import { useEffect, useRef, useState } from "react";
import { keyframes } from "@emotion/react";
import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  InputAdornment,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ContentCutIcon from "@mui/icons-material/ContentCut";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import TrainIcon from "@mui/icons-material/Train";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import {
  getClipboardTicketPdfFilename,
  getClipboardTicketPdfFiles,
} from "./ticketImportUtils";

const fieldGridSx = {
  display: "grid",
  gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))", lg: "repeat(4, minmax(0, 1fr))" },
  gap: 1.25,
};

const dropzoneConfirm = keyframes`
  0% { box-shadow: 0 0 0 0 rgba(36, 84, 166, 0.22); }
  100% { box-shadow: 0 0 0 9px rgba(36, 84, 166, 0); }
`;

export function TicketDropzone({ files, disabled, onFiles, onPasteError, onRemove }) {
  const dragDepthRef = useRef(0);
  const feedbackTimerRef = useRef(null);
  const [dragActive, setDragActive] = useState(false);
  const [focused, setFocused] = useState(false);
  const [received, setReceived] = useState(false);
  const interactive = !disabled;

  useEffect(
    () => () => {
      if (feedbackTimerRef.current) window.clearTimeout(feedbackTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    if (!interactive) setFocused(false);
  }, [interactive]);

  const playReceiveFeedback = () => {
    setReceived(true);
    if (feedbackTimerRef.current) window.clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = window.setTimeout(() => setReceived(false), 520);
  };

  const resetDragState = () => {
    dragDepthRef.current = 0;
    setDragActive(false);
  };

  const handleDragEnter = (event) => {
    event.preventDefault();
    if (!interactive) return;
    const dragTypes = Array.from(event.dataTransfer?.types || []);
    if (dragTypes.length > 0 && !dragTypes.includes("Files")) return;
    dragDepthRef.current += 1;
    setDragActive(true);
  };

  const handleDragLeave = (event) => {
    event.preventDefault();
    if (dragDepthRef.current > 0) dragDepthRef.current -= 1;
    if (dragDepthRef.current === 0) setDragActive(false);
  };

  const handleDragOver = (event) => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = interactive ? "copy" : "none";
  };

  const handleDrop = (event) => {
    event.preventDefault();
    resetDragState();
    if (!interactive) return;
    playReceiveFeedback();
    onFiles(event.dataTransfer.files);
  };

  const handlePaste = (event) => {
    if (!interactive) return;
    const clipboardFiles = getClipboardTicketPdfFiles(event.clipboardData);
    if (clipboardFiles.length === 0) {
      event.preventDefault();
      onPasteError?.("剪贴板中没有可导入的铁路电子客票 PDF");
      return;
    }
    event.preventDefault();
    const timestamp = Date.now();
    const normalizedFiles = clipboardFiles.map((file, index) => {
      const filename = getClipboardTicketPdfFilename(file, index, timestamp);
      if (!filename || filename === file.name || typeof File !== "function") return file;
      return new File([file], filename, {
        type: file.type,
        lastModified: file.lastModified || timestamp,
      });
    });
    playReceiveFeedback();
    onFiles(normalizedFiles);
  };

  const selected = focused && interactive;
  const activeVisual = dragActive || selected;
  const primaryText = dragActive
    ? "松开即可加入车票"
    : disabled
      ? "正在解析车票"
      : selected
        ? "已选中车票上传区域"
        : "上传铁路电子客票 PDF";
  const secondaryText = dragActive
    ? "铁路电子客票将加入当前批次"
    : selected
      ? "按 Ctrl+V 粘贴车票 PDF，或选择文件"
      : "拖入、Ctrl+V 或选择 PDF；图片车票暂不支持";

  return (
    <Stack spacing={1.25}>
      <Box
        role="group"
        tabIndex={interactive ? 0 : -1}
        aria-label="车票上传区，可拖放、粘贴或选择铁路电子客票 PDF"
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onPaste={handlePaste}
        onFocus={() => {
          if (interactive) setFocused(true);
        }}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
        }}
        onMouseDown={(event) => {
          if (!interactive || event.target.closest?.("button, label, input")) return;
          event.currentTarget.focus();
        }}
        onKeyDown={(event) => {
          if (interactive && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            event.currentTarget.querySelector("input")?.click();
          }
        }}
        sx={{
          border: 1,
          borderStyle: activeVisual ? "solid" : "dashed",
          borderColor: disabled
            ? "divider"
            : activeVisual
              ? "primary.main"
              : "rgba(94, 131, 201, 0.68)",
          borderRadius: 1,
          bgcolor: disabled
            ? "action.hover"
            : activeVisual
              ? "primary.50"
              : "rgba(233, 240, 251, 0.72)",
          px: 1.5,
          py: 1.25,
          position: "relative",
          overflow: "hidden",
          outline: "none",
          transition: "border-color 160ms ease, background-color 160ms ease, transform 160ms ease, box-shadow 160ms ease",
          transform: activeVisual ? "translateY(-2px)" : "translateY(0)",
          boxShadow: activeVisual
            ? "0 10px 24px rgba(36, 84, 166, 0.14)"
            : "none",
          animation: received ? `${dropzoneConfirm} 480ms ease-out` : "none",
          "&::before": {
            content: '\"\"',
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            background: "linear-gradient(105deg, transparent 18%, rgba(255,255,255,0.72) 48%, transparent 78%)",
            transform: activeVisual ? "translateX(80%)" : "translateX(-120%)",
            transition: activeVisual ? "transform 700ms ease" : "none",
          },
        }}
      >
        <Stack direction="row" alignItems="center" spacing={1} sx={{ position: "relative", zIndex: 1 }}>
          <TrainIcon color="primary" sx={{ flex: "0 0 auto" }} />
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="body2" fontWeight={800} color={activeVisual ? "primary.dark" : "primary.main"}>
              {primaryText}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.15 }}>
              {secondaryText}
            </Typography>
          </Box>

          <Stack direction={{ xs: "column", sm: "row" }} alignItems="center" spacing={0.75} sx={{ flex: "0 0 auto" }}>
            <Box
              component="kbd"
              sx={{
                display: { xs: "none", sm: "inline-flex" },
                alignItems: "center",
                gap: 0.4,
                px: 0.8,
                py: 0.35,
                border: 1,
                borderColor: "divider",
                borderRadius: 0.75,
                bgcolor: "#F8FAFC",
                color: "text.secondary",
                fontFamily: "inherit",
                fontSize: 11,
                fontWeight: 800,
                lineHeight: 1.2,
                whiteSpace: "nowrap",
              }}
            >
              Ctrl+V
            </Box>
            <Button
              component="label"
              size="small"
              startIcon={<UploadFileIcon />}
              disabled={!interactive}
              sx={{ whiteSpace: "nowrap", fontWeight: 800 }}
            >
              选择 PDF
              <input
                hidden
                multiple
                type="file"
                accept=".pdf,application/pdf,application/x-pdf"
                onChange={(event) => {
                  onFiles(event.target.files);
                  event.target.value = "";
                }}
              />
            </Button>
          </Stack>
        </Stack>
      </Box>

      {files.length > 0 && (
        <Stack spacing={0.75}>
          {files.map((file) => (
            <Paper
              key={`${file.name}-${file.size}-${file.lastModified}`}
              variant="outlined"
              sx={{ px: 1.5, py: 1, bgcolor: "#F8FAFC" }}
            >
              <Stack direction="row" alignItems="center" spacing={1}>
                <UploadFileIcon fontSize="small" color="primary" />
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography variant="body2" fontWeight={800} noWrap>
                    {file.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {(Number(file.size || 0) / 1024).toFixed(1)} KB
                  </Typography>
                </Box>
                <Tooltip title="移除">
                  <span>
                    <IconButton size="small" disabled={disabled} onClick={() => onRemove(file)}>
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
              </Stack>
            </Paper>
          ))}
        </Stack>
      )}
    </Stack>
  );
}

