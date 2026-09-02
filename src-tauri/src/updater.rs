// 更新器（阶段 6）。
//
// 基于 tauri-plugin-updater 实现：
// - check_for_update：拉 latest.json 比对版本；同时拉 data-compat 元数据
//   校验当前数据库 schema 是否在新版兼容范围内，不兼容则拒绝并提示先迁移数据。
// - install_update：创建 pre_update 备份（runtime 关键内容复制到 runtime 同级，
//   保留最近 3 份）→ 停 sidecar → 下载+验签+passive 安装 → 重启。
//
// 签名：更新包由 tauri-cli signer 生成密钥对，私钥签名（发布流程注入），
// 公钥写入 tauri.conf.json 的 plugins.updater.pubkey，客户端验签。
//
// feed：GitHub Releases 上的 latest.json（标准 updater 格式）+ data-compat.json
// （自定义，声明 min_data_schema_version / max_data_schema_version）。

use std::fs;
use std::path::PathBuf;

use rusqlite::Connection;
use serde::Deserialize;
use serde::Serialize;
use tauri::Manager;
use tauri_plugin_updater::UpdaterExt;

/// pre_update 备份保留份数（ADR 0009：最近 3 份）。
const PRE_UPDATE_KEEP: usize = 3;
/// pre_update 备份目录前缀（挂在 app_local_data_dir 下，与 runtime 同级）。
const PRE_UPDATE_DIR_NAME: &str = "pre_update";

/// updater feed 地址（与 tauri.conf.json plugins.updater.endpoints 保持一致）。
/// 修改时需同步更新 tauri.conf.json。
const UPDATE_FEED_URL: &str =
    "https://github.com/winloud/Reimbursement-Tool/releases/latest/download/latest.json";

/// data-compat.json：声明新版兼容的数据结构范围。
/// 放在 GitHub Releases 上，与 latest.json 同址。
#[derive(Debug, Deserialize)]
pub struct DataCompat {
    /// 新版能读取的最低 DB schema 版本（PRAGMA user_version）。
    pub min_data_schema_version: i64,
    /// 新版能读取的最高 DB schema 版本（通常等于当前 schema）。
    pub max_data_schema_version: i64,
}

/// check_for_update 返回的更新信息。
#[derive(Debug, Serialize)]
pub struct UpdateInfo {
    pub available: bool,
    pub version: String,
    pub current_version: String,
    /// 当前 DB schema 版本；读取失败时为 -1。
    pub current_data_schema: i64,
    /// 新版兼容的最低/最高 DB schema。
    pub min_data_schema: i64,
    pub max_data_schema: i64,
    /// 数据结构是否兼容（false 时前端应提示用户先迁移数据，不提供安装）。
    pub data_compatible: bool,
    /// 更新说明（latest.json 的 notes）。
    pub notes: String,
    /// 兼容性/错误说明。
    pub message: String,
}

/// install_update 返回。
#[derive(Debug, Serialize)]
pub struct InstallResult {
    pub success: bool,
    pub error: String,
    /// pre_update 备份目录路径（成功时）。
    pub backup_path: String,
}

/// 查询更新。不自动安装，前端拿到结果后展示并请求用户确认。
#[tauri::command]
pub async fn check_for_update(app: tauri::AppHandle) -> Result<UpdateInfo, String> {
    let current_version = env!("CARGO_PKG_VERSION").to_string();

    let updater = app
        .updater()
        .map_err(|e| format!("初始化更新器失败: {e}"))?;

    // data-compat 元数据与 latest.json 同址（由 UPDATE_FEED_URL 推导）。
    // fail closed：元数据拉取/解析失败时不允许安装，避免在不明确兼容范围时升级。
    let current_schema = current_data_schema(&app).unwrap_or(-1);

    match updater.check().await {
        Ok(Some(update)) => {
            let compat = fetch_data_compat(UPDATE_FEED_URL).await?;
            let min_schema = compat.min_data_schema_version;
            let max_schema = compat.max_data_schema_version;
            let data_compatible = is_data_schema_compatible(current_schema, &compat);
            Ok(UpdateInfo {
                available: true,
                version: update.version.clone(),
                current_version,
                current_data_schema: current_schema,
                min_data_schema: min_schema,
                max_data_schema: max_schema,
                data_compatible,
                notes: update.body.clone().unwrap_or_default(),
                message: if data_compatible {
                    String::new()
                } else {
                    format!(
                        "新版要求数据结构版本 {min_schema}–{max_schema}，当前为 {current_schema}，请先在数据维护页迁移数据",
                    )
                },
            })
        }
        Ok(None) => Ok(UpdateInfo {
            available: false,
            version: current_version.clone(),
            current_version,
            current_data_schema: current_schema,
            min_data_schema: 0,
            max_data_schema: 0,
            data_compatible: true,
            notes: String::new(),
            message: "已是最新版本".to_string(),
        }),
        Err(e) => Err(format!("检查更新失败: {e}")),
    }
}

