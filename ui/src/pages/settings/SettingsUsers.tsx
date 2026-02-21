import { Stack } from "@mantine/core";
import SettingsUsersPanel from "../../components/users/SettingsUsersPanel";
import { PageAccessGuard } from "../../components/access/PageAccessGuard";
import { PAGE_SLUGS } from "../../constants/pageSlugs";

const PAGE_SLUG = PAGE_SLUGS.settingsUsers;

const SettingsUsers = () => {
  return (
    <PageAccessGuard pageSlug={PAGE_SLUG}>
      <Stack gap="md">
        <SettingsUsersPanel />
      </Stack>
    </PageAccessGuard>
  );
};

export default SettingsUsers;
