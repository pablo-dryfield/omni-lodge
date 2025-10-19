import { Stack, Title, Text } from "@mantine/core";
import { PageAccessGuard } from "../../components/access/PageAccessGuard";
import { PAGE_SLUGS } from "../../constants/pageSlugs";
import VenuesList from "../../components/venues/VenuesList";

const PAGE_SLUG = PAGE_SLUGS.settingsVenues;

const SettingsVenues = () => {
  return (
    <PageAccessGuard pageSlug={PAGE_SLUG}>
      <Stack gap="md">
        <div>
          <Title order={3}>Venues</Title>
          <Text size="sm" c="dimmed">
            Maintain the list of partner venues available for nightly reports.
          </Text>
        </div>
        <VenuesList />
      </Stack>
    </PageAccessGuard>
  );
};

export default SettingsVenues;

