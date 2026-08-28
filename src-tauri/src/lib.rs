// Tauri 桌面壳主逻辑。
// 阶段 2：启动 Python sidecar，注入 runtime config，应用退出/崩溃时回收 sidecar。

use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_shell::process::CommandChild;

mod download;
mod job;
mod migration;
mod sidecar;
mod updater;

/// 持有 sidecar 子进程句柄与 Job Object。
/// 正常退出时显式 kill child；崩溃/强杀时 Job Object 句柄随进程释放，
/// 内核自动 kill 绑定的 sidecar。
pub(crate) struct AppState {
    pub(crate) sidecar_child: Mutex<Option<CommandChild>>,
    #[allow(dead_code)]
    sidecar_job: Mutex<Option<job::SidecarJob>>,
}

/// 共享的 RuntimeConfig，供前端通过 get_runtime_config 命令读取。
/// download 模块的认证下载命令也读这里取会话令牌。
#[derive(Default)]
pub(crate) struct SharedRuntimeConfig(pub(crate) Mutex<Option<sidecar::RuntimeConfig>>);

/// 运行时初始化状态：供前端首屏判断是否需要走迁移引导。
#[derive(Default)]
pub(crate) struct RuntimeInitState(pub(crate) Mutex<Option<RuntimeInitStatus>>);

/// runtime 初始化状态。
/// - Ready：runtime 已就绪，sidecar 已（或即将）启动。
/// - NeedsInit：runtime 未初始化，前端应渲染迁移/新建引导，完成后调
///   start_sidecar_after_init 启动 sidecar。
/// - Error：初始化或 sidecar 启动失败，附带原因供前端展示。
#[derive(Clone)]
pub(crate) enum RuntimeInitStatus {
    Ready,
    NeedsInit,
    Error(String),
}

#[tauri::command]
fn get_runtime_config(state: tauri::State<'_, SharedRuntimeConfig>) -> sidecar::RuntimeConfig {
    state
        .0
        .lock()
        .unwrap()
        .clone()
        .expect("runtime config not initialized")
}

/// 返回 runtime 初始化状态，供前端首屏决定渲染迁移引导还是业务界面。
#[tauri::command]
fn get_runtime_init_status(state: tauri::State<'_, RuntimeInitState>) -> String {
    match state.0.lock().unwrap().clone() {
        Some(RuntimeInitStatus::Ready) => "ready".to_string(),
        Some(RuntimeInitStatus::NeedsInit) => "needs_init".to_string(),
        Some(RuntimeInitStatus::Error(msg)) => format!("error:{msg}"),
        None => "unknown".to_string(),
    }
}

/// 迁移/新建完成后由前端调用，启动 sidecar 并注入 runtime 配置。
#[tauri::command]
async fn start_sidecar_after_init(
    app: tauri::AppHandle,
    state: tauri::State<'_, SharedRuntimeConfig>,
    init_state: tauri::State<'_, RuntimeInitState>,
    legacy_root: Option<String>,
) -> Result<String, String> {
    // 执行迁移/新建（若 runtime 已存在则直接复用）。
    let init_result = migration::initialize_runtime(app.clone(), legacy_root).await?;
    if !init_result.success {
        *init_state.0.lock().unwrap() = Some(RuntimeInitStatus::Error(init_result.error.clone()));
        return Err(init_result.error);
    }

    // 启动 sidecar。
    let session_token = generate_session_token();
    let app_version = env!("CARGO_PKG_VERSION").to_string();
    let (config, child) = sidecar::spawn_and_wait(&app, session_token, app_version)?;
    let pid = child.pid();
    let sidecar_job = job::SidecarJob::assign(pid).map_err(|e| {
        eprintln!("绑定 Job Object 失败（pid={pid}）: {e}");
        e
    })?;

    state.0.lock().unwrap().replace(config);
    app.manage(AppState {
        sidecar_child: Mutex::new(Some(child)),
        sidecar_job: Mutex::new(Some(sidecar_job)),
    });
    *init_state.0.lock().unwrap() = Some(RuntimeInitStatus::Ready);
    Ok(init_result.runtime_path)
}

/// 启动 sidecar 的公共逻辑：spawn + Job Object + 写入共享配置 + 管理 AppState。
/// setup（runtime 已就绪）与 start_sidecar_after_init（迁移后）复用。
/// Job 绑定失败时显式 kill child，避免遗留孤儿进程。
fn launch_sidecar(
    app: &tauri::AppHandle,
    state: &tauri::State<'_, SharedRuntimeConfig>,
) -> Result<(), String> {
    let session_token = generate_session_token();
    let app_version = env!("CARGO_PKG_VERSION").to_string();
    let (config, child) = sidecar::spawn_and_wait(app, session_token, app_version)?;
    let pid = child.pid();
    let sidecar_job = match job::SidecarJob::assign(pid) {
        Ok(job) => job,
        Err(e) => {
            // Job 绑定失败：child 已 ready 但尚未存入 AppState，显式 kill 避免孤儿。
            eprintln!("绑定 Job Object 失败（pid={pid}）: {e}，kill child");
            let _ = child.kill();
            return Err(e);
        }
    };
    state.0.lock().unwrap().replace(config);
    app.manage(AppState {
        sidecar_child: Mutex::new(Some(child)),
        sidecar_job: Mutex::new(Some(sidecar_job)),
    });
    Ok(())
}

/// 应用启动时由 Tauri 调用。负责创建主窗口、启动 sidecar 并注册插件。
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // 单实例：再次启动时把已有窗口提到前台。
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .manage(SharedRuntimeConfig::default())
        .manage(RuntimeInitState::default())
        .setup(|app| {
            let window = app
                .get_webview_window("main")
                .ok_or_else(|| tauri::Error::WindowNotFound)?;

            // 阶段 5：判断 runtime 是否已初始化。
            // 已就绪：启动 sidecar，前端首屏直接进业务界面。
            // 未就绪：不启动 sidecar，置 NeedsInit，前端首屏渲染迁移/新建引导，
            // 用户完成选择后前端调 start_sidecar_after_init 启动 sidecar。
            if migration::is_runtime_ready(app.handle()) {
                launch_sidecar(app.handle(), &app.state::<SharedRuntimeConfig>())?;
                *app.state::<RuntimeInitState>().0.lock().unwrap() =
                    Some(RuntimeInitStatus::Ready);
            } else {
                *app.state::<RuntimeInitState>().0.lock().unwrap() =
                    Some(RuntimeInitStatus::NeedsInit);
            }

            window.show()?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_runtime_config,
            get_runtime_init_status,
            migration::choose_legacy_root,
            migration::initialize_runtime,
            start_sidecar_after_init,
            updater::check_for_update,
            updater::install_update,
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
