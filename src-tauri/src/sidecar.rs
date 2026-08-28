// Sidecar 进程管理（阶段 2）。
//
// 由 Tauri 在 setup 或迁移完成后启动 Python API sidecar，解析其 stdout 的
// ready JSON，拿到 api_base_url 后注入前端。进程生命周期由 Tauri 管理：
// - 正常关闭：Tauri 退出时 kill sidecar（见 lib.rs 的 ExitRequested）。
// - 崩溃/更新：Windows Job Object 保证回收（见 job.rs）。
//
// 阶段 5 起，spawn 前通过 REIMBURSEMENT_APP_ROOT 注入 runtime 目录
// （%LOCALAPPDATA%\com.winloud.reimbursementtool\runtime，见 migration.rs），
// 使 sidecar 的数据库/附件/日志离开安装目录。开发模式下若 runtime 不存在
// 则不注入，sidecar 回退到源码根。
//
// 开发模式下通过环境变量 REIMBURSEMENT_SIDECAR_CMD 指定启动命令
// （例如 "python sidecar_app.py --port 0"）；打包后由 Tauri sidecar 机制运行 onedir exe。
//
// TODO(阶段 5+) 生产 sidecar 打包：当前 resolve_sidecar_command 在无开发环境变量时
// 回退到 `python sidecar_app.py`，仅用于开发/测试。生产安装包既无 Python 也无源码，
// 由 resolve_sidecar_command 解析 resource_dir()/reimbursement-sidecar/
// reimbursement-sidecar.exe（PyInstaller onedir 产物经 bundle.resources 装入 NSIS）。
// 构建脚本（阶段 7）负责把 onedir 产物放到 src-tauri/resources/reimbursement-sidecar/
// 供 cargo tauri build 打包。python 回退保留为开发兜底。

use std::collections::HashMap;
use serde::Deserialize;
use tauri::async_runtime::block_on;
use tauri::Manager;
use tokio::time::timeout;
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

const READY_TIMEOUT_SECS: u64 = 30;

/// sidecar 启动后通过 stdout 输出的就绪描述符。
#[derive(Debug, Deserialize)]
pub struct SidecarReady {
    pub event: String,
    pub api_base_url: String,
}

/// 运行时配置，注入前端供其访问 sidecar API。
#[derive(Debug, Clone, serde::Serialize)]
pub struct RuntimeConfig {
    pub api_base_url: String,
    pub session_token: Option<String>,
    pub app_version: String,
}

