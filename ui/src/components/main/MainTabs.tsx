import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  ActionIcon,
  Avatar,
  Box,
  Button,
  Burger,
  Divider,
  Drawer,
  Group,
  ScrollArea,
  Menu,
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
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconLogout,
} from "@tabler/icons-react";

import { useAppDispatch, useAppSelector } from "../../store/hooks";
import { fetchUsers, logoutUser } from "../../actions/userActions";
import { selectAllowedNavigationPages } from "../../selectors/accessControlSelectors";
import type { User } from "../../types/users/User";
import { buildUserProfilePhotoUrl } from "../../utils/profilePhoto";

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
  const navContainerRef = useRef<HTMLDivElement | null>(null);
  const navMeasurementRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const requestedUsersRef = useRef(false);

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

  const handleSignOut = () => {
    document.cookie = "token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
    dispatch(logoutUser());
    window.location.href = "/";
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
    const handleResize = () => updateNavVisibility();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [updateNavVisibility]);

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
    gridTemplateColumns: "auto 1fr auto",
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
            <Tooltip label="My profile" position="bottom" offset={4} withArrow>
              <ActionIcon
                variant="subtle"
                size={isMobile ? 34 : 36}
                onClick={handleProfileClick}
                aria-label="Open profile"
                radius="xl"
                style={{
                  color: theme.white,
                  backgroundColor: "rgba(255, 255, 255, 0.08)",
                }}
              >
                <Avatar
                  size={isMobile ? 26 : 28}
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
              </ActionIcon>
            </Tooltip>
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
