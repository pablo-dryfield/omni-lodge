import { Stack, Title, Text } from "@mantine/core";
import { PageAccessGuard } from "../../components/access/PageAccessGuard";
import { PAGE_SLUGS } from "../../constants/pageSlugs";
import VenuesList from "../../components/venues/VenuesList";
import VenueCompensationTermList from "../../components/venues/VenueCompensationTermList";
import VenueCompensationTermRateList from "../../components/venues/VenueCompensationTermRateList";

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
        <div>
          <Title order={4}>Compensation Terms</Title>
          <Text size="sm" c="dimmed">
            Capture open-bar payouts and per-venue commissions with effective date ranges.
          </Text>
        </div>
        <VenueCompensationTermList />
        <div>
          <Title order={4}>Rate Bands</Title>
          <Text size="sm" c="dimmed">
            Define per-product, per-ticket rates (normal vs cocktails vs brunch) with their own date ranges.
          </Text>
        </div>
        <VenueCompensationTermRateList />
      </Stack>
    </PageAccessGuard>
  );
};

export default SettingsVenues;
