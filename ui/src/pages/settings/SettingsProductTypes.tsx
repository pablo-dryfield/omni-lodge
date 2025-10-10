import { Stack, Title, Text } from "@mantine/core";
import ProductTypeList from "../../components/productTypes/ProductTypeList";
import { PageAccessGuard } from "../../components/access/PageAccessGuard";
import { PAGE_SLUGS } from "../../constants/pageSlugs";

const PAGE_SLUG = PAGE_SLUGS.settingsProductTypes;

const SettingsProductTypes = () => {
  return (
    <PageAccessGuard pageSlug={PAGE_SLUG}>
      <Stack gap="md">
        <div>
          <Title order={3}>Product Types</Title>
          <Text size="sm" c="dimmed">
            Categorise products into types to power reporting and automation.
          </Text>
        </div>
        <ProductTypeList pageTitle="Product Types" />
      </Stack>
    </PageAccessGuard>
  );
};

export default SettingsProductTypes;
