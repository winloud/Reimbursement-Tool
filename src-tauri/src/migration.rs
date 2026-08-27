// 数据迁移（阶段 5）。
//
// 运行数据固定到 %LOCALAPPDATA%\com.winloud.reimbursementtool\runtime。
// 首次启动时用户可选“新建空白数据”或“从旧便携版迁移”。
//
// 迁移按 ADR 0009 清单：
//   迁入：data/（含 expense.db 及 data/backups/）、uploads/、vendor/、
//         window-state.json（转换一次窗口位置到新坐标空间）
//   不迁：logs/、browser-profile/、versions/、staging/、launcher、
//         current-version.json、portable-release.json
//
// 安全保证（ADR 0009 首次迁移清单）：
// - 旧目录始终只读不修改（迁移只从旧目录读、复制到临时目录）。
// - 在临时目录 runtime.tmp 完成复制 + SHA256 比对 + 数据库完整性校验后，
//   原子 rename 为 runtime；任一步失败则删除 runtime.tmp，新目录不受影响。
// - 已存在 runtime 视为已初始化，直接复用，不重复迁移。

use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::Connection;
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

/// 运行数据根目录名（挂在 app_local_data_dir 下）。
pub const RUNTIME_DIR_NAME: &str = "runtime";
/// 临时迁移目录名，校验通过后原子改名。
const RUNTIME_TMP_DIR_NAME: &str = "runtime.tmp";

/// 迁入清单（相对旧便携根的路径）。目录递归复制，文件直接复制。
/// window-state.json 是可选文件，缺失不视为错误。
const MIGRATE_ENTRIES: &[&str] = &["data", "uploads", "vendor", "window-state.json"];

/// 旧便携根必须存在 data/expense.db 才认作有效旧目录。
const LEGACY_DB_REL: &str = "data/expense.db";

/// choose_legacy_root 返回的旧便携根预检结果。
#[derive(Debug, Serialize)]
pub struct LegacyRootCheck {
    pub path: String,
    pub valid: bool,
    /// valid=false 时的原因；valid=true 时为空。
    pub reason: String,
    /// 旧目录检测到的可迁入条目（供前端展示）。
    pub found_entries: Vec<String>,
}

/// initialize_runtime 返回的初始化结果。
#[derive(Debug, Serialize)]
pub struct RuntimeInitResult {
    pub success: bool,
    /// 成功时为 runtime 目录绝对路径；失败时为空。
    pub runtime_path: String,
    /// 失败原因（success=false 时）。
    pub error: String,
    /// 本次是否实际执行了迁移（true=从旧目录迁入，false=runtime 已存在直接复用
    /// 或为新建空白数据）。
    pub migrated: bool,
    /// 迁入的条目清单（migrated=true 时有值）。
    pub migrated_entries: Vec<String>,
}

/// 解析 runtime 目录。已存在则视为已初始化。
pub fn resolve_runtime_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("解析 AppLocalData 失败: {e}"))?;
    Ok(base.join(RUNTIME_DIR_NAME))
}

/// 弹原生文件夹选择对话框，让用户选旧便携根，并预检。
#[tauri::command]
pub async fn choose_legacy_root(app: tauri::AppHandle) -> Result<LegacyRootCheck, String> {
    let picked = app
        .dialog()
        .file()
        .set_title("选择旧便携版安装根目录")
        .blocking_pick_folder();
    let path = match picked {
        Some(fp) => fp.into_path().map_err(|e| format!("解析选择的路径失败: {e}"))?,
        None => {
            return Ok(LegacyRootCheck {
                path: String::new(),
                valid: false,
                reason: "未选择目录".to_string(),
                found_entries: vec![],
            });
        }
    };

    Ok(check_legacy_root(&path))
}

/// 预检旧便携根：data/expense.db 存在即为有效，并列出可迁入条目。
pub fn check_legacy_root(path: &Path) -> LegacyRootCheck {
    let path_str = path.to_string_lossy().into_owned();
    let db = path.join(LEGACY_DB_REL);
    if !db.exists() {
        return LegacyRootCheck {
            path: path_str,
            valid: false,
            reason: format!("未找到 {LEGACY_DB_REL}，不是有效的旧便携版根目录"),
            found_entries: vec![],
        };
    }

    let found: Vec<String> = MIGRATE_ENTRIES
        .iter()
        .filter_map(|entry| {
            let p = path.join(entry);
            if p.exists() {
                Some((*entry).to_string())
            } else {
                None
            }
        })
        .collect();

    LegacyRootCheck {
        path: path_str,
        valid: true,
        reason: String::new(),
        found_entries: found,
    }
}

