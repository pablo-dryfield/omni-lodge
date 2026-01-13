import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import LinkOffRoundedIcon from "@mui/icons-material/LinkOffRounded";
import LinkRoundedIcon from "@mui/icons-material/LinkRounded";
import {
  Box,
  Button,
  Card,
  CardContent,
  IconButton,
  MenuItem,
  MenuList,
  Popover,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { alpha, styled } from "@mui/material/styles";
import { useState, type MouseEvent } from "react";

type SpotlightHeaderProps = {
  title: string;
  description?: string | null;
  titleVariant?: "subtitle1" | "h6" | "h5";
  titleFontFamily?: string;
  rangeLabel?: string | null;
};

type SpotlightPeriodOption = {
  value: string;
  label: string;
};

type SpotlightPeriodRowProps = {
  label: string;
  options?: SpotlightPeriodOption[];
  activeValue?: string | null;
  onSelectOption?: (value: string) => void;
  customInput?: { from: string; to: string };
  onCustomInputChange?: (key: "from" | "to", value: string) => void;
  onApplyCustomRange?: () => void;
};

type SpotlightCardProps = {
  title: string;
  metricLabel?: string | null;
  metricValue?: string | null;
  deltaText?: string | null;
  rangeText?: string | null;
  contextText?: string | null;
  statusText?: string | null;
  statusTone?: "info" | "warning" | "error";
  periodLabel?: string | null;
  rangeLabel?: string | null;
  periodOptions?: SpotlightPeriodOption[];
  activePeriod?: string | null;
  onSelectPeriod?: (value: string) => void;
  customInput?: { from: string; to: string };
  onCustomInputChange?: (key: "from" | "to", value: string) => void;
  onApplyCustomRange?: () => void;
  titleVariant?: "subtitle1" | "h6" | "h5";
  isLinked?: boolean;
  onToggleLink?: () => void;
};

export const SpotlightPeriodGroup = styled("div")(({ theme }) => ({
  display: "inline-flex",
  flexWrap: "wrap",
  gap: 6,
  padding: 4,
  borderRadius: 999,
  backgroundColor: alpha(theme.palette.text.primary, 0.04),
  border: `1px solid ${alpha(theme.palette.text.primary, 0.08)}`,
}));

export const SpotlightPeriodButton = styled(Button)(({ theme }) => ({
  borderRadius: 999,
  textTransform: "none",
  fontWeight: 600,
  minHeight: 26,
  padding: "3px 10px",
  fontSize: 12,
  color: theme.palette.text.secondary,
  "&.isActive": {
    color: theme.palette.primary.main,
    backgroundColor: alpha(theme.palette.primary.main, 0.12),
  },
  "&:hover": {
    backgroundColor: alpha(theme.palette.text.primary, 0.08),
  },
}));

const SPOTLIGHT_VALUE_FONT = "'Roboto Slab', serif";
const SPOTLIGHT_TITLE_FONT = "'Manrope', sans-serif";

const SpotlightCardShell = styled(Card)(({ theme: muiTheme }) => ({
  position: "relative",
  height: "100%",
  width: "100%",
  borderRadius: 14,
  border: `1px solid ${alpha(muiTheme.palette.text.primary, 0.12)}`,
  background:
    muiTheme.palette.mode === "dark"
      ? "linear-gradient(160deg, rgba(12, 18, 30, 0.98) 0%, rgba(18, 26, 44, 0.98) 100%)"
      : "linear-gradient(180deg, #ffffff 0%, #f6f7f9 100%)",
  boxShadow: "0 12px 24px rgba(15, 23, 42, 0.08)",
  overflow: "hidden",
  minHeight: 0,
  // "&::before": {
  //   content: "\"\"",
  //   position: "absolute",
  //   inset: 0,
  //   backgroundImage:
  //     "linear-gradient(120deg, rgba(15, 23, 42, 0.04) 0%, transparent 50%), linear-gradient(90deg, rgba(15, 23, 42, 0.04) 1px, transparent 1px), linear-gradient(0deg, rgba(15, 23, 42, 0.04) 1px, transparent 1px)",
  //   backgroundSize: "auto, 26px 26px, 26px 26px",
  //   opacity: muiTheme.palette.mode === "dark" ? 0.25 : 0.4,
  //   pointerEvents: "none",
  // },
  "&::after": {
    content: "none",
  },
}));

const SpotlightMetricLabel = styled(Typography)(({ theme: muiTheme }) => ({
  textTransform: "uppercase",
  letterSpacing: 1.6,
  fontWeight: 700,
  fontSize: 10,
  color: alpha(muiTheme.palette.text.primary, 0.6),
}));

const SpotlightMetricValue = styled(Typography)(({ theme: muiTheme }) => ({
  fontFamily: SPOTLIGHT_VALUE_FONT,
  fontWeight: 600,
  letterSpacing: -0.4,
  color: muiTheme.palette.text.primary,
  fontVariantNumeric: "tabular-nums",
}));

export const SpotlightPeriodRow = ({
  label,
  options = [],
  activeValue,
  onSelectOption,
  customInput,
  onCustomInputChange,
  onApplyCustomRange,
}: SpotlightPeriodRowProps) => {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const isMenuOpen = Boolean(anchorEl);
  const canEdit = options.length > 0 && typeof onSelectOption === "function";
  const showCustomForm = activeValue === "custom" && Boolean(onCustomInputChange && onApplyCustomRange);
  const canApplyCustom =
    Boolean(onApplyCustomRange) &&
    Boolean(customInput?.from && customInput?.to && customInput.from.trim().length > 0 && customInput.to.trim().length > 0);

  const handleOpen = (event: MouseEvent<HTMLButtonElement>) => {
    if (!options.length) {
      return;
    }
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => setAnchorEl(null);

  const handleSelect = (value: string) => {
    onSelectOption?.(value);
    if (value !== "custom") {
      setAnchorEl(null);
    }
  };

  return (
    <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.5, flexWrap: "wrap", justifyContent: "center" }}>
      <Typography variant="body2" fontWeight={600} color="text.secondary" sx={{ fontSize: 12 }}>
        {label}
      </Typography>
      {options.length > 0 && (
        <>
          <IconButton
            size="small"
            onClick={handleOpen}
            aria-label="Edit period"
            sx={{ p: 0.25, color: "text.secondary" }}
            disabled={!canEdit}
          >
            <EditOutlinedIcon fontSize="inherit" />
          </IconButton>
          <Popover
            open={isMenuOpen}
            anchorEl={anchorEl}
            onClose={handleClose}
            anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
            transformOrigin={{ vertical: "top", horizontal: "left" }}
            PaperProps={{ sx: { p: 0.5, minWidth: 200 } }}
          >
            <MenuList dense>
              {options.map((option) => (
                <MenuItem
                  key={option.value}
                  selected={option.value === activeValue}
                  onClick={() => handleSelect(option.value)}
                  disabled={!canEdit}
                >
                  {option.label}
                </MenuItem>
              ))}
            </MenuList>
            {showCustomForm && (
              <Box sx={{ p: 1, pt: 0.5 }}>
                <Stack direction={{ xs: "column", sm: "row" }} spacing={1} flexWrap="wrap">
                  <TextField
                    size="small"
                    type="date"
                    label="From"
                    value={customInput?.from ?? ""}
                    onChange={(event) => onCustomInputChange?.("from", event.target.value)}
                    InputLabelProps={{ shrink: true }}
                  />
                  <TextField
                    size="small"
                    type="date"
                    label="To"
                    value={customInput?.to ?? ""}
                    onChange={(event) => onCustomInputChange?.("to", event.target.value)}
                    InputLabelProps={{ shrink: true }}
                  />
                  <Button
                    size="small"
                    variant="contained"
                    onClick={() => {
                      onApplyCustomRange?.();
                      setAnchorEl(null);
                    }}
                    disabled={!canApplyCustom}
                  >
                    Apply
                  </Button>
                </Stack>
              </Box>
            )}
          </Popover>
        </>
      )}
    </Box>
  );
};

