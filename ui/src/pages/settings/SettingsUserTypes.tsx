import React from "react";
import { Stack, Title, Text } from "@mantine/core";
import UserTypesList from "../../components/userTypes/UserTypeList";
import { PageAccessGuard } from "../../components/access/PageAccessGuard";
import { PAGE_SLUGS } from "../../constants/pageSlugs";

const PAGE_SLUG = PAGE_SLUGS.settingsUserTypes;

const SettingsUserTypes = () => {
  return (
    <PageAccessGuard pageSlug={PAGE_SLUG}>
      <Stack gap="md">
        <div>
          <Title order={3}>User Types</Title>
          <Text size="sm" c="dimmed">
            Manage reusable role definitions and their defaults.
          </Text>
        </div>
        <UserTypesList pageTitle="User Types" />
      </Stack>
    </PageAccessGuard>
  );
};

export default SettingsUserTypes;