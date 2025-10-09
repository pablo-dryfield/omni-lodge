import React, { useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  ActionIcon,
  Box,
  Button,
  Burger,
  Divider,
  Drawer,
  Group,
  ScrollArea,
  Stack,
  Tabs,
  Text,
  Tooltip,
  UnstyledButton,
  rem,
  useMantineTheme,
} from "@mantine/core";
import { useDisclosure, useMediaQuery } from "@mantine/hooks";
import { IconLayoutSidebarLeftCollapse, IconLayoutSidebarLeftExpand, IconLogout } from "@tabler/icons-react";

import { useAppDispatch, useAppSelector } from "../../store/hooks";
import { logoutUser } from "../../actions/userActions";
import { selectAllowedNavigationPages } from "../../selectors/accessControlSelectors";

type MainTabsProps = {
  hasSidebar?: boolean;
  onSidebarToggle?: () => void;
  sidebarOpened?: boolean;
};

const MainTabs = ({
  hasSidebar = false,
  onSidebarToggle,
  sidebarOpened = false,
}: MainTabsProps) => {
  const dispatch = useAppDispatch();
  const allowedPages = useAppSelector(selectAllowedNavigationPages);
  const { currentPage } = useAppSelector((state) => state.navigation);
  const navigate = useNavigate();
  const location = useLocation();
  const theme = useMantineTheme();

  const [drawerOpened, { toggle: toggleDrawer, close: closeDrawer }] = useDisclosure(false);
  const isTablet = useMediaQuery(`(max-width: ${theme.breakpoints.lg})`);
  const isMobile = useMediaQuery(`(max-width: ${theme.breakpoints.sm})`);
  const showSidebarToggle = hasSidebar && isTablet && Boolean(onSidebarToggle);

  const activeTab = useMemo(() => {
    if (allowedPages.length === 0) {
      return undefined;
    }

    const matchByPath = allowedPages.find((page) => {
      if (page.path === "/") {
        return location.pathname === "/";
      }
      return location.pathname.startsWith(page.path);
    });

    if (matchByPath) {
      return matchByPath.path;
    }

    const matchByName = allowedPages.find((page) => page.name === currentPage);
    return matchByName?.path ?? allowedPages[0]?.path;
  }, [allowedPages, location.pathname, currentPage]);

  const handleSignOut = () => {
    document.cookie = "token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
    dispatch(logoutUser());
    window.location.href = "/";
  };

  const handleNavigate = (path: string) => {
    navigate(path);
    closeDrawer();
  };

  const handleBrandClick = () => {
    navigate("/");
    closeDrawer();
  };

  const shellStyle: React.CSSProperties = {
    background: `linear-gradient(135deg, ${theme.colors.dark[7]} 0%, ${theme.colors.dark[8]} 45%, ${theme.colors.dark[9]} 100%)`,
    borderBottom: `1px solid rgba(255, 255, 255, 0.08)`,
    position: "sticky",
    top: 0,
    zIndex: 1100,
    boxShadow: "0 10px 30px rgba(0, 0, 0, 0.22)",
  };

  const innerStyle: React.CSSProperties = {
    width: "100%",
    margin: "0 auto",
    padding: `${rem(10)} ${isMobile ? rem(16) : rem(28)}`,
    display: "flex",
    alignItems: "center",
    gap: rem(18),
    minHeight: isMobile ? rem(56) : rem(68),
  };

  const navContainerStyle: React.CSSProperties = {
    flex: 1,
    display: isTablet ? "none" : "flex",
    justifyContent: "center",
  };

  const actionsStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: rem(8),
    marginLeft: "auto",
  };

  return (
    <>
      <header style={shellStyle}>
        <div style={innerStyle}>
          <Group gap="sm" align="center" wrap="nowrap" style={{ flexShrink: 0, minWidth: 0 }}>
            {isTablet && allowedPages.length > 0 && (
              <Burger
                opened={drawerOpened}
                onClick={toggleDrawer}
                size="sm"
                aria-label="Toggle navigation menu"
                color={theme.white}
              />
            )}
            <UnstyledButton
              onClick={handleBrandClick}
              style={{
                display: "flex",
                alignItems: "center",
                gap: rem(10),
                color: theme.white,
              }}
            >
              <Box
                style={{
                  background: `linear-gradient(135deg, ${theme.colors.blue[6]}, ${theme.colors.indigo[5]})`,
                  width: rem(36),
                  height: rem(36),
                  borderRadius: rem(12),
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: theme.white,
                  fontWeight: 700,
                  fontSize: rem(16),
                  boxShadow: "0 6px 18px rgba(0, 0, 0, 0.25)",
                  letterSpacing: "0.04em",
                }}
              >
                OL
              </Box>
              <Box style={{ textAlign: "left" }}>
                <Text fw={700} fz={isMobile ? "md" : "lg"} lh={1.1} style={{ color: theme.white }}>
                  OmniLodge
                </Text>
                {!isMobile && (
                  <Text fz="xs" lh={1.2} style={{ color: "rgba(255, 255, 255, 0.65)" }}>
                    Best Motherfucking System
                  </Text>
                )}
              </Box>
            </UnstyledButton>
          </Group>

          <Box style={navContainerStyle}>
            {allowedPages.length > 0 && (
              <ScrollArea type="never" scrollHideDelay={500} style={{ width: "100%" }}>
                <Tabs
                  value={activeTab ?? null}
                  onChange={(val) => val && handleNavigate(val)}
                  variant="pills"
                  radius="xl"
                  styles={(theme) => ({
                    root: {
                      background: "transparent",
                    },
                    list: {
                      background: "transparent",
                      display: "flex",
                      gap: rem(8),
                      paddingBottom: 0,
                      flexWrap: "nowrap",
                      alignItems: "center",
                      justifyContent: "center",
                    },
                    tab: {
                      position: "relative",
                      backgroundColor: "#050505",
                      color: theme.white,
                      border: "1px solid rgba(255, 255, 255, 0.35)",
                      fontWeight: 600,
                      fontSize: rem(15),
                      padding: "10px 22px",
                      minHeight: rem(38),
                      borderRadius: rem(999),
                      margin: 0,
                      transition: "all 120ms ease",
                      cursor: "pointer",
                      "&:hover": {
                        backgroundColor: theme.white,
                        color: theme.black,
                        borderColor: "transparent",
                      },
                      "&[data-active]": {
                        backgroundColor: theme.white,
                        color: theme.black,
                        borderColor: "transparent",
                        boxShadow: "0 10px 25px rgba(0, 0, 0, 0.25)",
                        transform: "translateY(-1px)",
                      },
                      "&:active": {
                        transform: "translateY(0)",
                      },
                    },
                  })}
                >
                  <Tabs.List>
                    {allowedPages.map((page) => (
                      <Tabs.Tab value={page.path} key={page.name}>
                        {page.name}
                      </Tabs.Tab>
                    ))}
                  </Tabs.List>
                </Tabs>
              </ScrollArea>
            )}
          </Box>

          <div style={actionsStyle}>
            {showSidebarToggle && onSidebarToggle && (
              <Tooltip
                label={sidebarOpened ? "Hide sidebar" : "Show sidebar"}
                position="bottom"
                offset={4}
                withArrow
              >
                <ActionIcon
                  variant="light"
                  color="gray"
                  size={isMobile ? 34 : 36}
                  onClick={onSidebarToggle}
                  aria-pressed={sidebarOpened}
                  radius="xl"
                  style={{
                    color: theme.white,
                    backgroundColor: "rgba(255, 255, 255, 0.08)",
                  }}
                >
                  {sidebarOpened ? (
                    <IconLayoutSidebarLeftCollapse size={20} />
                  ) : (
                    <IconLayoutSidebarLeftExpand size={20} />
                  )}
                </ActionIcon>
              </Tooltip>
            )}
            <ActionIcon
              variant="transparent"
              size={isMobile ? 34 : 36}
              onClick={handleSignOut}
              aria-label="Sign out"
              radius="xl"
              style={{
                color: theme.white,
              }}
            >
              <IconLogout size={22} stroke={1.7} />
            </ActionIcon>
          </div>
        </div>
      </header>

      <Drawer
        opened={drawerOpened}
        onClose={closeDrawer}
        size={isMobile ? "100%" : 320}
        padding="lg"
        title="OmniLodge"
        styles={{
          title: {
            flex: 1,
            textAlign: "center",
            fontWeight: 700,
            fontSize: rem(18),
          },
        }}
        overlayProps={{ opacity: 0.55, blur: 2 }}
      >
        <ScrollArea style={{ height: `calc(100vh - ${rem(140)})` }} offsetScrollbars>
          <Stack gap="lg" mt="sm">
            <Stack gap="sm">
              {allowedPages.map((page) => {
                const isActive = activeTab === page.path;
                return (
                  <Button
                    key={page.name}
                    variant={isActive ? "filled" : "light"}
                    color={isActive ? "dark" : "gray"}
                    radius="md"
                    fullWidth
                    onClick={() => handleNavigate(page.path)}
                  >
                    {page.name}
                  </Button>
                );
              })}
            </Stack>
            <Divider />
            <Button
              variant="light"
              color="red"
              radius="md"
              leftSection={<IconLogout size={18} stroke={1.8} />}
              onClick={handleSignOut}
            >
              Sign out
            </Button>
          </Stack>
        </ScrollArea>
      </Drawer>
    </>
  );
};

export default MainTabs;