/// 安装更新。流程：
/// 1. 重新 check 并校验数据兼容（确保即将安装的版本就是校验过的版本）。
/// 2. pre_update 备份：SQLite 在线热备（sidecar 运行时也能拿一致快照）+ 复制 uploads。
/// 3. 停 sidecar（释放 resources 里 sidecar exe 的文件锁）。
/// 4. 下载 + 验签 + 安装。
/// 5. 任一失败：重启 sidecar 恢复后端，把错误返回前端。
/// 6. 成功：app.restart() 重新拉起应用（NSIS passive 安装会退出当前进程，但不自动重开）。
#[tauri::command]
pub async fn install_update(
    app: tauri::AppHandle,
) -> Result<InstallResult, String> {
    let updater = app.updater().map_err(|e| format!("初始化更新器失败: {e}"))?;

    // 1. 重新 check 并校验兼容，确保即将安装的版本通过了兼容检查。
    let update = updater
        .check()
        .await
        .map_err(|e| format!("检查更新失败: {e}"))?
        .ok_or("没有可用更新")?;
    let compat = fetch_data_compat(UPDATE_FEED_URL).await?;
    let current_schema = current_data_schema(&app).unwrap_or(-1);
    if !is_data_schema_compatible(current_schema, &compat) {
        return Err(format!(
            "当前数据结构版本 {current_schema} 不在新版兼容范围 {}–{}，请先迁移数据",
            compat.min_data_schema_version, compat.max_data_schema_version
        ));
    }

    // 2. pre_update 备份（SQLite 热备 + uploads 复制）。sidecar 仍运行，但热备保证一致性。
    let backup_path = create_pre_update_backup(&app)
        .map_err(|e| format!("创建升级前备份失败: {e}"))?;

    // 3. 停 sidecar。
    if let Some(state) = app.try_state::<crate::AppState>() {
        if let Some(child) = state.sidecar_child.lock().unwrap().take() {
            let _ = child.kill();
        }
    }

    // 4. 下载 + 验签 + 安装。失败则在错误出口统一恢复 sidecar（见下方处理）。
    let install_result = update
        .download_and_install(
            |progress, total| {
                eprintln!("更新下载进度: {progress} 字节 / 共 {:?} 字节", total);
            },
            || {
                eprintln!("更新下载完成，准备安装");
            },
        )
        .await;

    if let Err(e) = install_result {
        // 5. 失败恢复：重启 sidecar，保证前端后端可用。附带备份路径供用户回退。
        let backup_msg = format!("升级前备份: {}", backup_path.display());
        match restore_sidecar(&app).await {
            Ok(()) => return Err(format!("下载安装更新失败: {e}；已恢复后端。{backup_msg}")),
            Err(restore_err) => return Err(format!(
                "下载安装更新失败: {e}；恢复后端也失败: {restore_err}（请手动重启程序）。{backup_msg}"
            )),
        }
    }

    // 6. 重启应用。download_and_install 成功后 NSIS passive 安装替换进程，
    // 但 Tauri 官方示例仍显式 restart 拉起新版本。restart() 不返回（类型为 !），
    // 成功路径不会回到前端；失败路径在上方已返回 Err。
    app.restart();
}

/// 重启 sidecar 恢复后端（更新失败后调用）。
/// Ok 表示已恢复，Err 表示恢复失败（前端应提示手动重启）。
async fn restore_sidecar(app: &tauri::AppHandle) -> Result<(), String> {
    crate::launch_sidecar(app).await
}

