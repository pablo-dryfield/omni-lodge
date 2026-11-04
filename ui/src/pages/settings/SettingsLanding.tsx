import React, { useMemo, useState } from "react";
import {
  SimpleGrid,
  Card,
  Stack,
  Title,
  Text,
  ActionIcon,
  Alert,
  Button,
  Modal,
  ScrollArea,
  Code,
} from "@mantine/core";
import {
  IconUsers,
  IconIdBadge,
  IconShieldLock,
  IconAddressBook,
  IconHierarchy3,
  IconUserCog,
  IconLayoutDashboard,
  IconStars,
  IconCoin,
  IconRefresh,
  IconSettings,
  IconTools,
  IconCalendarEvent,
  IconTag,
  IconBrandGoogle,
  IconMail,
  IconBrandWhatsapp,
  IconCurrencyEuro,
} from "@tabler/icons-react";
import { useNavigate } from "react-router-dom";
import axiosInstance from "../../utils/axiosInstance";
import { useAppSelector } from "../../store/hooks";
import { selectAllowedPageSlugs } from "../../selectors/accessControlSelectors";
import { PageAccessGuard } from "../../components/access/PageAccessGuard";
import { PAGE_SLUGS } from "../../constants/pageSlugs";
import { clearCachedAppFilesAndReload } from "../../utils/refreshApp";

type SettingsSection = {
  label: string;
  description: string;
  icon: React.ComponentType<{ size?: number | string }>;
  to: string;
  pageSlug: string;
};

const sections: SettingsSection[] = [
  {label:"System Management",description:"Open SSH terminals, manage server files, and review service activity.",icon:IconTools,to:"/settings/system-management",pageSlug:PAGE_SLUGS.settingsSystemManagement},
  { label: 'Products', description: 'Manage your experiences and their storefront settings.', icon: IconTag,
    to: '/settings/products', pageSlug: PAGE_SLUGS.settingsProducts },
  { label: 'Product Prices', description: 'Manage currency prices for your products.', icon: IconCurrencyEuro,
    to: '/settings/product-prices', pageSlug: PAGE_SLUGS.settingsProductPrices },
  { label: 'Product Add-Ons', description: 'Manage add-on availability and price overrides for your products.', icon: IconTag,
    to: '/settings/product-addons', pageSlug: PAGE_SLUGS.settingsProductAddons },
  {
    label: "Users",
    description: "Invite, deactivate, and reset access for platform members.",
    icon: IconUsers,
    to: "/settings/users",
    pageSlug: PAGE_SLUGS.settingsUsers,
  },
  {
    label: "Control Panel",
    description: "Manage dynamic configuration values and secrets.",
    icon: IconSettings,
    to: "/settings/control-panel",
    pageSlug: PAGE_SLUGS.settingsControlPanel,
  },
  {
    label: "WhatsApp Business",
    description: "Connect the WhatsApp Business app to the private morning brief.",
    icon: IconBrandWhatsapp,
    to: "/settings/whatsapp",
    pageSlug: PAGE_SLUGS.settingsControlPanel,
  },
  {
    label: "Email Previews",
    description: "Review every booking email layout with safe mocked information.",
    icon: IconMail,
    to: "/settings/email-previews",
    pageSlug: PAGE_SLUGS.settingsControlPanel,
  },
  {
    label: "Maintenance",
    description: "Monitor migrations, seed runs, and configuration health.",
    icon: IconTools,
    to: "/settings/maintenance",
    pageSlug: PAGE_SLUGS.settingsMaintenance,
  },
  {
    label: "Staff Profiles",
    description: "Track staff classifications and accommodation status.",
    icon: IconAddressBook,
    to: "/settings/staff-profiles",
    pageSlug: PAGE_SLUGS.settingsStaffProfiles,
  },
  {
    label: "Shift Roles",
    description: "Manage the roles available for scheduling.",
    icon: IconHierarchy3,
    to: "/settings/shift-roles",
    pageSlug: PAGE_SLUGS.settingsShiftRoles,
  },
  {
    label: "Shift Types",
    description: "Map shift types to products for counters.",
    icon: IconCalendarEvent,
    to: "/settings/shift-types",
    pageSlug: PAGE_SLUGS.settingsShiftTypes,
  },
  {
    label: "Product Aliases",
    description: "Map incoming booking labels to products.",
    icon: IconTag,
    to: "/settings/product-aliases",
    pageSlug: PAGE_SLUGS.settingsProductAliases,
  },
  {
    label: "Currencies",
    description: "Manage exchange rates used for manual transfer bookings and product prices.",
    icon: IconCurrencyEuro,
    to: "/settings/currencies",
    pageSlug: PAGE_SLUGS.settingsProductPrices,
  },
  {
    label: "User Shift Roles",
    description: "Assign shift roles to team members.",
    icon: IconUserCog,
    to: "/settings/user-shift-roles",
    pageSlug: PAGE_SLUGS.settingsUserShiftRoles,
  },
  {
    label: "Review Platforms",
    description: "Define and manage review platforms used across the system.",
    icon: IconStars,
    to: "/settings/review-platforms",
    pageSlug: PAGE_SLUGS.settingsReviewPlatforms,
  },
  {
    label: "Google API",
    description: "Inspect OAuth credentials and currently granted Google scopes.",
    icon: IconBrandGoogle,
    to: "/settings/google-api",
    pageSlug: PAGE_SLUGS.settingsGoogleApi,
  },
  {
    label: "Compensation Components",
    description: "Configure salary, commission, and incentive components plus assignments.",
    icon: IconCoin,
    to: "/settings/compensation-components",
    pageSlug: PAGE_SLUGS.settingsCompensationComponents,
  },
  {
    label: "Home Experience",
    description: "Assign each user to navigation or dashboard-first home modules.",
    icon: IconLayoutDashboard,
    to: "/settings/home-experience",
    pageSlug: PAGE_SLUGS.settingsHomeExperience,
  },
  {
    label: "User Types",
    description: "Define roles that bundle permissions and navigation.",
    icon: IconIdBadge,
    to: "/settings/user-types",
    pageSlug: PAGE_SLUGS.settingsUserTypes,
  },
  {
    label: "Access Control",
    description: "Manage pages, modules, and role permissions from one workspace.",
    icon: IconShieldLock,
    to: "/settings/permissions",
    pageSlug: PAGE_SLUGS.settingsPermissions,
  },
];

