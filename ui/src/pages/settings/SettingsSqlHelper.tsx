import { Stack } from "@mantine/core";
import { PageAccessGuard } from "../../components/access/PageAccessGuard";
import { PAGE_SLUGS } from "../../constants/pageSlugs";
import DatabaseWorkspace from "../../features/databaseWorkspace/DatabaseWorkspace";

const PAGE_SLUG = PAGE_SLUGS.settingsSqlHelper;

const SettingsSqlHelper = () => {
  return (
    <PageAccessGuard pageSlug={PAGE_SLUG}>
      <Stack gap="lg">
        <DatabaseWorkspace />
      </Stack>
    </PageAccessGuard>
  );
};

export default SettingsSqlHelper;
