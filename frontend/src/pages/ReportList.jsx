import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  CircularProgress,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  InputAdornment,
  MenuItem,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import SearchIcon from "@mui/icons-material/Search";
import TuneIcon from "@mui/icons-material/Tune";
import { Link as RouterLink, useNavigate } from "react-router-dom";
import { deleteReport, getReportFilterOptions, getReports } from "../api/client";
import { DEFAULT_REPORT_FILTERS } from "../api/reportFilters";

const STATUS_TABS = [
  { value: "all", label: "全部" },
  { value: "draft", label: "草稿" },
  { value: "printed", label: "已打印" },
  { value: "reimbursed", label: "已报销" },
];

const STATUS_META = {
  draft: { label: "草稿", color: "default" },
  printed: { label: "已打印", color: "info" },
  reimbursed: { label: "已报销", color: "success" },
};

const INVOICE_STATE_OPTIONS = [
  { value: "all", label: "全部发票" },
  { value: "has_unconfirmed", label: "有未确认发票" },
  { value: "all_confirmed", label: "全部已确认" },
  { value: "no_invoice", label: "无发票" },
];

const CATEGORY_OPTIONS = [
  { value: "", label: "全部类别" },
  { value: "transport_fare", label: "车船费" },
  { value: "luggage", label: "行李费" },
  { value: "city_transport", label: "市内交通费" },
  { value: "accommodation", label: "住宿费" },
  { value: "postal", label: "邮电费" },
  { value: "no_sleeper_subsidy", label: "未乘卧铺补助" },
  { value: "toll", label: "过路费" },
  { value: "fuel_subsidy", label: "燃油补助" },
];

const HAS_ATTACHMENT_OPTIONS = [
  { value: "all", label: "附件不限" },
  { value: "yes", label: "有附件" },
  { value: "no", label: "无附件" },
];