const PAGE_SLUG = PAGE_SLUGS.settings;

const compareString = (value?: string | null) => value ?? "";

const extractErrorMessage = (error: unknown): string => {
  if (typeof error === "object" && error !== null) {
    const maybeResponse = (error as { response?: { data?: unknown } }).response;
    if (maybeResponse?.data) {
      const { data } = maybeResponse;
      if (typeof data === "string") {
        return data;
      }
      if (Array.isArray(data) && data.length > 0) {
        const first = data[0];
        if (first && typeof first === "object" && "message" in first && typeof first.message === "string") {
          return first.message;
        }
      }
      if (typeof (data as { message?: unknown }).message === "string") {
        return (data as { message: string }).message;
      }
    }
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Unexpected error occurred";
};

const SettingsLanding = () => {
  const navigate = useNavigate();
  const allowedPageSlugs = useAppSelector(selectAllowedPageSlugs);
  const productScoped = useAppSelector(state => (state.accessControl.productTypeIds?.length ?? 0) > 0);
  const { roleSlug } = useAppSelector((state) => state.session);
  const [refreshing, setRefreshing] = useState(false);
  const [gygTestOpened, setGygTestOpened] = useState(false);
  const [gygTestLoading, setGygTestLoading] = useState(false);
  const [gygTestError, setGygTestError] = useState<string | null>(null);
  const [gygTestRequestJson, setGygTestRequestJson] = useState<string>("");
  const [gygTestResponseJson, setGygTestResponseJson] = useState<string>("");
  const canRunGygSelfTest = ["admin", "owner", "manager"].includes(compareString(roleSlug).toLowerCase());

  const visibleSections = useMemo(
    () => sections.filter((section) => allowedPageSlugs.has(section.pageSlug) && (!productScoped || section.to !== '/settings/currencies')),
    [allowedPageSlugs, productScoped],
  );

  const handleRefreshApp = async () => {
    if (refreshing) {
      return;
    }
    const confirmed = window.confirm(
      "This will clear cached app files and reload. Continue?",
    );
    if (!confirmed) {
      return;
    }
    setRefreshing(true);
    await clearCachedAppFilesAndReload();
  };

  const handleRunGygSelfTest = async () => {
    if (!canRunGygSelfTest) {
      return;
    }

    const requestBody = {
      includeAdditionalEndpoints: false,
    };

    setGygTestOpened(true);
    setGygTestLoading(true);
    setGygTestError(null);
    setGygTestRequestJson(JSON.stringify(requestBody, null, 2));
    setGygTestResponseJson("");

    try {
      const response = await axiosInstance.post("/gyg/outbound/self-test", requestBody);
      setGygTestResponseJson(JSON.stringify(response.data, null, 2));
    } catch (error) {
      const responseData = (error as { response?: { data?: unknown } }).response?.data;
      setGygTestResponseJson(
        responseData !== undefined ? JSON.stringify(responseData, null, 2) : JSON.stringify({ error: extractErrorMessage(error) }, null, 2),
      );
      setGygTestError(extractErrorMessage(error));
    } finally {
      setGygTestLoading(false);
    }
  };

  if (visibleSections.length === 0) {
    return (
      <PageAccessGuard pageSlug={PAGE_SLUG}>
        <Alert color="yellow" title="No accessible sections">
          Your role does not currently have access to any Settings areas. Reach out to your administrator if you
          believe this is an error.
        </Alert>
      </PageAccessGuard>
    );
  }

  return (
    <PageAccessGuard pageSlug={PAGE_SLUG}>
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="lg">
        {visibleSections.map(({ label, description, icon: Icon, to }) => (
          <Card
            key={label}
            withBorder
            radius="md"
            padding="lg"
            style={{ cursor: "pointer" }}
            onClick={() => navigate(to)}
          >
            <Stack gap="xs">
              <ActionIcon variant="light" color="blue" size="lg" aria-label={label}>
                <Icon size={22} />
              </ActionIcon>
              <Title order={4}>{label}</Title>
              <Text size="sm" c="dimmed">
                {description}
              </Text>
            </Stack>
          </Card>
        ))}
        <Card withBorder radius="md" padding="lg">
          <Stack gap="xs">
            <ActionIcon variant="light" color="orange" size="lg" aria-label="Refresh app">
              <IconRefresh size={22} />
            </ActionIcon>
            <Title order={4}>Refresh app</Title>
            <Text size="sm" c="dimmed">
              Clear cached files and reload to fetch the latest version.
            </Text>
            <Button
              variant="light"
              color="orange"
              onClick={handleRefreshApp}
              loading={refreshing}
            >
              Refresh now
            </Button>
          </Stack>
        </Card>
        {canRunGygSelfTest && (
          <Card withBorder radius="md" padding="lg">
            <Stack gap="xs">
              <ActionIcon variant="light" color="grape" size="lg" aria-label="GetYourGuide self-test">
                <IconRefresh size={22} />
              </ActionIcon>
              <Title order={4}>GetYourGuide</Title>
              <Text size="sm" c="dimmed">
                Run the outbound GetYourGuide self-test and review the request and response payloads.
              </Text>
              <Button variant="light" color="grape" onClick={handleRunGygSelfTest} loading={gygTestLoading}>
                Run self-test
              </Button>
            </Stack>
          </Card>
        )}
      </SimpleGrid>

      <Modal
        opened={gygTestOpened}
        onClose={() => setGygTestOpened(false)}
        title="GetYourGuide self-test"
        centered
        size="xl"
      >
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            Request JSON
          </Text>
          <ScrollArea h={140} type="always">
            <Code block>{gygTestRequestJson || "{}"}</Code>
          </ScrollArea>
          <Text size="sm" c="dimmed">
            Response JSON
          </Text>
          {gygTestError ? (
            <Alert color="red" title="Self-test error">
              {gygTestError}
            </Alert>
          ) : null}
          <ScrollArea h={320} type="always">
            <Code block>{gygTestLoading ? "Running self-test..." : gygTestResponseJson || "No response yet."}</Code>
          </ScrollArea>
          <Button
            variant="default"
            onClick={handleRunGygSelfTest}
            loading={gygTestLoading}
            disabled={gygTestLoading || !canRunGygSelfTest}
          >
            Run again
          </Button>
        </Stack>
      </Modal>
    </PageAccessGuard>
  );
};

export default SettingsLanding;
