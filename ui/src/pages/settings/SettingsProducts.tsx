import { Stack, Title, Text } from "@mantine/core";
import ProductsList from "../../components/products/ProductsList";
import { PageAccessGuard } from "../../components/access/PageAccessGuard";
import { PAGE_SLUGS } from "../../constants/pageSlugs";

const PAGE_SLUG = PAGE_SLUGS.settingsProducts;

const SettingsProducts = () => {
  return (
    <PageAccessGuard pageSlug={PAGE_SLUG}>
      <Stack gap="md">
        <div>
          <Title order={3}>Products</Title>
          <Text size="sm" c="dimmed">
            Manage sellable experiences, pricing, availability, and storefront rules.
          </Text>
        </div>
        <ProductsList />
      </Stack>
    </PageAccessGuard>
  );
};

export default SettingsProducts;
