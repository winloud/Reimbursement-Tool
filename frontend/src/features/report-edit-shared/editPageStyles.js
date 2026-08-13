// 差旅与常规填报页共享的布局与卡片样式，保证两页视觉一致。
export const SECTION_GAP = { xs: 2, md: 2.5 };
export const FIELD_GAP = { xs: 1.5, md: 2 };

export const pageContentSx = {
  width: "100%",
  pb: 4,
};

export const workCardSx = {
  height: "100%",
};

export const sectionCardContentSx = {
  p: { xs: 2, md: 2.5 },
  "&:last-child": {
    pb: { xs: 2, md: 2.5 },
  },
};

// 主编辑列 + 右侧汇总栏。
export const editMainLayoutSx = {
  display: "grid",
  gridTemplateColumns: { xs: "1fr", xl: "minmax(0, 1fr) 320px" },
  gap: { xs: 2, md: 2.5, xl: 3 },
  alignItems: "start",
};

export const summarySidebarSx = {
  minWidth: 0,
  position: { xl: "sticky" },
  top: { xl: 80 },
};

// 行程卡、报销项目卡等成组卡片的两列网格。
export const repeatedCardGridSx = {
  display: "grid",
  gridTemplateColumns: { xs: "1fr", md: "repeat(2, minmax(0, 1fr))" },
  gap: SECTION_GAP,
  alignItems: "stretch",
};

export const sectionAnchorSx = {
  scrollMarginTop: { xs: 24, lg: 80 },
};

// 折叠卡（Accordion）统一为描边、8px 圆角、无阴影。
export const accordionCardSx = {
  border: 1,
  borderColor: "divider",
  borderRadius: "8px !important",
  overflow: "hidden",
  boxShadow: "none",
  "&:before": { display: "none" },
};

// 已上传文件小卡（发票、附件、凭据）的统一基座，左侧色条由各列表叠加。
export const fileCardSx = {
  minWidth: 0,
  minHeight: 54,
  height: "100%",
  px: 0.75,
  py: 0.5,
  borderRadius: 1,
  bgcolor: "#F8FAFC",
  borderColor: "divider",
  borderLeft: 3,
};

// 卡片内的浅色分区面板（如行程的出发/到达）。
export const subtlePanelSx = {
  border: 1,
  borderColor: "divider",
  borderRadius: 1,
  bgcolor: "#F8FAFC",
};

// 卡片内纸质发票等次级区域与上方内容的分隔线。
export const cardSubSectionDividerSx = {
  mt: 0.25,
  pt: 0.75,
  borderTop: "1px solid",
  borderColor: "rgba(148, 163, 184, 0.28)",
};

// 网格尾部的虚线“添加”占位卡。
export const dashedAddCardSx = {
  minHeight: { xs: 96, md: 132 },
  borderStyle: "dashed",
  borderColor: "divider",
  bgcolor: "#F8FAFC",
  color: "text.secondary",
  "&:hover": { borderStyle: "dashed", borderColor: "primary.main", bgcolor: "primary.50" },
};
