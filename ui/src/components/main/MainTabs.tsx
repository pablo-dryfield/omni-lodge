import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Tabs,
  Menu,
  Button,
  Group,
  Text,
  ActionIcon,
  Box,
  rem,
} from "@mantine/core";
import { IconMenu2, IconLogout } from "@tabler/icons-react";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import { logoutUser } from "../../actions/userActions";
import { selectAllowedNavigationPages } from "../../selectors/accessControlSelectors";

const MainTabs = () => {
  const dispatch = useAppDispatch();
  const allowedPages = useAppSelector(selectAllowedNavigationPages);
  const { currentPage } = useAppSelector((state) => state.navigation);
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpened, setMenuOpened] = useState(false);

  const [showMobileMenu, setShowMobileMenu] = useState(window.innerWidth <= 600);
  useEffect(() => {
    const handleResize = () => setShowMobileMenu(window.innerWidth <= 600);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const handleSignOut = () => {
    document.cookie = "token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
    dispatch(logoutUser());
    window.location.href = "/";
  };

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

  return (
    <div
      style={{
        background: "#333",
        padding: "0 28px",
        minHeight: 40,
        boxShadow: "none",
        display: "flex",
        alignItems: "center",
        position: "sticky",
        top: 0,
        zIndex: 1100,
      }}
    >
      <Group align="center" style={{ width: "100%" }} gap={0}>
        {/* Brand / System Name */}
        <Text
          fw={700}
          size="lg"
          component="span"
          style={{
            textDecoration: "none",
            color: "white",
            marginRight: rem(30),
            letterSpacing: ".04em",
            fontFamily: "inherit",
          }}
        >
          OmniLodge
        </Text>

        {/* TABS or MENU */}
        {showMobileMenu ? (
          <Menu
            opened={menuOpened}
            onChange={setMenuOpened}
            withinPortal
            withArrow
            shadow="md"
            position="bottom-start"
          >
            <Menu.Target>
              <Button
                variant="subtle"
                size="md"
                px={14}
                style={{ color: "white", fontWeight: 600, background: "transparent" }}
                leftSection={<IconMenu2 size={20} color="white" />}
                disabled={allowedPages.length === 0}
              >
                Menu
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              {allowedPages.map((page) => (
                <Menu.Item
                  key={page.name}
                  onClick={() => {
                    navigate(page.path);
                    setMenuOpened(false);
                  }}
                  style={{
                    fontWeight: 500,
                    fontSize: 15,
                  }}
                >
                  {page.name}
                </Menu.Item>
              ))}
            </Menu.Dropdown>
          </Menu>
        ) : (
          <Tabs
            value={activeTab ?? null}
            onChange={(val) => val && navigate(val)}
            variant="pills"
            radius="xs"
            styles={{
              root: { background: "none" },
              list: {
                background: "none",
                marginLeft: 8,
                marginBottom: 0,
                minHeight: 44,
                gap: 2,
                borderBottom: "none",
                alignItems: "center",
              },
              tab: {
                color: "white",
                fontWeight: 700,
                fontSize: 17,
                height: 40,
                minWidth: 110,
                margin: 0,
                cursor: "pointer",
                background: "transparent",
                borderRadius: 8,
                transition: "background 0.14s, color 0.14s, border 0.14s",
                border: "none",
                '&[data-active]': {
                  background: "#222",
                  color: "#fff",
                  boxShadow: "none",
                  border: "none",
                },
                "&:hover": {
                  background: "#444",
                  color: "#fff",
                },
                "&:active": {
                  background: "#111",
                  color: "#fff",
                },
              },
            }}
          >
            <Tabs.List>
              {allowedPages.map((page) => (
                <Tabs.Tab value={page.path} key={page.name}>
                  {page.name}
                </Tabs.Tab>
              ))}
            </Tabs.List>
          </Tabs>
        )}

        {/* Spacer */}
        <Box style={{ marginLeft: "auto" }} />

        {/* Logout */}
        <ActionIcon
          variant="subtle"
          color="gray"
          size={36}
          onClick={handleSignOut}
          style={{ marginLeft: 12 }}
        >
          <IconLogout size={23} color="white" />
        </ActionIcon>
      </Group>
    </div>
  );
};

export default MainTabs;
