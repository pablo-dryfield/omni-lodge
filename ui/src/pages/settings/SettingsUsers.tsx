import React from "react";
import { Stack, Title, Text } from "@mantine/core";
import UsersList from "../../components/users/UsersList";
import { PageAccessGuard } from "../../components/access/PageAccessGuard";
import { PAGE_SLUGS } from "../../constants/pageSlugs";

const PAGE_SLUG = PAGE_SLUGS.settingsUsers;

const SettingsUsers = () => {
  return (
    <PageAccessGuard pageSlug={PAGE_SLUG}>
      <Stack gap="md">
        <div>
          <Title order={3}>Users</Title>
          <Text size="sm" c="dimmed">
            Manage individual user records and login access.
          </Text>
        </div>
        <UsersList pageTitle="Users" />
      </Stack>
    </PageAccessGuard>
  );
};

export default SettingsUsers;