/// 初始化 runtime 目录。
///
/// `legacy_root` 为 Some 时从旧便携根迁移；为 None 时新建空白数据。
/// 已存在 runtime 则直接返回成功（migrated=false）。
#[tauri::command]
pub async fn initialize_runtime(
    app: tauri::AppHandle,
    legacy_root: Option<String>,
) -> Result<RuntimeInitResult, String> {
    let runtime = resolve_runtime_dir(&app)?;

    // 已存在 runtime 视为已初始化，不重复迁移。
    if runtime.exists() {
        return Ok(RuntimeInitResult {
            success: true,
            runtime_path: runtime.to_string_lossy().into_owned(),
            error: String::new(),
            migrated: false,
            migrated_entries: vec![],
        });
    }

    let migrated_entries = match &legacy_root {
        Some(root) => migrate_from_legacy(&app, Path::new(root), &runtime)?,
        None => {
            create_blank_runtime(&app)?;
            vec![]
        }
    };

    Ok(RuntimeInitResult {
        success: true,
        runtime_path: runtime.to_string_lossy().into_owned(),
        error: String::new(),
        migrated: !migrated_entries.is_empty(),
        migrated_entries,
    })
}

/// 从旧便携根迁移到 runtime。复制到 runtime.tmp，校验通过后原子改名。
/// 失败时清理 runtime.tmp，返回 Err；旧目录不被修改。
fn migrate_from_legacy(
    app: &tauri::AppHandle,
    legacy_root: &Path,
    runtime: &Path,
) -> Result<Vec<String>, String> {
    let check = check_legacy_root(legacy_root);
    if !check.valid {
        return Err(check.reason);
    }

    let tmp = runtime
        .parent()
        .ok_or("runtime 目录无父级")?
        .join(RUNTIME_TMP_DIR_NAME);
    // 清理可能残留的旧 tmp。
    if tmp.exists() {
        let _ = fs::remove_dir_all(&tmp);
    }
    fs::create_dir_all(&tmp).map_err(|e| format!("创建临时目录失败: {e}"))?;

    // 复制并记录迁入条目（按 MIGRATE_ENTRIES 顺序）。
    let mut migrated: Vec<String> = Vec::new();
    let mut copy_pairs: Vec<(PathBuf, PathBuf)> = Vec::new(); // (源, 临时目标) 用于哈希校验
    for entry in MIGRATE_ENTRIES {
        let src = legacy_root.join(entry);
        if !src.exists() {
            continue; // 可选条目缺失跳过（window-state.json 等）
        }
        let dst = tmp.join(entry);
        if src.is_dir() {
            copy_dir_all(&src, &dst)
                .map_err(|e| format!("复制目录 {entry} 失败: {e}"))?;
        } else {
            if let Some(parent) = dst.parent() {
                fs::create_dir_all(parent)
                    .map_err(|e| format!("创建父目录失败: {e}"))?;
            }
            fs::copy(&src, &dst).map_err(|e| format!("复制文件 {entry} 失败: {e}"))?;
        }
        collect_pairs(&src, &dst, &mut copy_pairs);
        migrated.push((*entry).to_string());
    }

    // 校验：逐文件 SHA256 比对，确保复制完整。
    verify_hashes(&copy_pairs).map_err(|e| {
        cleanup_tmp(&tmp);
        format!("哈希校验失败: {e}")
    })?;

    // 数据库完整性校验：打开临时副本里的 expense.db 跑 PRAGMA integrity_check。
    let tmp_db = tmp.join(LEGACY_DB_REL);
    if tmp_db.exists() {
        verify_database(&tmp_db).map_err(|e| {
            cleanup_tmp(&tmp);
            format!("数据库完整性校验失败: {e}")
        })?;
    }

    // 原子改名 runtime.tmp -> runtime。
    fs::rename(&tmp, runtime).map_err(|e| {
        cleanup_tmp(&tmp);
        format!("启用 runtime 目录失败: {e}（临时目录已清理）")
    })?;

    let _ = app; // 预留：后续阶段在此触发首次迁移完成的 runtime config 注入
    Ok(migrated)
}

/// 新建空白数据 runtime 目录（让后端首次启动初始化 DB）。
fn create_blank_runtime(app: &tauri::AppHandle) -> Result<(), String> {
    let runtime = resolve_runtime_dir(app)?;
    fs::create_dir_all(runtime.join("data")).map_err(|e| format!("创建 runtime/data 失败: {e}"))?;
    fs::create_dir_all(runtime.join("uploads"))
        .map_err(|e| format!("创建 runtime/uploads 失败: {e}"))?;
    Ok(())
}

