export const toggleReportSelection = (selectedIds, reportId) =>
  selectedIds.includes(reportId) ? selectedIds.filter((id) => id !== reportId) : [...selectedIds, reportId];

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

export const deleteDialogActionLabels = ["彻底删除", "放入回收站"];
