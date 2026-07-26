import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import App from "./App";

const theme = createTheme({
  palette: {
    mode: "light",
    primary: {
      50: "#E9F0FB",
      main: "#2454A6",
      dark: "#173B78",
      light: "#5E83C9",
      contrastText: "#FFFFFF",
    },
    success: {
      50: "#E6F4EE",
      main: "#237A57",
      dark: "#175B40",
    },
    warning: {
      50: "#FFF1DD",
      main: "#B66B18",
      dark: "#8A4D0D",
    },
    error: {
      50: "#FDEAEA",
      main: "#B93B3B",
      dark: "#8C2828",
    },
    info: {
      50: "#E8EEF8",
      main: "#3A668F",
    },
    background: {
      default: "#F4F6F8",
      paper: "#FFFFFF",
    },
    text: {
      primary: "#17202A",
      secondary: "#667285",
    },
    divider: "#DDE3EA",
    action: {
      hover: "rgba(36, 84, 166, 0.06)",
      selected: "rgba(36, 84, 166, 0.11)",
    },
  },
  typography: {
    fontFamily: "'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', system-ui, sans-serif",
    fontWeightBold: 800,
    h4: { letterSpacing: 0, fontWeight: 900 },
    h5: { letterSpacing: 0, fontWeight: 850 },
    h6: { letterSpacing: 0, fontWeight: 850 },
  },
  shape: {
    borderRadius: 8,
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          backgroundColor: "#F4F6F8",
          fontVariantNumeric: "tabular-nums",
        },
        'input[type="number"]': {
          MozAppearance: "textfield",
        },
        'input[type="number"]::-webkit-inner-spin-button, input[type="number"]::-webkit-outer-spin-button': {
          WebkitAppearance: "none",
          margin: 0,
        },
      },
    },
    MuiCard: {
      defaultProps: {
        elevation: 0,
      },
      styleOverrides: {
        root: {
          border: "1px solid #DDE3EA",
          borderRadius: 8,
          boxShadow: "0 1px 0 rgba(23, 32, 42, 0.03)",
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          fontWeight: 800,
          textTransform: "none",
          boxShadow: "none",
        },
        contained: {
          boxShadow: "0 8px 18px rgba(36, 84, 166, 0.16)",
          "&:hover": {
            boxShadow: "0 10px 22px rgba(36, 84, 166, 0.2)",
          },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: 6,
          fontWeight: 800,
        },
      },
    },
    MuiInputLabel: {
      styleOverrides: {
        outlined: {
          "&.MuiInputLabel-shrink": {
            marginLeft: -4,
            paddingLeft: 4,
            paddingRight: 4,
            backgroundColor: "#FFFFFF",
          },
          "&.Mui-focused": {
            color: "#2454A6",
            fontWeight: 700,
          },
        },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          backgroundColor: "#FFFFFF",
          "&.Mui-focused .MuiOutlinedInput-notchedOutline": {
            borderColor: "#2454A6",
            borderWidth: 2,
          },
        },
        notchedOutline: {
          borderColor: "#DDE3EA",
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: {
          borderBottomColor: "#DDE3EA",
        },
        head: {
          backgroundColor: "#F1F4F8",
          color: "#526071",
          fontSize: 12,
          fontWeight: 900,
        },
      },
    },
    MuiTableRow: {
      styleOverrides: {
        root: {
          "&.MuiTableRow-hover:hover": {
            backgroundColor: "#F8FBFF",
          },
        },
      },
    },
    MuiTabs: {
      styleOverrides: {
        indicator: {
          height: 3,
          borderRadius: 3,
        },
      },
    },
  },
});

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemeProvider theme={theme}>
        <App />
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
