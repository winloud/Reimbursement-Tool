export const DEFAULT_REPORT_FILTERS = {
  reportStart: "",
  reportEnd: "",
  tripStart: "",
  tripEnd: "",
  statuses: "",
  keyword: "",
  amountMin: "",
  amountMax: "",
  invoiceState: "all",
  category: "",
  hasAttachment: "all",
  subsidyDaysMin: "",
  subsidyDaysMax: "",
};

const normalizedValue = (value) => {
  if (value === null || value === undefined) return "";
  return String(value).trim();
};

const addStringParam = (params, key, value) => {
  const normalized = normalizedValue(value);
  if (normalized) {
    params[key] = normalized;
  }
};

const addNumberParam = (params, key, value) => {
  const normalized = normalizedValue(value);
  if (normalized !== "") {
    params[key] = normalized;
  }
};

export const buildReportQueryParams = ({
  page = 1,
  pageSize = 20,
  status = "all",
  reportType,
  regularMode,
  filters = {},
} = {}) => {
  const merged = { ...DEFAULT_REPORT_FILTERS, ...filters };
  const params = {
    page,
    page_size: pageSize,
  };

  addStringParam(params, "report_type", reportType);
  addStringParam(params, "regular_mode", regularMode);

  if (status && status !== "all") {
    params.status = status;
  }
  if (status === "all") {
    addStringParam(params, "statuses", merged.statuses);
  }
  addStringParam(params, "report_start", merged.reportStart);
  addStringParam(params, "report_end", merged.reportEnd);
  addStringParam(params, "trip_start", merged.tripStart);
  addStringParam(params, "trip_end", merged.tripEnd);
  addStringParam(params, "keyword", merged.keyword);
  addNumberParam(params, "amount_min", merged.amountMin);
  addNumberParam(params, "amount_max", merged.amountMax);
  if (merged.invoiceState && merged.invoiceState !== "all") {
    params.invoice_state = merged.invoiceState;
  }
  addStringParam(params, "category", merged.category);
  if (merged.hasAttachment === "yes") {
    params.has_attachment = true;
  } else if (merged.hasAttachment === "no") {
    params.has_attachment = false;
  }
  addNumberParam(params, "subsidy_days_min", merged.subsidyDaysMin);
  addNumberParam(params, "subsidy_days_max", merged.subsidyDaysMax);

  return params;
};

export const buildReportExportPayload = ({ status = "all", reportType, regularMode, filters = {} } = {}) => {
  const { page: _page, page_size: _pageSize, ...payload } = buildReportQueryParams({
    page: 1,
    pageSize: 20,
    status,
    reportType,
    regularMode,
    filters,
  });
  return payload;
};
