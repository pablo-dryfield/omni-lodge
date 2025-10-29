import { useEffect, useMemo } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { Container, Tabs } from "@mantine/core";
import dayjs from "dayjs";
import isoWeek from "dayjs/plugin/isoWeek";
import { useAppSelector } from "../../store/hooks";
import { makeSelectIsModuleActionAllowed } from "../../selectors/accessControlSelectors";

dayjs.extend(isoWeek);

const SchedulingLayout = () => {
  const location = useLocation();
  const navigate = useNavigate();

  const selectCanManageTemplates = useMemo(
    () => makeSelectIsModuleActionAllowed("scheduling-builder", "create"),
    [],
  );
  const canManageTemplates = useAppSelector(selectCanManageTemplates);

  const schedulingTabs = useMemo(() => {
    const base = [
      { label: "Availability", value: "availability" },
      { label: "Builder", value: "builder" },
      { label: "My Shifts", value: "my-shifts" },
      { label: "Swaps", value: "swaps" },
      { label: "History", value: "history" },
    ];
    if (canManageTemplates) {
      base.splice(1, 0, { label: "Templates", value: "templates" });
    }
    return base;
  }, [canManageTemplates]);

  const activeTab = useMemo(() => {
    const segments = location.pathname.split("/").filter(Boolean);
    if (segments.length < 2) {
      return schedulingTabs[0]?.value ?? "availability";
    }
    return segments[1] ?? schedulingTabs[0]?.value ?? "availability";
  }, [location.pathname, schedulingTabs]);

  useEffect(() => {
    if (location.pathname === "/scheduling") {
      const fallback = schedulingTabs[0]?.value ?? "availability";
      navigate(`/scheduling/${fallback}`, { replace: true });
    }
  }, [location.pathname, navigate, schedulingTabs]);

  return (
    <Container size="xl" pb="xl">
      <Tabs
        value={activeTab}
        onChange={(value) => value && navigate(`/scheduling/${value}`)}
        keepMounted={false}
        variant="outline"
      >
        <Tabs.List style={{ justifyContent: "center" }}>
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