/// 创建 pre_update 备份：SQLite 在线热备 + 复制 uploads。
///
/// 数据库用 SQLite backup API 在 sidecar 运行时也能拿到一致快照（不依赖停 sidecar）；
/// uploads 直接文件复制（附件写入由业务层控制，复制期间无新增需保证；当前业务
/// 上传是用户主动操作，备份瞬间无写入，足够安全）。
fn create_pre_update_backup(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let runtime = crate::migration::resolve_runtime_dir(app)?;
    let base = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("解析 AppLocalData 失败: {e}"))?;
    let backup_root = base.join(PRE_UPDATE_DIR_NAME);

    use std::time::{SystemTime, UNIX_EPOCH};
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let backup_dir = backup_root.join(format!("pre_update_{ts}"));
    fs::create_dir_all(backup_dir.join("data"))
        .map_err(|e| format!("创建备份目录失败: {e}"))?;

    // SQLite 在线热备：打开源 DB（sidecar 仍运行，但 backup API 拿一致快照）。
    let src_db = runtime.join("data").join("expense.db");
    if src_db.exists() {
        let dst_db = backup_dir.join("data").join("expense.db");
        backup_database(&src_db, &dst_db)
            .map_err(|e| format!("数据库热备失败: {e}"))?;
    }
    // 复制 data/backups 子目录（备份的备份）。
    let src_backups = runtime.join("data").join("backups");
    if src_backups.exists() {
        copy_dir_recursive(&src_backups, &backup_dir.join("data").join("backups"))
            .map_err(|e| format!("备份 data/backups 失败: {e}"))?;
    }

    // 复制 uploads。
    let src_uploads = runtime.join("uploads");
    if src_uploads.exists() {
        copy_dir_recursive(&src_uploads, &backup_dir.join("uploads"))
            .map_err(|e| format!("备份 uploads 失败: {e}"))?;
    }

    // 清理旧备份，保留最近 PRE_UPDATE_KEEP 份。
    prune_old_backups(&backup_root, PRE_UPDATE_KEEP);

    Ok(backup_dir)
}

/// 用 SQLite backup API 做在线热备，保证事务一致性。
fn backup_database(src: &std::path::Path, dst: &std::path::Path) -> Result<(), String> {
    use rusqlite::backup::Backup;
    let src_conn = Connection::open(src).map_err(|e| format!("打开源 DB 失败: {e}"))?;
    let mut dst_conn = Connection::open(dst).map_err(|e| format!("打开目标 DB 失败: {e}"))?;
    let backup = Backup::new(&src_conn, &mut dst_conn).map_err(|e| format!("初始化 backup 失败: {e}"))?;
    backup
        .run_to_completion(100, std::time::Duration::from_millis(10), Some(|_| {}))
        .map_err(|e| format!("backup 执行失败: {e}"))?;
    Ok(())
}

fn copy_dir_recursive(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if from.is_dir() {
            copy_dir_recursive(&from, &to)?;
        } else {
            fs::copy(&from, &to)?;
        }
    }
    Ok(())
}

fn prune_old_backups(backup_root: &std::path::Path, keep: usize) {
    let Ok(entries) = fs::read_dir(backup_root) else { return };
    let mut dirs: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            p.is_dir() && p.file_name().and_then(|n| n.to_str()).unwrap_or("").starts_with("pre_update_")
        })
        .collect();
    // 按路径名排序（含时间戳，字典序=时间序）。
    dirs.sort();
    let remove_count = dirs.len().saturating_sub(keep);
    for p in dirs.into_iter().take(remove_count) {
        let _ = fs::remove_dir_all(&p);
    }
}

/// 读取当前 runtime DB 的 PRAGMA user_version（= data schema 版本）。
fn current_data_schema(app: &tauri::AppHandle) -> Result<i64, String> {
    let runtime = crate::migration::resolve_runtime_dir(app)?;
    let db = runtime.join("data").join("expense.db");
    if !db.exists() {
        return Ok(0); // 新建空白数据，视为 schema 0
    }
    let conn = Connection::open(&db).map_err(|e| format!("打开数据库失败: {e}"))?;
    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|e| format!("读取 user_version 失败: {e}"))?;
    Ok(version)
}

/// 从 latest.json 同址推导 data-compat.json URL 并拉取。
/// endpoints 形如 https://.../releases/latest.json，则 compat 为
/// https://.../releases/data-compat.json。
async fn fetch_data_compat(latest_json_url: &str) -> Result<DataCompat, String> {
    let compat_url = latest_json_url
        .trim_end_matches('/')
        .replace("latest.json", "data-compat.json");
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("构建 HTTP 客户端失败: {e}"))?;
    let resp = client
        .get(&compat_url)
        .send()
        .await
        .map_err(|e| format!("请求 data-compat 失败: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("data-compat 返回 {}", resp.status()));
    }
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("读取 data-compat 失败: {e}"))?;
    serde_json::from_slice::<DataCompat>(&bytes)
        .map_err(|e| format!("解析 data-compat 失败: {e}"))
}

