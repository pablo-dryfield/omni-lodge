import React, { useMemo } from "react";
import { Stack, Title, Text, SimpleGrid, Card, ActionIcon, Alert } from "@mantine/core";
import { IconLayoutSidebarLeftExpand, IconDevicesCode } from "@tabler/icons-react";
import { useNavigate } from "react-router-dom";
import { useAppSelector } from "../../store/hooks";
import { selectAllowedPageSlugs } from "../../selectors/accessControlSelectors";
import { PageAccessGuard } from "../../components/access/PageAccessGuard";
import { PAGE_SLUGS } from "../../constants/pageSlugs";

type PermissionCard = {
  label: string;
  description: string;
  icon: React.ComponentType<{ size?: number }>;
  to: string;
  pageSlug: string;
};

const permissionCards: PermissionCard[] = [
  {
    label: "Page Permissions",
    description: "Set which user types can access each page in the app shell.",
    icon: IconLayoutSidebarLeftExpand,
    to: "/settings/permissions/pages",
    pageSlug: PAGE_SLUGS.settingsPagePermissions,
  },
  {
    label: "Module Permissions",
    description: "Grant granular CRUD rights for modules inside a page.",
    icon: IconDevicesCode,
    to: "/settings/permissions/modules",
    pageSlug: PAGE_SLUGS.settingsModulePermissions,
  },
];

const PAGE_SLUG = PAGE_SLUGS.settingsPermissions;

const SettingsPermissions = () => {
  const navigate = useNavigate();
  const allowedPageSlugs = useAppSelector(selectAllowedPageSlugs);

  const visibleCards = useMemo(
    () => permissionCards.filter((card) => allowedPageSlugs.has(card.pageSlug)),
    [allowedPageSlugs],
  );

  return (
    <PageAccessGuard pageSlug={PAGE_SLUG}>
      <Stack gap="lg">
        <div>
          <Title order={3}>Permissions</Title>
          <Text size="sm" c="dimmed">
            Coordinate access rules between pages, modules, and user types.
          </Text>
        </div>
        {visibleCards.length === 0 ? (
          <Alert color="yellow" title="No accessible permission tools">
            You currently do not have access to manage permissions.
          </Alert>
        ) : (
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="lg">
            {visibleCards.map(({ label, description, icon: Icon, to }) => (
              <Card
                key={label}
                withBorder
                radius="md"
                padding="lg"
                style={{ cursor: "pointer" }}
                onClick={() => navigate(to)}
              >
                <Stack gap="xs">
                  <ActionIcon variant="light" color="indigo" size="lg" aria-label={label}>
                    <Icon size={22} />
                  </ActionIcon>
                  <Title order={4}>{label}</Title>
                  <Text size="sm" c="dimmed">
                    {description}
                  </Text>
                </Stack>
              </Card>
            ))}
          </SimpleGrid>
        )}
      </Stack>
    </PageAccessGuard>
  );
};

export default SettingsPermissions;