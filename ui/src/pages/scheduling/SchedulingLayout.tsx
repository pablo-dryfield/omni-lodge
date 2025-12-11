import { useEffect, useMemo } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { Card, Container, Tabs } from "@mantine/core";
import {
  IconCalendarCheck,
  IconClipboardList,
  IconHistory,
  IconLayoutGrid,
  IconRefresh,
  IconTemplate,
  IconUsersGroup,
} from "@tabler/icons-react";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import {
  makeSelectIsModuleActionAllowed,
  selectModulePermissionsMap,
} from "../../selectors/accessControlSelectors";
import { navigateToPage } from "../../actions/navigationActions";

type SchedulingTabDefinition = {
  label: string;
  value: string;
  icon: typeof IconCalendarCheck;
  module?: string;
  requiredAction?: string;
};

const BASE_TABS: SchedulingTabDefinition[] = [
  { label: "Schedule", value: "schedule", icon: IconLayoutGrid, module: "scheduling-builder" },
  { label: "Builder", value: "builder", icon: IconClipboardList, module: "scheduling-builder", requiredAction: "create" },
  { label: "Availability", value: "availability", icon: IconCalendarCheck, module: "scheduling-availability" },
  { label: "My Shifts", value: "my-shifts", icon: IconUsersGroup, module: "scheduling-my-shifts" },
  { label: "Swaps", value: "swaps", icon: IconRefresh, module: "scheduling-swaps" },
  { label: "History", value: "history", icon: IconHistory, module: "scheduling-history" },
];

const SchedulingLayout = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const modulePermissions = useAppSelector(selectModulePermissionsMap);
  const selectCanManageTemplates = useMemo(
    () => makeSelectIsModuleActionAllowed("scheduling-builder", "create"),
    [],
  );
  const canManageTemplates = useAppSelector(selectCanManageTemplates);

  const availableTabs = useMemo(() => {
    const hasAction = (moduleSlug: string | undefined, action = "view") => {
      if (!moduleSlug) {
        return true;
      }
      const actions = modulePermissions.get(moduleSlug);
      return actions?.has(action) ?? false;
    };

    const tabs = BASE_TABS.filter((tab) => hasAction(tab.module, tab.requiredAction ?? "view"));

    if (canManageTemplates && hasAction("scheduling-builder", "create")) {
      const builderIndex = tabs.findIndex((tab) => tab.value === "builder");
      const insertIndex = builderIndex >= 0 ? builderIndex + 1 : 1;
      tabs.splice(insertIndex, 0, {
        label: "Templates",
        value: "templates",
        icon: IconTemplate,
        module: "scheduling-builder",
        requiredAction: "create",
      });
    }

    return tabs;
  }, [modulePermissions, canManageTemplates]);

  const activeTab = useMemo(() => {
    const segments = location.pathname.split("/").filter(Boolean);
    const current = segments.length >= 2 ? segments[1] : null;
    const allowedValues = new Set(availableTabs.map((tab) => tab.value));
    if (current && allowedValues.has(current)) {
      return current;
    }
    return availableTabs[0]?.value ?? null;
  }, [location.pathname, availableTabs]);

  useEffect(() => {
    if (location.pathname === "/scheduling") {
      const fallback = availableTabs[0]?.value;
      if (fallback) {
        navigate(`/scheduling/${fallback}`, { replace: true });
      }
    }
  }, [location.pathname, navigate, availableTabs]);

  useEffect(() => {
    if (!activeTab && availableTabs[0]) {
      navigate(`/scheduling/${availableTabs[0].value}`, { replace: true });
    }
  }, [activeTab, availableTabs, navigate]);

  useEffect(() => {
    dispatch(navigateToPage("Scheduling"));
  }, [dispatch]);

  if (!availableTabs.length) {
    return (
      <Container size="xl" pb="xl">
        <Card withBorder shadow="sm" radius="md" p="md">
          <Tabs value={null} keepMounted={false} variant="pills" radius="md">
            <Tabs.List>{null}</Tabs.List>
          </Tabs>
        </Card>
        <Outlet />
      </Container>
    );
  }

  return (
    <Container size="xl" pb="xl">
      <Card withBorder shadow="sm" radius="md" p="md">
        <Tabs
          value={activeTab ?? availableTabs[0].value}
          onChange={(value) => value && navigate(`/scheduling/${value}`)}
          keepMounted={false}
          variant="pills"
          radius="md"
          defaultValue={availableTabs[0].value}
        >
          <Tabs.List
            style={{
              justifyContent: "center",
              gap: "0.5rem",
              flexWrap: "wrap",
            }}
          >
            {availableTabs.map((tab) => {
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
