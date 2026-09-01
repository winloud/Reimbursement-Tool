import tauriAdapter from "./tauri/adapter.js";
import zipAdapter from "./zip/adapter.js";

export const detectPlatformKind = () => (
  typeof window !== "undefined" && window.__TAURI_INTERNALS__ ? "tauri" : "zip"
);

export const platform = detectPlatformKind() === "tauri" ? tauriAdapter : zipAdapter;
export const capabilities = platform.capabilities;

export const bootstrap = (...args) => platform.bootstrap(...args);
export const saveDownload = (...args) => platform.saveDownload(...args);
export const openProtectedResource = (...args) => platform.openProtectedResource(...args);
