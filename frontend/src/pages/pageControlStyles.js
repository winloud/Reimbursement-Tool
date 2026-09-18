// 列表、看板和管理页沿用编辑页的轻量按钮，不改变按钮尺寸和位置。
export const pageControlSx = {
  "& .MuiButton-root": { fontWeight: 600 },
  "& .MuiButton-contained": {
    boxShadow: "none",
    "&:hover": { boxShadow: "0 2px 5px rgba(36, 84, 166, 0.12)" },
    "&.Mui-disabled": { boxShadow: "none" },
  },
};
