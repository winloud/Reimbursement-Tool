import { useEffect, useState } from "react";
import { Alert, Box, Button, CircularProgress, Stack, Typography } from "@mui/material";
import { getHealth } from "../api/client";
import { useAppStore } from "../store/appStore";

export default function HealthCheck() {
  const { health, healthError, setHealth, setHealthError } = useAppStore();
  const [loading, setLoading] = useState(false);

  const loadHealth = async () => {
    setLoading(true);
    try {
      const result = await getHealth();
      setHealth(result);
    } catch (error) {
      setHealthError(error?.message || "健康检查失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadHealth();
  }, []);

  return (
    <Stack spacing={2}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
        <Typography variant="h6">API 联通状态</Typography>
        <Button variant="outlined" size="small" onClick={loadHealth} disabled={loading}>
          重新检查
        </Button>
      </Box>

      {loading && <CircularProgress size={24} />}
      {!loading && health?.success && (
        <Alert severity="success">
          后端连接正常：{health.data?.status}；数据库：{health.data?.database}
        </Alert>
      )}
      {!loading && healthError && <Alert severity="error">{healthError}</Alert>}
    </Stack>
  );
}