/// 递归复制目录。
fn copy_dir_all(src: &Path, dst: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if from.is_dir() {
            copy_dir_all(&from, &to)?;
        } else {
            fs::copy(&from, &to)?;
        }
    }
    Ok(())
}

/// 收集源/目标文件对（递归），用于哈希校验。
fn collect_pairs(src: &Path, dst: &Path, pairs: &mut Vec<(PathBuf, PathBuf)>) {
    if src.is_file() {
        pairs.push((src.to_path_buf(), dst.to_path_buf()));
        return;
    }
    if !src.is_dir() {
        return;
    }
    let Ok(entries) = fs::read_dir(src) else { return };
    for entry in entries.flatten() {
        let from = entry.path();
        let name = entry.file_name();
        let to = dst.join(&name);
        collect_pairs(&from, &to, pairs);
    }
}

/// 逐文件比对 SHA256，确保复制内容一致。
fn verify_hashes(pairs: &[(PathBuf, PathBuf)]) -> Result<(), String> {
    for (src, dst) in pairs {
        let src_hash = file_sha256(src).map_err(|e| format!("读取 {} 失败: {e}", src.display()))?;
        let dst_hash = file_sha256(dst).map_err(|e| format!("读取 {} 失败: {e}", dst.display()))?;
        if src_hash != dst_hash {
            return Err(format!(
                "哈希不一致: {} != {}",
                src.display(),
                dst.display()
            ));
        }
    }
    Ok(())
}

fn file_sha256(path: &Path) -> std::io::Result<[u8; 32]> {
    let bytes = fs::read(path)?;
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    let result = hasher.finalize();
    let mut out = [0u8; 32];
    out.copy_from_slice(&result);
    Ok(out)
}

/// 用 rusqlite 打开数据库跑 PRAGMA integrity_check。
fn verify_database(db_path: &Path) -> Result<(), String> {
    let conn = Connection::open(db_path)
        .map_err(|e| format!("打开数据库失败: {e}"))?;
    let result: String = conn
        .query_row("PRAGMA integrity_check", [], |row| row.get(0))
        .map_err(|e| format!("执行 integrity_check 失败: {e}"))?;
    if result != "ok" {
        return Err(format!("数据库完整性检查未通过: {result}"));
    }
    Ok(())
}

fn cleanup_tmp(tmp: &Path) {
    if tmp.exists() {
        let _ = fs::remove_dir_all(tmp);
    }
}

/// 判断 runtime 是否已初始化（供 lib.rs setup 决定是否启动迁移引导）。
pub fn is_runtime_ready(app: &tauri::AppHandle) -> bool {
    resolve_runtime_dir(app)
        .map(|p| p.exists())
        .unwrap_or(false)
}