/// 数据结构兼容门禁。current 为 -1 表示读不到本地 schema 版本（数据库缺失或损坏），
/// 此时一律判为不兼容（fail closed），避免在不明确的数据状态下让新版覆盖安装。
fn is_data_schema_compatible(current: i64, compat: &DataCompat) -> bool {
    if current < 0 {
        return false;
    }
    current >= compat.min_data_schema_version && current <= compat.max_data_schema_version
}

#[cfg(test)]
mod tests {
    use super::*;

    fn compat(min: i64, max: i64) -> DataCompat {
        DataCompat {
            min_data_schema_version: min,
            max_data_schema_version: max,
        }
    }

    #[test]
    fn data_schema_gate_accepts_versions_inside_range() {
        assert!(is_data_schema_compatible(7, &compat(7, 7)));
        assert!(is_data_schema_compatible(7, &compat(5, 9)));
        assert!(is_data_schema_compatible(5, &compat(5, 9)));
        assert!(is_data_schema_compatible(9, &compat(5, 9)));
    }

    #[test]
    fn data_schema_gate_rejects_versions_outside_range() {
        assert!(!is_data_schema_compatible(4, &compat(5, 9)));
        assert!(!is_data_schema_compatible(10, &compat(5, 9)));
        assert!(!is_data_schema_compatible(6, &compat(7, 7)));
    }

    #[test]
    fn data_schema_gate_fails_closed_when_local_schema_is_unknown() {
        // current_data_schema 读失败时传入 -1，绝不能因为 min=0 而放行。
        assert!(!is_data_schema_compatible(-1, &compat(0, 99)));
        assert!(!is_data_schema_compatible(-1, &compat(7, 7)));
    }

    #[test]
    fn data_compat_parses_feed_payload() {
        let parsed: DataCompat = serde_json::from_str(
            r#"{"min_data_schema_version":7,"max_data_schema_version":8,"extra":"ignored"}"#,
        )
        .unwrap();
        assert_eq!(parsed.min_data_schema_version, 7);
        assert_eq!(parsed.max_data_schema_version, 8);
        // 缺字段必须解析失败，否则会退化成默认 0–0 的假兼容范围。
        assert!(serde_json::from_str::<DataCompat>(r#"{"min_data_schema_version":7}"#).is_err());
    }

    #[test]
    fn copy_dir_recursive_copies_subtree() {
        let tmp = std::env::temp_dir().join(format!(
            "reimbursement-updater-test-{:?}",
            std::thread::current().id()
        ));
        let _ = fs::remove_dir_all(&tmp);
        let src = tmp.join("src");
        fs::create_dir_all(src.join("a")).unwrap();
        fs::write(src.join("a/f.txt"), b"deep").unwrap();
        fs::write(src.join("top.txt"), b"top").unwrap();
        let dst = tmp.join("dst");
        copy_dir_recursive(&src, &dst).unwrap();
        assert_eq!(fs::read(dst.join("a/f.txt")).unwrap(), b"deep");
        assert_eq!(fs::read(dst.join("top.txt")).unwrap(), b"top");
        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn prune_old_backups_keeps_only_recent_n() {
        let tmp = std::env::temp_dir().join(format!(
            "reimbursement-updater-prune-{:?}",
            std::thread::current().id()
        ));
        let _ = fs::remove_dir_all(&tmp);
        let root = tmp.join("pre_update");
        fs::create_dir_all(&root).unwrap();
        // 造 5 个备份（按时间戳命名，字典序=时间序）。
        for i in 0..5 {
            fs::create_dir_all(root.join(format!("pre_update_{i}"))).unwrap();
        }
        prune_old_backups(&root, 3);
        let remaining: Vec<String> = fs::read_dir(&root)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(remaining.len(), 3, "应保留 3 份，实际 {remaining:?}");
        // 保留的应是最大的 3 个（pre_update_2/3/4）。
        assert!(remaining.contains(&"pre_update_4".to_string()));
        assert!(remaining.contains(&"pre_update_3".to_string()));
        assert!(remaining.contains(&"pre_update_2".to_string()));
        assert!(!remaining.contains(&"pre_update_0".to_string()));
        let _ = fs::remove_dir_all(&tmp);
    }
}
