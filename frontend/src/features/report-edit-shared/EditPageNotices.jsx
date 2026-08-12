import { Alert, LinearProgress, Stack, Typography } from "@mui/material";

// 页头下方的统一提示区：错误、只读说明、页面级上传进度。
export default function EditPageNotices({ error, readonly, readonlyMessage, uploadState }) {
  return (
    <>
      {error && (
        <Alert severity="error" sx={{ whiteSpace: "pre-line", overflowWrap: "anywhere" }}>
          {error}
        </Alert>
      )}
      {readonly && <Alert severity="info">{readonlyMessage}</Alert>}
      {uploadState && (
        <Alert severity="info">
          <Stack spacing={1}>
            <Typography variant="body2">
              正在上传 {uploadState.current}/{uploadState.total}
              {uploadState.name ? `：${uploadState.name}` : ""}
            </Typography>
            <LinearProgress />
          </Stack>
        </Alert>
      )}
    </>
  );
}
