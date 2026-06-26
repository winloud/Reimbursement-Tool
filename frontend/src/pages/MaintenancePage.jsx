import { Box, Stack, Typography } from "@mui/material";
import MaintenancePanel from "./MaintenancePanel";

export default function MaintenancePage() {
  return (
    <Stack spacing={2.5} sx={{ width: "100%", pb: 4 }}>
      <Box>
        <Typography variant="h4" fontWeight={900}>
          数据维护
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 0.5 }}>
          程序升级、数据备份恢复和诊断信息导出
        </Typography>
      </Box>

      <MaintenancePanel />
    </Stack>
  );
}
