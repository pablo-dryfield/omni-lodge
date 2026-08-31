import ArrowForwardRoundedIcon from "@mui/icons-material/ArrowForwardRounded";
import PlayArrowRoundedIcon from "@mui/icons-material/PlayArrowRounded";
import SportsEsportsRoundedIcon from "@mui/icons-material/SportsEsportsRounded";
import {
  Box,
  ButtonBase,
  Chip,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import { alpha, type Theme } from "@mui/material/styles";
import type { ReactNode } from "react";
import { Link as RouterLink } from "react-router-dom";
import type { NavigationPage } from "../../types/general/NavigationState";
import {
  getHomeModulePresentation,
  HOME_MODULE_GROUPS,
  type HomeModuleDescriptionAudience,
  type HomeModuleTone,
} from "./homeModuleRegistry";

type HomeModuleLauncherProps = {
  pages: NavigationPage[];
  descriptionAudience: HomeModuleDescriptionAudience;
  onOpenMiniGame: () => void;
  quickActions?: ReactNode;
};

const TONE_COLORS: Record<HomeModuleTone, string> = {
  blue: "#2563eb",
  cyan: "#0891b2",
  emerald: "#059669",
  amber: "#d97706",
  violet: "#7c3aed",
  rose: "#e11d48",
  slate: "#475569",
};

const moduleCardSx = (accent: string) => ({
  position: "relative" as const,
  width: "100%",
  minHeight: 144,
  display: "flex",
  alignItems: "stretch",
  justifyContent: "stretch",
  overflow: "hidden",
  textAlign: "left",
  border: "1px solid",
  borderColor: alpha(accent, 0.16),
  borderRadius: 3,
  backgroundColor: "background.paper",
  boxShadow: "0 5px 18px rgba(15, 23, 42, 0.055)",
  transition: (theme: Theme) =>
    theme.transitions.create(["border-color", "box-shadow", "transform"], {
      duration: theme.transitions.duration.shorter,
    }),
  "&:hover": {
    borderColor: alpha(accent, 0.5),
    boxShadow: `0 14px 32px ${alpha(accent, 0.13)}`,
    transform: "translateY(-3px)",
  },
  "&:active": { transform: "translateY(-1px)" },
  "&:focus-visible": {
    outline: `3px solid ${alpha(accent, 0.28)}`,
    outlineOffset: 2,
  },
  "@media (prefers-reduced-motion: reduce)": {
    transition: "none",
    "&:hover": { transform: "none" },
  },
});

const HomeModuleLauncher = ({
  pages,
  descriptionAudience,
  onOpenMiniGame,
  quickActions,
}: HomeModuleLauncherProps) => {
  const showMiniGame = pages.length > 0;

  return (
    <Stack gap={{ xs: 2.5, md: 3.5 }}>
      {quickActions}

      <Box component="section" aria-labelledby="workspace-modules-title">
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 2,
            mb: 2,
          }}
        >
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.25 }}>
            <Typography id="workspace-modules-title" component="h1" variant="h5" fontWeight={850}>
              Modules
            </Typography>
            <Chip
              label={`${pages.length} available`}
              size="small"
              variant="outlined"
              sx={{ fontWeight: 750, flexShrink: 0 }}
            />
          </Box>
        </Box>

        {pages.length === 0 ? (
          <Paper
            variant="outlined"
            sx={{ p: { xs: 3, sm: 5 }, borderRadius: 3, textAlign: "center" }}
          >
            <Typography fontWeight={800}>
              No modules assigned yet
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              Your account can access the home page, but no workspace modules have been assigned.
              Contact an administrator if you need access.
            </Typography>
          </Paper>
        ) : (
          <Stack gap={{ xs: 2.5, md: 3.25 }}>
            {HOME_MODULE_GROUPS.map((group) => {
              const groupPages = pages.filter(
                (page) => getHomeModulePresentation(page, descriptionAudience).group === group.id,
              );
              if (groupPages.length === 0) {
                return null;
              }
              return (
                <Box key={group.id} component="section" aria-labelledby={`module-group-${group.id}`}>
                  <Box sx={{ mb: 1.25 }}>
                    <Typography id={`module-group-${group.id}`} component="h3" variant="subtitle1" fontWeight={850}>
                      {group.label}
                    </Typography>
                  </Box>
                  <Box
                    sx={{
                      display: "grid",
                      gridTemplateColumns: {
                        xs: "1fr",
                        sm: "repeat(2, minmax(0, 1fr))",
                        md: "repeat(3, minmax(0, 1fr))",
                        lg: "repeat(4, minmax(0, 1fr))",
                      },
                      gap: { xs: 1.25, sm: 1.5 },
                    }}
                  >
                    {groupPages.map((page) => {
                      const presentation = getHomeModulePresentation(page, descriptionAudience);
                      const Icon = presentation.icon;
                      const accent = TONE_COLORS[presentation.tone];
                      return (
                        <ButtonBase
                          key={page.slug}
                          component={RouterLink}
                          to={page.path}
                          aria-label={`Open ${page.name}. ${presentation.description}`}
                          sx={moduleCardSx(accent)}
                        >
                          <Box sx={{ width: 5, flexShrink: 0, bgcolor: accent }} />
                          <Box
                            sx={{
                              display: "flex",
                              flexDirection: "column",
                              width: "100%",
                              minWidth: 0,
                              p: { xs: 2, sm: 2.25 },
                            }}
                          >
                            <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1.5 }}>
                              <Box
                                sx={{
                                  width: 48,
                                  height: 48,
                                  borderRadius: 2.25,
                                  display: "grid",
                                  placeItems: "center",
                                  flexShrink: 0,
                                  color: accent,
                                  bgcolor: alpha(accent, 0.11),
                                }}
                              >
                                <Icon />
                              </Box>
                              <Box sx={{ minWidth: 0, flex: 1, pt: 0.15 }}>
                                <Typography variant="subtitle1" fontWeight={850} color="text.primary">
                                  {page.name}
                                </Typography>
                                <Typography
                                  variant="body2"
                                  color="text.secondary"
                                  sx={{
                                    mt: 0.45,
                                    lineHeight: 1.5,
                                    display: "-webkit-box",
                                    WebkitLineClamp: 2,
                                    WebkitBoxOrient: "vertical",
                                    overflow: "hidden",
                                  }}
                                >
                                  {presentation.description}
                                </Typography>
                              </Box>
                              <ArrowForwardRoundedIcon sx={{ color: accent, mt: 0.25, flexShrink: 0 }} />
                            </Box>
                          </Box>
                        </ButtonBase>
                      );
                    })}
                  </Box>
                </Box>
              );
            })}

            {showMiniGame && (
              <Box component="section" aria-labelledby="module-group-break">
                <Box sx={{ mb: 1.25 }}>
                  <Typography id="module-group-break" component="h3" variant="subtitle1" fontWeight={850}>
                    Take a break
                  </Typography>
                </Box>
                <Box sx={{ maxWidth: { sm: 420 } }}>
                  <ButtonBase
                    onClick={onOpenMiniGame}
                    aria-label="Play Krakow Runner"
                    sx={moduleCardSx(TONE_COLORS.violet)}
                  >
                    <Box sx={{ width: 5, flexShrink: 0, bgcolor: TONE_COLORS.violet }} />
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, width: "100%", p: 2.25 }}>
                      <Box
                        sx={{
                          width: 48,
                          height: 48,
                          borderRadius: 2.25,
                          display: "grid",
                          placeItems: "center",
                          flexShrink: 0,
                          color: TONE_COLORS.violet,
                          bgcolor: alpha(TONE_COLORS.violet, 0.11),
                        }}
                      >
                        <SportsEsportsRoundedIcon />
                      </Box>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="subtitle1" fontWeight={850} color="text.primary">
                          Krakow Runner
                        </Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.4 }}>
                          Play a quick round without leaving OmniLodge.
                        </Typography>
                      </Box>
                      <PlayArrowRoundedIcon sx={{ color: TONE_COLORS.violet }} />
                    </Box>
                  </ButtonBase>
                </Box>
              </Box>
            )}
          </Stack>
        )}
      </Box>
    </Stack>
  );
};

export default HomeModuleLauncher;
