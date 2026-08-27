// Tauri 桌面壳主逻辑。
// 阶段 2：启动 Python sidecar，注入 runtime config，应用退出/崩溃时回收 sidecar。

use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_shell::process::CommandChild;

mod download;
mod job;
mod sidecar;

/// 持有 sidecar 子进程句柄与 Job Object。
/// 正常退出时显式 kill child；崩溃/强杀时 Job Object 句柄随进程释放，
/// 内核自动 kill 绑定的 sidecar。
struct AppState {
    sidecar_child: Mutex<Option<CommandChild>>,
    #[allow(dead_code)]
    sidecar_job: Mutex<Option<job::SidecarJob>>,
}

/// 共享的 RuntimeConfig，供前端通过 get_runtime_config 命令读取。
/// download 模块的认证下载命令也读这里取会话令牌。
#[derive(Default)]
pub(crate) struct SharedRuntimeConfig(pub(crate) Mutex<Option<sidecar::RuntimeConfig>>);

#[tauri::command]
fn get_runtime_config(state: tauri::State<'_, SharedRuntimeConfig>) -> sidecar::RuntimeConfig {
    state
        .0
        .lock()
        .unwrap()
        .clone()
        .expect("runtime config not initialized")
}

/// 应用启动时由 Tauri 调用。负责创建主窗口、启动 sidecar 并注册插件。
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // 单实例：再次启动时把已有窗口提到前台。
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .manage(SharedRuntimeConfig::default())
        .setup(|app| {
            let window = app
                .get_webview_window("main")
                .ok_or_else(|| tauri::Error::WindowNotFound)?;

            // 生成随机会话令牌。阶段 2 不校验，阶段 3 起 FastAPI 中间件校验。
            let session_token = generate_session_token();
            let app_version = env!("CARGO_PKG_VERSION").to_string();

            let (config, child) =
                sidecar::spawn_and_wait(app.handle(), session_token, app_version)?;

            // 绑定 Job Object：Tauri 崩溃时内核兜底回收 sidecar。
            let pid = child.pid();
            let sidecar_job = job::SidecarJob::assign(pid).map_err(|e| {
                eprintln!("绑定 Job Object 失败（pid={pid}）: {e}");
                e
            })?;

            app.state::<SharedRuntimeConfig>()
                .0
                .lock()
                .unwrap()
                .replace(config);

            app.manage(AppState {
                sidecar_child: Mutex::new(Some(child)),
                sidecar_job: Mutex::new(Some(sidecar_job)),
            });

            window.show()?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_runtime_config,
            download::fetch_authenticated_blob,
            download::save_backend_download
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run({
            move |app_handle, event| {
                if let tauri::RunEvent::ExitRequested { .. } = event {
                    // 正常退出：显式 kill sidecar。Job Object 作为崩溃兜底。
                    if let Some(state) = app_handle.try_state::<AppState>() {
                        if let Some(child) = state.sidecar_child.lock().unwrap().take() {
                            let _ = child.kill();
                        }
                    }
                }
            }
        });
}

fn generate_session_token() -> String {
    // 不引入 uuid 依赖：用系统时间纳秒构造本地唯一性足够的令牌。
    // 阶段 3 起由 FastAPI 校验，强度足够防本地随机端口被外部探测。
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("sid-{nanos:x}")
}