const formatAmount = (value) =>
  `¥${Number(value ?? 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const formatDate = (value) => value || "—";

export default function ReportList() {
  const navigate = useNavigate();
  const [status, setStatus] = useState("all");
  const [filters, setFilters] = useState(() => ({ ...DEFAULT_REPORT_FILTERS }));
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [categoryOptions, setCategoryOptions] = useState(CATEGORY_OPTIONS);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const fetchReports = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await getReports({ page: page + 1, pageSize, status, filters });
      if (res.success) {
        setItems(res.data.items);
        setTotal(res.data.total);
      } else {
        setError(res.message || "加载失败");
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message || "加载失败");
    } finally {
      setLoading(false);
    }
  }, [filters, page, pageSize, status]);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  useEffect(() => {
    let ignore = false;
    const fetchOptions = async () => {
      try {
        const res = await getReportFilterOptions();
        if (!ignore && res.success) {
          setCategoryOptions([{ value: "", label: "全部类别" }, ...(res.data.categories || [])]);
        }
      } catch {
        // 固定类别兜底即可，筛选列表加载失败不影响报销单列表使用。
      }
    };
    fetchOptions();
    return () => {
      ignore = true;
    };
  }, []);

  const handleStatusChange = (_event, value) => {
    setStatus(value);
    setPage(0);
  };

  const handleFilterChange = (key) => (event) => {
    setFilters((current) => ({ ...current, [key]: event.target.value }));
    setPage(0);
  };

  const handleResetFilters = () => {
    setFilters({ ...DEFAULT_REPORT_FILTERS });
    setPage(0);
  };

  const clearFilter = (key) => {
    setFilters((current) => ({ ...current, [key]: DEFAULT_REPORT_FILTERS[key] }));
    setPage(0);
  };

  const categoryLabel = (value) => categoryOptions.find((option) => option.value === value)?.label || value;
  const invoiceStateLabel = (value) => INVOICE_STATE_OPTIONS.find((option) => option.value === value)?.label || value;
  const attachmentLabel = (value) => HAS_ATTACHMENT_OPTIONS.find((option) => option.value === value)?.label || value;
  const activeFilterChips = [
    filters.keyword && { key: "keyword", label: `关键词：${filters.keyword}` },
    filters.tripStart && { key: "tripStart", label: `开始：${filters.tripStart}` },
    filters.tripEnd && { key: "tripEnd", label: `结束：${filters.tripEnd}` },
    filters.category && { key: "category", label: `类别：${categoryLabel(filters.category)}` },
    filters.amountMin && { key: "amountMin", label: `金额下限：${filters.amountMin}` },
    filters.amountMax && { key: "amountMax", label: `金额上限：${filters.amountMax}` },
    filters.invoiceState !== "all" && { key: "invoiceState", label: `发票：${invoiceStateLabel(filters.invoiceState)}` },
    filters.hasAttachment !== "all" && { key: "hasAttachment", label: attachmentLabel(filters.hasAttachment) },
    filters.subsidyDaysMin && { key: "subsidyDaysMin", label: `天数下限：${filters.subsidyDaysMin}` },
    filters.subsidyDaysMax && { key: "subsidyDaysMax", label: `天数上限：${filters.subsidyDaysMax}` },
  ].filter(Boolean);

  const handleConfirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    setError("");
    try {
      const res = await deleteReport(pendingDelete.id);
      if (res.success) {
        setPendingDelete(null);
        await fetchReports();
      } else {
        setError(res.message || "删除失败");
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message || "删除失败");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Stack spacing={3}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <div>
          <Typography variant="h5" fontWeight={700}>
            报销单管理
          </Typography>
          <Typography color="text.secondary">管理出差报销单，支持新增、编辑、删除与多条件筛选。</Typography>
        </div>
        <Button component={RouterLink} to="/reports/new" variant="contained">
          新增报销单
        </Button>
      </Stack>

      {error && <Alert severity="error">{error}</Alert>}

      <Card>
        <Tabs value={status} onChange={handleStatusChange} sx={{ px: 2, borderBottom: 1, borderColor: "divider" }}>
          {STATUS_TABS.map((tab) => (
            <Tab key={tab.value} value={tab.value} label={tab.label} />
          ))}
        </Tabs>

        <Box sx={{ p: 2, borderBottom: 1, borderColor: "divider" }}>
          <Stack direction={{ xs: "column", lg: "row" }} spacing={1.5} alignItems={{ xs: "stretch", lg: "center" }}>
            <TextField
              size="small"
              label="关键词"
              value={filters.keyword}
              onChange={handleFilterChange("keyword")}
              placeholder="事由 / 人员 / 部门 / ID"
              sx={{ minWidth: { lg: 260 }, flex: 1.4 }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>
                ),
              }}
            />
            <TextField
              size="small"
              label="行程开始"
              type="date"
              value={filters.tripStart}
              onChange={handleFilterChange("tripStart")}
              InputLabelProps={{ shrink: true }}
              sx={{ minWidth: { lg: 158 } }}
            />
            <TextField
              size="small"
              label="行程结束"
              type="date"
              value={filters.tripEnd}
              onChange={handleFilterChange("tripEnd")}
              InputLabelProps={{ shrink: true }}
              sx={{ minWidth: { lg: 158 } }}
            />
            <TextField
              select
              size="small"
              label="费用类别"
              value={filters.category}
              onChange={handleFilterChange("category")}
              sx={{ minWidth: { lg: 170 } }}
            >
              {categoryOptions.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </TextField>
            <Button
              variant={advancedOpen ? "contained" : "outlined"}
              startIcon={<TuneIcon />}
              endIcon={
                <ExpandMoreIcon
                  sx={{
                    transform: advancedOpen ? "rotate(180deg)" : "rotate(0deg)",
                    transition: "transform 160ms ease",
                  }}
                />
              }
              onClick={() => setAdvancedOpen((open) => !open)}
              sx={{ minHeight: 40, whiteSpace: "nowrap" }}
            >
              更多筛选
            </Button>
            <Button variant="text" onClick={handleResetFilters} disabled={activeFilterChips.length === 0}>
              重置
            </Button>
          </Stack>

          <Collapse in={advancedOpen} timeout="auto" unmountOnExit>
            <Box
              sx={{
                mt: 1.5,
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                gap: 1.5,
              }}
            >
              <TextField
                size="small"
                label="金额下限"
                type="number"
                value={filters.amountMin}
                onChange={handleFilterChange("amountMin")}
                inputProps={{ min: 0, step: "0.01" }}
              />
              <TextField
                size="small"
                label="金额上限"
                type="number"
                value={filters.amountMax}
                onChange={handleFilterChange("amountMax")}
                inputProps={{ min: 0, step: "0.01" }}
              />
              <TextField
                select
                size="small"
                label="发票状态"
                value={filters.invoiceState}
                onChange={handleFilterChange("invoiceState")}
              >
                {INVOICE_STATE_OPTIONS.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                select
                size="small"
                label="附件"
                value={filters.hasAttachment}
                onChange={handleFilterChange("hasAttachment")}
              >
                {HAS_ATTACHMENT_OPTIONS.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                size="small"
                label="天数下限"
                type="number"
                value={filters.subsidyDaysMin}
                onChange={handleFilterChange("subsidyDaysMin")}
                inputProps={{ min: 0, step: 1 }}
              />
              <TextField
                size="small"
                label="天数上限"
                type="number"
                value={filters.subsidyDaysMax}
                onChange={handleFilterChange("subsidyDaysMax")}
                inputProps={{ min: 0, step: 1 }}
              />
            </Box>
          </Collapse>

          {activeFilterChips.length > 0 && (
            <Stack direction="row" flexWrap="wrap" sx={{ gap: 1, mt: 1.5 }}>
              {activeFilterChips.map((chip) => (
                <Chip key={chip.key} size="small" label={chip.label} onDelete={() => clearFilter(chip.key)} />
              ))}
            </Stack>
          )}
        </Box>

        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>报销日期</TableCell>
                <TableCell>出差事由</TableCell>
                <TableCell align="center">补贴天数</TableCell>
                <TableCell align="right">报销总金额</TableCell>
                <TableCell align="center">状态</TableCell>
                <TableCell align="right">操作</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6} align="center" sx={{ py: 6 }}>
                    <CircularProgress size={28} />
                  </TableCell>
                </TableRow>
              ) : items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} align="center" sx={{ py: 6 }}>
                    <Typography color="text.secondary">暂无数据</Typography>
                  </TableCell>
                </TableRow>
              ) : (
                items.map((report) => {
                  const meta = STATUS_META[report.status] || { label: report.status, color: "default" };
                  return (
                    <TableRow key={report.id} hover>
                      <TableCell>{formatDate(report.report_date)}</TableCell>
                      <TableCell>{report.purpose || "—"}</TableCell>
                      <TableCell align="center">{report.subsidy_days ?? 0}</TableCell>
                      <TableCell align="right">{formatAmount(report.total_amount)}</TableCell>
                      <TableCell align="center">
                        <Chip size="small" color={meta.color} label={meta.label} />
                      </TableCell>
                      <TableCell align="right">
                        <Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end" }}>
                          <Button size="small" onClick={() => navigate(`/reports/${report.id}/edit`)}>
                            编辑
                          </Button>
                          <Button
                            size="small"
                            color="error"
                            disabled={report.status !== "draft"}
                            onClick={() => setPendingDelete(report)}
                          >
                            删除
                          </Button>
                        </Box>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </TableContainer>

        <TablePagination
          component="div"
          count={total}
          page={page}
          onPageChange={(_event, newPage) => setPage(newPage)}
          rowsPerPage={pageSize}
          onRowsPerPageChange={(event) => {
            setPageSize(parseInt(event.target.value, 10));
            setPage(0);
          }}
          rowsPerPageOptions={[10, 20, 50]}
          labelRowsPerPage="每页行数"
        />
      </Card>

      <Dialog open={Boolean(pendingDelete)} onClose={() => !deleting && setPendingDelete(null)}>
        <DialogTitle>确认删除</DialogTitle>
        <DialogContent>
          <DialogContentText>
            确定要删除报销单「{pendingDelete?.purpose || "未命名"}」吗？此操作将软删除该报销单。
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPendingDelete(null)} disabled={deleting}>
            取消
          </Button>
          <Button onClick={handleConfirmDelete} color="error" disabled={deleting}>
            {deleting ? "删除中..." : "确认删除"}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
