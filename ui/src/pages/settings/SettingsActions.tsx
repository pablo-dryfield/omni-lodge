import { Stack, Title, Text } from "@mantine/core";
import ActionsList from "../../components/actions/ActionsList";
import { PageAccessGuard } from "../../components/access/PageAccessGuard";
import { PAGE_SLUGS } from "../../constants/pageSlugs";

const PAGE_SLUG = PAGE_SLUGS.settingsActions;

const SettingsActions = () => {
  return (
    <PageAccessGuard pageSlug={PAGE_SLUG}>
      <Stack gap="md">
        <div>
          <Title order={3}>Actions</Title>
          <Text size="sm" c="dimmed">
            Curate the action catalogue used for permissions and automation.
          </Text>
        </div>
        <ActionsList pageTitle="Actions" />
      </Stack>
    </PageAccessGuard>
  );
};

export default SettingsActions;
