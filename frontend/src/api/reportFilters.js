export const DEFAULT_REPORT_FILTERS = {
  tripStart: "",
  tripEnd: "",
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

export const buildReportQueryParams = ({ page = 1, pageSize = 20, status = "all", filters = {} } = {}) => {
  const merged = { ...DEFAULT_REPORT_FILTERS, ...filters };
  const params = {
    page,
    page_size: pageSize,
  };

  if (status && status !== "all") {
    params.status = status;
  }
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
