import FileUploadPlaceholder from "../../components/FileUploadPlaceholder";

import {
  getClipboardInvoiceFilename,
  getClipboardInvoiceFiles,
} from "../../pages/reportEditUtils";

const INVOICE_ACCEPT =
  ".pdf,.jpg,.jpeg,.png,.bmp,.gif,.webp,image/jpeg,image/png,image/bmp,image/gif,image/webp";

export default function InvoiceDropzone({
  disabled,
  uploading,
  onFiles,
  onPasteError,
  hint = "上传发票",
}) {
  return (
    <FileUploadPlaceholder
      accept={INVOICE_ACCEPT}
      ariaLabel="发票上传区，可拖放、粘贴或选择文件"
      disabled={disabled}
      uploading={uploading}
      hint={hint}
      uploadingText="正在上传发票"
      selectedText="已选中"
      dragText="松开上传"
      idleDetail=""
      selectedDetail=""
      dragDetail=""
      getClipboardFiles={getClipboardInvoiceFiles}
      getClipboardFilename={getClipboardInvoiceFilename}
      pasteErrorMessage="剪贴板中没有可上传的 PDF 或图片"
      showIcon={false}
      onFiles={onFiles}
      onPasteError={onPasteError}
    />
  );
}
