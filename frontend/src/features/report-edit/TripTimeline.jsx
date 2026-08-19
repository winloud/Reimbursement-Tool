import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  ButtonBase,
  Chip,
  Collapse,
  Divider,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteIcon from "@mui/icons-material/Delete";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import KeyboardReturnIcon from "@mui/icons-material/KeyboardReturn";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import SwapHorizIcon from "@mui/icons-material/SwapHoriz";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";

import {
  formatAmount,
  getConfirmedInvoiceCount,
  getConfirmedInvoiceTotal,
  getPaperInvoiceCount,
  getSubsidySpans,
  getTripGapWarnings,
  hasPaperInvoice,
} from "../../pages/reportEditUtils";
import BlockCard from "../report-edit-shared/BlockCard";
import CardOrderControls, { DragHandle } from "../report-edit-shared/CardOrderControls";
import FileDropSlot from "../report-edit-shared/FileDropSlot";
import InvoiceCardList from "../report-edit-shared/InvoiceCardList";
import stopSummaryInteraction from "../report-edit-shared/stopSummaryInteraction";
import {
  cardSubSectionDividerSx,
  draggingCardSx,
  sectionAnchorSx,
} from "../report-edit-shared/editPageStyles";
import PaperInvoiceEntry from "./PaperInvoiceEntry";

const TRANSPORT_OPTIONS = ["飞机", "高铁/动车", "网约车", "自驾"];
const RAIL_COLOR = "#C6D0DC";
const SUBTLE_SURFACE = "#F8FAFC";

const tripKey = (trip, index) => String(trip.id ? `trip-${trip.id}` : `draft-${index}`);

const formatMonthDay = (dateValue, month, day) => {
  const matched = String(dateValue || "").match(/^\d{4}-(\d{2})-(\d{2})$/);
  if (matched) return `${Number(matched[1])}/${Number(matched[2])}`;
  if (!month || !day) return "日期待填";
  return `${Number(month)}/${Number(day)}`;
};

const formatTripDateRange = (trip) => {
  const depart = formatMonthDay(trip.depart_date, trip.depart_month, trip.depart_day);
  const arrive = formatMonthDay(trip.arrive_date, trip.arrive_month, trip.arrive_day);
  return depart === arrive ? depart : `${depart}-${arrive}`;
};

const railSegmentSx = (kind) => {
  if (kind === "none") return { background: "none" };
  if (kind === "live") return { backgroundColor: "primary.main" };
  return {
    backgroundImage: `repeating-linear-gradient(to bottom, ${RAIL_COLOR} 0 4px, transparent 4px 8px)`,
  };
};

const nodeKindSx = {
  off: { bgcolor: "background.paper", borderColor: RAIL_COLOR },
  mid: { bgcolor: "primary.50", borderColor: "primary.main" },
  start: {
    bgcolor: "primary.main",
    borderColor: "primary.main",
    boxShadow: "0 0 0 4px #E9F0FB",
  },
  end: {
    bgcolor: "primary.dark",
    borderColor: "primary.dark",
    boxShadow: "0 0 0 4px #E9F0FB",
  },
  warn: {
    bgcolor: "warning.main",
    borderColor: "warning.main",
    boxShadow: "0 0 0 4px #FFF1DD",
  },
};

function TimelineRail({ up = "idle", down = "idle", nodeKind = "off", centered = false }) {
  return (
    <Box
      aria-hidden="true"
      sx={{
        position: "relative",
        "&::before, &::after": {
          content: '\"\"',
          position: "absolute",
          left: 14,
          width: 2,
          borderRadius: 2,
        },
        "&::before": {
          top: 0,
          height: centered ? "50%" : 24,
          ...railSegmentSx(up),
        },
        "&::after": {
          top: centered ? "50%" : 24,
          bottom: 0,
          ...railSegmentSx(down),
        },
      }}
    >
      <Box
        component="span"
        sx={{
          position: "absolute",
          left: 9,
          top: centered ? "calc(50% - 6px)" : 18,
          zIndex: 1,
          width: 12,
          height: 12,
          borderRadius: "50%",
          border: "2px solid",
          ...nodeKindSx[nodeKind],
        }}
      />
    </Box>
  );
}

