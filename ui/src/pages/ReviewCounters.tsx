import { Paper, Stack, Tabs, Title } from "@mantine/core";
import { useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { PageAccessGuard } from "../components/access/PageAccessGuard";
import { PAGE_SLUGS } from "../constants/pageSlugs";
import ReviewCounterList from "../components/reviewCounters/ReviewCounterList";
import ReviewAnalyticsPanel from "../components/reviewCounters/ReviewAnalyticsPanel";
import ReviewMonthlySummary from "../components/reviewCounters/ReviewMonthlySummary";
import GoogleReviews from "../components/reports/GoogleReviews";
import TripAdvisorReviews from "../components/reports/TripAdvisorReviews";
import AirbnbReviews from "../components/reports/AirbnbReviews";
import GetYourGuideReviews from "../components/reports/GetYourGuideReviews";

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
        <div>
          <Title order={2}>Reviews</Title>
        </div>
        <Tabs
          value={activeTab}
          onChange={handleTabChange}
          radius="md"
          variant="outline"
          keepMounted={false}
        >
          <Tabs.List>  
            <Tabs.Tab value="google">Google Reviews</Tabs.Tab>
            <Tabs.Tab value="tripadvisor">TripAdvisor Reviews</Tabs.Tab>
            <Tabs.Tab value="airbnb">Airbnb Reviews</Tabs.Tab>
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
          <Tabs.Panel value="airbnb" pt="md">
            <Paper radius="md" withBorder shadow="xs" p="md">
              <AirbnbReviews />
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
