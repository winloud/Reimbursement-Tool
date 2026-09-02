import { defineCapabilities, definePlatformAdapter } from "../contract.js";

export const zipCapabilities = defineCapabilities({
  portableVersionSwitch: true,
  browserDiagnostics: true,
});

const defaultTriggerBrowserDownload = async (url) => {
  const { triggerBrowserDownload } = await import("../../utils/browserDownload.js");
  triggerBrowserDownload(url);
};

const defaultSaveBlobDownload = async (download) => {
  const { saveBlobDownload } = await import("../../utils/browserDownload.js");
  saveBlobDownload(download);
};

export const createZipAdapter = ({
  apiBaseUrl = import.meta.env?.VITE_API_BASE_URL || "",
  triggerBrowserDownload = defaultTriggerBrowserDownload,
  saveBlobDownload = defaultSaveBlobDownload,
} = {}) => definePlatformAdapter({
  kind: "zip",
  capabilities: zipCapabilities,

  async bootstrap() {
    return { apiBaseUrl, sessionToken: "", capabilities: zipCapabilities };
  },

  async saveDownload({ url, fetchBlob }) {
    if (fetchBlob) {
      await saveBlobDownload(await fetchBlob());
    } else {
      await triggerBrowserDownload(url);
    }
    return { browser: true };
  },

  async openProtectedResource(relativePath) {
    const base = apiBaseUrl.replace(/\/$/, "");
    const path = String(relativePath || "").replace(/^\//, "");
    return base ? `${base}/${path}` : `/${path}`;
  },
});

const zipAdapter = createZipAdapter();

export default zipAdapter;