function TimelineMark({ up, down, nodeKind, children }) {
  return (
    <Box sx={{ display: "grid", gridTemplateColumns: "30px minmax(0, 1fr)", alignItems: "stretch" }}>
      <TimelineRail up={up} down={down} nodeKind={nodeKind} centered />
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, py: 0.875, pl: 1.625, flexWrap: "wrap" }}>
        {children}
      </Box>
    </Box>
  );
}

const tripSummarySx = {
  display: "grid",
  gridTemplateColumns: {
    xs: "24px minmax(0, 1fr)",
    sm: "24px minmax(0, 1fr) auto",
  },
  gap: { xs: "6px 10px", lg: "6px 12px" },
  alignItems: "center",
  minHeight: 46,
  px: 1.5,
  py: 0.625,
  bgcolor: SUBTLE_SURFACE,
};

const tripSummaryToggleSx = {
  display: "grid",
  gridTemplateColumns: {
    xs: "minmax(0, 1fr)",
    lg: "minmax(0, 200px) minmax(0, 1fr)",
  },
  gap: { xs: "6px 10px", lg: "6px 12px" },
  alignItems: "center",
  minWidth: 0,
  alignSelf: "stretch",
  justifyItems: "stretch",
  textAlign: "left",
  borderRadius: 0.5,
  cursor: "pointer",
  outline: "none",
  "&:focus-visible": {
    boxShadow: "inset 0 0 0 2px #2454A6",
  },
};

const tripFactsSx = {
  display: "grid",
  gridTemplateColumns: {
    xs: "repeat(2, minmax(0, 1fr))",
    sm: "72px 76px minmax(84px, 1fr) 76px",
    lg: "72px 76px 84px 76px",
  },
  gridColumn: { xs: "1 / -1", sm: "1 / -1", lg: "auto" },
  gridRow: { xs: 2, sm: 2, lg: "auto" },
  gap: 1.25,
  alignItems: "baseline",
  minWidth: 0,
};

const tripLegGridSx = {
  display: "grid",
  gridTemplateColumns: {
    xs: "minmax(0, 1fr)",
    lg: "minmax(0, 1fr) 32px minmax(0, 1fr) minmax(130px, 170px)",
  },
  gap: 1.5,
  alignItems: "end",
};

const tripLegFieldsSx = {
  display: "grid",
  gridTemplateColumns: {
    xs: "minmax(0, 1fr) 56px",
    sm: "148px 56px minmax(0, 1fr)",
  },
  gap: 1,
  minWidth: 0,
  "& .trip-place-field": {
    gridColumn: { xs: "1 / -1", sm: "auto" },
  },
};

