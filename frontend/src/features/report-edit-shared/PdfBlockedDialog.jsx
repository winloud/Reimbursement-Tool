import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from "@mui/material";

// 解释“为什么暂时不能预览/下载 PDF”的统一弹窗。
export default function PdfBlockedDialog({ open, onClose, title, message }) {
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <DialogContentText>{message}</DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>知道了</Button>
      </DialogActions>
    </Dialog>
  );
}
