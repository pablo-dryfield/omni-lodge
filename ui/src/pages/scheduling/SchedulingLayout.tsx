import { useEffect, useMemo } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { Card, Container, Tabs } from "@mantine/core";
import dayjs from "dayjs";
import isoWeek from "dayjs/plugin/isoWeek";
import {
  IconCalendarCheck,
  IconClipboardList,
  IconHistory,
  IconLayoutGrid,
  IconRefresh,
  IconTemplate,
  IconUsersGroup,
} from "@tabler/icons-react";
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
      { label: "Availability", value: "availability", icon: IconCalendarCheck },
      { label: "Builder", value: "builder", icon: IconClipboardList },
      { label: "Schedule", value: "schedule", icon: IconLayoutGrid },
      { label: "My Shifts", value: "my-shifts", icon: IconUsersGroup },
      { label: "Swaps", value: "swaps", icon: IconRefresh },
      { label: "History", value: "history", icon: IconHistory },
    ];
    if (canManageTemplates) {
      base.splice(1, 0, { label: "Templates", value: "templates", icon: IconTemplate });
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
      <Card withBorder shadow="sm" radius="md" p="md">
        <Tabs
          value={activeTab}
          onChange={(value) => value && navigate(`/scheduling/${value}`)}
          keepMounted={false}
          variant="pills"
          radius="md"
          defaultValue={schedulingTabs[0]?.value}
        >
          <Tabs.List
            style={{
              justifyContent: "center",
              gap: "0.5rem",
              flexWrap: "wrap",
            }}
          >
            {schedulingTabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <Tabs.Tab
                  key={tab.value}
                  value={tab.value}
                  leftSection={<Icon size={16} />}
                  style={{
                    fontWeight: 600,
                    textTransform: "none",
                    paddingInline: "1.25rem",
                  }}
                >
                  {tab.label}
                </Tabs.Tab>
              );
            })}
          </Tabs.List>
        </Tabs>
      </Card>
      <Outlet />
    </Container>
  );
};

export default SchedulingLayout;
