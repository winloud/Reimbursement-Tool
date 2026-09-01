export const PLATFORM_CAPABILITY_DEFAULTS = Object.freeze({
  nativeSave: false,
  signedUpdater: false,
  portableVersionSwitch: false,
  protectedResourceAuth: false,
  browserDiagnostics: false,
  inAppProtectedResourcePreview: false,
});

export const defineCapabilities = (overrides = {}) => Object.freeze({
  ...PLATFORM_CAPABILITY_DEFAULTS,
  ...overrides,
});

export const definePlatformAdapter = (adapter) => {
  for (const method of ["bootstrap", "saveDownload", "openProtectedResource"]) {
    if (typeof adapter?.[method] !== "function") {
      throw new TypeError(`Platform adapter 缺少 ${method}()`);
    }
  }
  return Object.freeze(adapter);
};
