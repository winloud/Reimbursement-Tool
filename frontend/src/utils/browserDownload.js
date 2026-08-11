const DEFAULT_REVOKE_DELAY_MS = 30_000;

const requireDocument = (documentRef) => {
  if (!documentRef?.createElement || !documentRef?.body) {
    throw new Error("当前环境不支持浏览器下载");
  }
};

export const triggerBrowserDownload = (downloadUrl, { documentRef = globalThis.document } = {}) => {
  if (typeof downloadUrl !== "string" || !downloadUrl.trim()) {
    throw new Error("下载链接无效，请重新生成");
  }
  requireDocument(documentRef);

  const link = documentRef.createElement("a");
  link.href = downloadUrl;
  link.hidden = true;
  documentRef.body.appendChild(link);
  link.click();
  link.remove();
};

export const saveBlobDownload = (
  { blob, filename },
  {
    documentRef = globalThis.document,
    urlApi = globalThis.URL,
    setTimeoutFn = globalThis.setTimeout,
    revokeDelayMs = DEFAULT_REVOKE_DELAY_MS,
  } = {},
) => {
  if (!(blob instanceof Blob) || blob.size <= 0) {
    throw new Error("下载内容为空，请重试");
  }
  if (!urlApi?.createObjectURL || !urlApi?.revokeObjectURL) {
    throw new Error("当前环境不支持文件下载");
  }
  requireDocument(documentRef);

  const url = urlApi.createObjectURL(blob);
  const link = documentRef.createElement("a");
  link.href = url;
  link.download = filename || "download";
  link.hidden = true;
  documentRef.body.appendChild(link);
  link.click();
  link.remove();
  setTimeoutFn(() => urlApi.revokeObjectURL(url), revokeDelayMs);
};
