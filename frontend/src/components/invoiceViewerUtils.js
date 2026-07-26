export const shouldOpenInvoiceLocally = (fileType, localPdfOpenSupported) =>
  fileType === "pdf" && localPdfOpenSupported === true;
