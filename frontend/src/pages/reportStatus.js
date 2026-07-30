export const REPORT_STATUS_OPTIONS = [
  { value: "draft", label: "草稿" },
  { value: "checked", label: "已核对" },
  { value: "printed", label: "已提交" },
  { value: "reimbursed", label: "已报销" },
];

export const STATUS_CHIP_WIDTH = 80;

const statusChipSx = (backgroundColor, color) => ({
  width: STATUS_CHIP_WIDTH,
  justifyContent: "center",
  bgcolor: backgroundColor,
  color,
  fontWeight: 700,
  "& .MuiChip-label": { px: 0.75 },
  "&.MuiChip-clickable:hover": { bgcolor: backgroundColor },
});

export const STATUS_META = {
  draft: { label: "草稿", chipSx: statusChipSx("#F1EFE8", "#444441") },
  checked: { label: "已核对", chipSx: statusChipSx("#E6F1FB", "#0C447C") },
  printed: { label: "已提交", chipSx: statusChipSx("#FAEEDA", "#633806") },
  reimbursed: { label: "已报销", chipSx: statusChipSx("#EAF3DE", "#27500A") },
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
  reimbursed: [{ target: "printed", label: "退回已提交", color: "inherit" }],
};

export const canAccessReportPdf = (status) => Object.prototype.hasOwnProperty.call(STATUS_META, status);

export const getReportStatusLabel = (status) => STATUS_META[status]?.label || status;

export const getReportStatusActions = (status) => STATUS_ACTIONS[status] || [];

export const getReportStatusDirectionalActions = (status) => {
  const currentIndex = REPORT_STATUS_OPTIONS.findIndex((option) => option.value === status);
  if (currentIndex === -1) return { previous: null, next: null };

  return getReportStatusActions(status).reduce(
    (directions, action) => {
      const targetIndex = REPORT_STATUS_OPTIONS.findIndex((option) => option.value === action.target);
      if (targetIndex < currentIndex) directions.previous = action;
      if (targetIndex > currentIndex) directions.next = action;
      return directions;
    },
    { previous: null, next: null },
  );
};

export const getHomogeneousReportStatus = (reports) => {
  if (reports.length === 0) return null;
  const firstStatus = reports[0].status;
  return reports.every((report) => report.status === firstStatus) ? firstStatus : null;
};

export const getBatchReportStatusActions = (reports) =>
  REPORT_STATUS_OPTIONS.map((option) => {
    const attemptCount = reports.filter((report) => report.status !== option.value).length;
    return {
      target: option.value,
      label: `改为${option.label}`,
      attemptCount,
      sameStatusCount: reports.length - attemptCount,
    };
  }).filter((action) => action.attemptCount > 0);
