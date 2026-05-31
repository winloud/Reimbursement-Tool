import { Card, CardContent, Grid, Typography } from "@mui/material";
import HealthCheck from "../components/HealthCheck";

export default function Dashboard() {
  return (
    <Grid container spacing={3}>
      <Grid item xs={12} md={3}>
        <Card>
          <CardContent>
            <Typography color="text.secondary" gutterBottom>本月报销金额</Typography>
            <Typography variant="h4">¥0.00</Typography>
          </CardContent>
        </Card>
      </Grid>
      <Grid item xs={12} md={3}>
        <Card>
          <CardContent>
            <Typography color="text.secondary" gutterBottom>本月报销单数</Typography>
            <Typography variant="h4">0</Typography>
          </CardContent>
        </Card>
      </Grid>
      <Grid item xs={12} md={3}>
        <Card>
          <CardContent>
            <Typography color="text.secondary" gutterBottom>今年报销金额</Typography>
            <Typography variant="h4">¥0.00</Typography>
          </CardContent>
        </Card>
      </Grid>
      <Grid item xs={12} md={3}>
        <Card>
          <CardContent>
            <Typography color="text.secondary" gutterBottom>今年报销单数</Typography>
            <Typography variant="h4">0</Typography>
          </CardContent>
        </Card>
      </Grid>
      <Grid item xs={12}>
        <Card>
          <CardContent>
            <HealthCheck />
          </CardContent>
        </Card>
      </Grid>
    </Grid>
  );
}
