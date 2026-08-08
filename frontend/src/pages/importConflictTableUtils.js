export const IMPORT_CONFLICT_TABLE_MIN_WIDTH = 800;

export const importConflictTableContainerSx = {
  display: { xs: "none", sm: "block" },
  maxHeight: 240,
  overflow: "auto",
  overscrollBehaviorX: "contain",
  WebkitOverflowScrolling: "touch",
  border: 1,
  borderColor: "divider",
  borderRadius: 1,
};

export const importConflictMobileListSx = {
  display: { xs: "flex", sm: "none" },
  maxHeight: 360,
  overflowY: "auto",
  overscrollBehaviorY: "contain",
  m: 0,
  p: 0,
  pr: 0.5,
  listStyle: "none",
};

export const importConflictMobileCardSx = {
  p: 1.5,
  border: 1,
  borderColor: "divider",
  borderRadius: 1,
  bgcolor: "background.paper",
};

export const importConflictAtomicTextSx = {
  whiteSpace: "nowrap",
};

export const importConflictTableSx = {
  minWidth: IMPORT_CONFLICT_TABLE_MIN_WIDTH,
  tableLayout: "fixed",
};

export const importConflictTypeCellSx = {
  width: 96,
  minWidth: 96,
  whiteSpace: "nowrap",
};

export const importConflictUidCellSx = {
  width: 280,
  minWidth: 280,
};

export const importConflictLocalIdCellSx = {
  width: 112,
  minWidth: 112,
  whiteSpace: "nowrap",
};

export const importConflictReasonCellSx = {
  width: 312,
  minWidth: 312,
};

export const importConflictUidTextSx = {
  minWidth: 0,
  flex: 1,
  fontFamily: '"Roboto Mono", Consolas, monospace',
};

export const importConflictReasonTextSx = {
  display: "-webkit-box",
  overflow: "hidden",
  WebkitBoxOrient: "vertical",
  WebkitLineClamp: 2,
  lineHeight: 1.45,
  overflowWrap: "anywhere",
};

export const getImportConflictViewModel = (conflict = {}) => ({
  typeLabel: conflict.item_type === "report" ? "报销单" : "发票",
  sourceUid: String(conflict.source_uid || "—"),
  localId: conflict.local_id === null || conflict.local_id === undefined ? "—" : String(conflict.local_id),
  reason: String(conflict.reason || "—"),
});

export const copyImportConflictUid = async (sourceUid, clipboard = globalThis.navigator?.clipboard) => {
  if (!sourceUid || !clipboard?.writeText) return false;

  try {
    await clipboard.writeText(String(sourceUid));
    return true;
  } catch {
    return false;
  }
};
