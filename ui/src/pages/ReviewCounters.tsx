import { Accordion, Stack, Tabs, Text } from "@mantine/core";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PageAccessGuard } from "../components/access/PageAccessGuard";
import { PAGE_SLUGS } from "../constants/pageSlugs";
import ReviewArchivePanel from "../components/reviews/ReviewArchivePanel";
import ReviewOverviewDashboard from "../components/reviews/ReviewOverviewDashboard";
import ReviewCounterList from "../components/reviewCounters/ReviewCounterList";
import ReviewAnalyticsPanel from "../components/reviewCounters/ReviewAnalyticsPanel";
import ReviewMonthlySummary from "../components/reviewCounters/ReviewMonthlySummary";
import { useAppSelector } from "../store/hooks";
import { currentReviewMonthInWarsaw } from "../utils/reviewCreditMonth";
import classes from "./ReviewCounters.module.css";

const REVIEW_TABS = ["google", "tripadvisor", "airbnb", "getyourguide", "overview"] as const;
type ReviewTab = (typeof REVIEW_TABS)[number];
const DEFAULT_REVIEW_TAB: ReviewTab = "overview";

const isReviewTab = (value: string | null): value is ReviewTab =>
  value != null && REVIEW_TABS.includes(value as ReviewTab);
const isReviewMonth = (value: string | null): value is string =>
  value != null && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);

const ReviewCounters = () => {
  const roleSlug = useAppSelector((state) => state.session.roleSlug);
  const currentUserId = useAppSelector((state) => state.session.loggedUserId);
  const canManage = ["owner", "manager", "admin", "administrator"].includes(String(roleSlug ?? "").trim().toLowerCase());
  const [searchParams, setSearchParams] = useSearchParams();
  const [historySection, setHistorySection] = useState<string | null>(null);
  const tabParam = useMemo(() => searchParams.get("tab"), [searchParams]);
  const monthParam = useMemo(() => searchParams.get("month"), [searchParams]);
  const activeTab: ReviewTab = isReviewTab(tabParam) ? tabParam : DEFAULT_REVIEW_TAB;
  const defaultMonth = useMemo(() => currentReviewMonthInWarsaw(), []);
  const activeMonth = isReviewMonth(monthParam) ? monthParam : defaultMonth;

  useEffect(() => {
    if (tabParam === activeTab && monthParam === activeMonth) {
      return;
    }
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("tab", activeTab);
      next.set("month", activeMonth);
      return next;
    }, { replace: true });
  }, [activeMonth, activeTab, monthParam, setSearchParams, tabParam]);

  const handleTabChange = (value: string | null) => {
    const nextTab = isReviewTab(value) ? value : DEFAULT_REVIEW_TAB;
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("tab", nextTab);
      return next;
    }, { replace: true });
  };

  const handleMonthChange = (nextMonth: string) => {
    if (!isReviewMonth(nextMonth)) {
      return;
    }
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("month", nextMonth);
      return next;
    }, { replace: true });
  };

  return (
    <PageAccessGuard pageSlug={PAGE_SLUGS.reviews}>
      <Stack gap="md" className={classes.page}>
        <Tabs
          value={activeTab}
          onChange={handleTabChange}
          radius="md"
          variant="outline"
          keepMounted={false}
          classNames={{ list: classes.tabsList, tab: classes.tab }}
          miw={0}
        >
          <Tabs.List>
            <Tabs.Tab value="overview">Overview</Tabs.Tab>
            <Tabs.Tab value="google">Google</Tabs.Tab>
            <Tabs.Tab value="tripadvisor">TripAdvisor</Tabs.Tab>
            <Tabs.Tab value="airbnb">Airbnb</Tabs.Tab>
            <Tabs.Tab value="getyourguide">GetYourGuide Reviews</Tabs.Tab>
          </Tabs.List>
          <Tabs.Panel value="google" pt="md" miw={0}>
            <ReviewArchivePanel platform="google" canManage={canManage} />
          </Tabs.Panel>
          <Tabs.Panel value="tripadvisor" pt="md" miw={0}>
            <ReviewArchivePanel platform="tripadvisor" canManage={canManage} />
          </Tabs.Panel>
          <Tabs.Panel value="airbnb" pt="md" miw={0}>
            <ReviewArchivePanel platform="airbnb" canManage={canManage} />
          </Tabs.Panel>
          <Tabs.Panel value="getyourguide" pt="md" miw={0}>
            <ReviewArchivePanel platform="getyourguide" canManage={canManage} />
          </Tabs.Panel>
          <Tabs.Panel value="overview" pt="md" miw={0}>
            <Stack gap="lg">
              <ReviewOverviewDashboard
                canManage={canManage}
                currentUserId={currentUserId}
                month={activeMonth}
                onMonthChange={handleMonthChange}
              />
              {canManage && (
                  <Accordion
                    value={historySection}
                    onChange={setHistorySection}
                    variant="separated"
                    radius="lg"
                    classNames={{ content: classes.accordionContent }}
                  >
                    <Accordion.Item value="legacy-review-history">
                      <Accordion.Control>
                        <div style={{ width: "100%" }}>
                          <Text fw={700} ta="center">Previous review-counter history</Text>
                          <Text size="sm" c="dimmed" ta="center">
                            Original counters, monthly summaries, approvals, and analytics remain available here.
                          </Text>
                        </div>
                      </Accordion.Control>
                      <Accordion.Panel>
                        {historySection === "legacy-review-history" && (
                          <Stack gap="md">
                            <ReviewAnalyticsPanel />
                            <ReviewMonthlySummary />
                            <ReviewCounterList />
                          </Stack>
                        )}
                      </Accordion.Panel>
                    </Accordion.Item>
                  </Accordion>
              )}
            </Stack>
          </Tabs.Panel>
        </Tabs>
      </Stack>
    </PageAccessGuard>
  );
};

export default ReviewCounters;
