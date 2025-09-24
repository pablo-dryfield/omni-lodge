import React from "react";
import { Stack, Title, Text } from "@mantine/core";
import PagesList from "../../components/settings/pages/PagesList";
import { PageAccessGuard } from "../../components/access/PageAccessGuard";
import { PAGE_SLUGS } from "../../constants/pageSlugs";

const PAGE_SLUG = PAGE_SLUGS.settingsPages;

const SettingsPages = () => {
  return (
    <PageAccessGuard pageSlug={PAGE_SLUG}>
      <Stack gap="md">
        <div>
          <Title order={3}>Pages</Title>
          <Text size="sm" c="dimmed">
            Configure top-level navigation entries and organize available screens.
          </Text>
        </div>
        <PagesList pageTitle="Page" />
      </Stack>
    </PageAccessGuard>
  );
};

export default SettingsPages;