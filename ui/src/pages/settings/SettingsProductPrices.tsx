import { Stack, Title, Text } from "@mantine/core";
import ProductPriceList from "../../components/productPrices/ProductPriceList";
import { PageAccessGuard } from "../../components/access/PageAccessGuard";
import { PAGE_SLUGS } from "../../constants/pageSlugs";

const PAGE_SLUG = PAGE_SLUGS.settingsProductPrices;

const SettingsProductPrices = () => {
  return (
    <PageAccessGuard pageSlug={PAGE_SLUG}>
      <Stack gap="md">
        <div>
          <Title order={3}>Product Prices</Title>
          <Text size="sm" c="dimmed">
            Manage historical pricing for each product and schedule future changes.
          </Text>
        </div>
        <ProductPriceList pageTitle="Product Prices" />
      </Stack>
    </PageAccessGuard>
  );
};

export default SettingsProductPrices;
