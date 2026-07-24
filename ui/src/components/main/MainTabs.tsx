import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  ActionIcon,
  Avatar,
  Badge,
  Box,
  Button,
  Burger,
  Divider,
  Drawer,
  Group,
  ScrollArea,
  Menu,
  Indicator,
  Stack,
  Tabs,
  Text,
  Tooltip,
  UnstyledButton,
  rem,
  useMantineTheme,
} from "@mantine/core";
import type { MantineTheme, TabsProps } from "@mantine/core";
import { useDisclosure, useMediaQuery } from "@mantine/hooks";
import {
  IconChevronDown,
  IconBell,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconLogout,
  IconRefresh,
  IconUserCircle,
} from "@tabler/icons-react";

import { useAppDispatch, useAppSelector } from "../../store/hooks";
import { fetchUsers, logoutUser } from "../../actions/userActions";
import { selectAllowedNavigationPages } from "../../selectors/accessControlSelectors";
import type { User } from "../../types/users/User";
import { buildUserProfilePhotoUrl } from "../../utils/profilePhoto";
import {
  fetchInboxNotifications,
  markInboxNotificationsRead,
} from "../../api/notifications";
import { clearCachedAppFilesAndReload } from "../../utils/refreshApp";

const NAV_GAP = 8;
const OVERFLOW_TRIGGER_RESERVE = 72;

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
  const queryClient = useQueryClient();
  const allowedPages = useAppSelector(selectAllowedNavigationPages);
  const { currentPage } = useAppSelector((state) => state.navigation);
  const sessionUserName = useAppSelector((state) => state.session.user);
  const loggedUserId = useAppSelector((state) => state.session.loggedUserId);
  const usersState = useAppSelector((state) => state.users);
  const navigate = useNavigate();
  const location = useLocation();
  const theme = useMantineTheme();

  const [drawerOpened, { toggle: toggleDrawer, close: closeDrawer }] = useDisclosure(false);
  const isTablet = useMediaQuery(`(max-width: ${theme.breakpoints.lg})`);
  const isMobile = useMediaQuery(`(max-width: ${theme.breakpoints.sm})`);
  const showSidebarToggle = hasSidebar && isTablet && Boolean(onSidebarToggle);
  const [visiblePages, setVisiblePages] = useState(allowedPages);
  const [overflowPages, setOverflowPages] = useState<typeof allowedPages>([]);
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notificationsError, setNotificationsError] = useState<string | null>(null);
  const [refreshingApp, setRefreshingApp] = useState(false);
  const navContainerRef = useRef<HTMLDivElement | null>(null);
  const navMeasurementRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const requestedUsersRef = useRef(false);
  const navRafRef = useRef<number | null>(null);

  const userRecords = useMemo(
    () => (usersState?.[0]?.data?.[0]?.data ?? []) as Partial<User>[],
    [usersState],
  );
  const currentUserRecord = useMemo(
    () => userRecords.find((record) => record.id === loggedUserId),
    [userRecords, loggedUserId],
  );
  const userProfilePhotoUrl = useMemo(
    () => buildUserProfilePhotoUrl({ user: currentUserRecord }),
    [currentUserRecord],
  );

  const profileInitials = useMemo(() => {
    if (!sessionUserName) {
      return "OL";
    }

    const parts = sessionUserName
      .split(" ")
      .map((part) => part.trim())
      .filter(Boolean);

    if (parts.length === 0) {
      return "OL";
    }

    if (parts.length === 1) {
      return parts[0].slice(0, 2).toUpperCase();
    }

    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  }, [sessionUserName]);

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

  const loadRecentNotifications = useCallback(async () => {
    setNotificationsLoading(true);
    setNotificationsError(null);
    try {
      const response = await fetchInboxNotifications({ limit: 1, offset: 0 });
      setUnreadNotificationCount(response.unreadCount);
    } catch (error) {
      setNotificationsError(
        error instanceof Error ? error.message : "Failed to load notifications",
      );
    } finally {
      setNotificationsLoading(false);
    }
  }, []);

  const openNotifications = async () => {
    closeDrawer();
    navigate("/notifications");
    if (unreadNotificationCount === 0) {
      return;
    }
    setUnreadNotificationCount(0);
    try {
      await markInboxNotificationsRead();
    } catch {
      loadRecentNotifications().catch(() => undefined);
    }
  };

  const handleSignOut = async () => {
    closeDrawer();
    document.cookie = "token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
    try {
      await dispatch(logoutUser()).unwrap();
    } catch {
      // Local auth state is cleared by the rejected reducer; keep sign-out resilient.
    } finally {
      queryClient.clear();
      navigate("/", { replace: true });
    }
  };

  const handleRefreshApp = async () => {
    if (refreshingApp) {
      return;
    }
    const confirmed = window.confirm("This will clear cached app files and reload. Continue?");
    if (!confirmed) {
      return;
    }
    setRefreshingApp(true);
    await clearCachedAppFilesAndReload();
  };

  const handleProfileClick = () => {
    closeDrawer();
    navigate("/account");
  };

  const handleNavigate = (path: string) => {
    navigate(path);
    closeDrawer();
  };

  const handleBrandClick = () => {
    navigate("/");
    closeDrawer();
  };

  useEffect(() => {
    closeDrawer();
  }, [location.pathname, closeDrawer]);

  useEffect(() => {
    if (!loggedUserId) {
      requestedUsersRef.current = false;
      return;
    }
    if (currentUserRecord || usersState?.[0]?.loading || requestedUsersRef.current) {
      return;
    }
    requestedUsersRef.current = true;
    dispatch(fetchUsers());
  }, [loggedUserId, currentUserRecord, usersState, dispatch]);

  useEffect(() => {
    if (!loggedUserId) {
      setUnreadNotificationCount(0);
      setNotificationsError(null);
      return;
    }
    loadRecentNotifications().catch(() => undefined);
    const intervalId = window.setInterval(() => {
      loadRecentNotifications().catch(() => undefined);
    }, 60_000);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [loggedUserId, loadRecentNotifications]);

  useEffect(() => {
    setVisiblePages(allowedPages);
    setOverflowPages([]);
  }, [allowedPages]);

  const updateNavVisibility = useCallback(() => {
    if (isTablet || allowedPages.length === 0) {
      setVisiblePages(allowedPages);
      setOverflowPages([]);
      return;
    }

    const containerWidth = navContainerRef.current?.offsetWidth ?? 0;

    if (containerWidth === 0) {
      setVisiblePages(allowedPages);
      setOverflowPages([]);
      return;
    }

    const measurements = allowedPages.map((page) => ({
      page,
      width: navMeasurementRefs.current[page.path]?.offsetWidth ?? 0,
    }));

    if (measurements.some(({ width }) => width === 0)) {
      setVisiblePages(allowedPages);
      setOverflowPages([]);
      return;
    }

    const totalWidth =
      measurements.reduce((sum, { width }) => sum + width, 0) +
      Math.max(0, measurements.length - 1) * NAV_GAP;

    if (totalWidth <= containerWidth) {
      setVisiblePages(allowedPages);
      setOverflowPages([]);
      return;
    }

    const availableWidth = Math.max(containerWidth - OVERFLOW_TRIGGER_RESERVE, measurements[0]?.width ?? 0);
    const nextVisible: typeof allowedPages = [];
    const nextOverflow: typeof allowedPages = [];
    let usedWidth = 0;

    measurements.forEach(({ page, width }) => {
      const requiredWidth = width + (nextVisible.length > 0 ? NAV_GAP : 0);
      if (usedWidth + requiredWidth <= availableWidth || nextVisible.length === 0) {
        usedWidth += requiredWidth;
        nextVisible.push(page);
      } else {
        nextOverflow.push(page);
      }
    });

    setVisiblePages(nextVisible);
    setOverflowPages(nextOverflow);
  }, [allowedPages, isTablet]);

  useEffect(() => {
    updateNavVisibility();
    const scheduleUpdate = () => {
      if (navRafRef.current !== null) {
        window.cancelAnimationFrame(navRafRef.current);
      }
      navRafRef.current = window.requestAnimationFrame(() => {
        navRafRef.current = null;
        updateNavVisibility();
      });
    };
    const handleResize = () => scheduleUpdate();
    window.addEventListener("resize", handleResize);
    const observer =
      typeof ResizeObserver !== "undefined" && navContainerRef.current
        ? new ResizeObserver(() => scheduleUpdate())
        : null;
    if (observer && navContainerRef.current) {
      observer.observe(navContainerRef.current);
    }
    scheduleUpdate();
    return () => {
      window.removeEventListener("resize", handleResize);
      observer?.disconnect();
      if (navRafRef.current !== null) {
        window.cancelAnimationFrame(navRafRef.current);
        navRafRef.current = null;
      }
    };
  }, [updateNavVisibility]);

  useEffect(() => {
    if (!isTablet) {
      closeDrawer();
    }
  }, [isTablet, closeDrawer]);

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
    display: "grid",
    gridTemplateColumns: "auto minmax(0, 1fr) auto",
    alignItems: "center",
    columnGap: rem(18),
    minHeight: isMobile ? rem(56) : rem(68),
  };

  const navContainerStyle: React.CSSProperties = {
    display: isTablet ? "none" : "flex",
    justifyContent: "center",
    alignItems: "center",
    width: "100%",
    justifySelf: "center",
    overflow: "hidden",
    minWidth: 0,
  };

  const actionsStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: rem(8),
    justifySelf: "end",
  };

  const tabsStyles: TabsProps["styles"] = (
    currentTheme: MantineTheme,
    _props,
    _ctx
  ) => ({
    root: {
      background: "transparent",
      width: "100%",
      minWidth: 0,
    },
    list: {
      background: "transparent",
      display: "flex",
      gap: rem(NAV_GAP),
      paddingBottom: 0,
      flexWrap: "nowrap" as const,
      alignItems: "center",
      justifyContent: "center",
    },
    tab: {
      position: "relative",
      backgroundColor: "#050505",
      color: currentTheme.white,
      border: "1px solid rgba(255, 255, 255, 0.35)",
      fontWeight: 600,
      fontSize: rem(15),
      padding: `${rem(10)} ${rem(isMobile ? 18 : 22)}`,
      minHeight: rem(38),
      borderRadius: rem(999),
      margin: 0,
      transition: "all 120ms ease",
      cursor: "pointer",
    },
  });

  const activeTabStyle = useMemo(
    () => ({
      backgroundColor: theme.white,
      color: theme.black,
      borderColor: "transparent",
      boxShadow: "0 10px 25px rgba(0, 0, 0, 0.25)",
      transform: "translateY(-1px)",
    }),
    [theme],
  );

  return (
    <>
      <div
        aria-hidden
        style={{
          position: "absolute",
          top: "-9999px",
          left: "-9999px",
          pointerEvents: "none",
          opacity: 0,
        }}
      >
        {allowedPages.length > 0 && (
          <Tabs value={null} styles={tabsStyles}>
            <Tabs.List>
              {allowedPages.map((page) => (
                <Tabs.Tab
                  value={page.path}
                  key={`measure-${page.path}`}
                  ref={(node) => {
                    navMeasurementRefs.current[page.path] = node;
                  }}
                >
                  {page.name}
                </Tabs.Tab>
              ))}
            </Tabs.List>
          </Tabs>
        )}
      </div>

      <header style={shellStyle}>
        <div style={innerStyle}>
          <Group
            gap="sm"
            align="center"
            wrap="nowrap"
            style={{ minWidth: 0, justifySelf: "start" }}
          >
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

          <Box style={navContainerStyle} ref={navContainerRef}>
            {allowedPages.length > 0 && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: "100%",
                  minWidth: 0,
                  gap: rem(8),
                }}
              >
                <Tabs
                  value={activeTab ?? null}
                  onChange={(val) => val && handleNavigate(val)}
                  variant="pills"
                  radius="xl"
                  styles={tabsStyles}
                >
                  <Tabs.List>
                    {visiblePages.map((page) => (
                      <Tabs.Tab
                        value={page.path}
                        key={page.name}
                        style={activeTab === page.path ? activeTabStyle : undefined}
                      >
                        {page.name}
                      </Tabs.Tab>
                    ))}
                  </Tabs.List>
                </Tabs>
                {overflowPages.length > 0 && (
                  <Menu withinPortal position="bottom-end" offset={4}>
                    <Menu.Target>
                      <ActionIcon
                        variant="filled"
                        color="dark"
                        size={isMobile ? 34 : 36}
                        radius="xl"
                        aria-label="Show more sections"
                        style={{
                          backgroundColor: "rgba(255, 255, 255, 0.1)",
                          color: theme.white,
                          border: "1px solid rgba(255, 255, 255, 0.35)",
                        }}
                      >
                        <IconChevronDown size={18} />
                      </ActionIcon>
                    </Menu.Target>
                    <Menu.Dropdown>
                      {overflowPages.map((page) => (
                        <Menu.Item key={page.name} onClick={() => handleNavigate(page.path)}>
                          {page.name}
                        </Menu.Item>
                      ))}
                    </Menu.Dropdown>
                  </Menu>
                )}
              </div>
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
            {isMobile ? (
              <Tooltip label="Refresh app" position="bottom" offset={4} withArrow>
                <ActionIcon
                  variant="transparent"
                  size={34}
                  onClick={handleRefreshApp}
                  aria-label="Refresh app"
                  radius="xl"
                  loading={refreshingApp}
                  style={{
                    color: theme.white,
                  }}
                >
                  <IconRefresh size={21} stroke={1.8} />
                </ActionIcon>
              </Tooltip>
            ) : null}
            <Menu width={230} position="bottom-end" offset={8} withArrow>
              <Menu.Target>
                <ActionIcon
                  variant="subtle"
                  size={isMobile ? 34 : 36}
                  aria-label="Open account menu"
                radius="xl"
                  style={{
                    color: theme.white,
                    backgroundColor: "rgba(255, 255, 255, 0.08)",
                    overflow: "visible",
                  }}
                >
                <Indicator
                  color="red"
                  size={20}
                  offset={-3}
                  position="top-end"
                  disabled={unreadNotificationCount === 0}
                  label={unreadNotificationCount > 9 ? "9+" : `${unreadNotificationCount}`}
                  styles={{
                    root: {
                      overflow: "visible",
                    },
                    indicator: {
                      minWidth: rem(20),
                      height: rem(20),
                      paddingInline: rem(5),
                      fontSize: rem(11),
                      fontWeight: 900,
                      lineHeight: 1,
                      border: "2px solid #171717",
                    },
                  }}
                >
                  <Avatar
                    size={isMobile ? 28 : 30}
                    radius="xl"
                    src={userProfilePhotoUrl ?? undefined}
                    style={{
                      background: userProfilePhotoUrl
                        ? "transparent"
                        : `linear-gradient(135deg, ${theme.colors.blue[6]}, ${theme.colors.indigo[5]})`,
                      fontWeight: 600,
                      fontSize: rem(13),
                      color: userProfilePhotoUrl ? theme.black : theme.white,
                    }}
                  >
                    {!userProfilePhotoUrl && profileInitials}
                  </Avatar>
                </Indicator>
              </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item leftSection={<IconUserCircle size={18} />} onClick={handleProfileClick}>
                  My Account
                </Menu.Item>
                <Menu.Item
                  leftSection={<IconBell size={18} />}
                  rightSection={
                    unreadNotificationCount > 0 ? (
                      <Badge color="red" variant="filled" size="sm">
                        {unreadNotificationCount > 9 ? "9+" : unreadNotificationCount}
                      </Badge>
                    ) : undefined
                  }
                  onClick={openNotifications}
                >
                  Notifications
                </Menu.Item>
                {notificationsError ? (
                  <Menu.Item disabled>
                    <Text size="xs" c="red">
                      {notificationsError}
                    </Text>
                  </Menu.Item>
                ) : notificationsLoading ? (
                  <Menu.Item disabled>Loading notifications...</Menu.Item>
                ) : null}
                <Menu.Divider />
                {!isMobile ? (
                  <Menu.Item leftSection={<IconRefresh size={18} />} onClick={handleRefreshApp} disabled={refreshingApp}>
                    Refresh App
                  </Menu.Item>
                ) : null}
                <Menu.Item color="red" leftSection={<IconLogout size={18} />} onClick={handleSignOut}>
                  Sign Out
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
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
