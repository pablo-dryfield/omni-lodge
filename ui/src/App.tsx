import React, { useEffect } from "react";
import { BrowserRouter } from "react-router-dom";
import { AppShell, Center, Loader, Alert, Button, Stack, Text } from "@mantine/core";
import MainTabs from "./components/main/MainTabs";
import Routes from "./components/main/Routes"; // your route switch
import Login from "./pages/Login";
import { useAppDispatch, useAppSelector } from "./store/hooks";
import { fetchSession } from "./actions/sessionActions";
import { fetchAccessSnapshot } from "./actions/accessControlActions";
import { getNavbarSettings } from "./utils/getNavbarSettings";
import { NavBarRouter } from "./components/main/NavBarRouter";

const App = () => {
  const { authenticated, checkingSession } = useAppSelector((state) => state.session);
  const { currentPage } = useAppSelector((state) => state.navigation);
  const {
    loaded: accessLoaded,
    loading: accessLoading,
    error: accessError,
  } = useAppSelector((state) => state.accessControl);
  const dispatch = useAppDispatch();

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
    <BrowserRouter>
      {authenticated ? (
        <AppShell
          header={{ height: 40 }}
          navbar={getNavbarSettings(currentPage)}
          padding="md"
          styles={{
            main: {
              backgroundColor: "#f4f4f7",
              minHeight: "100vh",
            },
          }}
        >
          <AppShell.Header>
            <MainTabs />
          </AppShell.Header>
          <AppShell.Navbar
            style={{
              boxShadow: "2px 0 35px -2px rgba(60, 60, 60, 0.07)",
              zIndex: 12,
            }}
          >
            <NavBarRouter currentPage={currentPage} />
          </AppShell.Navbar>
          <AppShell.Main>
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
          </AppShell.Main>
        </AppShell>
      ) : (
        <Login />
      )}
    </BrowserRouter>
  );
};

export default App;
