import React, { useEffect } from "react";
import { BrowserRouter } from "react-router-dom";
import { AppShell, Center, Loader } from "@mantine/core";
import MainTabs from "./components/main/MainTabs";
import Routes from "./components/main/Routes"; // your route switch
import Login from "./pages/Login";
import { useAppDispatch, useAppSelector } from "./store/hooks";
import { fetchSession } from "./actions/sessionActions";
import { getNavbarSettings } from "./utils/getNavbarSettings";
import { NavBarRouter } from "./components/main/NavBarRouter";

const App = () => {
  const { authenticated, checkingSession } = useAppSelector((state) => state.session);
  const { currentPage } = useAppSelector((state) => state.navigation);
  const dispatch = useAppDispatch();

  useEffect(() => {
    if (!authenticated) {
      dispatch(fetchSession());
    }
  }, [dispatch, authenticated, currentPage]);

  if (checkingSession) {
    return (
      <Center style={{ height: "100vh" }}>
        <Loader variant="dots" />
      </Center>
    );
  }

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
        <AppShell.Navbar style={{
          boxShadow: "2px 0 35px -2px rgba(60, 60, 60, 0.07)",
          zIndex: 12,
        }}>
          <NavBarRouter currentPage={currentPage} />
        </AppShell.Navbar>
        <AppShell.Main>
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
