// 原生下载与认证资源加载（阶段 4）。
//
// 取代旧桌面壳的浏览器/IDM 下载接管与 <img src> 直接 URL。
// - fetch_authenticated_blob：取回发票/附件文件字节供前端构造 blob URL 预览/打开。
// - save_backend_download：取回 prepare 描述符指向的字节，经原生保存对话框写磁盘。
//
// 会话令牌只存在 Rust 侧的 SharedRuntimeConfig；前端永远拿不到原始令牌
// （JSON API 调用由前端 axios 拦截器注入同一令牌，那是 get_runtime_config 的职责）。

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine};
use serde::Serialize;
use tauri_plugin_dialog::DialogExt;

use crate::SharedRuntimeConfig;

/// fetch_authenticated_blob 返回体：base64 编码的字节 + mime 类型。
#[derive(Serialize)]
pub struct BlobPayload {
    pub bytes_base64: String,
    pub mime_type: String,
}

/// save_backend_download 返回体。
#[derive(Serialize)]
pub struct SavedFile {
    pub saved_path: String,
}

/// 取回认证资源的字节供前端构造 blob URL。
/// `url` 既可相对（如 /api/invoices/7/file）也可绝对；相对时以 sidecar api_base_url 为前缀。
#[tauri::command]
pub async fn fetch_authenticated_blob(
    state: tauri::State<'_, SharedRuntimeConfig>,
    url: String,
) -> Result<BlobPayload, String> {
    let config = state
        .0
        .lock()
        .unwrap()
        .as_ref()
        .cloned()
        .ok_or_else(|| "runtime config 未初始化".to_string())?;
    let session_token = config
        .session_token
        .ok_or_else(|| "缺少会话令牌".to_string())?;

    let full_url = resolve_url(&config.api_base_url, &url);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| format!("构建 HTTP 客户端失败: {e}"))?;
    let response = client
        .get(&full_url)
        .header("X-Session-Token", &session_token)
        .send()
        .await
        .map_err(|e| format!("请求资源失败: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("资源返回错误状态: {}", response.status()));
    }
    let mime_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
        .unwrap_or_else(|| "application/octet-stream".to_string());
    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("读取资源内容失败: {e}"))?;

    Ok(BlobPayload {
        bytes_base64: BASE64_STANDARD.encode(&bytes),
        mime_type,
    })
}

/// 经原生保存对话框下载认证资源到磁盘。
/// `suggested_filename` 用作保存对话框默认文件名；用户取消返回 Err("cancelled")。
#[tauri::command]
pub async fn save_backend_download(
    app: tauri::AppHandle,
    state: tauri::State<'_, SharedRuntimeConfig>,
    url: String,
    suggested_filename: String,
) -> Result<SavedFile, String> {
    let config = state
        .0
        .lock()
        .unwrap()
        .as_ref()
        .cloned()
        .ok_or_else(|| "runtime config 未初始化".to_string())?;
    let session_token = config
        .session_token
        .ok_or_else(|| "缺少会话令牌".to_string())?;

    let suggested = if suggested_filename.is_empty() {
        "download.bin".to_string()
    } else {
        suggested_filename
    };
    let target: Option<std::path::PathBuf> = app
        .dialog()
        .file()
        .set_file_name(&suggested)
        .blocking_save_file()
        .and_then(|fp| fp.into_path().ok());
    let target = match target {
        Some(path) => path,
        None => return Err("cancelled".to_string()),
    };

    let full_url = resolve_url(&config.api_base_url, &url);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| format!("构建 HTTP 客户端失败: {e}"))?;
    let response = client
        .get(&full_url)
        .header("X-Session-Token", &session_token)
        .send()
        .await
        .map_err(|e| format!("请求下载内容失败: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("下载返回错误状态: {}", response.status()));
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("读取下载内容失败: {e}"))?;

    // 写临时文件后先备份旧文件、再提交新文件，失败时恢复旧文件，保证覆盖不丢数据。
    commit_downloaded_file(&bytes, &target)?;

    Ok(SavedFile {
        saved_path: target.to_string_lossy().into_owned(),
    })
}

