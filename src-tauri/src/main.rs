// 正式版使用 GUI 子系统，避免启动时弹出控制台；debug 保留终端便于排查。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// 桌面壳入口。主逻辑放在 lib.rs，便于后续移动端/测试复用。
fn main() {
    reimbursement_tauri_lib::run();
}
