import { CircularProgress } from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";

// 两类填报页共用的保存状态标签，文案与图标保持一致。
const SAVE_STATE_META = {
  pristine: { text: "无需保存", icon: null, color: "default" },
  idle: { text: "等待修改", icon: null, color: "default" },
  dirty: { text: "有未保存修改", icon: null, color: "warning" },
  saving: { text: "保存中...", icon: <CircularProgress size={14} />, color: "info" },
  saved: { text: "已保存", icon: <CheckCircleIcon fontSize="small" />, color: "success" },
  error: { text: "保存失败，请重试", icon: <ErrorOutlineIcon fontSize="small" />, color: "error" },
};

export const getSaveStateMeta = (saveState) => SAVE_STATE_META[saveState] || SAVE_STATE_META.idle;
