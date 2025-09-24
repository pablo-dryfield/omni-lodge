import React from "react";
import { Stack, Title, Text } from "@mantine/core";
import RoleModulePermissionList from "../../components/settings/permissions/RoleModulePermissionList";
import { PageAccessGuard } from "../../components/access/PageAccessGuard";
import { PAGE_SLUGS } from "../../constants/pageSlugs";

const PAGE_SLUG = PAGE_SLUGS.settingsModulePermissions;

const SettingsModulePermissions = () => {
  return (
    <PageAccessGuard pageSlug={PAGE_SLUG}>
      <Stack gap="md">
        <div>
          <Title order={3}>Module Permissions</Title>
          <Text size="sm" c="dimmed">
            Fine-tune create, update, and delete rights for individual modules.
          </Text>
        </div>
        <RoleModulePermissionList pageTitle="Module Permission" />
      </Stack>
    </PageAccessGuard>
  );
};

export default SettingsModulePermissions;