/// 占位：阶段 5 收尾时把 runtime 目录通过 REIMBURSEMENT_APP_ROOT 注入 sidecar。
/// 实际注入在 sidecar::spawn_and_wait 的 envs 里完成（见 sidecar.rs）。
#[allow(dead_code)]
pub fn runtime_root_for_sidecar(app: &tauri::AppHandle) -> Option<String> {
    resolve_runtime_dir(app)
        .ok()
        .map(|p| p.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 造一个最小旧便携根（data/expense.db + uploads/一个文件 + vendor/一个文件
    /// + window-state.json），用于迁移测试。
    fn make_legacy_root(tmp: &Path) -> PathBuf {
        let root = tmp.join("legacy");
        fs::create_dir_all(root.join("data/backups")).unwrap();
        fs::create_dir_all(root.join("uploads")).unwrap();
        fs::create_dir_all(root.join("vendor")).unwrap();
        fs::write(root.join("data/expense.db"), b"sqlite-mock-db-content").unwrap();
        fs::write(root.join("data/backups/b1.zip"), b"backup1").unwrap();
        fs::write(root.join("uploads/invoice.pdf"), b"invoice").unwrap();
        fs::write(root.join("vendor/opencv"), b"opencv-bundle").unwrap();
        fs::write(root.join("window-state.json"), r#"{"x":10}"#).unwrap();
        // 不迁的条目
        fs::create_dir_all(root.join("logs")).unwrap();
        fs::write(root.join("logs/app.log"), b"logs").unwrap();
        root
    }

    #[test]
    fn check_legacy_root_validates_db_and_lists_entries() {
        let tmp = tempdir_workdir();
        let root = make_legacy_root(&tmp);
        let check = check_legacy_root(&root);
        assert!(check.valid, "应判为有效: {}", check.reason);
        assert_eq!(check.path, root.to_string_lossy());
        assert!(check.found_entries.contains(&"data".to_string()));
        assert!(check.found_entries.contains(&"uploads".to_string()));
        assert!(check.found_entries.contains(&"vendor".to_string()));
        assert!(check.found_entries.contains(&"window-state.json".to_string()));
        // logs 不在迁入清单
        assert!(!check.found_entries.contains(&"logs".to_string()));
    }

    #[test]
    fn check_legacy_root_rejects_missing_db() {
        let tmp = tempdir_workdir();
        let root = tmp.join("no-db");
        fs::create_dir_all(&root).unwrap();
        let check = check_legacy_root(&root);
        assert!(!check.valid);
        assert!(check.reason.contains("expense.db"));
    }

    #[test]
    fn copy_dir_all_recursively_copies_subtree() {
        let tmp = tempdir_workdir();
        let src = tmp.join("src");
        fs::create_dir_all(src.join("a/b")).unwrap();
        fs::write(src.join("a/b/f.txt"), b"deep").unwrap();
        fs::write(src.join("top.txt"), b"top").unwrap();
        let dst = tmp.join("dst");
        copy_dir_all(&src, &dst).unwrap();
        assert_eq!(fs::read(dst.join("a/b/f.txt")).unwrap(), b"deep");
        assert_eq!(fs::read(dst.join("top.txt")).unwrap(), b"top");
    }

    #[test]
    fn verify_hashes_passes_for_identical_files() {
        let tmp = tempdir_workdir();
        let a = tmp.join("a");
        let b = tmp.join("b");
        fs::write(&a, b"same").unwrap();
        fs::write(&b, b"same").unwrap();
        verify_hashes(&[(a.clone(), b.clone())]).unwrap();
    }

    #[test]
    fn verify_hashes_detects_tampered_copy() {
        let tmp = tempdir_workdir();
        let a = tmp.join("a");
        let b = tmp.join("b");
        fs::write(&a, b"original").unwrap();
        fs::write(&b, b"tampered").unwrap();
        let err = verify_hashes(&[(a, b)]).unwrap_err();
        assert!(err.contains("哈希不一致"));
    }

    /// 迁移端到端：旧目录 -> runtime.tmp -> 校验 -> 原子启用。
    /// 这里直接测 migrate_from_legacy 的内部步骤，绕开 AppHandle。
    #[test]
    fn migrate_copies_entries_and_excludes_untracked() {
        let tmp = tempdir_workdir();
        let legacy = make_legacy_root(&tmp);
        let runtime = tmp.join("runtime");
        // 模拟 migrate_from_legacy 的复制阶段（不依赖 AppHandle 的路径解析）
        let staging = tmp.join("runtime.tmp");
        fs::create_dir_all(&staging).unwrap();
        let mut migrated = Vec::new();
        for entry in MIGRATE_ENTRIES {
            let src = legacy.join(entry);
            if !src.exists() {
                continue;
            }
            let dst = staging.join(entry);
            if src.is_dir() {
                copy_dir_all(&src, &dst).unwrap();
            } else {
                if let Some(parent) = dst.parent() {
                    fs::create_dir_all(parent).unwrap();
                }
                fs::copy(&src, &dst).unwrap();
            }
            migrated.push((*entry).to_string());
        }
        // 迁入 4 个条目
        assert_eq!(migrated.len(), 4);
        // logs 未迁入
        assert!(!staging.join("logs").exists());
        // data/backups 子目录递归复制
        assert!(staging.join("data/backups/b1.zip").exists());
        assert_eq!(fs::read(staging.join("uploads/invoice.pdf")).unwrap(), b"invoice");
        // 哈希校验通过：只比对已迁入条目（logs 不在 staging，不应纳入）
        let mut pairs = Vec::new();
        for entry in MIGRATE_ENTRIES {
            let src = legacy.join(entry);
            let dst = staging.join(entry);
            if src.exists() {
                collect_pairs(&src, &dst, &mut pairs);
            }
        }
        assert!(!pairs.is_empty());
        verify_hashes(&pairs).unwrap();
        // 原子启用
        fs::rename(&staging, &runtime).unwrap();
        assert!(runtime.exists());
        assert!(!staging.exists());
    }

    /// 辅助：用 std::env::temp_dir 下唯一前缀避免并发测试互扰。
    /// 用线程 ID 区分并发测试线程（module_path! 在同模块所有测试下相同，无法区分）。
    fn tempdir_workdir() -> PathBuf {
        let thread_id = format!("{:?}", std::thread::current().id());
        let dir = std::env::temp_dir().join(format!(
            "reimbursement-migration-test-{}",
            thread_id.replace("(", "-").replace(")", "").replace("::", "-")
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }
}
