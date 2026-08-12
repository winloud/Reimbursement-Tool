import { Box, CircularProgress, Stack, Typography } from "@mui/material";

export default function EditPageLoading({ message }) {
  return (
    <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
      <Stack spacing={2} alignItems="center">
        <CircularProgress />
        <Typography color="text.secondary">{message}</Typography>
      </Stack>
    </Box>
  );
}
