import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { useAppDispatch, useAppSelector } from "./store/hooks";
import { fetchSession } from "./actions/sessionActions";
import { fetchAccessSnapshot } from "./actions/accessControlActions";
import devConfig from "./config/devConfig";
import prodConfig from "./config/prodConfig";
import { getNavbarSettings } from "./utils/getNavbarSettings";
import {
  SERVER_AVAILABILITY_CANDIDATE_EVENT,
  probeServerHealth,
  type ServerAvailabilityCandidateDetail,
} from "./utils/serverAvailability";

const MainTabs = lazy(() => import("./components/main/MainTabs"));
const Routes = lazy(() => import("./components/main/Routes"));
const Login = lazy(() => import("./pages/Login"));
const ServerDownOverlay = lazy(() => import("./components/offline/ServerDownOverlay"));
const RequiredActionsOverlay = lazy(() => import("./components/requiredActions/RequiredActionsOverlay"));
const NavBarRouter = lazy(() =>
  import("./components/main/NavBarRouter").then((module) => ({ default: module.NavBarRouter })),
);

const queryClient = new QueryClient();

const FullscreenLoader = () => (
  <Center style={{ height: "100vh" }}>
    <Loader variant="dots" />
  </Center>
);

const SectionLoader = () => (
  <Center py="xl">
    <Loader variant="dots" />
  </Center>
);

