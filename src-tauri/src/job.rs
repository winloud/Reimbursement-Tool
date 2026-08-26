// Windows Job Object：确保 sidecar 在 Tauri 崩溃/强杀时也被回收。
//
// 创建一个设了 JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE 的 Job Object，
// 把 sidecar 进程绑入。Tauri 进程退出（含崩溃）后 Job Object 句柄释放，
// 内核自动 kill 绑定的所有子进程。正常退出路径仍在 lib.rs 显式 kill。

#![cfg(target_os = "windows")]

use std::mem::MaybeUninit;
use windows::core::PCWSTR;
use windows::Win32::Foundation::{CloseHandle, HANDLE};
use windows::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
    SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};
use windows::Win32::System::Threading::OpenProcess;
use windows::Win32::System::Threading::PROCESS_SET_QUOTA;
use windows::Win32::System::Threading::PROCESS_TERMINATE;

/// 持有 Job Object 句柄，Drop 时关闭句柄触发内核 kill 绑定进程。
pub struct SidecarJob(HANDLE);

impl SidecarJob {
    /// 创建 Job Object 并把指定 pid 绑入。句柄由返回值持有。
    pub fn assign(pid: u32) -> Result<Self, String> {
        unsafe {
            let job = CreateJobObjectW(None, PCWSTR::null())
                .map_err(|e| format!("CreateJobObjectW 失败: {e}"))?;

            // 设置 KILL_ON_JOB_CLOSE：句柄全部关闭后 kill 绑定进程。
            let mut info = MaybeUninit::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>::zeroed();
            let info_ptr = info.as_mut_ptr();
            (*info_ptr).BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                info_ptr as *const std::ffi::c_void,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
            .map_err(|e| format!("SetInformationJobObject 失败: {e}"))?;

            // 打开 sidecar 进程并绑入 Job。
            let process = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, false, pid)
                .map_err(|e| format!("OpenProcess(pid={pid}) 失败: {e}"))?;
            AssignProcessToJobObject(job, process)
                .map_err(|e| format!("AssignProcessToJobObject 失败: {e}"))?;
            // process 句柄绑入 job 后可关闭。
            let _ = CloseHandle(process);

            Ok(SidecarJob(job))
        }
    }
}

impl Drop for SidecarJob {
    fn drop(&mut self) {
        // 句柄关闭后，若没有其他句柄持有该 job，内核 kill 绑定进程。
        unsafe {
            let _ = CloseHandle(self.0);
        }
    }
}

// SAFETY: HANDLE 是进程级资源，可跨线程传递（Drop 时单次关闭）。
unsafe impl Send for SidecarJob {}
unsafe impl Sync for SidecarJob {}
