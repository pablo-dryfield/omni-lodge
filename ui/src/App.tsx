import React, { useEffect, useMemo } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
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

const queryClient = new QueryClient();

const App = () => {
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

  const rawNavbarSettings = useMemo(() => getNavbarSettings(currentPage), [currentPage]);
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

  useEffect(() => {
    if (!isMobile) {
      closeSidebar();
    }
  }, [isMobile, closeSidebar]);

  useEffect(() => {
    closeSidebar();
  }, [currentPage, closeSidebar]);

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
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
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
      </BrowserRouter>
    </QueryClientProvider>
  );
};

export default App;