function TripMetric({ children, color = "text.secondary", align = "left", fontWeight = 700 }) {
  return (
    <Typography
      variant="body2"
      color={color}
      sx={{
        minWidth: 0,
        fontSize: align === "right" ? 13 : 12.5,
        fontWeight,
        textAlign: align,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {children}
    </Typography>
  );
}

function TripTimelineRow({
  trip,
  index,
  totalTrips,
  expanded,
  up,
  down,
  inSpan,
  readonly,
  saveState,
  uploadState,
  dragIndex,
  tripInvoices,
  paperInvoiceEditor,
  onToggle,
  updateTrip,
  toggleTripMarker,
  returnTrip,
  startTripDrag,
  dropTrip,
  endTripDrag,
  moveTripByIndex,
  openTripMenu,
  handleFilesUpload,
  onUploadError,
  onSelectInvoice,
  onDeleteInvoice,
  openPaperInvoiceEditor,
  updatePaperInvoiceEditor,
  savePaperInvoiceEditor,
  closePaperInvoiceEditor,
  requestPaperInvoiceClear,
}) {
  const rowKey = tripKey(trip, index);
  const summaryId = `${rowKey}-summary`;
  const detailId = `${rowKey}-detail`;
  const paperInvoiceKey = `trip:${trip.id || index}`;
  const uploadKey = `trip-${index}`;
  const paperCount = getPaperInvoiceCount(trip);
  const confirmedElectronicCount = getConfirmedInvoiceCount(tripInvoices);
  const confirmedCount = confirmedElectronicCount + paperCount;
  const pendingCount = tripInvoices.filter((invoice) => !invoice.amount_confirmed).length;
  const invoiceCount = tripInvoices.length + paperCount;
  const confirmedAmount = getConfirmedInvoiceTotal(tripInvoices) + Number(trip.paper_invoice_amount || 0);
  const tripTitle = `${trip.depart_place || "出发地"} -> ${trip.arrive_place || "到达地"}`;
  const isFirst = index === 0;
  const isLast = index === totalTrips - 1;
  const effectiveStart = isFirst || trip.subsidy_start;
  const effectiveEnd = isLast || trip.subsidy_end;
  const uploadDisabled = readonly || !trip.id || saveState === "saving";
  const uploading = uploadState?.key === uploadKey;

  return (
    <Box
      onDragOver={(event) => event.preventDefault()}
      onDrop={() => dropTrip(index)}
      sx={{
        display: "grid",
        gridTemplateColumns: "30px minmax(0, 1fr)",
        alignItems: "stretch",
      }}
    >
      <TimelineRail up={up} down={down} nodeKind={inSpan ? "mid" : "off"} />
      <Box
        sx={{
          minWidth: 0,
          mb: 1,
          overflow: "hidden",
          border: 1,
          borderColor: "divider",
          borderRadius: 1,
          bgcolor: "background.paper",
          transition: (theme) => theme.transitions.create("border-color", {
            duration: theme.transitions.duration.shorter,
          }),
          "&:hover, &:focus-within": { borderColor: "primary.light" },
          ...(dragIndex === index ? draggingCardSx : {}),
          "@media (prefers-reduced-motion: reduce)": {
            transition: "none",
            "& .MuiCollapse-root": { transitionDuration: "0ms !important" },
          },
        }}
      >
        <Box
          sx={tripSummarySx}
        >
          <DragHandle
            label={`拖动排序：${tripTitle}`}
            disabled={readonly}
            active={dragIndex === index}
            onDragStart={() => startTripDrag(index)}
            onDragEnd={endTripDrag}
          />

          <ButtonBase
            id={summaryId}
            type="button"
            aria-expanded={expanded}
            aria-controls={detailId}
            aria-label={`${expanded ? "收起" : "展开"}行程：${tripTitle}`}
            onClick={onToggle}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              onToggle();
            }}
            sx={tripSummaryToggleSx}
          >
            <Stack direction="row" alignItems="center" spacing={0.75} sx={{ minWidth: 0 }}>
              <Tooltip title={tripTitle}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, minWidth: 0, fontSize: 14, fontWeight: 800 }}>
                  <Typography component="span" fontWeight={800} noWrap sx={{ minWidth: 0 }}>
                    {trip.depart_place || "出发地"}
                  </Typography>
                  <ArrowForwardIcon sx={{ flex: "0 0 auto", color: "primary.light", fontSize: 16 }} />
                  <Typography component="span" fontWeight={800} noWrap sx={{ minWidth: 0 }}>
                    {trip.arrive_place || "到达地"}
                  </Typography>
                </Box>
              </Tooltip>
            </Stack>

            <Box sx={tripFactsSx}>
              <TripMetric>{formatTripDateRange(trip)}</TripMetric>
              <Chip
                size="small"
                label={trip.transport || "未填"}
                sx={{
                  justifySelf: "start",
                  maxWidth: "100%",
                  height: 22,
                  bgcolor: "background.paper",
                  border: 1,
                  borderColor: "divider",
                  color: trip.transport ? "text.secondary" : "text.disabled",
                  "& .MuiChip-label": { px: 0.875, overflow: "hidden", textOverflow: "ellipsis" },
                }}
              />
              <TripMetric align="right" color={confirmedAmount > 0 ? "text.primary" : "text.disabled"} fontWeight={800}>
                {confirmedAmount > 0 ? formatAmount(confirmedAmount) : "—"}
              </TripMetric>
              <TripMetric
                align="right"
                color={pendingCount > 0 ? "warning.dark" : invoiceCount > 0 ? "text.secondary" : "text.disabled"}
                fontWeight={800}
              >
                {pendingCount > 0 ? `${pendingCount} 张待确认` : confirmedCount > 0 ? `${confirmedCount} 张` : "无发票"}
              </TripMetric>
            </Box>
          </ButtonBase>

          <Stack
            direction="row"
            spacing={0.25}
            useFlexGap
            alignItems="center"
            justifyContent="flex-end"
            sx={{
              gridColumn: { xs: "1 / -1", sm: 3 },
              gridRow: { xs: 2, sm: 1 },
              minWidth: 0,
            }}
            {...stopSummaryInteraction}
          >
            <Divider orientation="vertical" flexItem sx={{ mx: 1 }} />
            <Tooltip title={isFirst ? "出差开始（默认，自动）" : "标记这段为一次出差的开始"}>
              <span>
                <Button
                  size="small"
                  variant={effectiveStart ? "contained" : "outlined"}
                  disabled={readonly || isFirst}
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleTripMarker(index, "subsidy_start");
                  }}
                  sx={{
                    minWidth: 28,
                    height: 26,
                    px: 0.75,
                    ...(isFirst
                      ? {
                          "&.Mui-disabled": {
                            bgcolor: "primary.50",
                            borderColor: "primary.50",
                            color: "primary.main",
                          },
                        }
                      : {}),
                  }}
                >
                  起
                </Button>
              </span>
            </Tooltip>
            <Tooltip title={isLast ? "出差结束（默认，自动）" : "标记这段为一次出差的结束"}>
              <span>
                <Button
                  size="small"
                  variant={effectiveEnd ? "contained" : "outlined"}
                  disabled={readonly || isLast}
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleTripMarker(index, "subsidy_end");
                  }}
                  sx={{
                    minWidth: 28,
                    height: 26,
                    px: 0.75,
                    ...(isLast
                      ? {
                          "&.Mui-disabled": {
                            bgcolor: "primary.50",
                            borderColor: "primary.50",
                            color: "primary.main",
                          },
                        }
                      : {}),
                  }}
                >
                  止
                </Button>
              </span>
            </Tooltip>
            <Divider orientation="vertical" flexItem sx={{ mx: 1 }} />
            <Tooltip title="生成返程">
              <span>
                <IconButton
                  size="small"
                  disabled={readonly}
                  onClick={(event) => {
                    event.stopPropagation();
                    returnTrip(index);
                  }}
                  aria-label={`生成返程：${tripTitle}`}
                >
                  <KeyboardReturnIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <CardOrderControls
              index={index}
              totalItems={totalTrips}
              itemLabel={tripTitle}
              disabled={readonly}
              onMove={moveTripByIndex}
            />
            <Tooltip title="更多行程操作">
              <span>
                <IconButton
                  size="small"
                  disabled={readonly}
                  aria-label={`更多行程操作：${tripTitle}`}
                  aria-haspopup="menu"
                  onClick={(event) => {
                    event.stopPropagation();
                    openTripMenu(event.currentTarget, index);
                  }}
                >
                  <MoreVertIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title={expanded ? "收起行程明细" : "展开行程明细"}>
              <IconButton
                size="small"
                aria-label={`${expanded ? "收起" : "展开"}行程明细：${tripTitle}`}
                aria-expanded={expanded}
                aria-controls={detailId}
                onClick={(event) => {
                  event.stopPropagation();
                  onToggle();
                }}
                sx={{
                  "& .MuiSvgIcon-root": {
                    transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
                    transition: (theme) => theme.transitions.create("transform", {
                      duration: theme.transitions.duration.shorter,
                    }),
                  },
                }}
              >
                <ExpandMoreIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
        </Box>

        <Collapse in={expanded} timeout="auto">
          <Box
            id={detailId}
            role="region"
            aria-labelledby={summaryId}
            sx={{
              display: "flex",
              flexDirection: "column",
              gap: 1.5,
              p: 1.5,
              bgcolor: "background.paper",
              borderTop: 1,
              borderTopColor: "divider",
              borderRadius: "0 0 7px 7px",
            }}
          >
            <Box sx={tripLegGridSx}>
              <Stack spacing={0.625} sx={{ minWidth: 0 }}>
                <Typography variant="caption" fontWeight={700} color="text.secondary">
                  出发
                </Typography>
                <Box sx={tripLegFieldsSx}>
                  <TextField
                    size="small"
                    type="date"
                    value={trip.depart_date}
                    disabled={readonly}
                    onChange={(event) => updateTrip(index, "depart_date", event.target.value)}
                    inputProps={{ "aria-label": "出发日期" }}
                  />
                  <TextField
                    size="small"
                    type="number"
                    placeholder="时"
                    value={trip.depart_hour}
                    disabled={readonly}
                    onChange={(event) => updateTrip(index, "depart_hour", event.target.value)}
                    inputProps={{ min: 0, max: 23, "aria-label": "出发时（24 小时制，可留空）" }}
                  />
                  <TextField
                    className="trip-place-field"
                    size="small"
                    placeholder="出发地"
                    value={trip.depart_place}
                    disabled={readonly}
                    onChange={(event) => updateTrip(index, "depart_place", event.target.value)}
                    inputProps={{ "aria-label": "出发地点" }}
                  />
                </Box>
              </Stack>

              <Box
                aria-hidden="true"
                sx={{
                  display: { xs: "none", lg: "flex" },
                  position: "relative",
                  height: 40,
                  alignItems: "center",
                  justifyContent: "center",
                  "&::before": {
                    content: '\"\"',
                    position: "absolute",
                    left: -1.25,
                    right: -1.25,
                    borderTop: `1px dashed ${RAIL_COLOR}`,
                  },
                }}
              >
                <ArrowForwardIcon sx={{ position: "relative", p: 0.25, bgcolor: "background.paper", color: "primary.light", fontSize: 20 }} />
              </Box>

              <Stack spacing={0.625} sx={{ minWidth: 0 }}>
                <Typography variant="caption" fontWeight={700} color="text.secondary">
                  到达
                </Typography>
                <Box sx={tripLegFieldsSx}>
                  <TextField
                    size="small"
                    type="date"
                    value={trip.arrive_date}
                    disabled={readonly}
                    onChange={(event) => updateTrip(index, "arrive_date", event.target.value)}
                    inputProps={{ "aria-label": "到达日期" }}
                  />
                  <TextField
                    size="small"
                    type="number"
                    placeholder="时"
                    value={trip.arrive_hour}
                    disabled={readonly}
                    onChange={(event) => updateTrip(index, "arrive_hour", event.target.value)}
                    inputProps={{ min: 0, max: 23, "aria-label": "到达时（24 小时制，可留空）" }}
                  />
                  <TextField
                    className="trip-place-field"
                    size="small"
                    placeholder="到达地"
                    value={trip.arrive_place}
                    disabled={readonly}
                    onChange={(event) => updateTrip(index, "arrive_place", event.target.value)}
                    inputProps={{ "aria-label": "到达地点" }}
                  />
                </Box>
              </Stack>

              <Stack spacing={0.625} sx={{ minWidth: 0 }}>
                <Typography variant="caption" fontWeight={700} color="text.secondary">
                  交通工具
                </Typography>
                <Autocomplete
                  freeSolo
                  clearOnBlur={false}
                  options={TRANSPORT_OPTIONS}
                  value={trip.transport || ""}
                  inputValue={trip.transport || ""}
                  disabled={readonly}
                  onChange={(_event, value) => updateTrip(index, "transport", value || "")}
                  onInputChange={(_event, value) => updateTrip(index, "transport", value)}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      fullWidth
                      size="small"
                      placeholder="选择或输入"
                      inputProps={{ ...params.inputProps, "aria-label": "交通工具" }}
                    />
                  )}
                />
              </Stack>
            </Box>

            <Box sx={{ pt: 1.5, borderTop: "1px solid", borderColor: "rgba(148, 163, 184, 0.28)" }}>
              <Stack spacing={1}>
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Typography variant="subtitle2" fontWeight={800} color="text.secondary">
                    车船费发票
                  </Typography>
                  {!trip.id && (
                    <Typography variant="caption" color="text.secondary">
                      行程自动保存后可上传
                    </Typography>
                  )}
                </Stack>
                <InvoiceCardList
                  invoices={tripInvoices}
                  readonly={readonly}
                  uploadSlot={
                    <FileDropSlot
                      kind="invoice"
                      disabled={uploadDisabled}
                      uploading={uploading}
                      onPasteError={onUploadError}
                      onFiles={(files) =>
                        handleFilesUpload({
                          files,
                          expenseCategory: "transport_fare",
                          tripId: trip.id,
                          key: uploadKey,
                        })
                      }
                    />
                  }
                  onSelect={onSelectInvoice}
                  onDelete={onDeleteInvoice}
                />
                {(!readonly || hasPaperInvoice(trip)) && (
                  <Box sx={cardSubSectionDividerSx}>
                    <PaperInvoiceEntry
                      value={trip}
                      editor={paperInvoiceEditor?.key === paperInvoiceKey ? paperInvoiceEditor : null}
                      disabled={readonly}
                      onOpen={() => openPaperInvoiceEditor({ key: paperInvoiceKey, kind: "trip", index }, trip)}
                      onChange={updatePaperInvoiceEditor}
                      onSave={savePaperInvoiceEditor}
                      onCancel={closePaperInvoiceEditor}
                      onClear={requestPaperInvoiceClear}
                    />
                  </Box>
                )}
              </Stack>
            </Box>
          </Box>
        </Collapse>
      </Box>
    </Box>
  );
}

