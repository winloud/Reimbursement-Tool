import { forwardRef, useId, useState } from "react";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import { Box, Collapse, IconButton, Tooltip } from "@mui/material";

import {
  collapsibleRowActionsSx,
  collapsibleRowDrawerSx,
  collapsibleRowSummaryContentSx,
  collapsibleRowSummarySx,
  collapsibleRowSx,
} from "./editPageStyles";

const toSxArray = (base, override) => (
  Array.isArray(override) ? [base, ...override] : [base, override]
);

// 摘要行与展开内容共享同一圈边框，展开时呈现为从摘要下方拉出的白色抽屉。
const CollapsibleRow = forwardRef(function CollapsibleRow({
  id,
  summary,
  actions,
  children,
  expanded: expandedProp,
  defaultExpanded = false,
  onExpandedChange,
  toggleLabel = "此行明细",
  component = "div",
  unmountOnExit = false,
  sx,
  summarySx,
  drawerSx,
  ...rootProps
}, ref) {
  const generatedId = useId();
  const rootId = id || `report-edit-row-${generatedId}`;
  const summaryId = `${rootId}-summary`;
  const drawerId = `${rootId}-detail`;
  const controlled = typeof expandedProp === "boolean";
  const [localExpanded, setLocalExpanded] = useState(defaultExpanded);
  const expanded = controlled ? expandedProp : localExpanded;

  const handleToggle = (event) => {
    event.stopPropagation();
    const nextExpanded = !expanded;
    if (!controlled) setLocalExpanded(nextExpanded);
    onExpandedChange?.(nextExpanded, event);
  };

  return (
    <Box
      {...rootProps}
      ref={ref}
      id={rootId}
      component={component}
      data-report-edit-collapsible-row="true"
      data-expanded={String(expanded)}
      sx={toSxArray(collapsibleRowSx, sx)}
    >
      <Box
        className="report-edit-collapsible-row__summary"
        sx={toSxArray(collapsibleRowSummarySx, summarySx)}
      >
        <Box
          id={summaryId}
          role="button"
          tabIndex={0}
          aria-expanded={expanded}
          aria-controls={drawerId}
          onClick={handleToggle}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            handleToggle(event);
          }}
          sx={collapsibleRowSummaryContentSx}
        >
          {summary}
        </Box>

        {actions != null && <Box sx={collapsibleRowActionsSx}>{actions}</Box>}

        <Tooltip title={`${expanded ? "收起" : "展开"}${toggleLabel}`}>
          <IconButton
            size="small"
            aria-label={`${expanded ? "收起" : "展开"}${toggleLabel}`}
            aria-expanded={expanded}
            aria-controls={drawerId}
            onClick={handleToggle}
            sx={{
              flex: "0 0 auto",
              "& .MuiSvgIcon-root": {
                transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
                transition: (theme) => theme.transitions.create("transform", {
                  duration: theme.transitions.duration.shorter,
                }),
              },
              "@media (prefers-reduced-motion: reduce)": {
                "& .MuiSvgIcon-root": { transition: "none" },
              },
            }}
          >
            <ChevronRightIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>

      <Collapse in={expanded} timeout="auto" unmountOnExit={unmountOnExit}>
        <Box
          id={drawerId}
          className="report-edit-collapsible-row__drawer"
          role="region"
          aria-labelledby={summaryId}
          sx={toSxArray(collapsibleRowDrawerSx, drawerSx)}
        >
          {children}
        </Box>
      </Collapse>
    </Box>
  );
});

export default CollapsibleRow;
