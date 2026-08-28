// 阶段 6：启动时 24h 间隔的更新检查（ADR 0009：启动最多每 24h 检查一次）。
//
// 用法：在 App 顶层调用 useStartupUpdateCheck(onAvailable)。
// - 启动时读 localStorage 上次检查时间，超过 24h 才静默检查更新。
// - 有可用更新且数据兼容时回调 onAvailable(updateInfo)，由 UI 提示用户去维护页。
// - 检查失败静默忽略（不打扰用户；手动检查在维护页）。
// - 浏览器模式不检查。

import { useEffect } from "react";
import { checkForUpdate, isInTauriEnvironment } from "../api/tauriBridge";

const STORAGE_KEY = "reimbursement_last_update_check";
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 小时

export default function useStartupUpdateCheck(onAvailable) {
  useEffect(() => {
    if (!isInTauriEnvironment()) return;

    let cancelled = false;
    (async () => {
      try {
        const lastCheck = Number(localStorage.getItem(STORAGE_KEY) || "0");
        const now = Date.now();
        if (now - lastCheck < CHECK_INTERVAL_MS) return; // 不到 24h，跳过

        const info = await checkForUpdate();
        if (cancelled || !info?.available || !info?.data_compatible) return;
        onAvailable?.(info);
      } catch {
        // 静默忽略：手动检查入口在维护页。
      } finally {
        if (!cancelled) {
          try {
            localStorage.setItem(STORAGE_KEY, String(Date.now()));
          } catch {
            // localStorage 不可用时跳过记录，下次启动仍会检查（无害）。
          }
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
