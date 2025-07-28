import React, { useState, useEffect } from "react";
import { Drawer, Box, Divider, Text, rem, Input, Button } from "@mantine/core";
import {
  IconGridDots,
  IconChartLine,
  IconCalendar,
  IconUsers,
  IconCurrencyDollar,
  IconSearch,
  IconX,
} from "@tabler/icons-react";
import { ActiveNavLink } from "./ActiveNavLink";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import { setActiveKey } from "../../actions/reportsNavBarActiveKeyActions";

// Drawer section/reports types
interface DrawerSection {
  title: string;
  reports: string[];
}
interface SidebarOption {
  label: string;
  key: string;
  icon: React.ReactNode;
  onClick?: () => void;
  drawerSections?: DrawerSection[];
}

export function AppNavbarReports() {
  const [search, setSearch] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const activeKey = useAppSelector((state) => state.reportsNavBarActiveKey);
  
  const dispatch = useAppDispatch();
    useEffect(() => {
      dispatch(setActiveKey("GoogleReviews"));
    }, [dispatch]);

  // All sidebar options (one can have drawerSections)
  const sidebarOptions: SidebarOption[] = [
    {
      label: "Overview",
      key: "Overview",
      icon: <IconGridDots size={25} stroke={2} />,
      onClick: () => {
        dispatch(setActiveKey("Overview"));
        setDrawerOpen(false);
      },
    },
    {
      label: "Performance",
      key: "Performance",
      icon: <IconChartLine size={25} stroke={2} />,
      onClick: () => {
        dispatch(setActiveKey("Performance"));
        setDrawerOpen(true);
      },
      drawerSections: [
        {
          title: "Sales",
          reports: ["Sales by item", "Sales by user", "Sales by availability"],
        },
        {
          title: "Bookings",
          reports: [
            "Bookings by item",
            "Bookings by user",
            "Affiliates and agents",
            "FHDN bookings",
            "Combos",
          ],
        },
        {
          title: "Saved reports",
          reports: [
            "API Bookings",
            "QRBRUNCH",
            "Bookings per payment date and hour",
            "Numbers by Item by Month",
          ],
        },
      ],
    },
    {
      label: "Operations",
      key: "Operations",
      icon: <IconCalendar size={25} stroke={2} />,
      onClick: () => {
        dispatch(setActiveKey("Operations"));
        setDrawerOpen(false);
      },
    },
    {
      label: "Customers",
      key: "Customers",
      icon: <IconUsers size={25} stroke={2} />,
      onClick: () => {
        dispatch(setActiveKey("Customers"));
        setDrawerOpen(false);
      },
    },
    {
      label: "Accounting",
      key: "Accounting",
      icon: <IconCurrencyDollar size={25} stroke={2} />,
      onClick: () => {
        dispatch(setActiveKey("Accounting"));
        setDrawerOpen(false);
      },
    },
    {
      label: "Google Reviews",
      key: "Google Reviews",
      icon: <IconCurrencyDollar size={25} stroke={2} />,
      onClick: () => {
        dispatch(setActiveKey("GoogleReviews"));
        setDrawerOpen(false);
      },
    },
  ];

  // Should this sidebar option appear? (label OR drawer matches search)
  function sidebarOptionMatches(option: SidebarOption, search: string) {
    const lowerSearch = search.toLowerCase();
    if (option.label.toLowerCase().includes(lowerSearch)) return true;
    if (!option.drawerSections) return false;
    return option.drawerSections.some(
      (section) =>
        section.title.toLowerCase().includes(lowerSearch) ||
        section.reports.some((report) =>
          report.toLowerCase().includes(lowerSearch)
        )
    );
  }

  // Sidebar filtered
  const filteredSidebarOptions = sidebarOptions.filter((opt) =>
    sidebarOptionMatches(opt, search)
  );

  // Drawer: Only for active sidebar, filtered by search
  const activeSidebar = sidebarOptions.find((opt) => opt.key === activeKey);

  let filteredDrawerSections: DrawerSection[] = [];
  if (activeSidebar?.drawerSections) {
    filteredDrawerSections = activeSidebar.drawerSections
      .map((section) => {
        const filteredReports = section.reports.filter((report) =>
          report.toLowerCase().includes(search.toLowerCase())
        );
        return filteredReports.length > 0
          ? { ...section, reports: filteredReports }
          : null;
      })
      .filter((section): section is DrawerSection => !!section);
  }

  // Effect: auto-close drawer if nothing matches
  useEffect(() => {
    if (
      !activeSidebar?.drawerSections ||
      filteredDrawerSections.length === 0 ||
      !filteredSidebarOptions.some((opt) => opt.key === activeKey)
    ) {
      setDrawerOpen(false);
    } else if (
      activeSidebar.drawerSections &&
      filteredDrawerSections.length > 0 &&
      activeKey === activeSidebar.key
    ) {
      // Only open if Performance is selected and there are results
      setDrawerOpen(true);
    }
    // eslint-disable-next-line
  }, [search, activeKey]); // Run on search or nav changes

  return (
    <Box p="sm" pt={rem(25)} style={{ position: "relative", height: "100%" }}>
      {/* Search bar at top */}
      <Input
        leftSection={<IconSearch size={18} />}
        placeholder="Search"
        value={search}
        onChange={(e) => setSearch(e.currentTarget.value)}
        size="sm"
        mb={16}
        radius={8}
        styles={{
          input: {
            background: "#fff",
            fontSize: 15,
            border: "1px solid #a5abb6",
          },
        }}
      />

      {/* Sidebar navigation */}
      {filteredSidebarOptions.map((option) => (
        <ActiveNavLink
          key={option.key}
          icon={option.icon}
          label={option.label}
          active={activeKey === option.key}
          onClick={option.onClick}
        />
      ))}

      {/* Drawer for the currently active sidebar's sections */}
      <Drawer
        opened={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title=""
        offset="44px 241px"
        position="left"
        closeOnEscape={true}
        withCloseButton={false}
        trapFocus={false}
        returnFocus={false}
        size={240}
        closeOnClickOutside={false}
        transitionProps={{
          transition: "scale-x",
          duration: 100,
          timingFunction: "linear",
        }}
        overlayProps={{ backgroundOpacity: 0.03, zIndex: 0 }}
      >
        <Button
          variant="subtle"
          size="xs"
          style={{
            position: "absolute",
            top: 12,
            right: 12,
            zIndex: 1,
            color: "#333",
            minWidth: 30,
            height: 30,
            padding: 0,
            borderRadius: "50%",
            background: "transparent",
          }}
          onClick={() => setDrawerOpen(false)}
        >
          <IconX size={18} />
        </Button>
        <Box>
          {filteredDrawerSections.map((section, idx) => (
            <Box
              key={section.title}
              mb={idx === filteredDrawerSections.length - 1 ? 0 : 18}
            >
              <Text fw={700} fz={15} mb={10}>
                {section.title}
              </Text>
              {section.reports.map((report, rIdx) => (
                <Text
                  key={report}
                  component="a"
                  href="#"
                  fz={15}
                  mb={rIdx === section.reports.length - 1 ? 0 : 6}
                  style={{
                    display: "block",
                    color: "#222",
                    fontWeight: 400,
                    lineHeight: "22px",
                  }}
                >
                  {report}
                </Text>
              ))}
              {idx < filteredDrawerSections.length - 1 && <Divider my={18} />}
            </Box>
          ))}
        </Box>
      </Drawer>
    </Box>
  );
}
