import { defineCapabilities, definePlatformAdapter } from "../contract.js";

export const tauriCapabilities = defineCapabilities({
  nativeSave: true,
  signedUpdater: true,
  protectedResourceAuth: true,
  inAppProtectedResourcePreview: true,
});

const invokeTauri = async (command, args) => {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke(command, args);
};

export const createTauriAdapter = ({ invokeCommand = invokeTauri } = {}) => {
  let cachedBootstrap = null;

  return definePlatformAdapter({
    kind: "tauri",
    capabilities: tauriCapabilities,

    async bootstrap() {
      if (!cachedBootstrap) {
        cachedBootstrap = invokeCommand("get_runtime_config")
          .then((config) => ({
            apiBaseUrl: config?.api_base_url || "",
            sessionToken: config?.session_token || "",
            appVersion: config?.app_version || "",
            capabilities: tauriCapabilities,
          }))
          .catch((error) => {
            cachedBootstrap = null;
            throw error;
          });
      }
      return cachedBootstrap;
    },

    resetBootstrap() {
      cachedBootstrap = null;
    },

    async saveDownload({ url, filename }) {
      try {
        const result = await invokeCommand("save_backend_download", {
          url,
          suggestedFilename: filename,
        });
        return { saved: true, saved_path: result.saved_path };
      } catch (err) {
        const message = String(err);
        if (message.includes("cancelled")) return { cancelled: true };
        return { error: message };
      }
    },

    async openProtectedResource(relativePath) {
      const payload = await invokeCommand("fetch_authenticated_blob", { url: relativePath });
      if (!payload) throw new Error("无法加载资源");
      const binary = atob(payload.bytes_base64);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      return URL.createObjectURL(new Blob([bytes], { type: payload.mime_type }));
    },

    getRuntimeInitStatus: () => invokeCommand("get_runtime_init_status"),
    chooseLegacyRoot: () => invokeCommand("choose_legacy_root"),

    async startSidecarAfterInit(legacyRoot) {
      const runtimePath = await invokeCommand("start_sidecar_after_init", { legacyRoot });
      cachedBootstrap = null;
      return runtimePath;
    },

    checkForUpdate: () => invokeCommand("check_for_update"),
    installUpdate: () => invokeCommand("install_update"),
  });
};

const tauriAdapter = createTauriAdapter();

export default tauriAdapter;
