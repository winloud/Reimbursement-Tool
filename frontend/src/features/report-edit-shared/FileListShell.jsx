import { Box, Divider, Stack, Typography } from "@mui/material";

const countBadgeSx = {
  px: 0.625,
  py: 0,
  borderRadius: 999,
  bgcolor: "#EEF1F4",
  color: "text.secondary",
  fontSize: 11,
  fontWeight: 700,
  lineHeight: 1.5,
  whiteSpace: "nowrap",
};

const fileGridSx = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 0.5,
  alignItems: "stretch",
};

// 已上传文件列表的统一外壳：标题行（计数徽标）+ 两列小卡网格 + 末尾上传占位。
// 发票列表与附件/凭据列表共用，保证两类填报页的构图一致。
export default function FileListShell({
  title,
  count = 0,
  countUnit = "张",
  emptyText,
  readonly,
  uploadSlot,
  children,
}) {
  return (
    <Stack spacing={0.5}>
      <Stack direction="row" alignItems="center" spacing={0.5}>
        <Typography variant="caption" fontWeight={800} color="text.secondary">
          {title}
        </Typography>
        <Box sx={countBadgeSx}>
          {count} {countUnit}
        </Box>
        <Divider sx={{ flex: 1 }} />
      </Stack>
      {count === 0 && readonly ? (
        <Typography variant="body2" color="text.secondary" sx={{ py: 0.25 }}>
          {emptyText}
        </Typography>
      ) : (
        <Box sx={fileGridSx}>
          {children}
          {!readonly && uploadSlot}
        </Box>
      )}
    </Stack>
  );
}
