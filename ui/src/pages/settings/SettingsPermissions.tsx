import React from "react";
import { Stack, Text, Title } from "@mantine/core";
import { PageAccessGuard } from "../../components/access/PageAccessGuard";
import { PAGE_SLUGS } from "../../constants/pageSlugs";
import { AccessControlTreeManager } from "../../components/settings/accessControl/AccessControlTreeManager";

const PAGE_SLUG = PAGE_SLUGS.settingsPermissions;

const SettingsPermissions = () => {
  return (
    <PageAccessGuard pageSlug={PAGE_SLUG}>
      <Stack gap="lg">
        <div>
          <Title order={3}>Access Control Tree</Title>
          <Text size="sm" c="dimmed">
            One structure: pages contain modules, and both levels define permissions.
          </Text>
        </div>
        <AccessControlTreeManager />
      </Stack>
    </PageAccessGuard>
  );
};

export default SettingsPermissions;