export const SpotlightCard = ({
  title,
  metricLabel,
  metricValue,
  deltaText,
  rangeText,
  contextText,
  statusText,
  statusTone,
  periodLabel,
  rangeLabel,
  periodOptions = [],
  activePeriod,
  onSelectPeriod,
  customInput,
  onCustomInputChange,
  onApplyCustomRange,
  titleVariant = "subtitle1",
  isLinked,
  onToggleLink,
}: SpotlightCardProps) => {
  const normalizedTitle = title.trim().toLowerCase();
  const normalizedMetricLabel = (metricLabel ?? "").trim().toLowerCase();
  const shouldShowMetricLabel = normalizedMetricLabel.length > 0 && normalizedMetricLabel !== normalizedTitle;
  const valueLabel = shouldShowMetricLabel ? metricLabel : null;
  const valueText = metricValue ?? "-";
  const statusColor =
    statusTone === "error" ? "error.main" : statusTone === "warning" ? "warning.main" : "text.secondary";
  const normalizedDelta = (deltaText ?? "").trim();
  const shouldShowDelta = normalizedDelta.length > 0 && normalizedDelta !== "-" && normalizedDelta !== "—";
  const shouldShowRangeText = Boolean(rangeText && !periodLabel);
  const linkState = isLinked ?? true;
  const canToggleLink = typeof onToggleLink === "function";

  return (
    <SpotlightCardShell variant="outlined">
      <CardContent
        sx={{
          position: "relative",
          zIndex: 1,
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center",
          p: { xs: 1.25, md: 1.75 },
          gap: 1.5,
        }}
      >
        <Box
          sx={{
            position: "absolute",
            top: 10,
            right: 12,
            display: "flex",
            alignItems: "center",
          }}
        >
          <Tooltip title={linkState ? "Linked period" : "Unlinked period"} arrow placement="top">
            <span>
              <IconButton
                size="small"
                onClick={onToggleLink}
                disabled={!canToggleLink}
                aria-label={linkState ? "Unlink period" : "Link period"}
                sx={{ p: 0.4 }}
              >
                {linkState ? (
                  <LinkRoundedIcon
                    sx={{
                      fontSize: 16,
                      color: "text.primary",
                    }}
                  />
                ) : (
                  <LinkOffRoundedIcon
                    sx={{
                      fontSize: 16,
                      color: "text.disabled",
                    }}
                  />
                )}
              </IconButton>
            </span>
          </Tooltip>
        </Box>
        <SpotlightHeaderRow
          title={title}
          titleVariant={titleVariant}
          titleFontFamily={SPOTLIGHT_TITLE_FONT}
          rangeLabel={rangeLabel ?? undefined}
        />
        <Box
          sx={{
            flexGrow: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 0.5,
          }}
        >
          {valueLabel && <SpotlightMetricLabel variant="overline">{valueLabel}</SpotlightMetricLabel>}
          <SpotlightMetricValue variant="h4" sx={{ fontSize: { xs: "1.4rem", sm: "1.65rem", md: "1.9rem" } }}>
            {valueText}
          </SpotlightMetricValue>
          {statusText && (
            <Typography variant="caption" sx={{ color: statusColor }}>
              {statusText}
            </Typography>
          )}
          {shouldShowDelta && (
            <Typography variant="caption" color="text.secondary" sx={{ opacity: 0.85 }}>
              {deltaText}
            </Typography>
          )}
          {shouldShowRangeText && (
            <Typography variant="caption" color="text.secondary" sx={{ opacity: 0.85 }}>
              {rangeText}
            </Typography>
          )}
          {contextText && (
            <Typography variant="caption" color="text.secondary">
              {contextText}
            </Typography>
          )}
        </Box>
        {periodLabel && (
          <SpotlightPeriodRow
            label={periodLabel}
            options={periodOptions}
            activeValue={activePeriod ?? undefined}
            onSelectOption={onSelectPeriod}
            customInput={customInput}
            onCustomInputChange={onCustomInputChange}
            onApplyCustomRange={onApplyCustomRange}
          />
        )}
      </CardContent>
    </SpotlightCardShell>
  );
};

