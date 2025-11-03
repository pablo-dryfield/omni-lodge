import { Stack, Title, Text } from "@mantine/core";
import { PageAccessGuard } from "../../components/access/PageAccessGuard";
import { PAGE_SLUGS } from "../../constants/pageSlugs";
import SqlHelperPanel from "../../components/sql/SqlHelperPanel";

const PAGE_SLUG = PAGE_SLUGS.settingsActions;

const SettingsSqlHelper = () => {
  return (
    <PageAccessGuard pageSlug={PAGE_SLUG}>
      <Stack gap="lg">
        <SqlHelperPanel />
      </Stack>
    </PageAccessGuard>
  );
};

export default SettingsSqlHelper;
