import { Stack } from "@mantine/core";
import DbBackupsPanel from "../../components/settings/DbBackupsPanel";
import { PageAccessGuard } from "../../components/access/PageAccessGuard";
import { PAGE_SLUGS } from "../../constants/pageSlugs";

const SettingsDbBackups = () => {
  return (
    <PageAccessGuard pageSlug={PAGE_SLUGS.settingsDbBackups}>
      <Stack gap="lg">
        <DbBackupsPanel />
      </Stack>
    </PageAccessGuard>
  );
};

export default SettingsDbBackups;

