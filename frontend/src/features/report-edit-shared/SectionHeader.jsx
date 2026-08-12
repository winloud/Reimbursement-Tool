import { Box, Stack, Typography } from "@mui/material";

// 章节头：h6 标题（可带芯片）+ 说明文字，右侧放该章节的操作按钮。
export default function SectionHeader({ title, chip, description, actions }) {
  return (
    <Stack
      direction={{ xs: "column", sm: "row" }}
      justifyContent="space-between"
      alignItems={{ xs: "stretch", sm: "center" }}
      spacing={1}
    >
      <Box>
        <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap">
          <Typography variant="h6" fontWeight={800}>
            {title}
          </Typography>
          {chip}
        </Stack>
        {description && (
          <Typography variant="body2" color="text.secondary">
            {description}
          </Typography>
        )}
      </Box>
      {actions && (
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
          {actions}
        </Stack>
      )}
    </Stack>
  );
}
