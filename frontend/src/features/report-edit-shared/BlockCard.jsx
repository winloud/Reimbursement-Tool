import { forwardRef, useId, useState } from "react";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import { Box, Card, Collapse, IconButton, Tooltip, Typography } from "@mui/material";

import {
  blockCardActionsSx,
  blockCardBodySx,
  blockCardHeaderCollapsedSx,
  blockCardHeaderSx,
  blockCardSummarySx,
  blockCardSx,
  blockCardTitleSx,
} from "./editPageStyles";

const toSxArray = (base, override) => (
  Array.isArray(override) ? [base, ...override] : [base, override]
);

// 填报页的统一块卡。折叠状态既可由页面受控，也可只在组件内维护。
const BlockCard = forwardRef(function BlockCard({
  id,
  title,
  summary,
  actions,
  children,
  expanded: expandedProp,
  defaultExpanded = true,
  onExpandedChange,
  collapsible = true,
  toggleLabel,
  titleComponent = "h2",
  component = "section",
  unmountOnExit = false,
  sx,
  headerSx,
  bodySx,
  ...rootProps
}, ref) {
  const generatedId = useId();
  const rootId = id || `report-edit-block-${generatedId}`;
  const titleId = `${rootId}-title`;
  const bodyId = `${rootId}-content`;
  const controlled = typeof expandedProp === "boolean";
  const [localExpanded, setLocalExpanded] = useState(defaultExpanded);
  const expanded = collapsible && controlled ? expandedProp : collapsible ? localExpanded : true;
  const accessibleName = toggleLabel || (typeof title === "string" ? title : "此分区");

  const handleToggle = (event) => {
    const nextExpanded = !expanded;
    if (!controlled) setLocalExpanded(nextExpanded);
    onExpandedChange?.(nextExpanded, event);
  };

  return (
    <Card
      {...rootProps}
      ref={ref}
      id={rootId}
      component={component}
      aria-labelledby={rootProps["aria-labelledby"] || titleId}
      data-report-edit-block-card="true"
      data-expanded={String(expanded)}
      sx={toSxArray(blockCardSx, sx)}
    >
      <Box
        className="report-edit-block-card__header"
        sx={[
          blockCardHeaderSx,
          !expanded && blockCardHeaderCollapsedSx,
          ...(Array.isArray(headerSx) ? headerSx : [headerSx]),
        ]}
      >
        {collapsible && (
          <Tooltip title={`${expanded ? "收起" : "展开"}${accessibleName}`}>
            <IconButton
              size="small"
              aria-label={`${expanded ? "收起" : "展开"}${accessibleName}`}
              aria-expanded={expanded}
              aria-controls={bodyId}
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
        )}

        <Typography id={titleId} component={titleComponent} sx={blockCardTitleSx}>
          {title}
        </Typography>

        {summary != null && <Box sx={blockCardSummarySx}>{summary}</Box>}
        {actions != null && <Box sx={blockCardActionsSx}>{actions}</Box>}
      </Box>

      <Collapse in={expanded} timeout="auto" unmountOnExit={unmountOnExit}>
        <Box
          id={bodyId}
          className="report-edit-block-card__body"
          role="region"
          aria-labelledby={titleId}
          sx={toSxArray(blockCardBodySx, bodySx)}
        >
          {children}
        </Box>
      </Collapse>
    </Card>
  );
});

export default BlockCard;
