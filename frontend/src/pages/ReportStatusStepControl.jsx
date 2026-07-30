import { Box, CircularProgress, IconButton } from "@mui/material";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";

import { getReportStatusDirectionalActions, STATUS_META } from "./reportStatus";

const STATUS_STEP_BUTTON_WIDTH = 24;
const STATUS_STEP_LABEL_WIDTH = 64;
export const REPORT_STATUS_STEP_CONTROL_WIDTH = STATUS_STEP_BUTTON_WIDTH * 2 + STATUS_STEP_LABEL_WIDTH;

const statusStepButtonSx = {
  width: STATUS_STEP_BUTTON_WIDTH,
  height: 26,
  minWidth: STATUS_STEP_BUTTON_WIDTH,
  p: 0,
  borderRadius: 0,
  color: "inherit",
  "&:hover": { bgcolor: "rgba(255, 255, 255, 0.42)" },
  "&.Mui-disabled": { color: "inherit", opacity: 0.28 },
};

export default function ReportStatusStepControl({ reportId, status, loading = false, disabled = false, onStatusChange }) {
  const meta = STATUS_META[status] || { label: status, chipSx: {} };
  const { previous: previousAction, next: nextAction } = getReportStatusDirectionalActions(status);
  const subject = reportId ? `报销单 ${reportId}` : "当前报销单";
  const backgroundColor = meta.chipSx?.bgcolor || "action.selected";
  const color = meta.chipSx?.color || "text.primary";

  const changeStatus = (event, action) => {
    event.stopPropagation();
    if (action && !disabled) onStatusChange(action.target);
  };

  return (
    <Box
      role="group"
      aria-label={`${subject} 状态：${meta.label}`}
      onClick={(event) => event.stopPropagation()}
      sx={{
        width: REPORT_STATUS_STEP_CONTROL_WIDTH,
        height: 26,
        display: "inline-flex",
        alignItems: "stretch",
        overflow: "hidden",
        borderRadius: 1,
        bgcolor: backgroundColor,
        color,
        boxShadow: "inset 0 0 0 1px rgba(0, 0, 0, 0.08)",
      }}
    >
      <IconButton
        size="small"
        aria-label={previousAction ? `${previousAction.label}（${subject}）` : "没有可退回的状态"}
        title={previousAction?.label || "没有可退回的状态"}
        disabled={disabled || !previousAction}
        onClick={(event) => changeStatus(event, previousAction)}
        sx={{ ...statusStepButtonSx, borderRight: "1px solid rgba(0, 0, 0, 0.1)" }}
      >
        <ChevronLeftIcon sx={{ fontSize: 17 }} />
      </IconButton>
      <Box
        component="span"
        sx={{
          width: STATUS_STEP_LABEL_WIDTH,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          px: 0.5,
          fontSize: 13,
          fontWeight: 700,
          lineHeight: 1,
          whiteSpace: "nowrap",
        }}
      >
        {loading ? <CircularProgress size={12} color="inherit" /> : meta.label}
      </Box>
      <IconButton
        size="small"
        aria-label={nextAction ? `${nextAction.label}（${subject}）` : "没有可前进的状态"}
        title={nextAction?.label || "没有可前进的状态"}
        disabled={disabled || !nextAction}
        onClick={(event) => changeStatus(event, nextAction)}
        sx={{ ...statusStepButtonSx, borderLeft: "1px solid rgba(0, 0, 0, 0.1)" }}
      >
        <ChevronRightIcon sx={{ fontSize: 17 }} />
      </IconButton>
    </Box>
  );
}
