import {
  Box,
  Button,
  CssBaseline,
  Divider,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DashboardIcon from "@mui/icons-material/Dashboard";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import StorageIcon from "@mui/icons-material/Storage";
import SettingsIcon from "@mui/icons-material/Settings";
import { Route, Routes, useLocation } from "react-router-dom";
import { NavigationGuardProvider, useNavigationGuard } from "./navigationGuard";
import Dashboard from "./pages/Dashboard";
import MaintenancePage from "./pages/MaintenancePage";
import ReportEdit from "./pages/ReportEdit";
import ReportList from "./pages/ReportList";
import ReportPrint from "./pages/ReportPrint";
import SettingsPage from "./pages/SettingsPage";

const NAV_ITEMS = [
  { label: "总览看板", to: "/", icon: <DashboardIcon fontSize="small" /> },
  { label: "报销单管理", to: "/reports", icon: <ReceiptLongIcon fontSize="small" /> },
  { label: "个性化设置", to: "/settings", icon: <SettingsIcon fontSize="small" /> },
  { label: "数据维护", to: "/maintenance", icon: <StorageIcon fontSize="small" /> },
];

// 全站统一内容区宽度：随屏幕分级放宽，保证各页面左右边界对齐
// 笔记本(14"/15.6") ~1440，27" ~1680，32" ~1920
const APP_CONTENT_SX = {
  width: "100%",
  mx: "auto",
  maxWidth: 1440,
  "@media (min-width:1920px)": { maxWidth: 1680 },
  "@media (min-width:2560px)": { maxWidth: 1920 },
};

function Sidebar() {
  const location = useLocation();
  const { requestNavigation } = useNavigationGuard();

  const isActive = (to) => {
    if (to === "/") return location.pathname === "/";
    return location.pathname.startsWith(to);
  };

  return (
    <Paper
      component="aside"
      elevation={0}
      sx={{
        width: { xs: "100%", md: 248 },
        minHeight: { md: "100vh" },
        borderRadius: 0,
        borderRight: { md: 1 },
        borderBottom: { xs: 1, md: 0 },
        borderColor: "divider",
        bgcolor: "background.paper",
        position: { md: "sticky" },
        top: 0,
        zIndex: 1,
      }}
    >
      <Stack spacing={2} sx={{ p: 2.5 }}>
        <Box>
          <Typography variant="h6" fontWeight={800}>
            报销管理
          </Typography>
          <Typography variant="body2" color="text.secondary">
            出差旅费报销工具
          </Typography>
        </Box>

        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => requestNavigation("/reports/new")}
          sx={{ justifyContent: "flex-start" }}
        >
          新增报销单
        </Button>

        <Divider />

        <List disablePadding>
          {NAV_ITEMS.map((item) => (
            <ListItemButton
              key={item.to}
              selected={isActive(item.to)}
              onClick={() => requestNavigation(item.to)}
              sx={{ borderRadius: 1, mb: 0.5 }}
            >
              <ListItemIcon sx={{ minWidth: 36 }}>{item.icon}</ListItemIcon>
              <ListItemText primary={item.label} primaryTypographyProps={{ fontWeight: 700 }} />
            </ListItemButton>
          ))}
        </List>
      </Stack>
    </Paper>
  );
}

function AppRoutes() {
  return (
    <Box sx={{ display: { xs: "block", md: "flex" }, minHeight: "100vh", bgcolor: "#F4F7FB" }}>
      <Sidebar />
      <Box component="main" sx={{ flex: 1, minWidth: 0, px: { xs: 2, md: 3, xl: 4 }, py: { xs: 2, md: 3 } }}>
        <Box sx={APP_CONTENT_SX}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/reports" element={<ReportList />} />
            <Route path="/reports/new" element={<ReportEdit />} />
            <Route path="/reports/:id/edit" element={<ReportEdit />} />
            <Route path="/reports/:id/print" element={<ReportPrint />} />
            <Route path="/maintenance" element={<MaintenancePage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </Box>
      </Box>
    </Box>
  );
}

export default function App() {
  return (
    <NavigationGuardProvider>
      <CssBaseline />
      <AppRoutes />
    </NavigationGuardProvider>
  );
}
