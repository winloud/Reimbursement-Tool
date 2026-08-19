export const SIDEBAR_EXPANDED_WIDTH = 200;
export const SIDEBAR_COLLAPSED_WIDTH = 72;
export const SIDEBAR_COLLAPSED_STORAGE_KEY = "reimbursement-tool:sidebar-collapsed";

export const readSidebarCollapsed = (storage) => {
  try {
    return storage?.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
};

export const writeSidebarCollapsed = (storage, collapsed) => {
  try {
    storage?.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(Boolean(collapsed)));
    return Boolean(storage);
  } catch {
    return false;
  }
};
