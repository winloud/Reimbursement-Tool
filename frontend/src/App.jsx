import { AppBar, Box, Button, Container, CssBaseline, Toolbar, Typography } from "@mui/material";
import { Link as RouterLink, Route, Routes } from "react-router-dom";
import Dashboard from "./pages/Dashboard";
import ReportEdit from "./pages/ReportEdit";
import ReportList from "./pages/ReportList";
import ReportPrint from "./pages/ReportPrint";

export default function App() {
  return (
    <>
      <CssBaseline />
      <AppBar position="static" color="default" elevation={0} sx={{ borderBottom: 1, borderColor: "divider" }}>
        <Toolbar>
          <Typography variant="h6" sx={{ flexGrow: 1, fontWeight: 700 }}>
            出差旅费报销管理工具
          </Typography>
          <Button component={RouterLink} to="/" color="inherit">总览看板</Button>
          <Button component={RouterLink} to="/reports" color="inherit">报销单管理</Button>
        </Toolbar>
      </AppBar>
      <Box sx={{ minHeight: "100vh", bgcolor: "#F7F8FA", py: 4 }}>
        <Container maxWidth="lg">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/reports" element={<ReportList />} />
            <Route path="/reports/new" element={<ReportEdit />} />
            <Route path="/reports/:id/edit" element={<ReportEdit />} />
            <Route path="/reports/:id/print" element={<ReportPrint />} />
          </Routes>
        </Container>
      </Box>
    </>
  );
}
