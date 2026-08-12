export const getApiErrorMessage = (error, fallback) => {
  const detail = error.response?.data?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return detail.map((item) => item?.msg || String(item)).join("；");
  return error.response?.data?.message || error.message || fallback;
};