/// 启动 sidecar 并等待 ready。返回 (RuntimeConfig, sidecar 进程句柄)。
///
/// `session_token` 由 Rust 生成传入 sidecar 环境变量；阶段 2 暂不校验，
/// 阶段 3 起由 FastAPI 中间件校验。
pub fn spawn_and_wait(
    app: &tauri::AppHandle,
    session_token: String,
    app_version: String,
) -> Result<(RuntimeConfig, tauri_plugin_shell::process::CommandChild), String> {
    let (program, args) = resolve_sidecar_command(app)?;

    let mut envs = HashMap::new();
    envs.insert(
        "REIMBURSEMENT_SESSION_TOKEN".to_string(),
        session_token.clone(),
    );
    envs.insert("REIMBURSEMENT_APP_VERSION".to_string(), app_version.clone());
    // 阶段 5：把 runtime 目录经 REIMBURSEMENT_APP_ROOT 注入 sidecar，
    // 使数据库/附件/日志落到 %LOCALAPPDATA%\com.winloud.reimbursementtool\runtime，
    // 离开安装目录。runtime 已由迁移/新建流程就绪（见 migration.rs）；
    // 开发模式下若 runtime 不存在则不注入，sidecar 回退到源码根（开发兜底）。
    if let Some(runtime_root) = crate::migration::runtime_root_for_sidecar(app) {
        envs.insert("REIMBURSEMENT_APP_ROOT".to_string(), runtime_root);
    }

    let (mut rx, child) = app
        .shell()
        .command(program)
        .args(args)
        .envs(envs)
        .spawn()
        .map_err(|e| format!("启动 sidecar 失败: {e}"))?;

    eprintln!("sidecar spawned pid={}", child.pid());

    // 阻塞等待 ready JSON，带超时。setup 是同步上下文，用 block_on 跑异步 recv。
    // 任何错误出口都先 kill child 再返回，避免遗留后台 Python 进程
    // （Job Object 要等本函数成功返回后由 lib.rs 绑定，此处失败时尚未绑定）。
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(READY_TIMEOUT_SECS);
    let ready_result = block_on(async {
        loop {
            if std::time::Instant::now() >= deadline {
                return Err("sidecar 启动超时未输出 ready JSON".to_string());
            }
            match timeout(std::time::Duration::from_millis(200), rx.recv()).await {
                Ok(Some(CommandEvent::Stdout(bytes))) => {
                    let line = String::from_utf8_lossy(&bytes);
                    eprintln!("sidecar stdout: {line}");
                    if let Ok(ready) = serde_json::from_str::<SidecarReady>(line.trim()) {
                        if ready.event == "ready" {
                            return Ok(ready.api_base_url);
                        }
                    }
                }
                Ok(Some(CommandEvent::Stderr(bytes))) => {
                    eprintln!("sidecar stderr: {}", String::from_utf8_lossy(&bytes));
                }
                Ok(Some(CommandEvent::Terminated(payload))) => {
                    return Err(format!("sidecar 提前退出: {payload:?}"));
                }
                Ok(Some(CommandEvent::Error(msg))) => {
                    return Err(format!("sidecar 事件错误: {msg}"));
                }
                Ok(None) => return Err("sidecar 输出通道关闭".to_string()),
                Ok(Some(_)) => continue,
                Err(_) => continue,
            }
        }
    });

    let api_base_url = match ready_result {
        Ok(url) => url,
        Err(e) => {
            // spawn 已成功但就绪等待失败：显式终止子进程，避免遗留后台进程。
            let _ = child.kill();
            return Err(e);
        }
    };

    Ok((
        RuntimeConfig {
            api_base_url,
            session_token: Some(session_token),
            app_version,
        },
        child,
    ))
}

/// 解析 sidecar 启动命令。优先级：
/// 1. 环境变量 REIMBURSEMENT_SIDECAR_CMD（开发模式，空格分割，首段为程序）。
/// 2. 打包产物：resource_dir()/reimbursement-sidecar/reimbursement-sidecar.exe
///    （生产 NSIS 安装后，sidecar onedir 经 bundle.resources 装入）。
/// 3. 开发兜底：python sidecar_app.py（源码根）。
fn resolve_sidecar_command(app: &tauri::AppHandle) -> Result<(String, Vec<String>), String> {
    if let Ok(cmd) = std::env::var("REIMBURSEMENT_SIDECAR_CMD") {
        let parts: Vec<String> = cmd.split_whitespace().map(String::from).collect();
        if parts.is_empty() {
            return Err("REIMBURSEMENT_SIDECAR_CMD 不能为空".into());
        }
        let (program, args) = parts.split_first().unwrap();
        return Ok((program.clone(), args.to_vec()));
    }

    // 生产：解析打包进 NSIS 的 PyInstaller onedir exe。
    if let Ok(resource_dir) = app.path().resource_dir() {
        let sidecar_exe = resource_dir
            .join("reimbursement-sidecar")
            .join("reimbursement-sidecar.exe");
        if sidecar_exe.exists() {
            return Ok((sidecar_exe.to_string_lossy().into_owned(), vec!["--port".into(), "0".into()]));
        }
    }

    // 开发兜底：python 源码。
    Ok((
        "python".to_string(),
        vec!["sidecar_app.py".to_string(), "--port".into(), "0".into()],
    ))
}
