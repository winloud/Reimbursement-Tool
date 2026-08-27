// 阶段 4：Tauri 桥接层。
//
// 把与 Tauri 相关的运行环境探测与命令调用集中在此，前端其余部分只依赖本模块，
// 这样在纯浏览器开发模式（npm run dev 不走 Tauri）下可走回退分支，单元测试无需 Tauri。
//
// 环境判定依据：Tauri 注入的 window.__TAURI_INTERNALS__。Vite 开发服务器无此对象，
// 视为浏览器模式，API 基址用 VITE_API_BASE_URL（同源时为空串），会话令牌为空
// （后端在未设 REIMBURSEMENT_SESSION_TOKEN 时放行全部请求）。

const isTauriEnvironment = () => Boolean(
  typeof window !== "undefined" && window.__TAURI_INTERNALS__,
);

let cachedRuntimeConfig = null;

const safeInvoke = async (command, args) => {
  if (!isTauriEnvironment()) return undefined;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke(command, args);
};

export const isInTauriEnvironment = isTauriEnvironment;

/// 加载并缓存 Tauri 注入的运行时配置（api_base_url + session_token + app_version）。
/// 浏览器模式下返回空令牌配置，供 client.js 的请求拦截器统一处理。
export const loadRuntimeConfig = async () => {
  if (cachedRuntimeConfig) return cachedRuntimeConfig;
  if (!isTauriEnvironment()) {
    cachedRuntimeConfig = {
      api_base_url: import.meta.env?.VITE_API_BASE_URL || "",
      session_token: "",
      app_version: "",
    };
    return cachedRuntimeConfig;
  }
  const config = await safeInvoke("get_runtime_config");
  cachedRuntimeConfig = {
    api_base_url: config?.api_base_url || "",
    session_token: config?.session_token || "",
    app_version: config?.app_version || "",
  };
  return cachedRuntimeConfig;
};

export const getRuntimeConfig = () => cachedRuntimeConfig;

/// 取回认证资源的字节并构造 blob URL，供 <img src> / window.open 使用。
/// 浏览器模式下直接拼接 URL 返回（后端无令牌放行）。
export const fetchAuthenticatedBlobUrl = async (relativePath) => {
  if (!isTauriEnvironment()) {
    const config = await loadRuntimeConfig();
    const base = (config.api_base_url || "").replace(/\/$/, "");
    return `${base}/${String(relativePath).replace(/^\//, "")}`;
  }
  const payload = await safeInvoke("fetch_authenticated_blob", { url: relativePath });
  if (!payload) throw new Error("无法加载资源");
  const binary = atob(payload.bytes_base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: payload.mime_type });
  return URL.createObjectURL(blob);
};

/// 经 Tauri 原生保存对话框下载认证资源。
/// 仅在 Tauri 环境下调用（调用方应先判断环境或走 client.js 的 triggerBackendDownload）。
/// 返回 { saved: true, saved_path } 或 { cancelled: true } 或 { error }。
export const saveBackendDownload = async (relativePath, suggestedFilename) => {
  try {
    const result = await safeInvoke("save_backend_download", {
      url: relativePath,
      suggestedFilename,
    });
    return { saved: true, saved_path: result.saved_path };
  } catch (err) {
    const message = String(err);
    if (message.includes("cancelled")) return { cancelled: true };
    return { error: message };
  }
};
