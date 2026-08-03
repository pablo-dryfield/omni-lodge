import { Accordion, Paper, Stack, Tabs, Text, Title } from "@mantine/core";
import { useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { PageAccessGuard } from "../components/access/PageAccessGuard";
import { PAGE_SLUGS } from "../constants/pageSlugs";
import GetYourGuideReviews from "../components/reports/GetYourGuideReviews";
import ReviewArchivePanel from "../components/reviews/ReviewArchivePanel";
import ReviewOverviewDashboard from "../components/reviews/ReviewOverviewDashboard";
import ReviewCounterList from "../components/reviewCounters/ReviewCounterList";
import ReviewAnalyticsPanel from "../components/reviewCounters/ReviewAnalyticsPanel";
import ReviewMonthlySummary from "../components/reviewCounters/ReviewMonthlySummary";

const REVIEW_TABS = ["google", "tripadvisor", "airbnb", "getyourguide", "overview"] as const;
type ReviewTab = (typeof REVIEW_TABS)[number];
const DEFAULT_REVIEW_TAB: ReviewTab = "overview";

const isReviewTab = (value: string | null): value is ReviewTab =>
  value != null && REVIEW_TABS.includes(value as ReviewTab);

const ReviewCounters = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = useMemo(() => searchParams.get("tab"), [searchParams]);
  const activeTab: ReviewTab = isReviewTab(tabParam) ? tabParam : DEFAULT_REVIEW_TAB;

  useEffect(() => {
    if (tabParam === activeTab) {
      return;
    }
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("tab", activeTab);
      return next;
    }, { replace: true });
  }, [activeTab, setSearchParams, tabParam]);

  const handleTabChange = (value: string | null) => {
    const nextTab = isReviewTab(value) ? value : DEFAULT_REVIEW_TAB;
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("tab", nextTab);
      return next;
    }, { replace: true });
  };

  return (
    <PageAccessGuard pageSlug={PAGE_SLUGS.reviews}>
      <Stack gap="md">
        <Paper radius="lg" p="lg" withBorder>
          <Title order={2}>Review intelligence</Title>
          <Text c="dimmed" mt={4}>Archive every review, detect removals, and share staff credit fairly.</Text>
        </Paper>
        <Tabs
          value={activeTab}
          onChange={handleTabChange}
          radius="md"
          variant="outline"
          keepMounted={false}
        >
          <Tabs.List>  
            <Tabs.Tab value="overview">Overview</Tabs.Tab>
            <Tabs.Tab value="google">Google</Tabs.Tab>
            <Tabs.Tab value="tripadvisor">TripAdvisor</Tabs.Tab>
            <Tabs.Tab value="airbnb">Airbnb</Tabs.Tab>
            <Tabs.Tab value="getyourguide">GetYourGuide Reviews</Tabs.Tab>
          </Tabs.List>
          <Tabs.Panel value="google" pt="md">
            <ReviewArchivePanel platform="google" />
          </Tabs.Panel>
          <Tabs.Panel value="tripadvisor" pt="md">
            <ReviewArchivePanel platform="tripadvisor" />
          </Tabs.Panel>
          <Tabs.Panel value="airbnb" pt="md">
            <ReviewArchivePanel platform="airbnb" />
          </Tabs.Panel>
          <Tabs.Panel value="getyourguide" pt="md">
            <Paper radius="md" withBorder shadow="xs" p="md">
              <GetYourGuideReviews />
            </Paper>
          </Tabs.Panel>
           <Tabs.Panel value="overview" pt="md">
            <Stack gap="lg">
              <ReviewOverviewDashboard />
              <Accordion variant="separated" radius="lg">
                <Accordion.Item value="legacy-review-history">
                  <Accordion.Control>
                    <div>
                      <Text fw={700}>Previous review-counter history</Text>
                      <Text size="sm" c="dimmed">Original counters, monthly summaries, approvals, and analytics remain available here.</Text>
                    </div>
                  </Accordion.Control>
                  <Accordion.Panel>
                    <Stack gap="md">
                      <ReviewAnalyticsPanel />
                      <ReviewMonthlySummary />
                      <ReviewCounterList />
                    </Stack>
                  </Accordion.Panel>
                </Accordion.Item>
              </Accordion>
            </Stack>
          </Tabs.Panel>
        </Tabs>
      </Stack>
    </PageAccessGuard>
  );
};

export default ReviewCounters;
