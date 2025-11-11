import React, { useMemo } from "react";
import { SimpleGrid, Card, Stack, Title, Text, ActionIcon, Alert } from "@mantine/core";
import {
  IconUsers,
  IconIdBadge,
  IconLayoutSidebar,
  IconComponents,
  IconShieldLock,
  IconAddressBook,
  IconHierarchy3,
  IconUserCog,
  IconLayoutDashboard,
  IconStars,
  IconCoin,
} from "@tabler/icons-react";
import { useNavigate } from "react-router-dom";
import { useAppSelector } from "../../store/hooks";
import { selectAllowedPageSlugs } from "../../selectors/accessControlSelectors";
import { PageAccessGuard } from "../../components/access/PageAccessGuard";
import { PAGE_SLUGS } from "../../constants/pageSlugs";

type SettingsSection = {
  label: string;
  description: string;
  icon: React.ComponentType<{ size?: number | string }>;
  to: string;
  pageSlug: string;
};

const sections: SettingsSection[] = [
  {
    label: "Users",
    description: "Invite, deactivate, and reset access for platform members.",
    icon: IconUsers,
    to: "/settings/users",
    pageSlug: PAGE_SLUGS.settingsUsers,
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
    label: "Pages",
    description: "Control the high-level navigation structure shown to users.",
    icon: IconLayoutSidebar,
    to: "/settings/pages",
    pageSlug: PAGE_SLUGS.settingsPages,
  },
  {
    label: "Modules",
    description: "Organise reusable modules and the widgets they render.",
    icon: IconComponents,
    to: "/settings/modules",
    pageSlug: PAGE_SLUGS.settingsModules,
  },
  {
    label: "Permissions",
    description: "Map user types to their page and module capabilities.",
    icon: IconShieldLock,
    to: "/settings/permissions",
    pageSlug: PAGE_SLUGS.settingsPermissions,
  },
];

const PAGE_SLUG = PAGE_SLUGS.settings;

const SettingsLanding = () => {
  const navigate = useNavigate();
  const allowedPageSlugs = useAppSelector(selectAllowedPageSlugs);

  const visibleSections = useMemo(
    () => sections.filter((section) => allowedPageSlugs.has(section.pageSlug)),
    [allowedPageSlugs],
  );

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
      </SimpleGrid>
    </PageAccessGuard>
  );
};

export default SettingsLanding;

