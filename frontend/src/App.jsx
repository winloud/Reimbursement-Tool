import {
  Box,
  Button,
  CssBaseline,
  Divider,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import DashboardIcon from "@mui/icons-material/Dashboard";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import RequestQuoteIcon from "@mui/icons-material/RequestQuote";
import StorageIcon from "@mui/icons-material/Storage";
import SettingsIcon from "@mui/icons-material/Settings";
import { useState } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import {
  SIDEBAR_COLLAPSED_WIDTH,
  SIDEBAR_EXPANDED_WIDTH,
  readSidebarCollapsed,
  writeSidebarCollapsed,
} from "./appLayoutUtils";
import { NavigationGuardProvider, useNavigationGuard } from "./navigationGuard";
import Dashboard from "./pages/Dashboard";
import MaintenancePage from "./pages/MaintenancePage";
import ReportEdit from "./pages/ReportEdit";
import ReportList from "./pages/ReportList";
import ReportPrint from "./pages/ReportPrint";
import RegularReportEdit from "./pages/RegularReportEdit";
import RegularReportList from "./pages/RegularReportList";
import SettingsPage from "./pages/SettingsPage";

const NAV_ITEMS = [
  { label: "总览看板", to: "/", icon: <DashboardIcon fontSize="small" /> },
  { label: "出差报销单", to: "/reports", icon: <ReceiptLongIcon fontSize="small" /> },
  { divider: true, key: "report-type-divider" },
  { label: "常规报销单", to: "/regular-reports", icon: <RequestQuoteIcon fontSize="small" /> },
  { label: "个性化设置", to: "/settings", icon: <SettingsIcon fontSize="small" /> },
  { label: "数据维护", to: "/maintenance", icon: <StorageIcon fontSize="small" /> },
];

// 全站统一内容区宽度：平滑放宽，保证各页面左右边界对齐。
// 1920px 视口对应 1680px，2560px 视口对应 1920px；避免窗口状态跨断点时突变。
const APP_CONTENT_SX = {
  width: "100%",
  mx: "auto",
  maxWidth: "clamp(1440px, calc(37.5vw + 960px), 1920px)",
};

function Sidebar() {
  const location = useLocation();
  const { requestNavigation } = useNavigationGuard();
  const [createMenuAnchor, setCreateMenuAnchor] = useState(null);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return readSidebarCollapsed(window.localStorage);
    } catch {
      return false;
    }
  });

  const toggleCollapsed = () => {
    setCollapsed((previous) => {
      const next = !previous;
      try {
        writeSidebarCollapsed(window.localStorage, next);
      } catch {
        // localStorage 不可用时仍保留当前会话内的侧栏状态。
      }
      return next;
    });
  };

  const isActive = (to) => {
    if (to === "/") return location.pathname === "/";
    return location.pathname.startsWith(to);
  };

  const closeCreateMenu = () => setCreateMenuAnchor(null);
  const navigateToCreate = (to) => {
    closeCreateMenu();
    requestNavigation(to);
  };

  return (
    <Paper
      component="aside"
      aria-label="主导航"
      elevation={0}
      sx={{
        width: { xs: "100%", md: collapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_EXPANDED_WIDTH },
        flexShrink: 0,
        minHeight: { md: "100vh" },
        borderRadius: 0,
        borderRight: { md: 1 },
        borderBottom: { xs: 1, md: 0 },
        borderColor: "divider",
        bgcolor: "#F8FAFC",
        position: { md: "sticky" },
        top: 0,
        zIndex: 1,
        overflowX: "hidden",
        transition: (theme) => theme.transitions.create("width", { duration: theme.transitions.duration.shorter }),
      }}
    >
      <Stack spacing={2} sx={{ p: { xs: 2.5, md: collapsed ? 1.5 : 2.5 } }}>
        <Stack
          direction="row"
          alignItems="flex-start"
          justifyContent={{ xs: "space-between", md: collapsed ? "center" : "space-between" }}
          spacing={1}
        >
          <Box sx={{ minWidth: 0, display: { xs: "block", md: collapsed ? "none" : "block" } }}>
            <Typography variant="h6" fontWeight={800} noWrap>
              报销管理
            </Typography>
            <Typography variant="body2" color="text.secondary" noWrap sx={{ mt: 0.25 }}>
              本地报销工作台
            </Typography>
          </Box>
          <Tooltip title={collapsed ? "展开侧栏" : "收起侧栏"} placement="right">
            <IconButton
              size="small"
              onClick={(event) => {
                toggleCollapsed();
                if (event.detail > 0) event.currentTarget.blur();
              }}
              aria-label={collapsed ? "展开侧栏" : "收起侧栏"}
              sx={{ display: { xs: "none", md: "inline-flex" }, flex: "0 0 auto" }}
            >
              {collapsed ? <ChevronRightIcon /> : <ChevronLeftIcon />}
            </IconButton>
          </Tooltip>
        </Stack>

        <Tooltip title={collapsed ? "新增报销单" : ""} placement="right">
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            endIcon={<ArrowDropDownIcon />}
            aria-label="新增报销单"
            aria-haspopup="menu"
            aria-expanded={Boolean(createMenuAnchor)}
            onClick={(event) => setCreateMenuAnchor(event.currentTarget)}
            sx={{
              minWidth: 0,
              justifyContent: { xs: "flex-start", md: collapsed ? "center" : "flex-start" },
              px: { md: collapsed ? 0 : 2 },
              "& .MuiButton-startIcon": {
                ml: { md: collapsed ? 0 : -0.5 },
                mr: { md: collapsed ? 0 : 1 },
              },
              "& .MuiButton-endIcon": {
                display: { md: collapsed ? "none" : "inherit" },
              },
            }}
          >
            <Box component="span" sx={{ display: { xs: "inline", md: collapsed ? "none" : "inline" } }}>
              新增报销单
            </Box>
          </Button>
        </Tooltip>
        <Menu
          anchorEl={createMenuAnchor}
          open={Boolean(createMenuAnchor)}
          onClose={closeCreateMenu}
          MenuListProps={{ "aria-label": "选择报销单类型", dense: true }}
        >
          <MenuItem onClick={() => navigateToCreate("/reports/new")}>出差报销单</MenuItem>
          <Divider />
          <MenuItem onClick={() => navigateToCreate("/regular-reports/new?mode=no_invoice")}>常规报销单 · 无票</MenuItem>
          <MenuItem onClick={() => navigateToCreate("/regular-reports/new?mode=invoice")}>常规报销单 · 有票</MenuItem>
        </Menu>

        <Divider />

        <List disablePadding>
          {NAV_ITEMS.map((item) => item.divider ? (
            <Divider key={item.key} sx={{ my: 1 }} />
          ) : (
            <Tooltip key={item.to} title={collapsed ? item.label : ""} placement="right">
              <ListItemButton
                selected={isActive(item.to)}
                onClick={() => requestNavigation(item.to)}
                aria-label={item.label}
                sx={{
                  minHeight: 40,
                  justifyContent: { xs: "flex-start", md: collapsed ? "center" : "flex-start" },
                  px: { md: collapsed ? 1 : 2 },
                  borderRadius: 1,
                  mb: 0.5,
                  "&.Mui-selected": {
                    bgcolor: "primary.50",
                    color: "primary.dark",
                    "& .MuiListItemIcon-root": { color: "primary.main" },
                  },
                }}
              >
                <ListItemIcon
                  sx={{
                    minWidth: { xs: 36, md: collapsed ? 0 : 36 },
                    justifyContent: "center",
                  }}
                >
                  {item.icon}
                </ListItemIcon>
                <ListItemText
                  primary={item.label}
                  primaryTypographyProps={{ fontWeight: 700, noWrap: true }}
                  sx={{ display: { xs: "block", md: collapsed ? "none" : "block" } }}
                />
              </ListItemButton>
            </Tooltip>
          ))}
        </List>
      </Stack>
    </Paper>
  );
}

function AppRoutes() {
  return (
    <Box sx={{ display: { xs: "block", md: "flex" }, minHeight: "100vh", bgcolor: "background.default" }}>
      <Sidebar />
      <Box component="main" sx={{ flex: 1, minWidth: 0, px: { xs: 2, md: 3, xl: 4 }, py: { xs: 2, md: 3 } }}>
        <Box sx={APP_CONTENT_SX}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/reports" element={<ReportList />} />
            <Route path="/reports/new" element={<ReportEdit />} />
            <Route path="/reports/:id/edit" element={<ReportEdit />} />
            <Route path="/reports/:id/print" element={<ReportPrint />} />
            <Route path="/regular-reports" element={<RegularReportList />} />
            <Route path="/regular-reports/new" element={<RegularReportEdit />} />
            <Route path="/regular-reports/:id/edit" element={<RegularReportEdit />} />
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
