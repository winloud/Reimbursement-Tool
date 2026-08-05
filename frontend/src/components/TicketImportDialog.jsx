import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  LinearProgress,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import LinkIcon from "@mui/icons-material/Link";
import TrainIcon from "@mui/icons-material/Train";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import { discardRailTicketPreview, importRailTickets, previewRailTickets } from "../api/client";
import {
  buildTicketGroups,
  buildTicketImportPayload,
  getTicketConnection,
  mergeTicketPdfFiles,
  moveTicketCandidate,
  normalizeTicketCandidate,
  normalizeTicketCandidates,
  removeTicketCandidate,
  sortTicketCandidates,
  shouldMergeTicketGroup,
  validateTicketCandidates,
} from "./ticketImportUtils";
import { RailPath, TicketDropzone, TicketEditor } from "./TicketImportParts";

const getApiErrorMessage = (error, fallback) => {
  const detail = error?.response?.data?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return detail.map((item) => item?.msg || String(item)).join("；");
  return error?.response?.data?.message || error?.message || fallback;
};

const warningText = (warning) => {
  if (typeof warning === "string") return warning;
  return warning?.message || warning?.detail || String(warning || "");
};

const formatMoney = (value) =>
  `¥${Number(value || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function TicketImportDialog({ open, reportId, onClose, onImported }) {
  const [files, setFiles] = useState([]);
  const [preview, setPreview] = useState(null);
  const [tickets, setTickets] = useState([]);
  const [breakAfterIds, setBreakAfterIds] = useState(new Set());
  const [mergeByGroup, setMergeByGroup] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const reset = useCallback(() => {
    setFiles([]);
    setPreview(null);
    setTickets([]);
    setBreakAfterIds(new Set());
    setMergeByGroup({});
    setBusy(false);
    setError("");
  }, []);

  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  const groups = useMemo(() => buildTicketGroups(tickets, { breakAfterIds }), [breakAfterIds, tickets]);
  const validationErrors = useMemo(() => validateTicketCandidates(tickets), [tickets]);
  const invalidCount = Object.keys(validationErrors).length;
  const duplicateCount = tickets.filter((ticket) => ticket.duplicate).length;
  const mergedTicketCount = groups.reduce(
    (sum, group) => sum + (shouldMergeTicketGroup(group, mergeByGroup) ? group.ticket_ids.length : 0),
    0,
  );

  const addFiles = (incoming) => {
    const result = mergeTicketPdfFiles(files, incoming);
    setFiles(result.files);
    const messages = [];
    if (result.rejected.length > 0) messages.push(`${result.rejected.length} 个文件不是 PDF，已忽略`);
    if (result.duplicates.length > 0) messages.push(`${result.duplicates.length} 个重复文件未再次加入`);
    setError(messages.join("；"));
  };

  const handlePreview = async () => {
    if (!reportId) {
      setError("请先保存报销单，再导入车票");
      return;
    }
    if (files.length === 0) {
      setError("请至少选择一张铁路电子客票 PDF");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await previewRailTickets({ reportId, files });
      if (!response?.success) {
        setError(response?.message || "车票解析失败");
        return;
      }
      const data = response.data || {};
      const candidates = sortTicketCandidates(normalizeTicketCandidates(data.tickets || []));
      if (candidates.length === 0) {
        setError("没有解析出可确认的车票，请检查 PDF 是否为铁路电子客票");
        return;
      }
      setPreview(data);
      setTickets(candidates);
      setBreakAfterIds(new Set());
      setMergeByGroup({});
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "车票解析失败"));
    } finally {
      setBusy(false);
    }
  };

  const updateTicket = (ticketId, field, value) => {
    setTickets((current) =>
      current.map((ticket, index) =>
        String(ticket.id) === String(ticketId) ? normalizeTicketCandidate({ ...ticket, [field]: value }, index) : ticket,
      ),
    );
  };

  const moveTicket = (index, offset) => {
    setTickets((current) => moveTicketCandidate(current, index, index + offset));
  };

  const toggleSplit = (ticketId) => {
    setBreakAfterIds((current) => {
      const next = new Set(current);
      const key = String(ticketId);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const removeTicket = (ticketId) => {
    const key = String(ticketId);
    setTickets((current) => removeTicketCandidate(current, key));
    setBreakAfterIds((current) => {
      if (!current.has(key)) return current;
      const next = new Set(current);
      next.delete(key);
      return next;
    });
  };

  const handleImport = async () => {
    if (!preview?.token || tickets.length === 0 || invalidCount > 0) return;
    setBusy(true);
    setError("");
    try {
      const payload = buildTicketImportPayload({ token: preview.token, tickets, groups, mergeByGroup });
      const response = await importRailTickets(reportId, payload);
      if (!response?.success) {
        setError(response?.message || "车票导入失败");
        return;
      }
      await onImported?.(response.data, { tickets, groups, mergeByGroup });
      onClose?.();
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "车票导入失败"));
    } finally {
      setBusy(false);
    }
  };

  const discardPreview = async () => {
    if (!preview?.token) return;
    try {
      await discardRailTicketPreview({ reportId, token: preview.token });
    } catch {
      // The server also expires orphaned previews; closing should not be blocked by cleanup failure.
    }
  };

  const requestClose = async () => {
    if (busy) return;
    await discardPreview();
    onClose?.();
  };

  return (
    <Dialog
      open={open}
      onClose={requestClose}
      fullWidth
      maxWidth="lg"
      PaperProps={{ sx: { maxHeight: "92vh" } }}
    >
      <DialogTitle sx={{ pb: 1.25 }}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <TrainIcon color="primary" />
          <Box>
            <Typography component="div" variant="h6" fontWeight={900}>
              从高铁车票导入行程
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {preview ? "检查识别结果，并决定是否简化中转行程" : "上传多张车票，系统会识别连续中转路线"}
            </Typography>
          </Box>
        </Stack>
      </DialogTitle>

      {busy && <LinearProgress />}

      <DialogContent dividers sx={{ bgcolor: "#F8FAFC" }}>
        <Stack spacing={2}>
          {error && <Alert severity="error">{error}</Alert>}

          {!preview ? (
            <>
              {busy && (
                <Alert severity="info" icon={<CircularProgress size={18} />}>
                  正在解析车票文字、二维码和票面信息，多张车票可能需要一些时间。
                </Alert>
              )}
              <TicketDropzone
                files={files}
                disabled={busy}
                onFiles={addFiles}
                onPasteError={setError}
                onRemove={(target) => setFiles((current) => current.filter((file) => file !== target))}
              />
              <Alert severity="info">
                系统会先按乘车日期整理各段，再根据同日或次日的连续站点重排唯一明确的路线；分叉或循环路线内部保留上传顺序。
              </Alert>
            </>
          ) : (
            <>
              <Paper variant="outlined" sx={{ p: 1.5, bgcolor: "#FFFFFF" }}>
                <Stack
                  direction={{ xs: "column", sm: "row" }}
                  justifyContent="space-between"
                  alignItems={{ xs: "flex-start", sm: "center" }}
                  spacing={1}
                >
                  <Box>
                    <Typography fontWeight={900}>解析完成：{tickets.length} 张车票</Typography>
                    <Typography variant="body2" color="text.secondary">
                      已按日期和连续站点整理初始顺序；分叉或循环路线内部保留上传顺序，仍可手动调整、拆分或取消合并。
                    </Typography>
                  </Box>
                  <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ minWidth: 0, maxWidth: "100%" }}>
                    <Chip size="small" label={`${groups.length} 个建议行程组`} color="info" variant="outlined" />
                    {duplicateCount > 0 && <Chip size="small" label={`${duplicateCount} 张重复票`} color="error" />}
                    {invalidCount > 0 && <Chip size="small" label={`${invalidCount} 张待补充`} color="warning" />}
                    {preview.expires_at && (
                      <Chip
                        size="small"
                        label={`临时预览有效至 ${preview.expires_at}`}
                        variant="outlined"
                        sx={{
                          height: "auto",
                          maxWidth: "100%",
                          "& .MuiChip-label": { py: 0.35, whiteSpace: "normal", overflowWrap: "anywhere" },
                        }}
                      />
                    )}
                  </Stack>
                </Stack>
              </Paper>

              {Array.from(preview.warnings || []).map((warning, index) => (
                <Alert key={`${warningText(warning)}-${index}`} severity="warning">
                  {warningText(warning)}
                </Alert>
              ))}

              {duplicateCount > 0 && (
                <Alert severity="error">
                  存在重复文件、重复发票号码或已导入车票。可用每张车票右上角的删除按钮移除重复项，再导入其余车票。
                </Alert>
              )}

              {tickets.length === 0 && (
                <Alert severity="info">已移除全部车票。请点击“返回重选”重新上传，或直接取消。</Alert>
              )}

              {groups.map((group, groupIndex) => (
                <Paper key={group.id} variant="outlined" sx={{ overflow: "hidden", bgcolor: "#FFFFFF" }}>
                  <Box sx={{ p: { xs: 1.5, sm: 2 }, bgcolor: group.suggested_merge ? "primary.50" : "#F8FAFC" }}>
                    <Stack spacing={1.25}>
                      <Stack
                        direction={{ xs: "column", md: "row" }}
                        justifyContent="space-between"
                        alignItems={{ xs: "flex-start", md: "center" }}
                        spacing={1}
                      >
                        <Box>
                          <Stack direction="row" alignItems="center" spacing={0.75} flexWrap="wrap" useFlexGap>
                            <Typography fontWeight={900}>建议行程组 {groupIndex + 1}</Typography>
                            {group.suggested_merge && <Chip size="small" icon={<LinkIcon />} label="连续中转" color="primary" />}
                            {group.cross_day && <Chip size="small" label="次日中转" color="warning" />}
                            {(group.round_trip || group.route_loop) && (
                              <Chip size="small" label="返程/回环已拆分" color="info" variant="outlined" />
                            )}
                          </Stack>
                          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.35 }}>
                            {group.ticket_ids.length} 张车票 · 合计 {formatMoney(group.total_amount)}
                          </Typography>
                        </Box>
                        {group.suggested_merge && (
                          <FormControlLabel
                            control={
                              <Checkbox
                                checked={shouldMergeTicketGroup(group, mergeByGroup)}
                                disabled={busy}
                                onChange={(event) =>
                                  setMergeByGroup((current) => ({ ...current, [group.id]: event.target.checked }))
                                }
                              />
                            }
                            label="合并为一段中转行程"
                            sx={{ mr: 0, "& .MuiFormControlLabel-label": { fontWeight: 900 } }}
                          />
                        )}
                      </Stack>
                      <RailPath path={group.path} />
                      {group.warning && <Alert severity={group.round_trip || group.route_loop ? "warning" : "info"}>{group.warning}</Alert>}
                    </Stack>
                  </Box>

                  <Divider />
                  <Stack spacing={1.25} sx={{ p: { xs: 1.25, sm: 1.5 } }}>
                    {group.tickets.map((ticket, groupTicketIndex) => {
                      const ticketIndex = tickets.findIndex((item) => String(item.id) === String(ticket.id));
                      const nextTicket = group.tickets[groupTicketIndex + 1];
                      const splitActive = breakAfterIds.has(String(ticket.id));
                      return (
                        <TicketEditor
                          key={ticket.id}
                          ticket={ticket}
                          ticketIndex={ticketIndex}
                          ticketCount={tickets.length}
                          errors={validationErrors[String(ticket.id)] || []}
                          splitActive={splitActive}
                          canToggleSplit={Boolean(nextTicket && getTicketConnection(ticket, nextTicket))}
                          disabled={busy}
                          onChange={(field, value) => updateTicket(ticket.id, field, value)}
                          onMove={(offset) => moveTicket(ticketIndex, offset)}
                          onToggleSplit={() => toggleSplit(ticket.id)}
                          onRemove={() => removeTicket(ticket.id)}
                        />
                      );
                    })}
                  </Stack>
                </Paper>
              ))}
            </>
          )}
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 2.5, py: 1.5 }}>
        <Button onClick={requestClose} disabled={busy} color="inherit">
          取消
        </Button>
        {preview ? (
          <>
            <Button
              disabled={busy}
              onClick={async () => {
                await discardPreview();
                setPreview(null);
                setTickets([]);
                setBreakAfterIds(new Set());
                setMergeByGroup({});
                setError("");
              }}
            >
              返回重选
            </Button>
            <Button
              variant="contained"
              startIcon={busy ? <CircularProgress size={16} color="inherit" /> : <TrainIcon />}
              disabled={busy || invalidCount > 0 || tickets.length === 0}
              onClick={handleImport}
            >
              {busy
                ? "正在导入..."
                : mergedTicketCount > 0
                  ? `确认导入（${mergedTicketCount} 张票含中转合并）`
                  : `确认导入 ${tickets.length} 张车票`}
            </Button>
          </>
        ) : (
          <Button
            variant="contained"
            startIcon={busy ? <CircularProgress size={16} color="inherit" /> : <UploadFileIcon />}
            disabled={busy || files.length === 0}
            onClick={handlePreview}
          >
            {busy ? "正在解析..." : `解析 ${files.length || ""} 张车票`}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
