import { alpha } from "@mui/material/styles";

// 差旅与常规填报页共享的布局与卡片样式，保证两页视觉一致。
export const SECTION_GAP = { xs: 2, md: 2.5 };
export const FIELD_GAP = { xs: 1.5, md: 2 };

// 填报页现有的浅色层级：白色块卡 > 浅灰摘要行 > 白色展开抽屉。
// 发票小卡与上传槽在白色抽屉内继续使用这一层浅灰，避免灰压灰。
const SUBTLE_SURFACE = "#F8FAFC";

export const EDIT_PAGE_HEADER_STICKY_OFFSET = 92;

export const pageContentSx = {
  width: "100%",
  pb: 4,
  // 关掉滚动锚定：折叠一行会让页面变矮，浏览器补偿滚动位置后，被折叠行以上的内容
  // 看起来是往下滑的，同一个列表里折叠不同行方向还不一样。禁用后统一为向上收拢。
  overflowAnchor: "none",
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

// 行列表型卡片（如其他费用）：留白由每行自己承担，卡片只保留很小的上下内边距。
export const listCardContentSx = {
  px: { xs: 2, md: 2.5 },
  py: { xs: 0.75, md: 1 },
  "&:last-child": {
    pb: { xs: 0.75, md: 1 },
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
  top: { xl: EDIT_PAGE_HEADER_STICKY_OFFSET },
};

export const sectionAnchorSx = {
  scrollMarginTop: { xs: 24, lg: EDIT_PAGE_HEADER_STICKY_OFFSET },
};

// 页头负边距抵消 App 主内容区的 padding，吸顶后背景会铺满编辑区宽度。
export const editPageHeaderSx = {
  position: "sticky",
  top: 0,
  zIndex: (theme) => theme.zIndex.appBar,
  mx: { xs: -2, md: -3, xl: -4 },
  mt: { xs: -2, md: -3 },
  px: { xs: 2, md: 3, xl: 4 },
  py: { xs: 1.5, md: 1.75 },
  bgcolor: "background.default",
  borderBottom: "1px solid transparent",
  transition: (theme) => theme.transitions.create(
    ["border-color", "box-shadow"],
    { duration: theme.transitions.duration.shorter },
  ),
  '&[data-stuck="true"]': {
    borderBottomColor: "divider",
    boxShadow: (theme) => `0 6px 16px ${alpha(theme.palette.text.primary, 0.06)}`,
  },
};

// 四大块统一卡语法：紧凑卡头 + 可折叠卡身。
export const blockCardSx = {
  minWidth: 0,
  overflow: "hidden",
  bgcolor: "background.paper",
};

export const blockCardHeaderSx = {
  display: "flex",
  alignItems: "center",
  gap: 1.25,
  minHeight: 46,
  py: 1,
  pr: { xs: 1.25, sm: 2 },
  pl: 1,
  borderBottom: "1px solid",
  borderBottomColor: "divider",
  flexWrap: "wrap",
  transition: (theme) => theme.transitions.create("border-color", {
    duration: theme.transitions.duration.shorter,
  }),
};

export const blockCardHeaderCollapsedSx = {
  borderBottomColor: "transparent",
};

export const blockCardTitleSx = {
  flex: "0 0 auto",
  fontSize: 15,
  fontWeight: 800,
  lineHeight: 1.4,
  whiteSpace: "nowrap",
};

export const blockCardSummarySx = {
  display: "flex",
  alignItems: "center",
  gap: 1,
  minWidth: 0,
  flex: "1 1 180px",
  color: "text.secondary",
  fontSize: 12.5,
  fontWeight: 700,
  flexWrap: "wrap",
};

export const blockCardActionsSx = {
  display: "flex",
  alignItems: "center",
  gap: 1,
  ml: "auto",
  flex: "0 0 auto",
  flexWrap: "wrap",
};

export const blockCardBodySx = {
  px: { xs: 1.5, sm: 2 },
  pt: 0.5,
  pb: 1.75,
};

// 折叠行采用“浅灰摘要 + 白色抽屉”的单卡结构；列表间距由 collapsibleRowListSx 统一提供。
export const collapsibleRowSx = {
  minWidth: 0,
  overflow: "hidden",
  bgcolor: "background.paper",
  border: 1,
  borderColor: "divider",
  borderRadius: 1,
  transition: (theme) => theme.transitions.create("border-color", {
    duration: theme.transitions.duration.shorter,
  }),
  "&:hover, &:focus-within": {
    borderColor: "primary.light",
  },
  "@media (prefers-reduced-motion: reduce)": {
    transition: "none",
    "& .MuiCollapse-root": { transitionDuration: "0ms !important" },
  },
};

export const collapsibleRowSummarySx = {
  display: "flex",
  alignItems: "center",
  gap: 1.25,
  minHeight: 42,
  px: 1.5,
  py: 0.5,
  bgcolor: SUBTLE_SURFACE,
  "&:hover": {
    bgcolor: "#F1F5F9",
  },
  // 极窄屏时给摘要内容留出完整一行，操作按钮再换到下一行，避免标题被压成几像素。
  flexWrap: { xs: "wrap", sm: "nowrap" },
};

export const collapsibleRowSummaryContentSx = {
  minWidth: 0,
  flex: { xs: "1 1 180px", sm: "1 1 auto" },
  cursor: "pointer",
  outline: "none",
  "&:focus-visible": {
    boxShadow: "inset 0 0 0 2px #2454A6",
    borderRadius: 0.5,
  },
};

export const collapsibleRowActionsSx = {
  display: "flex",
  alignItems: "center",
  gap: 0.5,
  flex: "0 0 auto",
};

export const collapsibleRowDrawerSx = {
  p: 1.5,
  bgcolor: "background.paper",
  borderTop: "1px solid",
  borderTopColor: "divider",
  borderRadius: "0 0 7px 7px",
};

// 可直接传给抽屉内的发票小卡、上传槽或其包装层，维持第三层浅灰。
export const collapsibleRowNestedSurfaceSx = {
  bgcolor: SUBTLE_SURFACE,
};

export const collapsibleRowListSx = {
  display: "flex",
  flexDirection: "column",
  gap: 1,
};

// 拖拽激活态：用 outline 而不是 border——border 会占掉 2px 内容宽度，
// 让卡内一行排布的字段被挤到下一行，拖动时整卡跳动。
export const draggingCardSx = {
  outline: (theme) => `2px solid ${theme.palette.primary.main}`,
  outlineOffset: "-2px",
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
  borderRadius: 0.75,
  bgcolor: SUBTLE_SURFACE,
  borderColor: "divider",
  borderLeft: 3,
};

// 卡片内的浅色分区面板（如行程的出发/到达）。
export const subtlePanelSx = {
  border: 1,
  borderColor: "divider",
  borderRadius: 1,
  bgcolor: SUBTLE_SURFACE,
};

// 卡片内纸质发票等次级区域与上方内容的分隔线。
export const cardSubSectionDividerSx = {
  mt: 0.25,
  pt: 0.75,
  borderTop: "1px solid",
  borderColor: "rgba(148, 163, 184, 0.28)",
};

// 列表尾部的虚线“添加”占位卡（单列时占满整行，不需要网格时代的高度）。
export const dashedAddCardSx = {
  minHeight: 72,
  borderStyle: "dashed",
  borderColor: "divider",
  bgcolor: SUBTLE_SURFACE,
  color: "text.secondary",
  "&:hover": { borderStyle: "dashed", borderColor: "primary.main", bgcolor: "primary.50" },
};
