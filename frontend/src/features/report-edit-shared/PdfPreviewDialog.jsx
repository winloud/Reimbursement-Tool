import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Stack,
  Typography,
} from "@mui/material";

// PDF 预览对话框：每页一张 Paper 页卡，带页码标注。
export default function PdfPreviewDialog({ open, onClose, pages, title = "PDF 预览" }) {
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="lg">
      <DialogTitle>{title}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          {pages.map((page) => (
            <Paper key={page.page} variant="outlined" sx={{ p: 1, bgcolor: "grey.50" }}>
              <Typography variant="caption" color="text.secondary">
                第 {page.page} 页
              </Typography>
              <Box
                component="img"
                src={page.image_url}
                alt={`${title}第 ${page.page} 页`}
                sx={{ display: "block", width: "100%", mt: 1, borderRadius: 1 }}
              />
            </Paper>
          ))}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>关闭</Button>
      </DialogActions>
    </Dialog>
  );
}
