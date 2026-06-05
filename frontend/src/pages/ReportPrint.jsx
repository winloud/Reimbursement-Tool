import { Card, CardContent, Typography } from "@mui/material";

export default function ReportPrint() {
  return (
    <Card>
      <CardContent>
        <Typography variant="h5" fontWeight={700}>PDF 预览</Typography>
        <Typography color="text.secondary">请在报销单编辑页的费用汇总卡片中预览或下载 PDF。</Typography>
      </CardContent>
    </Card>
  );
}
