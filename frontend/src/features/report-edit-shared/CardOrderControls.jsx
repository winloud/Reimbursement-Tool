import { Box, IconButton, Stack, Tooltip } from "@mui/material";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import KeyboardArrowUpIcon from "@mui/icons-material/KeyboardArrowUp";

import stopSummaryInteraction from "./stopSummaryInteraction";

// 拖拽手柄：draggable 只绑在手柄上，避免整卡可拖时与输入框、折叠展开抢交互。
export function DragHandle({ label, disabled = false, active = false, onDragStart, onDragEnd }) {
  return (
    <Tooltip title={disabled ? "" : "按住拖动排序"}>
      <Box
        component="span"
        draggable={!disabled}
        aria-label={label}
        onDragStart={disabled ? undefined : onDragStart}
        onDragEnd={disabled ? undefined : onDragEnd}
        sx={{
          display: "inline-flex",
          alignItems: "center",
          flex: "0 0 auto",
          color: active ? "primary.main" : "action.disabled",
          cursor: disabled ? "default" : "grab",
          "&:active": { cursor: disabled ? "default" : "grabbing" },
        }}
        {...stopSummaryInteraction}
      >
        <DragIndicatorIcon fontSize="small" />
      </Box>
    </Tooltip>
  );
}

// 卡片标题行右侧的上移 / 下移按钮，与拖拽手柄配套。
// 差旅行程卡与常规项目卡共用，保证两页排序操作一致。
export default function CardOrderControls({
  index,
  totalItems,
  itemLabel = "",
  disabled = false,
  onMove,
}) {
  const move = (target) => (event) => {
    event.stopPropagation();
    onMove(index, target);
  };

  return (
    <Stack direction="row" spacing={0} sx={{ flexShrink: 0 }} {...stopSummaryInteraction}>
      <Tooltip title="上移">
        <span>
          <IconButton
            size="small"
            disabled={disabled || index === 0}
            aria-label={`上移：${itemLabel}`}
            onClick={move(index - 1)}
          >
            <KeyboardArrowUpIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title="下移">
        <span>
          <IconButton
            size="small"
            disabled={disabled || index === totalItems - 1}
            aria-label={`下移：${itemLabel}`}
            onClick={move(index + 1)}
          >
            <KeyboardArrowDownIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
    </Stack>
  );
}
