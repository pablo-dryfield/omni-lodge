import ArrowForwardRoundedIcon from "@mui/icons-material/ArrowForwardRounded";
import BoltRoundedIcon from "@mui/icons-material/BoltRounded";
import {
  Box,
  ButtonBase,
  Chip,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import { useMemo } from "react";
import { Link as RouterLink } from "react-router-dom";
import {
  selectAllowedPageSlugs,
  selectModulePermissionsMap,
} from "../../selectors/accessControlSelectors";
import { useAppSelector } from "../../store/hooks";
import {
  filterVisibleHomeQuickActions,
  HOME_QUICK_ACTIONS,
  type HomeQuickAction,
  type QuickActionTone,
} from "./homeQuickActionRegistry";

type HomeQuickActionsProps = {
  actions?: HomeQuickAction[];
  compact?: boolean;
  quickActionVisibility?: Readonly<Record<string, boolean>>;
  audienceReady?: boolean;
};

const TONE_COLORS: Record<QuickActionTone, string> = {
  blue: "#2563eb",
  emerald: "#059669",
  amber: "#d97706",
  violet: "#7c3aed",
  rose: "#e11d48",
};

const HomeQuickActions = ({
  actions = HOME_QUICK_ACTIONS,
  compact = false,
  quickActionVisibility = {},
  audienceReady = true,
}: HomeQuickActionsProps) => {
  const accessLoaded = useAppSelector((state) => state.accessControl.loaded);
  const allowedPageSlugs = useAppSelector(selectAllowedPageSlugs);
  const modulePermissions = useAppSelector(selectModulePermissionsMap);
  const visibleActions = useMemo(
    () => filterVisibleHomeQuickActions(
      actions,
      allowedPageSlugs,
      modulePermissions,
      quickActionVisibility,
    ),
    [actions, allowedPageSlugs, modulePermissions, quickActionVisibility],
  );

  if (!accessLoaded || !audienceReady || visibleActions.length === 0) {
    return null;
  }

  return (
    <Paper
      component="section"
      aria-labelledby="home-quick-actions-title"
      elevation={0}
      sx={{
        mx: compact ? { xs: 1, md: 2 } : 0,
        mt: compact ? { xs: 1, md: 1.5 } : 0,
        p: compact ? { xs: 1.25, sm: 1.5 } : { xs: 2, sm: 2.5 },
        border: "1px solid",
        borderColor: "divider",
        borderRadius: { xs: 3, sm: 4 },
        background: (theme) =>
          `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.055)} 0%, ${theme.palette.background.paper} 45%, ${alpha("#059669", 0.045)} 100%)`,
        boxShadow: "0 12px 32px rgba(15, 23, 42, 0.07)",
      }}
    >
      <Stack
        direction={compact ? { xs: "column", md: "row" } : "column"}
        spacing={compact ? 1.25 : 2}
        alignItems={compact ? { xs: "stretch", md: "center" } : "stretch"}
      >
        <Box sx={{ minWidth: compact ? 190 : undefined }}>
          <Stack direction="row" spacing={1} alignItems="center">
            <Chip
              icon={<BoltRoundedIcon />}
              label="Shortcuts"
              size="small"
              color="primary"
              variant="outlined"
              sx={{ fontWeight: 750 }}
            />
            <Typography
              id="home-quick-actions-title"
              component="h2"
              variant={compact ? "subtitle1" : "h6"}
              fontWeight={800}
            >
              Quick actions
            </Typography>
          </Stack>
        </Box>

        <Box
          sx={{
            display: "grid",
            gridAutoFlow: { xs: "column", sm: "row" },
            gridAutoColumns: { xs: "minmax(250px, 84vw)", sm: "auto" },
            gridTemplateColumns: { sm: "repeat(auto-fit, minmax(260px, 340px))" },
            gap: 1.25,
            overflowX: { xs: "auto", sm: "visible" },
            overscrollBehaviorInline: "contain",
            scrollSnapType: { xs: "inline mandatory", sm: "none" },
            pb: { xs: 0.5, sm: 0 },
            flex: 1,
          }}
        >
          {visibleActions.map((action) => {
            const Icon = action.icon;
            const accent = TONE_COLORS[action.tone ?? "blue"];
            return (
              <ButtonBase
                key={action.id}
                component={RouterLink}
                to={action.to}
                state={action.state}
                aria-label={`${action.label}. ${action.description}`}
                sx={{
                  width: "100%",
                  minHeight: compact ? 68 : 88,
                  justifyContent: "stretch",
                  textAlign: "left",
                  border: "1px solid",
                  borderColor: alpha(accent, 0.2),
                  borderRadius: 2.5,
                  backgroundColor: "background.paper",
                  scrollSnapAlign: "start",
                  overflow: "hidden",
                  transition: (theme) =>
                    theme.transitions.create(["border-color", "box-shadow", "transform"], {
                      duration: theme.transitions.duration.shorter,
                    }),
                  "&:hover": {
                    borderColor: alpha(accent, 0.55),
                    boxShadow: `0 10px 24px ${alpha(accent, 0.14)}`,
                    transform: "translateY(-2px)",
                  },
                  "&:focus-visible": {
                    outline: `3px solid ${alpha(accent, 0.28)}`,
                    outlineOffset: 2,
                  },
                  "@media (prefers-reduced-motion: reduce)": {
                    transition: "none",
                    "&:hover": { transform: "none" },
                  },
                }}
              >
                <Box
                  sx={{
                    alignSelf: "stretch",
                    width: 5,
                    flexShrink: 0,
                    backgroundColor: accent,
                  }}
                />
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1.5,
                    width: "100%",
                    px: 1.5,
                    py: 1.25,
                  }}
                >
                  <Box
                    sx={{
                      width: 42,
                      height: 42,
                      borderRadius: 2,
                      display: "grid",
                      placeItems: "center",
                      flexShrink: 0,
                      color: accent,
                      backgroundColor: alpha(accent, 0.11),
                    }}
                  >
                    <Icon fontSize="small" />
                  </Box>
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ display: "block", fontWeight: 750, letterSpacing: "0.04em" }}
                    >
                      {action.group.toUpperCase()}
                    </Typography>
                    <Typography variant="subtitle2" fontWeight={800} color="text.primary">
                      {action.label}
                    </Typography>
                    {!compact && (
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ display: "block", mt: 0.25, lineHeight: 1.35 }}
                      >
                        {action.description}
                      </Typography>
                    )}
                  </Box>
                  <ArrowForwardRoundedIcon sx={{ color: accent, flexShrink: 0 }} fontSize="small" />
                </Box>
              </ButtonBase>
            );
          })}
        </Box>
      </Stack>
    </Paper>
  );
};

export default HomeQuickActions;
