import { Stack, Title, Text } from "@mantine/core";
import ProductAddonsList from "../../components/productAddons/ProductAddonsList";
import { PageAccessGuard } from "../../components/access/PageAccessGuard";
import { PAGE_SLUGS } from "../../constants/pageSlugs";

const PAGE_SLUG = PAGE_SLUGS.settingsProductAddons;

const SettingsProductAddons = () => {
  return (
    <PageAccessGuard pageSlug={PAGE_SLUG}>
      <Stack gap="md">
        <div>
          <Title order={3}>Product Add-Ons</Title>
          <Text size="sm" c="dimmed">
            Link add-ons to products and control pricing and storefront selection.
          </Text>
        </div>
        <ProductAddonsList />
      </Stack>
    </PageAccessGuard>
  );
};

export default SettingsProductAddons;
