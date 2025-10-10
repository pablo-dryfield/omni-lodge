import { Stack, Title, Text } from "@mantine/core";
import ChannelCommissionList from "../../components/channelCommissions/ChannelCommissionList";
import { PageAccessGuard } from "../../components/access/PageAccessGuard";
import { PAGE_SLUGS } from "../../constants/pageSlugs";

const PAGE_SLUG = PAGE_SLUGS.settingsChannelCommissions;

const SettingsChannelCommissions = () => {
  return (
    <PageAccessGuard pageSlug={PAGE_SLUG}>
      <Stack gap="md">
        <div>
          <Title order={3}>Channel Commissions</Title>
          <Text size="sm" c="dimmed">
            Manage commission agreements for each channel and maintain their history.
          </Text>
        </div>
        <ChannelCommissionList pageTitle="Channel Commissions" />
      </Stack>
    </PageAccessGuard>
  );
};

export default SettingsChannelCommissions;
