import React from "react";
import { Stack, Title, Text } from "@mantine/core";
import ModulesList from "../../components/settings/modules/ModulesList";
import { PageAccessGuard } from "../../components/access/PageAccessGuard";
import { PAGE_SLUGS } from "../../constants/pageSlugs";

const PAGE_SLUG = PAGE_SLUGS.settingsModules;

const SettingsModules = () => {
  return (
    <PageAccessGuard pageSlug={PAGE_SLUG}>
      <Stack gap="md">
        <div>
          <Title order={3}>Modules</Title>
          <Text size="sm" c="dimmed">
            Define modular building blocks and assign them to pages.
          </Text>
        </div>
        <ModulesList pageTitle="Module" />
      </Stack>
    </PageAccessGuard>
  );
};

export default SettingsModules;