import { Paper, Stack, Tabs, Text, Title } from "@mantine/core";
import { PageAccessGuard } from "../components/access/PageAccessGuard";
import { PAGE_SLUGS } from "../constants/pageSlugs";
import ReviewCounterList from "../components/reviewCounters/ReviewCounterList";
import ReviewAnalyticsPanel from "../components/reviewCounters/ReviewAnalyticsPanel";
import ReviewMonthlySummary from "../components/reviewCounters/ReviewMonthlySummary";
import GoogleReviews from "../components/reports/GoogleReviews";
import TripAdvisorReviews from "../components/reports/TripAdvisorReviews";
import GetYourGuideReviews from "../components/reports/GetYourGuideReviews";

const ReviewCounters = () => {
  return (
    <PageAccessGuard pageSlug={PAGE_SLUGS.reviews}>
      <Stack gap="md">
        <div>
          <Title order={2}>Reviews</Title>
          <Text size="sm" c="dimmed">
            Track monthly review totals, reviewer order, and staff credit allocations across platforms.
          </Text>
        </div>
        <Tabs defaultValue="overview" radius="md" variant="outline">
          <Tabs.List>
            <Tabs.Tab value="overview">Review Performance</Tabs.Tab>
            <Tabs.Tab value="google">Google Reviews</Tabs.Tab>
            <Tabs.Tab value="tripadvisor">TripAdvisor Reviews</Tabs.Tab>
            <Tabs.Tab value="getyourguide">GetYourGuide Reviews</Tabs.Tab>
          </Tabs.List>
          <Tabs.Panel value="overview" pt="md">
            <Stack gap="md">
              <ReviewAnalyticsPanel />
              <ReviewMonthlySummary />
              <ReviewCounterList />
            </Stack>
          </Tabs.Panel>
          <Tabs.Panel value="google" pt="md">
            <Stack gap="sm">
              <Text size="sm" c="dimmed">
                Blend external guest sentiment data from Google with your in-house review tracking to stay ahead of potential issues.
              </Text>
              <Paper radius="md" withBorder shadow="xs" p="md">
                <GoogleReviews />
              </Paper>
            </Stack>
          </Tabs.Panel>
          <Tabs.Panel value="tripadvisor" pt="md">
            <Stack gap="sm">
              <Text size="sm" c="dimmed">
                Cross-check Google feedback with the TripAdvisor community to surface trends from a different audience.
              </Text>
              <Paper radius="md" withBorder shadow="xs" p="md">
                <TripAdvisorReviews />
              </Paper>
            </Stack>
          </Tabs.Panel>
          <Tabs.Panel value="getyourguide" pt="md">
            <Stack gap="sm">
              <Text size="sm" c="dimmed">
                Track public reviews from GetYourGuide to understand how booking platform guests describe their
                experience.
              </Text>
              <Paper radius="md" withBorder shadow="xs" p="md">
                <GetYourGuideReviews />
              </Paper>
            </Stack>
          </Tabs.Panel>
        </Tabs>
      </Stack>
    </PageAccessGuard>
  );
};

export default ReviewCounters;
