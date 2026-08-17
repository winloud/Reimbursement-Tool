import { useEffect, useState } from "react";
import { Box, Button, CircularProgress, Stack, Typography } from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import SaveIcon from "@mui/icons-material/Save";

import { editPageHeaderSx } from "./editPageStyles";

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
  sx,
  ...rootProps
}) {
  const saving = saveState === "saving";
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const updateStuck = () => setStuck(window.scrollY > 4);
    updateStuck();
    window.addEventListener("scroll", updateStuck, { passive: true });
    return () => window.removeEventListener("scroll", updateStuck);
  }, []);

  return (
    <Stack
      {...rootProps}
      component="header"
      direction={{ xs: "column", md: "row" }}
      justifyContent="space-between"
      alignItems={{ xs: "stretch", md: "center" }}
      spacing={2}
      data-stuck={String(stuck)}
      sx={Array.isArray(sx) ? [editPageHeaderSx, ...sx] : [editPageHeaderSx, sx]}
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
