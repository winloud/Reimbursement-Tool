import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Stack,
  Typography,
} from "@mui/material";

const IssueList = ({ title, issues, tone }) => {
  if (issues.length === 0) return null;
  const isWarning = tone === "warning";

  return (
    <Stack spacing={0.75}>
      <Typography variant="subtitle2" fontWeight={900} color={`${tone}.dark`}>
        {title}
      </Typography>
      {issues.map((issue, index) => (
        <Paper
          key={`${issue.fileName}-${index}`}
          variant="outlined"
          sx={{
            p: 1.25,
            bgcolor: isWarning ? "warning.50" : "error.50",
            borderColor: isWarning ? "warning.light" : "error.light",
          }}
        >
          <Typography variant="body2" fontWeight={800} sx={{ overflowWrap: "anywhere" }}>
            {issue.fileName}
          </Typography>
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ mt: 0.35, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
          >
            {issue.message}
          </Typography>
        </Paper>
      ))}
    </Stack>
  );
};

export default function InvoiceUploadResultDialog({ result, onClose, onContinue }) {
  const warningIssues = result?.issues?.filter((issue) => issue.type === "warning") || [];
  const duplicateIssues = result?.issues?.filter((issue) => issue.type === "duplicate") || [];
  const failedIssues =
    result?.issues?.filter((issue) => issue.type !== "duplicate" && issue.type !== "warning") || [];
  const successfulFileCount = result?.successfulFileCount || 0;
  const uploadedInvoiceCount = result?.uploadedInvoices?.length || 0;
  const allDuplicates =
    successfulFileCount === 0 &&
    duplicateIssues.length > 0 &&
    failedIssues.length === 0;

  const summary = allDuplicates
    ? `本次选择的 ${result?.totalFileCount || duplicateIssues.length} 个文件均已存在，未上传任何发票。`
    : `共处理 ${result?.totalFileCount || 0} 个文件，已上传 ${successfulFileCount} 个。`;

  return (
    <Dialog
      open={Boolean(result)}
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      aria-labelledby="invoice-upload-result-title"
    >
      <DialogTitle id="invoice-upload-result-title" sx={{ pb: 1 }}>
        发票上传结果
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Box>
            <Typography variant="body1" fontWeight={800}>
              {summary}
            </Typography>
            <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
              <Chip size="small" color="success" label={`已上传 ${successfulFileCount}`} />
              {warningIssues.length > 0 && (
                <Chip size="small" color="warning" label={`提醒 ${warningIssues.length}`} />
              )}
              {duplicateIssues.length > 0 && (
                <Chip size="small" color="warning" label={`重复 ${duplicateIssues.length}`} />
              )}
              {failedIssues.length > 0 && (
                <Chip size="small" color="error" label={`失败 ${failedIssues.length}`} />
              )}
            </Stack>
          </Box>

          <IssueList title="需要注意" issues={warningIssues} tone="warning" />
          <IssueList title="重复文件（未上传）" issues={duplicateIssues} tone="warning" />
          <IssueList title="上传失败" issues={failedIssues} tone="error" />
        </Stack>
      </DialogContent>
      <DialogActions>
        {uploadedInvoiceCount > 0 ? (
          <>
            <Button onClick={onClose}>稍后确认</Button>
            <Button variant="contained" onClick={onContinue} autoFocus>
              继续确认 {uploadedInvoiceCount} 张
            </Button>
          </>
        ) : (
          <Button variant="contained" onClick={onClose} autoFocus>
            知道了
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
