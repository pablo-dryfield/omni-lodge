import { useEffect, useMemo } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { Container, Tabs } from "@mantine/core";
import dayjs from "dayjs";
import isoWeek from "dayjs/plugin/isoWeek";

dayjs.extend(isoWeek);

const schedulingTabs = [
  { label: "Availability", value: "availability" },
  { label: "Builder", value: "builder" },
  { label: "My Shifts", value: "my-shifts" },
  { label: "Swaps", value: "swaps" },
  { label: "History", value: "history" },
];

const SchedulingLayout = () => {
  const location = useLocation();
  const navigate = useNavigate();

  const activeTab = useMemo(() => {
    const segments = location.pathname.split("/").filter(Boolean);
    if (segments.length < 2) {
      return "availability";
    }
    return segments[1] ?? "availability";
  }, [location.pathname]);

  useEffect(() => {
    if (location.pathname === "/scheduling") {
      navigate("/scheduling/availability", { replace: true });
    }
  }, [location.pathname, navigate]);

  return (
    <Container size="xl" pb="xl">
      <Tabs
        value={activeTab}
        onChange={(value) => value && navigate(`/scheduling/${value}`)}
        keepMounted={false}
        variant="outline"
      >
        <Tabs.List>
          {schedulingTabs.map((tab) => (
            <Tabs.Tab key={tab.value} value={tab.value}>
              {tab.label}
            </Tabs.Tab>
          ))}
        </Tabs.List>
      </Tabs>
      <Outlet />
    </Container>
  );
};

export default SchedulingLayout;