const PUBLIC_ROUTE_PATHS = new Set(["/privacy-policy", "/data-deletion", "/terms", "/terms-and-conditions"]);
const SERVER_FAILURE_CONFIRMATION_DELAY_MS = 1500;
const SERVER_OUTAGE_RETRY_DELAY_MS = 7000;
const SERVER_HEALTH_PROBE_TIMEOUT_MS = 4000;
const API_BASE_URL = process.env.NODE_ENV === "production" ? prodConfig.baseURL : devConfig.baseURL;

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
  const [showMiniGame, setShowMiniGame] = useState(false);
  const serverDownRef = useRef(false);
  const serverDownStatusRef = useRef<number | undefined>(undefined);
  const retryTimerRef = useRef<number | null>(null);
  const activeProbeIdRef = useRef<number | null>(null);
  const nextProbeIdRef = useRef(0);
  const consecutiveProbeFailuresRef = useRef(0);
  const confirmationNotBeforeRef = useRef(0);
  const pendingVisibleProbeRef = useRef(false);
  const lastCandidateStatusRef = useRef<number | undefined>(undefined);
  const isReceiptAccessRoute = /^\/payout-receipt\/[^/]+\/?$/.test(location.pathname);
  const isPublicRoute = PUBLIC_ROUTE_PATHS.has(location.pathname) || isReceiptAccessRoute;

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
    if (document.visibilityState === "hidden") {
      pendingVisibleProbeRef.current = true;
      return;
    }

    if (activeProbeIdRef.current !== null) {
      return;
    }

    if (!serverDownRef.current && consecutiveProbeFailuresRef.current === 1) {
      const confirmationDelay = confirmationNotBeforeRef.current - Date.now();
      if (confirmationDelay > 0) {
        if (retryTimerRef.current === null) {
          retryTimerRef.current = window.setTimeout(() => {
            retryTimerRef.current = null;
            void checkServer();
          }, confirmationDelay);
        }
        return;
      }
    }

    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }

    const probeId = ++nextProbeIdRef.current;
    activeProbeIdRef.current = probeId;
    pendingVisibleProbeRef.current = false;
    setCheckingServer(true);

    try {
      const result = await probeServerHealth({
        baseURL: API_BASE_URL,
        timeoutMs: SERVER_HEALTH_PROBE_TIMEOUT_MS,
      }).catch(() => ({ available: false, status: undefined }));

      // A probe that began before the PWA was suspended must not change state
      // after a newer foreground probe has taken its place.
      if (activeProbeIdRef.current !== probeId) {
        return;
      }

      if (result.available) {
        consecutiveProbeFailuresRef.current = 0;
        confirmationNotBeforeRef.current = 0;
        lastCandidateStatusRef.current = undefined;

        if (serverDownRef.current) {
          serverDownRef.current = false;
          serverDownStatusRef.current = undefined;
          setServerDown(false);
          setServerDownStatus(undefined);
        }
        return;
      }

      if (serverDownRef.current) {
        if (result.status !== undefined && result.status !== serverDownStatusRef.current) {
          serverDownStatusRef.current = result.status;
          setServerDownStatus(result.status);
        }
        retryTimerRef.current = window.setTimeout(() => {
          retryTimerRef.current = null;
          void checkServer();
        }, SERVER_OUTAGE_RETRY_DELAY_MS);
        return;
      }

      if (result.status !== undefined) {
        lastCandidateStatusRef.current = result.status;
      }

      if (consecutiveProbeFailuresRef.current === 0) {
        consecutiveProbeFailuresRef.current = 1;
        confirmationNotBeforeRef.current = Date.now() + SERVER_FAILURE_CONFIRMATION_DELAY_MS;
        retryTimerRef.current = window.setTimeout(() => {
          retryTimerRef.current = null;
          void checkServer();
        }, SERVER_FAILURE_CONFIRMATION_DELAY_MS);
        return;
      }

      const confirmedStatus = result.status ?? lastCandidateStatusRef.current;
      consecutiveProbeFailuresRef.current = 0;
      confirmationNotBeforeRef.current = 0;
      serverDownRef.current = true;
      serverDownStatusRef.current = confirmedStatus;
      setServerDownStatus(confirmedStatus);
      setServerDown(true);
      retryTimerRef.current = window.setTimeout(() => {
        retryTimerRef.current = null;
        void checkServer();
      }, SERVER_OUTAGE_RETRY_DELAY_MS);
    } finally {
      if (activeProbeIdRef.current === probeId) {
        activeProbeIdRef.current = null;
        setCheckingServer(false);
      }
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
  }, [serverDown]);

  useEffect(() => {
    serverDownStatusRef.current = serverDownStatus;
  }, [serverDownStatus]);

  useEffect(() => {
    const handleAvailabilityCandidate = (event: Event) => {
      const detail = (event as CustomEvent<ServerAvailabilityCandidateDetail>).detail;
      lastCandidateStatusRef.current = detail?.status;

      if (document.visibilityState === "hidden") {
        pendingVisibleProbeRef.current = true;
        return;
      }

      // One failed application request is only evidence of a possible outage.
      // The native health probe confirms it independently before any overlay is shown.
      if (!serverDownRef.current) {
        void checkServer();
      }
    };

    const checkWhenVisible = () => {
      if (document.visibilityState === "hidden") {
        pendingVisibleProbeRef.current = true;
        return;
      }

      void checkServer();
    };

    const checkOnFocus = () => {
      if (document.visibilityState === "hidden") {
        pendingVisibleProbeRef.current = true;
        return;
      }

      if (pendingVisibleProbeRef.current || serverDownRef.current) {
        void checkServer();
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        // Invalidate a probe the OS may have suspended. It can still resolve, but
        // its result is ignored and it cannot block a fresh foreground check.
        activeProbeIdRef.current = null;
        nextProbeIdRef.current += 1;
        setCheckingServer(false);
        consecutiveProbeFailuresRef.current = 0;
        confirmationNotBeforeRef.current = 0;
        pendingVisibleProbeRef.current = true;
        if (retryTimerRef.current !== null) {
          window.clearTimeout(retryTimerRef.current);
          retryTimerRef.current = null;
        }
        return;
      }

      if (pendingVisibleProbeRef.current || serverDownRef.current) {
        pendingVisibleProbeRef.current = false;
      }
      void checkServer();
    };

    const handleOpenGame = () => {
      setShowMiniGame(true);
    };

    window.addEventListener(SERVER_AVAILABILITY_CANDIDATE_EVENT, handleAvailabilityCandidate as EventListener);
    window.addEventListener("online", checkWhenVisible);
    window.addEventListener("focus", checkOnFocus);
    window.addEventListener("pageshow", checkWhenVisible);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("omni-open-game", handleOpenGame as EventListener);
    return () => {
      window.removeEventListener(SERVER_AVAILABILITY_CANDIDATE_EVENT, handleAvailabilityCandidate as EventListener);
      window.removeEventListener("online", checkWhenVisible);
      window.removeEventListener("focus", checkOnFocus);
      window.removeEventListener("pageshow", checkWhenVisible);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("omni-open-game", handleOpenGame as EventListener);
      activeProbeIdRef.current = null;
      nextProbeIdRef.current += 1;
      if (retryTimerRef.current !== null) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, [checkServer]);

  useEffect(() => {
    if (!authenticated && !isReceiptAccessRoute) {
      dispatch(fetchSession());
    }
  }, [dispatch, authenticated, currentPage, isReceiptAccessRoute]);

  useEffect(() => {
    if (authenticated && !isReceiptAccessRoute && !accessLoaded && !accessLoading && !accessError) {
      dispatch(fetchAccessSnapshot());
    }
  }, [authenticated, isReceiptAccessRoute, accessLoaded, accessLoading, accessError, dispatch]);

  if (checkingSession && !isReceiptAccessRoute) {
    return (
      <Center style={{ height: "100vh" }}>
        <Loader variant="dots" />
      </Center>
    );
  }

  const handleRetryAccess = () => {
    dispatch(fetchAccessSnapshot());
  };

  const showOverlay = !isReceiptAccessRoute && (serverDown || showMiniGame);
  const overlayMode = serverDown ? "server-down" : "freeplay";

  return (
    <>
      {showOverlay && (
        <Suspense fallback={<FullscreenLoader />}>
          <ServerDownOverlay
            mode={overlayMode}
            status={serverDownStatus}
            onRetry={serverDown ? checkServer : undefined}
            isChecking={checkingServer}
            onClose={!serverDown ? () => setShowMiniGame(false) : undefined}
            isAuthenticated={authenticated}
          />
        </Suspense>
      )}
      {isReceiptAccessRoute ? (
        <Suspense fallback={<FullscreenLoader />}>
          <Routes />
        </Suspense>
      ) : authenticated ? (
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
            <Suspense fallback={<SectionLoader />}>
              <MainTabs
                hasSidebar={Boolean(rawNavbarSettings)}
                onSidebarToggle={toggleSidebar}
                sidebarOpened={sidebarOpened}
              />
            </Suspense>
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
                <Suspense fallback={<SectionLoader />}>
                  <NavBarRouter currentPage={currentPage} onNavigate={closeSidebar} />
                </Suspense>
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
              <Suspense fallback={<SectionLoader />}>
                <Routes />
              </Suspense>
            </Stack>
          </AppShell.Main>
          <Suspense fallback={null}>
            <RequiredActionsOverlay enabled={authenticated && !showOverlay} />
          </Suspense>
        </AppShell>
      ) : isPublicRoute ? (
        <Suspense fallback={<SectionLoader />}>
          <Routes />
        </Suspense>
      ) : (
        <Suspense fallback={<FullscreenLoader />}>
          <Login />
        </Suspense>
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
