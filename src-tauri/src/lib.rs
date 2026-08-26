// 阶段 1：Tauri 桌面壳最小可运行骨架。
// 本阶段只验证 Tauri 能加载前端产物并显示窗口，sidecar 用占位逻辑。
// 阶段 2 再接入真实 Python sidecar 与进程生命周期管理。

use tauri::Manager;

/// 应用启动时由 Tauri 调用。负责创建主窗口并注册插件。
/// 窗口标题/尺寸由 tauri.conf.json 配置；window-state 插件负责记住上次位置。
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // 单实例：再次启动时把已有窗口提到前台。
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .setup(|app| {
            // 阶段 2 在此启动 sidecar 并注入 runtime config。
            // 阶段 1 仅确认主窗口存在。
            let _window = app
                .get_webview_window("main")
                .ok_or_else(|| tauri::Error::WindowNotFound)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
