import { Stack, Text, Title } from "@mantine/core";
import { PageAccessGuard } from "../../components/access/PageAccessGuard";
import { PAGE_SLUGS } from "../../constants/pageSlugs";
import StaffProfilesList from "../../components/staffProfiles/StaffProfilesList";

const PAGE_SLUG = PAGE_SLUGS.settingsStaffProfiles;

const SettingsStaffProfiles = () => {
  return (
    <PageAccessGuard pageSlug={PAGE_SLUG}>
      <Stack gap="md">
        <div>
          <Title order={3}>Staff Profiles</Title>
          <Text size="sm" c="dimmed">
            Maintain staff profile metadata, including volunteer status and accommodation details.
          </Text>
        </div>
        <StaffProfilesList />
      </Stack>
    </PageAccessGuard>
  );
};

export default SettingsStaffProfiles;