export function RailPath({ path }) {
  return (
    <Box sx={{ overflowX: "auto", py: 0.5 }}>
      <Stack direction="row" alignItems="center" sx={{ minWidth: "max-content" }}>
        {path.map((station, index) => (
          <Stack key={`${station}-${index}`} direction="row" alignItems="center">
            {index > 0 && <Box sx={{ width: { xs: 28, sm: 48 }, height: 2, bgcolor: "primary.light" }} />}
            <Stack alignItems="center" spacing={0.4}>
              <Box
                sx={{
                  width: 12,
                  height: 12,
                  borderRadius: "50%",
                  bgcolor: index === 0 || index === path.length - 1 ? "primary.main" : "background.paper",
                  border: 2,
                  borderColor: "primary.main",
                  boxShadow: "0 0 0 3px rgba(36, 84, 166, 0.1)",
                }}
              />
              <Typography variant="caption" fontWeight={900} color="primary.dark">
                {station || "待补充"}
              </Typography>
            </Stack>
          </Stack>
        ))}
      </Stack>
    </Box>
  );
}

export function TicketEditor({
  ticket,
  ticketIndex,
  ticketCount,
  errors,
  splitActive,
  canToggleSplit,
  disabled,
  onChange,
  onMove,
  onToggleSplit,
  onRemove,
}) {
  return (
    <Paper variant="outlined" sx={{ p: { xs: 1.25, sm: 1.5 }, bgcolor: "#FFFFFF" }}>
      <Stack spacing={1.25}>
        <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" spacing={1}>
          <Box sx={{ minWidth: 0 }}>
            <Stack direction="row" alignItems="center" spacing={0.75} flexWrap="wrap" useFlexGap>
              <Typography fontWeight={900}>车票 {ticketIndex + 1}</Typography>
              {ticket.train_no && <Chip size="small" label={ticket.train_no} color="info" variant="outlined" />}
              {ticket.duplicate && <Chip size="small" label="疑似重复" color="error" />}
            </Stack>
            <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block", mt: 0.25 }}>
              {ticket.file_name || "未命名车票"}
            </Typography>
          </Box>
          <Stack direction="row" spacing={0.25} alignItems="center">
            {(canToggleSplit || splitActive) && (
              <Tooltip title={splitActive ? "恢复与下一张的中转连接" : "在此拆分中转链"}>
                <span>
                  <IconButton size="small" color={splitActive ? "warning" : "default"} disabled={disabled} onClick={onToggleSplit}>
                    <ContentCutIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
            )}
            <Tooltip title="上移">
              <span>
                <IconButton size="small" disabled={disabled || ticketIndex === 0} onClick={() => onMove(-1)}>
                  <ArrowUpwardIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="下移">
              <span>
                <IconButton size="small" disabled={disabled || ticketIndex === ticketCount - 1} onClick={() => onMove(1)}>
                  <ArrowDownwardIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="移除此车票">
              <span>
                <IconButton size="small" color="error" disabled={disabled} onClick={onRemove}>
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          </Stack>
        </Stack>

        {splitActive && <Alert severity="info" sx={{ py: 0.25 }}>已在此票后拆分，不再与下一张合并。</Alert>}
        {ticket.parse_warnings.map((warning, index) => (
          <Alert key={`${warning}-${index}`} severity="warning" sx={{ py: 0.25 }}>
            {warning}
          </Alert>
        ))}
        {errors.length > 0 && (
          <Alert severity="error" sx={{ py: 0.25, "& .MuiAlert-message": { minWidth: 0, overflowWrap: "anywhere" } }}>
            {errors.join("；")}
          </Alert>
        )}

        <Box sx={fieldGridSx}>
          <TextField
            size="small"
            label="乘车日期"
            type="date"
            value={ticket.travel_date}
            disabled={disabled}
            onChange={(event) => onChange("travel_date", event.target.value)}
            InputLabelProps={{ shrink: true }}
            error={errors.some((item) => item.includes("乘车日期"))}
          />
          <TextField
            size="small"
            label="出发站"
            value={ticket.depart_station}
            disabled={disabled}
            onChange={(event) => onChange("depart_station", event.target.value)}
            error={errors.some((item) => item.includes("出发站"))}
          />
          <TextField
            size="small"
            label="到达站"
            value={ticket.arrive_station}
            disabled={disabled}
            onChange={(event) => onChange("arrive_station", event.target.value)}
            error={errors.some((item) => item.includes("到达站"))}
          />
          <TextField
            size="small"
            label="车次"
            value={ticket.train_no}
            disabled={disabled}
            onChange={(event) => onChange("train_no", event.target.value)}
          />
          <TextField
            size="small"
            label="席别"
            value={ticket.seat_class}
            disabled={disabled}
            onChange={(event) => onChange("seat_class", event.target.value)}
          />
          <TextField
            size="small"
            label="座位"
            value={ticket.seat_no}
            disabled={disabled}
            onChange={(event) => onChange("seat_no", event.target.value)}
          />
          <TextField
            size="small"
            label="票价"
            type="number"
            value={ticket.amount}
            disabled={disabled}
            onChange={(event) => onChange("amount", event.target.value)}
            error={errors.some((item) => item.includes("票价"))}
            InputProps={{
              startAdornment: <InputAdornment position="start">¥</InputAdornment>,
              inputProps: { min: 0, step: "0.01" },
            }}
          />
          <TextField
            size="small"
            label="发票号码"
            value={ticket.invoice_no}
            disabled={disabled}
            onChange={(event) => onChange("invoice_no", event.target.value)}
            sx={{ gridColumn: { lg: "span 2" } }}
          />
          <TextField
            size="small"
            label="开票日期"
            type="date"
            value={ticket.invoice_date}
            disabled={disabled}
            onChange={(event) => onChange("invoice_date", event.target.value)}
            InputLabelProps={{ shrink: true }}
            sx={{ gridColumn: { lg: "span 2" } }}
          />
        </Box>
      </Stack>
    </Paper>
  );
}
