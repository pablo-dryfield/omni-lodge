import React from "react";
import { Stack, Title, Text } from "@mantine/core";
import RolePagePermissionList from "../../components/settings/permissions/RolePagePermissionList";
import { PageAccessGuard } from "../../components/access/PageAccessGuard";
import { PAGE_SLUGS } from "../../constants/pageSlugs";

const PAGE_SLUG = PAGE_SLUGS.settingsPagePermissions;

const SettingsPagePermissions = () => {
  return (
    <PageAccessGuard pageSlug={PAGE_SLUG}>
      <Stack gap="md">
        <div>
          <Title order={3}>Page Permissions</Title>
          <Text size="sm" c="dimmed">
            Decide which user types can browse each navigational page.
          </Text>
        </div>
        <RolePagePermissionList pageTitle="Page Permission" />
      </Stack>
    </PageAccessGuard>
  );
};

export default SettingsPagePermissions;