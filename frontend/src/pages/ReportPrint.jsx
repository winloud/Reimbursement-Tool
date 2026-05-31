import { Card, CardContent, Typography } from "@mui/material";

export default function ReportPrint() {
  return (
    <Card>
      <CardContent>
        <Typography variant="h5" fontWeight={700}>打印预览</Typography>
        <Typography color="text.secondary">PDF 生成与预览将在 Phase 4 实现。</Typography>
      </CardContent>
    </Card>
  );
}
