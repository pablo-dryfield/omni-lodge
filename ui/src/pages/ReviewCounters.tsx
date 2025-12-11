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
        </div>
        <Tabs defaultValue="overview" radius="md" variant="outline">
          <Tabs.List>
            
            <Tabs.Tab value="google">Google Reviews</Tabs.Tab>
            <Tabs.Tab value="tripadvisor">TripAdvisor Reviews</Tabs.Tab>
            <Tabs.Tab value="getyourguide">GetYourGuide Reviews</Tabs.Tab>
            <Tabs.Tab value="overview">Review Performance</Tabs.Tab>
          </Tabs.List>
          <Tabs.Panel value="google" pt="md">
            <Paper radius="md" withBorder shadow="xs" p="md">
              <GoogleReviews />
            </Paper>
          </Tabs.Panel>
          <Tabs.Panel value="tripadvisor" pt="md">
            <Paper radius="md" withBorder shadow="xs" p="md">
              <TripAdvisorReviews />
            </Paper>
          </Tabs.Panel>
          <Tabs.Panel value="getyourguide" pt="md">
            <Paper radius="md" withBorder shadow="xs" p="md">
              <GetYourGuideReviews />
            </Paper>
          </Tabs.Panel>
           <Tabs.Panel value="overview" pt="md">
            <Stack gap="md">
              <ReviewAnalyticsPanel />
              <ReviewMonthlySummary />
              <ReviewCounterList />
            </Stack>
          </Tabs.Panel>
        </Tabs>
      </Stack>
    </PageAccessGuard>
  );
};

export default ReviewCounters;
