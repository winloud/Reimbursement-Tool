import { Box, Button, CircularProgress, Stack, Typography } from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import SaveIcon from "@mui/icons-material/Save";

// 填报页统一页头：标题 + 状态芯片 + 副标题，右侧为返回/手动保存/状态流转按钮。
export default function EditPageHeader({
  title,
  chips,
  subtitle,
  onBack,
  backLabel = "返回列表",
  saveState,
  canSave = true,
  readonly = false,
  onSave,
  statusActions = [],
  onStatusAction,
}) {
  const saving = saveState === "saving";
  return (
    <Stack
      direction={{ xs: "column", md: "row" }}
      justifyContent="space-between"
      alignItems={{ xs: "stretch", md: "center" }}
      spacing={2}
    >
      <Box>
        <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
          <Typography variant="h5" fontWeight={800}>
            {title}
          </Typography>
          {chips}
        </Stack>
        {subtitle && <Typography color="text.secondary">{subtitle}</Typography>}
      </Box>
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ "& > .MuiButton-root": { whiteSpace: "nowrap" } }}>
        <Button startIcon={<ArrowBackIcon />} variant="outlined" onClick={onBack}>
          {backLabel}
        </Button>
        <Button
          startIcon={saving ? <CircularProgress size={16} /> : <SaveIcon />}
          variant="contained"
          onClick={onSave}
          disabled={readonly || saving || !canSave}
        >
          手动保存
        </Button>
        {statusActions.map((action) => (
          <Button
            key={action.target}
            variant="outlined"
            color={action.color === "inherit" ? "inherit" : action.color}
            onClick={() => onStatusAction(action.target)}
            disabled={saving}
          >
            {action.label}
          </Button>
        ))}
      </Stack>
    </Stack>
  );
}
