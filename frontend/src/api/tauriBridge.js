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

/// 查询 runtime 初始化状态。
/// 返回 "ready" | "needs_init" | "error:<msg>" | "unknown" | "browser"。
/// 浏览器模式返回 "browser"（无需迁移，直接走业务界面）。
export const getRuntimeInitStatus = async () => {
  if (!isTauriEnvironment()) return "browser";
  try {
    return await safeInvoke("get_runtime_init_status");
  } catch {
    return "unknown";
  }
};

/// 弹原生对话框选旧便携根，返回预检结果 { path, valid, reason, found_entries }。
/// 浏览器模式返回 null。
export const chooseLegacyRoot = async () => {
  if (!isTauriEnvironment()) return null;
  return safeInvoke("choose_legacy_root");
};

/// 初始化 runtime：legacy_root 为 null 时新建空白数据，否则从旧目录迁移。
/// 返回 { success, runtime_path, error, migrated, migrated_entries }。
export const initializeRuntime = async (legacyRoot) => {
  if (!isTauriEnvironment()) {
    // 浏览器模式无 runtime 概念，直接返回成功占位。
    return { success: true, runtime_path: "", error: "", migrated: false, migrated_entries: [] };
  }
  return safeInvoke("initialize_runtime", { legacyRoot });
};

/// 迁移/新建完成后启动 sidecar，返回 runtime 目录路径。
/// 成功后清除缓存的 runtime config，让后续 get_runtime_config 拿到 sidecar 真实配置。
export const startSidecarAfterInit = async (legacyRoot) => {
  if (!isTauriEnvironment()) return "";
  const runtimePath = await safeInvoke("start_sidecar_after_init", { legacyRoot });
  cachedRuntimeConfig = null; // 让 loadRuntimeConfig 重新拉取 sidecar 配置
  return runtimePath;
};

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

/// 检查更新。浏览器模式返回不可用占位。
/// 返回 { available, version, current_version, current_data_schema,
///   min_data_schema, max_data_schema, data_compatible, notes, message }。
export const checkForUpdate = async () => {
  if (!isTauriEnvironment()) {
    return {
      available: false,
      version: "",
      current_version: "",
      current_data_schema: 0,
      min_data_schema: 0,
      max_data_schema: 0,
      data_compatible: true,
      notes: "",
      message: "浏览器模式不支持更新检查",
    };
  }
  return safeInvoke("check_for_update");
};

/// 安装更新。返回 { success, error, backup_path }。
export const installUpdate = async () => {
  if (!isTauriEnvironment()) {
    return { success: false, error: "浏览器模式不支持更新", backup_path: "" };
  }
  return safeInvoke("install_update");
};
