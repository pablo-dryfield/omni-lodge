import { Stack, Title, Text } from "@mantine/core";
import ChannelProductPriceList from "../../components/channelProductPrices/ChannelProductPriceList";
import { PageAccessGuard } from "../../components/access/PageAccessGuard";
import { PAGE_SLUGS } from "../../constants/pageSlugs";

const PAGE_SLUG = PAGE_SLUGS.settingsChannelProductPrices;

const SettingsChannelProductPrices = () => {
  return (
    <PageAccessGuard pageSlug={PAGE_SLUG}>
      <Stack gap="md">
        <div>
          <Title order={3}>Channel Product Prices</Title>
          <Text size="sm" c="dimmed">
            Override product pricing for specific sales channels and keep historical records.
          </Text>
        </div>
        <ChannelProductPriceList pageTitle="Channel Product Prices" />
      </Stack>
    </PageAccessGuard>
  );
};

export default SettingsChannelProductPrices;
