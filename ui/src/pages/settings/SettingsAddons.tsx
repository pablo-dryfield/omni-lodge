import { Stack, Title, Text } from "@mantine/core";
import AddonsList from "../../components/addons/AddonsList";
import { PageAccessGuard } from "../../components/access/PageAccessGuard";
import { PAGE_SLUGS } from "../../constants/pageSlugs";

const PAGE_SLUG = PAGE_SLUGS.settingsAddons;

const SettingsAddons = () => {
  return (
    <PageAccessGuard pageSlug={PAGE_SLUG}>
      <Stack gap="md">
        <div>
          <Title order={3}>Add-Ons</Title>
          <Text size="sm" c="dimmed">
            Maintain optional extras that can be attached to bookings.
          </Text>
        </div>
        <AddonsList pageTitle="Add-Ons" />
      </Stack>
    </PageAccessGuard>
  );
};

export default SettingsAddons;