export const SpotlightHeaderRow = ({
  title,
  description,
  titleVariant = "subtitle1",
  titleFontFamily,
  rangeLabel,
}: SpotlightHeaderProps) => {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const infoText = rangeLabel?.trim() ?? "";
  const hasInfo = infoText.length > 0;
  const handleToggle = (event: MouseEvent<HTMLButtonElement>) => {
    if (!hasInfo) {
      return;
    }
    setAnchorEl((current) => (current ? null : event.currentTarget));
  };
  const handleClose = () => setAnchorEl(null);

  return (
    <Box sx={{ textAlign: "center" }}>
      <Box
        sx={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 0.5,
          justifyContent: "center",
        }}
      >
        <Typography variant={titleVariant} fontWeight={700} fontFamily={titleFontFamily}>
          {title}
        </Typography>
        {hasInfo && (
          <>
            <Tooltip title={infoText} arrow placement="top">
              <IconButton
                size="small"
                onClick={handleToggle}
                aria-label="Show date range"
                sx={{ p: 0.25, color: "text.secondary" }}
              >
                <InfoOutlinedIcon fontSize="inherit" />
              </IconButton>
            </Tooltip>
            <Popover
              open={Boolean(anchorEl)}
              anchorEl={anchorEl}
              onClose={handleClose}
              anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
              transformOrigin={{ vertical: "top", horizontal: "center" }}
              PaperProps={{
                sx: {
                  px: 1.25,
                  py: 0.75,
                  maxWidth: 200,
                  borderRadius: 1.5,
                  bgcolor: "rgba(17, 24, 39, 0.96)",
                  color: "#fff",
                  boxShadow: "0 12px 30px rgba(15, 23, 42, 0.35)",
                },
              }}
            >
              <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.9)" }}>
                {infoText}
              </Typography>
            </Popover>
          </>
        )}
      </Box>
      {description && (
        <Typography variant="body2" color="text.secondary" sx={{ fontSize: 13, lineHeight: 1.5 }}>
          {description}
        </Typography>
      )}
    </Box>
  );
};
