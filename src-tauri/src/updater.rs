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
    let compat = fetch_data_compat(UPDATE_FEED_URL).await;

    let current_schema = current_data_schema(&app).unwrap_or(-1);

    match updater.check().await {
        Ok(Some(update)) => {
            let (min_schema, max_schema, data_compatible) = match &compat {
                Ok(c) => {
                    let ok = current_schema >= c.min_data_schema_version
                        && current_schema <= c.max_data_schema_version;
                    (c.min_data_schema_version, c.max_data_schema_version, ok)
                }
                Err(e) => {
                    // 元数据拉取失败：保守起见视为兼容，让用户自行决定
                    // （避免 feed 临时不可用时阻断所有更新）。
                    eprintln!("data-compat 拉取失败，按兼容处理: {e}");
                    (0, i64::MAX, true)
                }
            };
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
                        "新版要求数据结构版本 {min}–{max}，当前为 {current_schema}，请先在数据维护页迁移数据",
                        min = min_schema,
                        max = max_schema,
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

/// 安装更新。先 pre_update 备份，再停 sidecar，再下载验签安装，最后重启。
#[tauri::command]
pub async fn install_update(
    app: tauri::AppHandle,
) -> Result<InstallResult, String> {
    // 1. pre_update 备份（安装失败时这是回退点）。
    let backup_path = create_pre_update_backup(&app)
        .map_err(|e| format!("创建升级前备份失败: {e}"))?;

    // 2. 停 sidecar（避免安装时 DB 被占用）。
    if let Some(state) = app.try_state::<crate::AppState>() {
        if let Some(child) = state.sidecar_child.lock().unwrap().take() {
            let _ = child.kill();
        }
    }

    // 3. 下载 + 验签 + 安装。updater 插件用 pubkey 验签，passive 模式安装。
    let updater = app.updater().map_err(|e| format!("初始化更新器失败: {e}"))?;
    let update = updater
        .check()
        .await
        .map_err(|e| format!("检查更新失败: {e}"))?
        .ok_or("没有可用更新")?;

    update
        .download_and_install(
            |progress, total| {
                // 进度回调：前端可通过事件订阅，此处仅记录。
                eprintln!("更新下载进度: {progress} 字节 / 共 {:?} 字节", total);
            },
            || {
                eprintln!("更新下载完成，准备安装");
            },
        )
        .await
        .map_err(|e| format!("下载安装更新失败: {e}"))?;

    Ok(InstallResult {
        success: true,
        error: String::new(),
        backup_path: backup_path.to_string_lossy().into_owned(),
    })
    // 安装完成后由 NSIS passive 模式触发重启；Tauri 进程会被替换。
    // 这里不显式 restart，交由安装器。
}

/// 创建 pre_update 备份：复制 runtime 关键内容到 app_local_data/pre_update/<timestamp>，
/// 保留最近 PRE_UPDATE_KEEP 份，老的删除。
fn create_pre_update_backup(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let runtime = crate::migration::resolve_runtime_dir(app)?;
    let base = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("解析 AppLocalData 失败: {e}"))?;
    let backup_root = base.join(PRE_UPDATE_DIR_NAME);

    // 备份目录用计数标识（不能用时间戳，Date.now 在 workflow 脚本不可用；
    // 但这是 Rust 运行时，SystemTime 可用）。
    use std::time::{SystemTime, UNIX_EPOCH};
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let backup_dir = backup_root.join(format!("pre_update_{ts}"));
    fs::create_dir_all(&backup_dir)
        .map_err(|e| format!("创建备份目录失败: {e}"))?;

    // 复制 runtime 的 data/（含 expense.db + backups）和 uploads/。
    // vendor/、logs/、window-state.json 不纳入升级前备份（体积大或可重建）。
    for entry in ["data", "uploads"] {
        let src = runtime.join(entry);
        if !src.exists() {
            continue;
        }
        let dst = backup_dir.join(entry);
        copy_dir_recursive(&src, &dst).map_err(|e| format!("备份 {entry} 失败: {e}"))?;
    }

    // 清理旧备份，保留最近 PRE_UPDATE_KEEP 份。
    prune_old_backups(&backup_root, PRE_UPDATE_KEEP);

    Ok(backup_dir)
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

#[cfg(test)]
mod tests {
    use super::*;

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