/// 原子落盘：临时文件 → 备份旧文件 → 改名提交 → 删除备份。
/// 提交失败时恢复旧文件并清理临时文件，保证覆盖保存不会把原文件弄丢。
fn commit_downloaded_file(bytes: &[u8], target: &std::path::Path) -> Result<(), String> {
    let tmp_path = target.with_extension(format!(
        "{}.downloading",
        target.extension().and_then(|e| e.to_str()).unwrap_or("tmp")
    ));
    std::fs::write(&tmp_path, bytes).map_err(|e| format!("写入临时文件失败: {e}"))?;

    let backup_path = std::path::PathBuf::from(format!("{}.bak", target.to_string_lossy()));
    let had_old = target.exists();
    if had_old {
        if backup_path.exists() {
            let _ = std::fs::remove_file(&backup_path);
        }
        std::fs::rename(target, &backup_path).map_err(|e| format!("备份旧文件失败: {e}"))?;
    }

    if let Err(rename_err) = std::fs::rename(&tmp_path, target) {
        // 提交失败：尝试恢复旧文件，并清理临时文件。
        let restore_msg = if had_old {
            match std::fs::rename(&backup_path, target) {
                Ok(()) => "已恢复旧文件".to_string(),
                Err(restore_err) => format!(
                    "恢复旧文件也失败: {restore_err}，原文件备份在 {}",
                    backup_path.display()
                ),
            }
        } else {
            "无旧文件可恢复".to_string()
        };
        let _ = std::fs::remove_file(&tmp_path);
        return Err(format!("提交新文件失败: {rename_err}（{restore_msg}）"));
    }

    // 提交成功，删除备份。
    if had_old {
        let _ = std::fs::remove_file(&backup_path);
    }
    Ok(())
}

/// 拼接相对/绝对 URL。
fn resolve_url(api_base_url: &str, url: &str) -> String {
    if url.starts_with("http://") || url.starts_with("https://") {
        return url.to_string();
    }
    let base = api_base_url.trim_end_matches('/');
    let relative = url.trim_start_matches('/');
    format!("{base}/{relative}")
}

#[cfg(test)]
mod tests {
    use super::{commit_downloaded_file, resolve_url};
    use std::fs;
    use std::path::PathBuf;

    /// 每个测试线程用独立目录，避免并发互扰。
    fn workdir(tag: &str) -> PathBuf {
        let thread_id = format!("{:?}", std::thread::current().id());
        let dir = std::env::temp_dir().join(format!(
            "reimbursement-download-{tag}-{}",
            thread_id.replace(['(', ')'], "-")
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn resolve_url_keeps_absolute_url() {
        assert_eq!(
            resolve_url("http://127.0.0.1:5000", "https://other.example/x"),
            "https://other.example/x"
        );
        assert_eq!(
            resolve_url("http://127.0.0.1:5000", "http://127.0.0.1:9000/api/health"),
            "http://127.0.0.1:9000/api/health"
        );
    }

    #[test]
    fn resolve_url_joins_relative_to_base() {
        assert_eq!(
            resolve_url("http://127.0.0.1:5000", "/api/invoices/7/file"),
            "http://127.0.0.1:5000/api/invoices/7/file"
        );
        assert_eq!(
            resolve_url("http://127.0.0.1:5000/", "api/reports/downloads/abc"),
            "http://127.0.0.1:5000/api/reports/downloads/abc"
        );
        assert_eq!(
            resolve_url("http://127.0.0.1:5000", "/api/report-attachments/3/file"),
            "http://127.0.0.1:5000/api/report-attachments/3/file"
        );
    }

    #[test]
    fn commit_writes_new_file_and_leaves_no_temp_artifacts() {
        let dir = workdir("new");
        let target = dir.join("report.pdf");

        commit_downloaded_file(b"pdf-bytes", &target).unwrap();

        assert_eq!(fs::read(&target).unwrap(), b"pdf-bytes");
        let leftovers: Vec<String> = fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|name| name != "report.pdf")
            .collect();
        assert!(leftovers.is_empty(), "残留中间文件: {leftovers:?}");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn commit_overwrites_existing_file_and_removes_backup() {
        let dir = workdir("overwrite");
        let target = dir.join("report.pdf");
        fs::write(&target, b"old-bytes").unwrap();

        commit_downloaded_file(b"new-bytes", &target).unwrap();

        assert_eq!(fs::read(&target).unwrap(), b"new-bytes");
        assert!(
            !dir.join("report.pdf.bak").exists(),
            "提交成功后备份文件必须删除"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn commit_reports_error_when_target_directory_is_missing() {
        let dir = workdir("missing");
        let target = dir.join("nope").join("report.pdf");

        let err = commit_downloaded_file(b"bytes", &target).unwrap_err();

        assert!(err.contains("写入临时文件失败"), "实际错误: {err}");
        assert!(!target.exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn commit_handles_target_without_extension() {
        let dir = workdir("noext");
        let target = dir.join("payload");

        commit_downloaded_file(b"raw", &target).unwrap();

        assert_eq!(fs::read(&target).unwrap(), b"raw");
        let _ = fs::remove_dir_all(&dir);
    }
}
