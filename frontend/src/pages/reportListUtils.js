export const toggleReportSelection = (selectedIds, reportId) =>
  selectedIds.includes(reportId) ? selectedIds.filter((id) => id !== reportId) : [...selectedIds, reportId];

export const reportFilterToolbarSx = {
  flexWrap: "wrap",
  rowGap: 1.5,
};

export const reportFilterKeywordSx = {
  flex: { xs: "1 1 100%", sm: "1 1 260px", lg: "1 1 260px" },
  minWidth: 0,
};

export const reportFilterDateFieldSx = {
  flex: { xs: "1 1 100%", sm: "1 1 158px", lg: "0 1 158px" },
  minWidth: 0,
};

export const reportFilterCategorySx = {
  flex: { xs: "1 1 100%", sm: "1 1 170px", lg: "0 1 170px" },
  minWidth: 0,
};

export const reportFilterActionsSx = {
  flex: { xs: "1 1 100%", sm: "0 1 auto" },
  minWidth: 0,
  flexWrap: "wrap",
  gap: 1,
};

export const reportFilterMoreButtonSx = {
  minHeight: 40,
  minWidth: "max-content",
  flexShrink: 0,
  whiteSpace: "nowrap",
};

export const reportFilterResetButtonSx = {
  minWidth: "max-content",
  flexShrink: 0,
};

export const toggleCurrentPageSelection = (selectedIds, pageIds, checked) => {
  const next = new Set(selectedIds);
  if (checked) {
    pageIds.forEach((id) => next.add(id));
  } else {
    pageIds.forEach((id) => next.delete(id));
  }
  return Array.from(next);
};

export const formatBatchPdfFailureMessage = (failures) =>
  failures.map((item) => `报销单 ${item.report_id}：${item.reason}`).join("；");

export const isTrashStatus = (status) => status === "trash";

export const isReportStatusVisible = ({ tab = "all", statuses = "" } = {}, reportStatus) => {
  if (tab === "trash") return true;
  if (tab !== "all") return reportStatus === tab;
  const scopedStatuses = String(statuses)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return scopedStatuses.length === 0 || scopedStatuses.includes(reportStatus);
};

export const getSubsidyDaysLabel = (report = {}) =>
  report.manual_subsidy_total !== null && report.manual_subsidy_total !== undefined
    ? "人工核定"
    : String(report.subsidy_days ?? 0);

export const deleteDialogActionLabels = ["彻底删除", "放入回收站"];
