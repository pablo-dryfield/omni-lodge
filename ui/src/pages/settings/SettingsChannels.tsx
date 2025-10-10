import { Stack, Title, Text } from "@mantine/core";
import ChannelsList from "../../components/channels/ChannelsList";
import { PageAccessGuard } from "../../components/access/PageAccessGuard";
import { PAGE_SLUGS } from "../../constants/pageSlugs";

const PAGE_SLUG = PAGE_SLUGS.settingsChannels;

const SettingsChannels = () => {
  return (
    <PageAccessGuard pageSlug={PAGE_SLUG}>
      <Stack gap="md">
        <div>
          <Title order={3}>Channels</Title>
          <Text size="sm" c="dimmed">
            Manage connected marketplaces and direct booking sources.
          </Text>
        </div>
        <ChannelsList pageTitle="Channels" />
      </Stack>
    </PageAccessGuard>
  );
};

export default SettingsChannels;
