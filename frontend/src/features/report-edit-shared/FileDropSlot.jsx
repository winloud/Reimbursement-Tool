import FileUploadPlaceholder from "../../components/FileUploadPlaceholder";
import {
  getClipboardInvoiceFilename,
  getClipboardInvoiceFiles,
  getClipboardReportAttachmentFilename,
  getClipboardReportAttachmentFiles,
} from "../../pages/reportEditUtils";

// 发票与附件共用同一份可上传类型白名单，扩展名与 MIME 都要覆盖，
// 否则部分环境的文件选择框会把 PDF 过滤掉。
export const UPLOAD_ACCEPT =
  ".pdf,.jpg,.jpeg,.png,.bmp,.gif,.webp,application/pdf,image/jpeg,image/png,image/bmp,image/gif,image/webp";

// 两类槽位只有文案和剪贴板取值函数不同，外观完全一致。
const SLOT_PRESETS = {
  invoice: {
    ariaLabel: "发票上传区，可拖放、粘贴或选择文件",
    hint: "上传发票",
    uploadingText: "正在上传发票",
    selectedText: "已选中发票上传区域",
    dragText: "松开即可上传发票",
    pasteErrorMessage: "剪贴板中没有可上传的 PDF 或图片",
    getClipboardFiles: getClipboardInvoiceFiles,
    getClipboardFilename: getClipboardInvoiceFilename,
  },
  attachment: {
    ariaLabel: "附件上传区，可拖放、粘贴或选择文件",
    hint: "添加附件",
    uploadingText: "正在上传附件",
    selectedText: "已选中附件上传区域",
    dragText: "松开即可上传附件",
    pasteErrorMessage: "剪贴板中没有可上传的 PDF 或图片",
    getClipboardFiles: getClipboardReportAttachmentFiles,
    getClipboardFilename: getClipboardReportAttachmentFilename,
  },
};

// 填报页统一上传槽：图标 + 单行主文案 + Ctrl+V 徽标 + 选择文件。
// 差旅页与常规页、发票位与附件位共用这一个出口，保证外观一致。
export default function FileDropSlot({
  kind = "invoice",
  hint,
  ariaLabel,
  uploadingText,
  disabled = false,
  uploading = false,
  onFiles,
  onPasteError,
}) {
  const preset = SLOT_PRESETS[kind] || SLOT_PRESETS.invoice;

  return (
    <FileUploadPlaceholder
      accept={UPLOAD_ACCEPT}
      ariaLabel={ariaLabel || preset.ariaLabel}
      disabled={disabled}
      uploading={uploading}
      hint={hint || preset.hint}
      uploadingText={uploadingText || preset.uploadingText}
      selectedText={preset.selectedText}
      dragText={preset.dragText}
      idleDetail=""
      selectedDetail=""
      dragDetail=""
      getClipboardFiles={preset.getClipboardFiles}
      getClipboardFilename={preset.getClipboardFilename}
      pasteErrorMessage={preset.pasteErrorMessage}
      onFiles={onFiles}
      onPasteError={onPasteError}
    />
  );
}
