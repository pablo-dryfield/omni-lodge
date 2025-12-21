import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, useLocation } from "react-router-dom";
import {
  AppShell,
  Center,
  Loader,
  Alert,
  Button,
  Stack,
  Text,
  ScrollArea,
  useMantineTheme,
} from "@mantine/core";
import { useDisclosure, useMediaQuery } from "@mantine/hooks";
import MainTabs from "./components/main/MainTabs";
import Routes from "./components/main/Routes"; // your route switch
import Login from "./pages/Login";
import { useAppDispatch, useAppSelector } from "./store/hooks";
import { fetchSession } from "./actions/sessionActions";
import { fetchAccessSnapshot } from "./actions/accessControlActions";
import { getNavbarSettings } from "./utils/getNavbarSettings";
import { NavBarRouter } from "./components/main/NavBarRouter";
import axiosInstance from "./utils/axiosInstance";
import ServerDownOverlay from "./components/offline/ServerDownOverlay";

const queryClient = new QueryClient();

const AppContent = () => {
  const location = useLocation();
  const { authenticated, checkingSession } = useAppSelector((state) => state.session);
  const { currentPage } = useAppSelector((state) => state.navigation);
  const {
    loaded: accessLoaded,
    loading: accessLoading,
    error: accessError,
  } = useAppSelector((state) => state.accessControl);
  const dispatch = useAppDispatch();
  const theme = useMantineTheme();
  const isMobile = useMediaQuery(`(max-width: ${theme.breakpoints.sm})`);
  const [sidebarOpened, { toggle: toggleSidebar, close: closeSidebar }] = useDisclosure(false);
  const [serverDown, setServerDown] = useState(false);
  const [serverDownStatus, setServerDownStatus] = useState<number | undefined>(undefined);
  const [checkingServer, setCheckingServer] = useState(false);
  const serverDownRef = useRef(false);
  const serverDownStatusRef = useRef<number | undefined>(undefined);
  const retryTimerRef = useRef<number | null>(null);
  const checkInFlightRef = useRef(false);

  const rawNavbarSettings = useMemo(
    () => getNavbarSettings(currentPage, location.pathname),
    [currentPage, location.pathname],
  );
  const computedNavbarSettings = useMemo(() => {
    if (!rawNavbarSettings) {
      return undefined;
    }
    const collapsed = {
      desktop: rawNavbarSettings.collapsed?.desktop ?? false,
      mobile: !sidebarOpened,
    };
    return {
      ...rawNavbarSettings,
      collapsed,
    };
  }, [rawNavbarSettings, sidebarOpened]);

  const checkServer = useCallback(async () => {
    if (checkInFlightRef.current) {
      return;
    }
    checkInFlightRef.current = true;
    setCheckingServer(true);
    try {
      await axiosInstance.get("/session", {
        withCredentials: true,
        timeout: 4000,
        validateStatus: () => true,
      });
      if (retryTimerRef.current) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      if (serverDownRef.current) {
        setServerDown(false);
        setServerDownStatus(undefined);
      }
    } catch {
      if (serverDownRef.current) {
        if (retryTimerRef.current) {
          window.clearTimeout(retryTimerRef.current);
        }
        retryTimerRef.current = window.setTimeout(() => {
          checkServer();
        }, 10000);
      }
    } finally {
      checkInFlightRef.current = false;
      setCheckingServer(false);
    }
  }, []);

  useEffect(() => {
    if (!isMobile) {
      closeSidebar();
    }
  }, [isMobile, closeSidebar]);

  useEffect(() => {
    closeSidebar();
  }, [currentPage, closeSidebar]);

  useEffect(() => {
    if (!rawNavbarSettings) {
      closeSidebar();
    }
  }, [rawNavbarSettings, closeSidebar]);

  useEffect(() => {
    serverDownRef.current = serverDown;
    if (!serverDown && retryTimerRef.current) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    if (serverDown) {
      checkServer();
    }
  }, [serverDown, checkServer]);

  useEffect(() => {
    serverDownStatusRef.current = serverDownStatus;
  }, [serverDownStatus]);

  useEffect(() => {
    const handleServerDown = (event: Event) => {
      const detail = (event as CustomEvent).detail as { status?: number };
      if (!serverDownRef.current) {
        setServerDown(true);
        setServerDownStatus(detail?.status);
        return;
      }
      if (detail?.status && detail.status !== serverDownStatusRef.current) {
        setServerDownStatus(detail.status);
      }
    };

    const handleOnline = () => {
      if (serverDownRef.current) {
        checkServer();
      }
    };

    window.addEventListener("omni-server-down", handleServerDown as EventListener);
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("omni-server-down", handleServerDown as EventListener);
      window.removeEventListener("online", handleOnline);
    };
  }, [checkServer]);

  useEffect(() => {
    if (!authenticated) {
      dispatch(fetchSession());
    }
  }, [dispatch, authenticated, currentPage]);

  useEffect(() => {
    if (authenticated && !accessLoaded && !accessLoading && !accessError) {
      dispatch(fetchAccessSnapshot());
    }
  }, [authenticated, accessLoaded, accessLoading, accessError, dispatch]);

  if (checkingSession) {
    return (
      <Center style={{ height: "100vh" }}>
        <Loader variant="dots" />
      </Center>
    );
  }

  const handleRetryAccess = () => {
    dispatch(fetchAccessSnapshot());
  };

  return (
    <>
      {serverDown && (
        <ServerDownOverlay status={serverDownStatus} onRetry={checkServer} isChecking={checkingServer} />
      )}
      {authenticated ? (
        <AppShell
          header={{ height: isMobile ? 56 : 68 }}
          navbar={computedNavbarSettings}
          padding={isMobile ? "sm" : "md"}
          styles={{
            main: {
              backgroundColor: "#f4f4f7",
              minHeight: "100vh",
            },
          }}
        >
          <AppShell.Header>
            <MainTabs
              hasSidebar={Boolean(rawNavbarSettings)}
              onSidebarToggle={toggleSidebar}
              sidebarOpened={sidebarOpened}
            />
          </AppShell.Header>
          {rawNavbarSettings && (
            <AppShell.Navbar
              p="md"
              withBorder={false}
              style={{
                boxShadow: "2px 0 35px -2px rgba(60, 60, 60, 0.07)",
                zIndex: 12,
              }}
            >
              <ScrollArea style={{ height: "100%" }} type="hover" offsetScrollbars>
                <NavBarRouter currentPage={currentPage} />
              </ScrollArea>
            </AppShell.Navbar>
          )}
          <AppShell.Main>
            <Stack gap="md">
              {accessError && (
                <Alert color="red" title="Permission sync failed" mb="md">
                  <Stack gap="xs">
                    <Text>{accessError}</Text>
                    <Button
                      size="xs"
                      color="red"
                      variant="light"
                      onClick={handleRetryAccess}
                      loading={accessLoading}
                    >
                      Retry fetch
                    </Button>
                  </Stack>
                </Alert>
              )}
              <Routes />
            </Stack>
          </AppShell.Main>
        </AppShell>
      ) : (
        <Login />
      )}
    </>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  </QueryClientProvider>
);

export default App;