export default function TripTimeline({
  reportDate,
  dailySubsidy,
  occupiedDateKeys = [],
  includedDateKeys = null,
  readonly,
  saveState,
  uploadState,
  tripEditor,
  invoiceFlow,
  paperInvoice,
}) {
  const {
    tripYearRangeLabel,
    handleOpenTicketImport,
    trips,
    dragIndex,
    invoicesForTrip,
    addTrip,
    insertTripAt,
    updateTrip,
    toggleTripMarker,
    duplicateTrip,
    swapTrip,
    returnTrip,
    removeTrip,
    startTripDrag,
    dropTrip,
    endTripDrag,
    moveTripByIndex,
  } = tripEditor;
  const {
    handleFilesUpload,
    onUploadError,
    onSelectInvoice,
    onDeleteInvoice,
  } = invoiceFlow;

  const keys = useMemo(() => trips.map(tripKey), [trips]);
  const keySignature = keys.join("|");
  const knownKeysRef = useRef(new Set(keys));
  // 已加载的行程默认收起；新增行程由下面的 key 差异检测自动展开。
  const [expandedKeys, setExpandedKeys] = useState(() => new Set());
  const [tripMenu, setTripMenu] = useState({ anchorEl: null, index: null });

  useEffect(() => {
    const currentKeys = new Set(keys);
    const addedKeys = keys.filter((key) => !knownKeysRef.current.has(key));
    setExpandedKeys((previous) => {
      const next = new Set([...previous].filter((key) => currentKeys.has(key)));
      addedKeys.forEach((key) => next.add(key));
      return next;
    });
    knownKeysRef.current = currentKeys;
  }, [keySignature]); // eslint-disable-line react-hooks/exhaustive-deps

  const spans = useMemo(
    () => getSubsidySpans(reportDate, trips, occupiedDateKeys, includedDateKeys),
    [includedDateKeys, occupiedDateKeys, reportDate, trips],
  );
  const validSpans = useMemo(() => spans.filter((span) => !span.issue), [spans]);
  const issues = useMemo(() => spans.filter((span) => span.issue), [spans]);
  const gapWarnings = useMemo(() => getTripGapWarnings(trips, spans), [trips, spans]);
  const hasIssues = issues.length > 0;
  const subsidyDays = spans.reduce((sum, span) => sum + Number(span.days || 0), 0);
  const tripData = trips.map((trip) => {
    const electronicInvoices = trip.id ? invoicesForTrip(trip.id) : [];
    return {
      electronicInvoices,
      paperCount: getPaperInvoiceCount(trip),
      amount: getConfirmedInvoiceTotal(electronicInvoices) + Number(trip.paper_invoice_amount || 0),
      pendingCount: electronicInvoices.filter((invoice) => !invoice.amount_confirmed).length,
    };
  });
  const totalInvoiceCount = tripData.reduce(
    (sum, item) => sum + item.electronicInvoices.length + item.paperCount,
    0,
  );
  const pendingInvoiceCount = tripData.reduce((sum, item) => sum + item.pendingCount, 0);
  const transportTotal = tripData.reduce((sum, item) => sum + item.amount, 0);
  const allExpanded = trips.length > 0 && keys.every((key) => expandedKeys.has(key));

  const setRowExpanded = (key, expanded) => {
    setExpandedKeys((previous) => {
      const next = new Set(previous);
      if (expanded) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const toggleAll = () => {
    setExpandedKeys(allExpanded ? new Set() : new Set(keys));
  };

  const closeTripMenu = () => setTripMenu({ anchorEl: null, index: null });
  const runMenuAction = (action) => {
    const index = tripMenu.index;
    closeTripMenu();
    if (index === null) return;
    if (action === "duplicate") duplicateTrip(index);
    if (action === "swap") swapTrip(index);
    if (action === "delete") removeTrip(index);
  };

  return (
    <>
      <BlockCard
        id="trip-list-section"
        title="行程"
        sx={sectionAnchorSx}
        summary={
          <>
            <Box component="span"><strong>{trips.length}</strong> 段</Box>
            <Box component="span" color="divider">·</Box>
            <Box component="span"><strong>{validSpans.length}</strong> 次出差</Box>
            <Box component="span" color="divider">·</Box>
            <Box component="span">补贴 <strong>{hasIssues ? "—" : `${subsidyDays} 天`}</strong></Box>
            <Box component="span" color="divider">·</Box>
            <Box component="span">车船费 <strong>{formatAmount(transportTotal)}</strong></Box>
            <Box component="span" color="divider">·</Box>
            <Box component="span">发票 <strong>{totalInvoiceCount}</strong> 张</Box>
            {pendingInvoiceCount > 0 && <Chip size="small" color="warning" label={`${pendingInvoiceCount} 张待确认`} />}
            {tripYearRangeLabel && <Chip size="small" color="info" variant="outlined" label={tripYearRangeLabel} />}
          </>
        }
        actions={
          <>
            {trips.length > 0 && (
              <Button size="small" variant="text" onClick={toggleAll}>
                {allExpanded ? "全部收起" : "全部展开"}
              </Button>
            )}
            <Button
              size="small"
              variant="contained"
              onClick={handleOpenTicketImport}
              disabled={readonly || saveState === "saving"}
            >
              从车票导入
            </Button>
            <Button size="small" startIcon={<AddIcon />} variant="outlined" onClick={addTrip} disabled={readonly}>
              手动添加
            </Button>
          </>
        }
        bodySx={{ pt: 0.75 }}
      >
        {trips.length === 0 ? (
          <Alert severity="info" sx={{ mt: 0.5 }}>
            暂无行程。可以批量导入铁路电子客票自动生成，也可以手动添加第一段行程。
          </Alert>
        ) : (
          <Box sx={{ pt: 0.25, pb: 0.25 }}>
            {trips.map((trip, index) => {
              const key = keys[index];
              const spanStart = validSpans.find((span) => span.startIndex === index);
              const spanEnd = validSpans.find((span) => span.endIndex === index);
              const issue = issues.find((item) => (item.issue === "start" ? item.startIndex : item.endIndex) === index);
              const gap = gapWarnings.find((item) => item.index === index);
              const inSpan = validSpans.some((span) => index >= span.startIndex && index <= span.endIndex);
              const up = spanStart ? "live" : index === 0 ? "none" : inSpan ? "live" : "idle";
              const down = spanEnd ? "live" : index === trips.length - 1 ? "none" : inSpan ? "live" : "idle";

              return (
                <Box key={key}>
                  {spanStart && (
                    <TimelineMark up={index === 0 ? "none" : "idle"} down="live" nodeKind="start">
                      <Chip
                        size="small"
                        label={`出差开始 ${formatMonthDay(trip.depart_date, trip.depart_month, trip.depart_day)}`}
                        sx={{ bgcolor: "primary.50", color: "primary.dark" }}
                      />
                    </TimelineMark>
                  )}

                  {issue && (
                    <TimelineMark up="idle" down="idle" nodeKind="warn">
                      <Alert
                        severity="warning"
                        icon={<WarningAmberIcon fontSize="small" />}
                        sx={{ py: 0.25, px: 1, "& .MuiAlert-message": { py: 0.25 } }}
                      >
                        {issue.issue === "start"
                          ? "这段标了“起”，但上一次出差还没有“止”"
                          : "这段标了“止”，但前面没有对应的“起”"}
                        ，途中补贴暂时不计算。
                      </Alert>
                    </TimelineMark>
                  )}

                  {gap && (
                    <TimelineMark up="live" down="live" nodeKind="warn">
                      <Alert
                        severity="warning"
                        icon={<WarningAmberIcon fontSize="small" />}
                        action={
                          !readonly ? (
                            <Button size="small" color="warning" onClick={() => insertTripAt(index)}>
                              在这里插入一段
                            </Button>
                          ) : null
                        }
                        sx={{ py: 0.25, px: 1, "& .MuiAlert-message": { py: 0.5 } }}
                      >
                        上一段到达 <strong>{gap.previousPlace}</strong>，这一段从 <strong>{gap.currentPlace}</strong> 出发，中间可能漏了一段。
                      </Alert>
                    </TimelineMark>
                  )}

                  <TripTimelineRow
                    trip={trip}
                    index={index}
                    totalTrips={trips.length}
                    expanded={expandedKeys.has(key)}
                    up={up}
                    down={down}
                    inSpan={inSpan}
                    readonly={readonly}
                    saveState={saveState}
                    uploadState={uploadState}
                    dragIndex={dragIndex}
                    tripInvoices={tripData[index].electronicInvoices}
                    paperInvoiceEditor={paperInvoice.paperInvoiceEditor}
                    onToggle={() => setRowExpanded(key, !expandedKeys.has(key))}
                    updateTrip={updateTrip}
                    toggleTripMarker={toggleTripMarker}
                    returnTrip={returnTrip}
                    startTripDrag={startTripDrag}
                    dropTrip={dropTrip}
                    endTripDrag={endTripDrag}
                    moveTripByIndex={moveTripByIndex}
                    openTripMenu={(anchorEl, menuIndex) => setTripMenu({ anchorEl, index: menuIndex })}
                    handleFilesUpload={handleFilesUpload}
                    onUploadError={onUploadError}
                    onSelectInvoice={onSelectInvoice}
                    onDeleteInvoice={onDeleteInvoice}
                    openPaperInvoiceEditor={paperInvoice.openPaperInvoiceEditor}
                    updatePaperInvoiceEditor={paperInvoice.updatePaperInvoiceEditor}
                    savePaperInvoiceEditor={paperInvoice.savePaperInvoiceEditor}
                    closePaperInvoiceEditor={paperInvoice.closePaperInvoiceEditor}
                    requestPaperInvoiceClear={paperInvoice.requestPaperInvoiceClear}
                  />

                  {spanEnd && (
                    <TimelineMark up="live" down={index === trips.length - 1 ? "none" : "idle"} nodeKind="end">
                      <Chip
                        size="small"
                        label={
                          <Stack component="span" direction="row" spacing={0.75} alignItems="center">
                            <Box component="span">出差结束 {formatMonthDay(trip.arrive_date, trip.arrive_month, trip.arrive_day)}</Box>
                            <Divider component="span" orientation="vertical" flexItem />
                            <Box component="span" fontWeight={800} color="text.primary">
                              补贴 {spanEnd.days} 天 · {formatAmount(Number(spanEnd.days || 0) * Number(dailySubsidy || 0))}
                            </Box>
                          </Stack>
                        }
                        sx={{ bgcolor: "#EEF2F7", color: "text.secondary", height: 24 }}
                      />
                    </TimelineMark>
                  )}
                </Box>
              );
            })}
          </Box>
        )}
      </BlockCard>

      <Menu
        anchorEl={tripMenu.anchorEl}
        open={Boolean(tripMenu.anchorEl)}
        onClose={closeTripMenu}
        MenuListProps={{ "aria-label": "更多行程操作" }}
      >
        <MenuItem onClick={() => runMenuAction("duplicate")}>
          <ContentCopyIcon fontSize="small" sx={{ mr: 1 }} />复制行程
        </MenuItem>
        <MenuItem onClick={() => runMenuAction("swap")}>
          <SwapHorizIcon fontSize="small" sx={{ mr: 1 }} />交换出发/到达
        </MenuItem>
        <MenuItem onClick={() => runMenuAction("delete")} sx={{ color: "error.main" }}>
          <DeleteIcon fontSize="small" sx={{ mr: 1 }} />删除行程
        </MenuItem>
      </Menu>
    </>
  );
}
