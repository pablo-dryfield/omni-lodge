import { Stack, Text, Title } from "@mantine/core";
import { PageAccessGuard } from "../../components/access/PageAccessGuard";
import ProductAliasList from "../../components/productAliases/ProductAliasList";
import { PAGE_SLUGS } from "../../constants/pageSlugs";

const PAGE_SLUG = PAGE_SLUGS.settingsProductAliases;

const SettingsProductAliases = () => {
  return (
    <PageAccessGuard pageSlug={PAGE_SLUG}>
      <Stack gap="md">
        <div>
          <Title order={3}>Product Aliases</Title>
          <Text size="sm" c="dimmed">
            Connect incoming booking labels to products so new activities are recognized automatically.
          </Text>
        </div>
        <ProductAliasList pageTitle="Product Aliases" />
      </Stack>
    </PageAccessGuard>
  );
};

export default SettingsProductAliases;
