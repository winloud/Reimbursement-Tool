export const REPORT_STATUS_OPTIONS = [
  { value: "draft", label: "草稿" },
  { value: "checked", label: "已核对" },
  { value: "printed", label: "已提交" },
  { value: "reimbursed", label: "已报销" },
];

export const STATUS_META = {
  draft: { label: "草稿", color: "default" },
  checked: { label: "已核对", color: "warning" },
  printed: { label: "已提交", color: "info" },
  reimbursed: { label: "已报销", color: "success" },
};

export const STATUS_ACTIONS = {
  draft: [{ target: "checked", label: "标记为已核对", color: "primary" }],
  checked: [
    { target: "printed", label: "标记为已提交", color: "primary" },
    { target: "draft", label: "退回草稿", color: "inherit" },
  ],
  printed: [
    { target: "reimbursed", label: "标记为已报销", color: "success" },
    { target: "checked", label: "退回已核对", color: "inherit" },
  ],
  reimbursed: [],
};

export const canAccessReportPdf = (status) => Object.prototype.hasOwnProperty.call(STATUS_META, status);

export const getReportStatusLabel = (status) => STATUS_META[status]?.label || status;

export const getReportStatusActions = (status) => STATUS_ACTIONS[status] || [];

export const getHomogeneousReportStatus = (reports) => {
  if (reports.length === 0) return null;
  const firstStatus = reports[0].status;
  return reports.every((report) => report.status === firstStatus) ? firstStatus : null;
};

export const getBatchReportStatusActions = (reports) =>
  REPORT_STATUS_OPTIONS.map((option) => {
    const eligibleCount = reports.filter((report) =>
      getReportStatusActions(report.status).some((action) => action.target === option.value),
    ).length;
    return {
      target: option.value,
      label: `改为${option.label}`,
      eligibleCount,
      skippedCount: reports.length - eligibleCount,
    };
  }).filter((action) => action.eligibleCount > 0);
