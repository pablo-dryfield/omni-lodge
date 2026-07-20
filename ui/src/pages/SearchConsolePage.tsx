import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  NumberFormatter,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Textarea,
  TextInput,
  Title,
} from "@mantine/core";
import { DateInput } from "@mantine/dates";
import {
  IconAlertCircle,
  IconBrandGoogle,
  IconBulb,
  IconChecklist,
  IconRefresh,
  IconSearch,
} from "@tabler/icons-react";
import dayjs from "dayjs";
import { useAppDispatch } from "../store/hooks";
import { navigateToPage } from "../actions/navigationActions";
import { PageAccessGuard } from "../components/access/PageAccessGuard";
import { PAGE_SLUGS } from "../constants/pageSlugs";
import {
  useSearchConsolePerformance,
  useSearchConsoleSites,
  useAnalyzeGoogleSerp,
  useCreateSeoActionLog,
  useInspectSearchConsoleUrl,
  useSeoActionLogs,
  type SerpResultItem,
  type SearchConsolePerformanceRow,
} from "../api/searchConsole";

const TARGET_DOMAIN = "krawlthroughkrakow.com";
const EMPTY_PERFORMANCE_ROWS: SearchConsolePerformanceRow[] = [];
const TARGET_KEYWORDS = [
  "pub crawl krakow",
  "krakow pub crawl",
  "bar crawl krakow",
  "krakow nightlife",
  "things to do in krakow at night",
  "krakow party",
  "krawl through krakow",
  "krawlthroughkrakow",
];

type SeoOpportunity = {
  type: "ctr" | "near_top" | "weak_rank" | "no_clicks" | "cannibalization" | "missing_target";
  priority: "High" | "Medium" | "Low";
  title: string;
  detail: string;
  action: string;
  query?: string;
  page?: string;
  metric?: string;
};

type TargetKeywordTrackerRow = {
  keyword: string;
  found: boolean;
  topPage: string | null;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

type LandingPageDiagnosisRow = {
  page: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  topQueries: string[];
  issue: string;
};

type RecommendedSeoAction = {
  id: string;
  priority: "High" | "Medium" | "Low";
  actionType: string;
  title: string;
  why: string;
  nextStep: string;
  targetQuery: string | null;
  targetPage: string | null;
  details: string;
};

type DateRangePresetKey = "last_7" | "last_28" | "last_90" | "last_180" | "last_365" | "custom";

type DateRangeState = {
  preset: DateRangePresetKey;
  startDate: Date | null;
  endDate: Date | null;
};

type Props = {
  title?: string;
};

const DATE_RANGE_PRESETS: Array<{ value: DateRangePresetKey; label: string }> = [
  { value: "last_7", label: "Last 7 days" },
  { value: "last_28", label: "Last 28 days" },
  { value: "last_90", label: "Last 90 days" },
  { value: "last_180", label: "Last 6 months" },
  { value: "last_365", label: "Last 12 months" },
  { value: "custom", label: "Custom" },
];

const getPresetDateRange = (preset: DateRangePresetKey): Pick<DateRangeState, "startDate" | "endDate"> => {
  const endDate = dayjs().subtract(2, "day").toDate();
  const daysByPreset: Record<Exclude<DateRangePresetKey, "custom">, number> = {
    last_7: 7,
    last_28: 28,
    last_90: 90,
    last_180: 180,
    last_365: 365,
  };
  const days = preset === "custom" ? 28 : daysByPreset[preset];
  return {
    startDate: dayjs(endDate).subtract(days - 1, "day").toDate(),
    endDate,
  };
};

const createDateRange = (preset: DateRangePresetKey): DateRangeState => ({
  preset,
  ...getPresetDateRange(preset),
});

const extractErrorMessage = (error: unknown): string => {
  const data = (error as { response?: { data?: unknown } })?.response?.data;
  if (Array.isArray(data) && data.length > 0) {
    const first = data[0];
    if (first && typeof first === "object" && typeof (first as { message?: unknown }).message === "string") {
      return (first as { message: string }).message;
    }
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Unexpected error occurred.";
};

const formatPercent = (value: number): string => `${(value * 100).toFixed(2)}%`;

const getMetricTotals = (rows: SearchConsolePerformanceRow[]) => {
  const clicks = rows.reduce((sum, row) => sum + row.clicks, 0);
  const impressions = rows.reduce((sum, row) => sum + row.impressions, 0);
  const weightedPositionNumerator = rows.reduce((sum, row) => sum + row.position * row.impressions, 0);
  return {
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : 0,
    position: impressions > 0 ? weightedPositionNumerator / impressions : 0,
  };
};

const formatDelta = (value: number, options?: { percent?: boolean; inverseGood?: boolean }): { label: string; color: string } => {
  const color = value === 0 ? "gray" : options?.inverseGood ? (value < 0 ? "green" : "red") : value > 0 ? "green" : "red";
  const prefix = value > 0 ? "+" : "";
  const label = options?.percent ? `${prefix}${(value * 100).toFixed(2)}pp` : `${prefix}${value.toFixed(2)}`;
  return { label, color };
};

const getPreviousPeriod = (start: Date | null, end: Date | null) => {
  const safeStart = dayjs(start ?? undefined);
  const safeEnd = dayjs(end ?? undefined);
  const days = Math.max(safeEnd.diff(safeStart, "day") + 1, 1);
  const previousEnd = safeStart.subtract(1, "day");
  const previousStart = previousEnd.subtract(days - 1, "day");
  return {
    startDate: previousStart.format("YYYY-MM-DD"),
    endDate: previousEnd.format("YYYY-MM-DD"),
  };
};

const normalizeSearchText = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, " ");

const formatDateRange = (range: DateRangeState): { startDate: string; endDate: string } => ({
  startDate: dayjs(range.startDate ?? undefined).format("YYYY-MM-DD"),
  endDate: dayjs(range.endDate ?? undefined).format("YYYY-MM-DD"),
});

const DateRangeControls = ({
  range,
  onChange,
  label,
}: {
  range: DateRangeState;
  onChange: (range: DateRangeState) => void;
  label: string;
}) => (
  <Group align="flex-end" wrap="wrap">
    <Select
      label={label}
      data={DATE_RANGE_PRESETS}
      value={range.preset}
      onChange={(value) => {
        const preset = (value as DateRangePresetKey | null) ?? "last_28";
        onChange({
          preset,
          ...(preset === "custom" ? { startDate: range.startDate, endDate: range.endDate } : getPresetDateRange(preset)),
        });
      }}
      style={{ width: 180 }}
    />
    <DateInput
      label="Start date"
      value={range.startDate}
      onChange={(startDate) => onChange({ ...range, preset: "custom", startDate })}
      clearable={false}
    />
    <DateInput
      label="End date"
      value={range.endDate}
      onChange={(endDate) => onChange({ ...range, preset: "custom", endDate })}
      clearable={false}
    />
  </Group>
);

const buildSeoOpportunities = (rows: SearchConsolePerformanceRow[]): SeoOpportunity[] => {
  const queryPageRows = rows
    .map((row) => ({
      query: row.keys[0] ?? "",
      page: row.keys[1] ?? "",
      clicks: row.clicks,
      impressions: row.impressions,
      ctr: row.ctr,
      position: row.position,
    }))
    .filter((row) => row.query.length > 0);

  const opportunities: SeoOpportunity[] = [];

  queryPageRows
    .filter((row) => row.impressions >= 30 && row.ctr < 0.02 && row.position <= 12)
    .sort((left, right) => right.impressions - left.impressions)
    .slice(0, 5)
    .forEach((row) => {
      opportunities.push({
        type: "ctr",
        priority: row.position <= 5 ? "High" : "Medium",
        title: "Shown often, not clicked",
        detail: `"${row.query}" is getting impressions but weak CTR.`,
        action: "Rewrite the title/meta description and make the offer match this query more directly.",
        query: row.query,
        page: row.page,
        metric: `${row.impressions} impressions · ${formatPercent(row.ctr)} CTR · position ${row.position.toFixed(2)}`,
      });
    });

  queryPageRows
    .filter((row) => row.impressions >= 10 && row.position >= 4 && row.position <= 15)
    .sort((left, right) => left.position - right.position || right.impressions - left.impressions)
    .slice(0, 5)
    .forEach((row) => {
      opportunities.push({
        type: "near_top",
        priority: row.position <= 10 ? "High" : "Medium",
        title: "Close to page-one win",
        detail: `"${row.query}" is already relevant but not consistently high enough.`,
        action: "Improve the landing page section for this exact intent, add internal links, FAQs, reviews, and clearer headings.",
        query: row.query,
        page: row.page,
        metric: `${row.impressions} impressions · position ${row.position.toFixed(2)}`,
      });
    });

  queryPageRows
    .filter((row) => row.impressions >= 30 && row.position > 15)
    .sort((left, right) => right.impressions - left.impressions)
    .slice(0, 5)
    .forEach((row) => {
      opportunities.push({
        type: "weak_rank",
        priority: "Medium",
        title: "Demand exists, ranking is weak",
        detail: `"${row.query}" has search visibility but the page is ranking too low.`,
        action: "Create or substantially improve a dedicated page for this search intent.",
        query: row.query,
        page: row.page,
        metric: `${row.impressions} impressions · position ${row.position.toFixed(2)}`,
      });
    });

  queryPageRows
    .filter((row) => row.clicks === 0 && row.impressions >= 20)
    .sort((left, right) => right.impressions - left.impressions)
    .slice(0, 5)
    .forEach((row) => {
      opportunities.push({
        type: "no_clicks",
        priority: row.position <= 10 ? "High" : "Low",
        title: "Impressions with zero clicks",
        detail: `"${row.query}" appeared in Search but produced no visits.`,
        action: "Check if the page title, snippet, and search intent are aligned before investing in more content.",
        query: row.query,
        page: row.page,
        metric: `${row.impressions} impressions · position ${row.position.toFixed(2)}`,
      });
    });

  const byQuery = new Map<string, Array<(typeof queryPageRows)[number]>>();
  queryPageRows.forEach((row) => {
    const key = normalizeSearchText(row.query);
    byQuery.set(key, [...(byQuery.get(key) ?? []), row]);
  });
  Array.from(byQuery.values())
    .filter((group) => new Set(group.map((row) => row.page).filter(Boolean)).size > 1)
    .map((group) => ({
      group,
      impressions: group.reduce((sum, row) => sum + row.impressions, 0),
    }))
    .filter(({ impressions }) => impressions >= 20)
    .sort((left, right) => right.impressions - left.impressions)
    .slice(0, 4)
    .forEach(({ group, impressions }) => {
      const sorted = [...group].sort((left, right) => right.impressions - left.impressions);
      opportunities.push({
        type: "cannibalization",
        priority: "Medium",
        title: "Multiple pages ranking for one query",
        detail: `"${sorted[0].query}" is split across ${new Set(group.map((row) => row.page).filter(Boolean)).size} URLs.`,
        action: "Pick the best landing page, strengthen internal links to it, and reduce duplicate/misaligned content.",
        query: sorted[0].query,
        page: sorted[0].page,
        metric: `${impressions} combined impressions`,
      });
    });

  const observedQueries = new Set(queryPageRows.map((row) => normalizeSearchText(row.query)));
  TARGET_KEYWORDS.filter((keyword) => {
    const normalized = normalizeSearchText(keyword);
    return !Array.from(observedQueries).some((query) => query.includes(normalized) || normalized.includes(query));
  }).forEach((keyword) => {
    opportunities.push({
      type: "missing_target",
      priority: "High",
      title: "Target keyword not visible",
      detail: `"${keyword}" did not appear in the top Search Console rows for this period.`,
      action: "Verify the site has a dedicated page/section for this intent and that it is indexable and internally linked.",
      query: keyword,
    });
  });

  const priorityRank = { High: 0, Medium: 1, Low: 2 };
  return opportunities
    .sort((left, right) => priorityRank[left.priority] - priorityRank[right.priority])
    .slice(0, 18);
};

const buildTargetKeywordRows = (rows: SearchConsolePerformanceRow[]): TargetKeywordTrackerRow[] =>
  TARGET_KEYWORDS.map((keyword) => {
    const normalizedKeyword = normalizeSearchText(keyword);
    const matches = rows.filter((row) => normalizeSearchText(row.keys[0] ?? "").includes(normalizedKeyword));
    const totals = getMetricTotals(matches);
    const topMatch = [...matches].sort((left, right) => left.position - right.position || right.impressions - left.impressions)[0] ?? null;
    return {
      keyword,
      found: matches.length > 0,
      topPage: topMatch?.keys[1] ?? null,
      clicks: totals.clicks,
      impressions: totals.impressions,
      ctr: totals.ctr,
      position: totals.position,
    };
  });

const buildLandingPageRows = (rows: SearchConsolePerformanceRow[]): LandingPageDiagnosisRow[] => {
  const byPage = new Map<string, SearchConsolePerformanceRow[]>();
  rows.forEach((row) => {
    const page = row.keys[1] ?? row.keys[0] ?? "";
    if (!page || !page.startsWith("http")) {
      return;
    }
    byPage.set(page, [...(byPage.get(page) ?? []), row]);
  });
  return Array.from(byPage.entries())
    .map(([page, pageRows]) => {
      const totals = getMetricTotals(pageRows);
      const topQueries = [...pageRows]
        .sort((left, right) => right.impressions - left.impressions)
        .slice(0, 4)
        .map((row) => row.keys[0] ?? "")
        .filter(Boolean);
      const issue =
        totals.impressions >= 30 && totals.ctr < 0.02
          ? "Snippet/intent issue"
          : totals.position > 15 && totals.impressions >= 30
            ? "Weak ranking"
            : topQueries.length > 2
              ? "Mixed query intent"
              : "Monitor";
      return { page, ...totals, topQueries, issue };
    })
    .sort((left, right) => right.impressions - left.impressions)
    .slice(0, 12);
};

const buildRecommendedSeoActions = (
  keywordRows: TargetKeywordTrackerRow[],
  opportunities: SeoOpportunity[],
  landingRows: LandingPageDiagnosisRow[],
): RecommendedSeoAction[] => {
  const actions: RecommendedSeoAction[] = [];

  keywordRows
    .filter((row) => row.found && row.position > 1.5 && row.position <= 3.5 && row.impressions >= 50)
    .sort((left, right) => right.impressions - left.impressions)
    .slice(0, 3)
    .forEach((row) => {
      actions.push({
        id: `defend-top-${row.keyword}`,
        priority: "High",
        actionType: "title_meta",
        title: `Improve CTR for "${row.keyword}"`,
        why: `Already ranking at position ${row.position.toFixed(2)} with ${row.impressions} impressions, so small snippet gains can convert quickly.`,
        nextStep: "Rewrite the title/meta around the exact offer, price/value, social proof, and Krakow intent.",
        targetQuery: row.keyword,
        targetPage: row.topPage,
        details: `Target keyword is close to position 1. Current metrics: ${row.clicks} clicks, ${row.impressions} impressions, ${formatPercent(row.ctr)} CTR, average position ${row.position.toFixed(2)}.`,
      });
    });

  keywordRows
    .filter((row) => row.found && row.position > 3.5 && row.position <= 15)
    .sort((left, right) => left.position - right.position || right.impressions - left.impressions)
    .slice(0, 3)
    .forEach((row) => {
      actions.push({
        id: `lift-opportunity-${row.keyword}`,
        priority: "High",
        actionType: "content_update",
        title: `Strengthen ranking for "${row.keyword}"`,
        why: `Google already sees relevance, but position ${row.position.toFixed(2)} is leaving traffic on the table.`,
        nextStep: "Add a focused section or page for this intent, then link to it from the homepage and relevant booking content.",
        targetQuery: row.keyword,
        targetPage: row.topPage,
        details: `Improve content depth and internal links for ${row.keyword}. Current metrics: ${row.clicks} clicks, ${row.impressions} impressions, ${formatPercent(row.ctr)} CTR, average position ${row.position.toFixed(2)}.`,
      });
    });

  keywordRows
    .filter((row) => !row.found)
    .filter((row) => row.keyword !== "krawlthroughkrakow")
    .slice(0, 3)
    .forEach((row) => {
      actions.push({
        id: `create-page-${row.keyword}`,
        priority: row.keyword.includes("night") || row.keyword.includes("party") ? "High" : "Medium",
        actionType: "content_update",
        title: `Create visibility for "${row.keyword}"`,
        why: "This target keyword has no visible page in the returned Search Console rows.",
        nextStep: "Create or expand a landing page that matches this exact search intent and add internal links to it.",
        targetQuery: row.keyword,
        targetPage: null,
        details: `Target keyword is currently missing from Search Console visibility for this period. Create dedicated content, ensure it is indexable, and add internal links from the homepage/navigation where relevant.`,
      });
    });

  opportunities
    .filter((opportunity) => opportunity.type === "cannibalization")
    .slice(0, 2)
    .forEach((opportunity) => {
      actions.push({
        id: `canonical-focus-${opportunity.query ?? opportunity.page ?? "cannibalization"}`,
        priority: "Medium",
        actionType: "internal_links",
        title: `Choose one ranking page for "${opportunity.query ?? "split query"}"`,
        why: opportunity.detail,
        nextStep: "Pick the strongest page, point internal links to it, and reduce duplicate or competing copy on weaker pages.",
        targetQuery: opportunity.query ?? null,
        targetPage: opportunity.page ?? null,
        details: `${opportunity.detail} ${opportunity.metric ?? ""}`.trim(),
      });
    });

  landingRows
    .filter((row) => row.issue === "Snippet/intent issue")
    .slice(0, 2)
    .forEach((row) => {
      actions.push({
        id: `page-snippet-${row.page}`,
        priority: "Medium",
        actionType: "title_meta",
        title: "Fix low CTR landing page snippet",
        why: `${row.page} has ${row.impressions} impressions but only ${formatPercent(row.ctr)} CTR.`,
        nextStep: "Match the title/meta to the top queries and make the offer more specific in the snippet.",
        targetQuery: row.topQueries[0] ?? null,
        targetPage: row.page,
        details: `Landing page top queries: ${row.topQueries.join(", ") || "No query detail"}. Current metrics: ${row.clicks} clicks, ${row.impressions} impressions, ${formatPercent(row.ctr)} CTR, average position ${row.position.toFixed(2)}.`,
      });
    });

  const priorityRank = { High: 0, Medium: 1, Low: 2 };
  const seen = new Set<string>();
  return actions
    .filter((action) => {
      const key = `${action.actionType}-${action.targetQuery ?? ""}-${action.targetPage ?? ""}-${action.title}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .sort((left, right) => priorityRank[left.priority] - priorityRank[right.priority])
    .slice(0, 8);
};

const formatSerpPosition = (position: number | null): string => (position ? position.toString() : "-");

const SerpResultsTable = ({ title, rows }: { title: string; rows: SerpResultItem[] }) => (
  <Stack gap="xs">
    <Group justify="space-between" wrap="wrap">
      <Text fw={600} size="sm">{title}</Text>
      <Badge variant="light">{rows.length} results</Badge>
    </Group>
    {rows.length > 0 ? (
      <div style={{ overflowX: "auto" }}>
        <Table withTableBorder withColumnBorders striped highlightOnHover style={{ minWidth: 820 }}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Pos.</Table.Th>
              <Table.Th>Result</Table.Th>
              <Table.Th>Signals</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((row, index) => (
              <Table.Tr key={`${title}-${row.link ?? row.title ?? index}`}>
                <Table.Td>
                  <Group gap="xs">
                    <Text size="sm" fw={600}>{formatSerpPosition(row.position)}</Text>
                    {row.isTargetDomain ? <Badge color="green" variant="light">Us</Badge> : null}
                  </Group>
                </Table.Td>
                <Table.Td>
                  <Stack gap={2}>
                    <Text size="sm" fw={600}>{row.title ?? "Untitled result"}</Text>
                    <Text size="xs" c="dimmed">{row.link ?? row.displayedLink ?? "No link returned"}</Text>
                    {row.snippet ? <Text size="xs">{row.snippet}</Text> : null}
                  </Stack>
                </Table.Td>
                <Table.Td>
                  <Stack gap={2}>
                    {row.rating ? <Text size="xs">Rating: {row.rating.toFixed(1)}</Text> : null}
                    {row.reviews ? <Text size="xs">Reviews: <NumberFormatter value={row.reviews} thousandSeparator /></Text> : null}
                    {row.type ? <Text size="xs" c="dimmed">{row.type}</Text> : null}
                    {row.source ? <Text size="xs" c="dimmed">{row.source}</Text> : null}
                  </Stack>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </div>
    ) : (
      <Text size="sm" c="dimmed">No {title.toLowerCase()} returned for this SERP sample.</Text>
    )}
  </Stack>
);

const SearchConsolePage = ({ title = "Search Console" }: Props) => {
  const dispatch = useAppDispatch();
  const sitesQuery = useSearchConsoleSites();
  const [siteUrl, setSiteUrl] = useState<string | null>(null);
  const [overviewRange, setOverviewRange] = useState<DateRangeState>(() => createDateRange("last_28"));
  const [recommendationRange, setRecommendationRange] = useState<DateRangeState>(() => createDateRange("last_28"));
  const [opportunityRange, setOpportunityRange] = useState<DateRangeState>(() => createDateRange("last_28"));
  const [keywordRange, setKeywordRange] = useState<DateRangeState>(() => createDateRange("last_90"));
  const [landingRange, setLandingRange] = useState<DateRangeState>(() => createDateRange("last_28"));
  const [dimensionMode, setDimensionMode] = useState<"query" | "page" | "query,page">("query");
  const [inspectionUrl, setInspectionUrl] = useState(`https://${TARGET_DOMAIN}/`);
  const [actionType, setActionType] = useState("content_update");
  const [actionTitle, setActionTitle] = useState("");
  const [actionDetails, setActionDetails] = useState("");
  const [actionQuery, setActionQuery] = useState("");
  const [actionPage, setActionPage] = useState("");
  const [serpKeyword, setSerpKeyword] = useState("pub crawl krakow");
  const [serpLocation, setSerpLocation] = useState("Krakow, Lesser Poland Voivodeship, Poland");
  const [serpCountry, setSerpCountry] = useState("pl");
  const [serpLanguage, setSerpLanguage] = useState("en");

  useEffect(() => {
    dispatch(navigateToPage(title));
  }, [dispatch, title]);

  const siteOptions = useMemo(
    () =>
      (sitesQuery.data ?? []).map((site) => ({
        value: site.siteUrl,
        label: site.siteUrl,
        description: site.permissionLevel,
      })),
    [sitesQuery.data],
  );

  useEffect(() => {
    if (siteUrl || siteOptions.length === 0) {
      return;
    }
    const preferred =
      siteOptions.find((option) => option.value === `sc-domain:${TARGET_DOMAIN}`) ??
      siteOptions.find((option) => option.value === `https://${TARGET_DOMAIN}/`) ??
      siteOptions.find((option) => option.value.includes(TARGET_DOMAIN)) ??
      siteOptions[0];
    setSiteUrl(preferred.value);
  }, [siteOptions, siteUrl]);

  const dimensions = dimensionMode.split(",");
  const overviewDateRange = formatDateRange(overviewRange);
  const recommendationDateRange = formatDateRange(recommendationRange);
  const opportunityDateRange = formatDateRange(opportunityRange);
  const keywordDateRange = formatDateRange(keywordRange);
  const landingDateRange = formatDateRange(landingRange);
  const performanceQuery = useSearchConsolePerformance({
    siteUrl,
    startDate: overviewDateRange.startDate,
    endDate: overviewDateRange.endDate,
    dimensions,
  });
  const previousPeriod = getPreviousPeriod(overviewRange.startDate, overviewRange.endDate);
  const previousPerformanceQuery = useSearchConsolePerformance({
    siteUrl,
    startDate: previousPeriod.startDate,
    endDate: previousPeriod.endDate,
    dimensions,
  });
  const recommendationQuery = useSearchConsolePerformance({
    siteUrl,
    startDate: recommendationDateRange.startDate,
    endDate: recommendationDateRange.endDate,
    dimensions: ["query", "page"],
  });
  const opportunityQuery = useSearchConsolePerformance({
    siteUrl,
    startDate: opportunityDateRange.startDate,
    endDate: opportunityDateRange.endDate,
    dimensions: ["query", "page"],
  });
  const keywordQuery = useSearchConsolePerformance({
    siteUrl,
    startDate: keywordDateRange.startDate,
    endDate: keywordDateRange.endDate,
    dimensions: ["query", "page"],
  });
  const landingQuery = useSearchConsolePerformance({
    siteUrl,
    startDate: landingDateRange.startDate,
    endDate: landingDateRange.endDate,
    dimensions: ["query", "page"],
  });
  const inspectUrlMutation = useInspectSearchConsoleUrl();
  const serpAnalysisMutation = useAnalyzeGoogleSerp();
  const actionLogsQuery = useSeoActionLogs(siteUrl);
  const createActionLog = useCreateSeoActionLog();

  const rows = performanceQuery.data?.rows ?? EMPTY_PERFORMANCE_ROWS;
  const previousRows = previousPerformanceQuery.data?.rows ?? EMPTY_PERFORMANCE_ROWS;
  const recommendationRows = recommendationQuery.data?.rows ?? EMPTY_PERFORMANCE_ROWS;
  const opportunityRows = opportunityQuery.data?.rows ?? EMPTY_PERFORMANCE_ROWS;
  const keywordRows = keywordQuery.data?.rows ?? EMPTY_PERFORMANCE_ROWS;
  const landingRows = landingQuery.data?.rows ?? EMPTY_PERFORMANCE_ROWS;
  const totals = useMemo(() => getMetricTotals(rows), [rows]);
  const previousTotals = useMemo(() => getMetricTotals(previousRows), [previousRows]);
  const recommendationOpportunities = useMemo(() => buildSeoOpportunities(recommendationRows), [recommendationRows]);
  const recommendationKeywordRows = useMemo(() => buildTargetKeywordRows(recommendationRows), [recommendationRows]);
  const recommendationLandingPageRows = useMemo(() => buildLandingPageRows(recommendationRows), [recommendationRows]);
  const seoOpportunities = useMemo(() => buildSeoOpportunities(opportunityRows), [opportunityRows]);
  const targetKeywordRows = useMemo(() => buildTargetKeywordRows(keywordRows), [keywordRows]);
  const landingPageRows = useMemo(() => buildLandingPageRows(landingRows), [landingRows]);
  const recommendedSeoActions = useMemo(
    () => buildRecommendedSeoActions(recommendationKeywordRows, recommendationOpportunities, recommendationLandingPageRows),
    [recommendationKeywordRows, recommendationLandingPageRows, recommendationOpportunities],
  );

  const handleInspectUrl = () => {
    if (!siteUrl || !inspectionUrl.trim()) {
      return;
    }
    inspectUrlMutation.mutate({ siteUrl, inspectionUrl: inspectionUrl.trim() });
  };

  const handleCreateAction = async () => {
    if (!siteUrl || !actionTitle.trim()) {
      return;
    }
    await createActionLog.mutateAsync({
      siteUrl,
      actionType,
      title: actionTitle.trim(),
      details: actionDetails.trim() || null,
      targetQuery: actionQuery.trim() || null,
      targetPage: actionPage.trim() || null,
    });
    setActionTitle("");
    setActionDetails("");
    setActionQuery("");
    setActionPage("");
  };

  const handleAnalyzeSerp = () => {
    if (!serpKeyword.trim()) {
      return;
    }
    serpAnalysisMutation.mutate({
      keyword: serpKeyword.trim(),
      targetDomain: TARGET_DOMAIN,
      location: serpLocation.trim(),
      country: serpCountry.trim(),
      language: serpLanguage.trim(),
      googleDomain: "google.com",
    });
  };

  const applyRecommendedAction = (action: RecommendedSeoAction) => {
    setActionType(action.actionType);
    setActionTitle(action.title);
    setActionDetails(`${action.why}\n\nNext step: ${action.nextStep}\n\n${action.details}`);
    setActionQuery(action.targetQuery ?? "");
    setActionPage(action.targetPage ?? "");
  };

  return (
    <PageAccessGuard pageSlug={PAGE_SLUGS.searchConsole}>
      <Stack gap="lg">
        <Group justify="space-between" align="flex-start" wrap="wrap">
          <Stack gap={6}>
            <Group gap="xs">
              <IconBrandGoogle size={26} />
              <Title order={2}>Search Console</Title>
            </Group>
            <Text size="sm" c="dimmed">
              Track Google Search performance for {TARGET_DOMAIN}.
            </Text>
          </Stack>
          <Button
            variant="default"
            leftSection={<IconRefresh size={16} />}
            onClick={() => {
              sitesQuery.refetch();
              performanceQuery.refetch();
              previousPerformanceQuery.refetch();
              recommendationQuery.refetch();
              opportunityQuery.refetch();
              keywordQuery.refetch();
              landingQuery.refetch();
              actionLogsQuery.refetch();
            }}
            loading={
              sitesQuery.isFetching ||
              performanceQuery.isFetching ||
              previousPerformanceQuery.isFetching ||
              recommendationQuery.isFetching ||
              opportunityQuery.isFetching ||
              keywordQuery.isFetching ||
              landingQuery.isFetching ||
              actionLogsQuery.isFetching
            }
          >
            Refresh
          </Button>
        </Group>

        {sitesQuery.isError ? (
          <Alert color="red" icon={<IconAlertCircle size={16} />} title="Unable to load Search Console properties">
            {extractErrorMessage(sitesQuery.error)}
          </Alert>
        ) : null}

        {performanceQuery.isError ? (
          <Alert color="red" icon={<IconAlertCircle size={16} />} title="Unable to load performance">
            {extractErrorMessage(performanceQuery.error)}
          </Alert>
        ) : null}

        <Card withBorder radius="md" padding="lg">
          <Group align="flex-end" wrap="wrap">
            <Select
              label="Property"
              placeholder={sitesQuery.isLoading ? "Loading properties..." : "Select property"}
              data={siteOptions}
              value={siteUrl}
              onChange={setSiteUrl}
              searchable
              nothingFoundMessage="No Search Console properties"
              style={{ flex: "1 1 360px" }}
            />
            <Select
              label="Performance rows view"
              data={[
                { value: "query", label: "Queries" },
                { value: "page", label: "Pages" },
                { value: "query,page", label: "Query + page" },
              ]}
              value={dimensionMode}
              onChange={(value) => setDimensionMode((value as typeof dimensionMode | null) ?? "query")}
            />
          </Group>
        </Card>

        <Card withBorder radius="md" padding="lg">
          <Stack gap="md">
            <Group justify="space-between" wrap="wrap">
              <Text fw={600}>Overview date range</Text>
              <Badge variant="light">{overviewDateRange.startDate} to {overviewDateRange.endDate}</Badge>
            </Group>
            <DateRangeControls range={overviewRange} onChange={setOverviewRange} label="Range" />
          </Stack>
        </Card>

        <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="md">
          <Card withBorder radius="md" padding="lg">
            <Text size="sm" c="dimmed">Clicks</Text>
            <Title order={3}><NumberFormatter value={totals.clicks} thousandSeparator /></Title>
          </Card>
          <Card withBorder radius="md" padding="lg">
            <Text size="sm" c="dimmed">Impressions</Text>
            <Title order={3}><NumberFormatter value={totals.impressions} thousandSeparator /></Title>
          </Card>
          <Card withBorder radius="md" padding="lg">
            <Text size="sm" c="dimmed">CTR</Text>
            <Title order={3}>{formatPercent(totals.ctr)}</Title>
          </Card>
          <Card withBorder radius="md" padding="lg">
            <Text size="sm" c="dimmed">Average position</Text>
            <Title order={3}>{totals.position > 0 ? totals.position.toFixed(2) : "-"}</Title>
          </Card>
        </SimpleGrid>

        <Card withBorder radius="md" padding="lg">
          <Stack gap="md">
            <Group justify="space-between" wrap="wrap">
              <Text fw={600}>Current vs previous period</Text>
              <Badge variant="light">
                {previousPeriod.startDate} to {previousPeriod.endDate}
              </Badge>
            </Group>
            <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="md">
              {[
                { label: "Clicks", current: totals.clicks, previous: previousTotals.clicks },
                { label: "Impressions", current: totals.impressions, previous: previousTotals.impressions },
                { label: "CTR", current: totals.ctr, previous: previousTotals.ctr, percent: true },
                { label: "Position", current: totals.position, previous: previousTotals.position, inverseGood: true },
              ].map((metric) => {
                const delta = formatDelta(metric.current - metric.previous, {
                  percent: metric.percent,
                  inverseGood: metric.inverseGood,
                });
                return (
                  <div
                    key={metric.label}
                    style={{ border: "1px solid var(--mantine-color-gray-3)", borderRadius: 8, padding: 16 }}
                  >
                    <Text size="sm" c="dimmed">{metric.label}</Text>
                    <Group justify="space-between" align="flex-end">
                      <Text fw={700}>
                        {metric.percent
                          ? formatPercent(metric.current)
                          : metric.label === "Position"
                            ? metric.current > 0 ? metric.current.toFixed(2) : "-"
                            : <NumberFormatter value={metric.current} thousandSeparator />}
                      </Text>
                      <Badge color={delta.color} variant="light">{delta.label}</Badge>
                    </Group>
                  </div>
                );
              })}
            </SimpleGrid>
          </Stack>
        </Card>

        <Card withBorder radius="md" padding="lg">
          <Stack gap="md">
            <Group justify="space-between" wrap="wrap">
              <Group gap="xs">
                <IconSearch size={20} />
                <Text fw={600}>Live SERP analysis</Text>
              </Group>
              {serpAnalysisMutation.data ? (
                <Badge variant="light">
                  {new Date(serpAnalysisMutation.data.searchedAt).toLocaleString()}
                </Badge>
              ) : null}
            </Group>
            <Group align="flex-end" wrap="wrap">
              <TextInput
                label="Keyword"
                value={serpKeyword}
                onChange={(event) => setSerpKeyword(event.currentTarget.value)}
                placeholder="pub crawl krakow"
                style={{ flex: "1 1 260px" }}
              />
              <TextInput
                label="Location"
                value={serpLocation}
                onChange={(event) => setSerpLocation(event.currentTarget.value)}
                placeholder="Krakow, Lesser Poland Voivodeship, Poland"
                style={{ flex: "1 1 320px" }}
              />
              <TextInput
                label="Country"
                value={serpCountry}
                onChange={(event) => setSerpCountry(event.currentTarget.value)}
                style={{ width: 110 }}
              />
              <TextInput
                label="Language"
                value={serpLanguage}
                onChange={(event) => setSerpLanguage(event.currentTarget.value)}
                style={{ width: 120 }}
              />
              <Button
                leftSection={<IconSearch size={16} />}
                onClick={handleAnalyzeSerp}
                loading={serpAnalysisMutation.isPending}
                disabled={!serpKeyword.trim()}
              >
                Analyze SERP
              </Button>
            </Group>

            {serpAnalysisMutation.isError ? (
              <Alert color="red" icon={<IconAlertCircle size={16} />} title="Unable to analyze SERP">
                {extractErrorMessage(serpAnalysisMutation.error)}
              </Alert>
            ) : null}

            {serpAnalysisMutation.data ? (
              <Stack gap="md">
                <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="md">
                  <div style={{ border: "1px solid var(--mantine-color-gray-3)", borderRadius: 8, padding: 16 }}>
                    <Text size="sm" c="dimmed">Organic position</Text>
                    <Title order={4}>{formatSerpPosition(serpAnalysisMutation.data.summary.topOrganicPosition)}</Title>
                  </div>
                  <div style={{ border: "1px solid var(--mantine-color-gray-3)", borderRadius: 8, padding: 16 }}>
                    <Text size="sm" c="dimmed">Local position</Text>
                    <Title order={4}>{formatSerpPosition(serpAnalysisMutation.data.summary.topLocalPosition)}</Title>
                  </div>
                  <div style={{ border: "1px solid var(--mantine-color-gray-3)", borderRadius: 8, padding: 16 }}>
                    <Text size="sm" c="dimmed">Ad position</Text>
                    <Title order={4}>{formatSerpPosition(serpAnalysisMutation.data.summary.topAdPosition)}</Title>
                  </div>
                  <div style={{ border: "1px solid var(--mantine-color-gray-3)", borderRadius: 8, padding: 16 }}>
                    <Text size="sm" c="dimmed">SERP pressure</Text>
                    <Title order={4}>{serpAnalysisMutation.data.summary.aboveTheFoldPressure}</Title>
                  </div>
                </SimpleGrid>

                <Group gap="xs" wrap="wrap">
                  <Badge color={serpAnalysisMutation.data.features.hasAds ? "yellow" : "gray"} variant="light">
                    {serpAnalysisMutation.data.features.hasAds ? "Ads present" : "No ads detected"}
                  </Badge>
                  <Badge color={serpAnalysisMutation.data.features.hasLocalPack ? "yellow" : "gray"} variant="light">
                    {serpAnalysisMutation.data.features.hasLocalPack ? "Local pack present" : "No local pack detected"}
                  </Badge>
                  <Badge color={serpAnalysisMutation.data.features.hasPlacesSites ? "yellow" : "gray"} variant="light">
                    {serpAnalysisMutation.data.features.hasPlacesSites ? "Places sites present" : "No places sites detected"}
                  </Badge>
                  <Badge variant="light">
                    {serpAnalysisMutation.data.features.organicResultCount} organic results
                  </Badge>
                </Group>

                <Stack gap="xs">
                  <Text fw={600} size="sm">Diagnosis</Text>
                  {serpAnalysisMutation.data.summary.diagnosis.map((entry) => (
                    <Text key={entry} size="sm">{entry}</Text>
                  ))}
                </Stack>

                <SerpResultsTable title="Target-domain results" rows={serpAnalysisMutation.data.targetResults} />
                <SerpResultsTable title="Ads" rows={serpAnalysisMutation.data.ads.slice(0, 6)} />
                <SerpResultsTable title="Local results" rows={serpAnalysisMutation.data.localResults.slice(0, 8)} />
                <SerpResultsTable title="Organic results" rows={serpAnalysisMutation.data.organicResults.slice(0, 10)} />
              </Stack>
            ) : (
              <Text size="sm" c="dimmed">
                Run a live SERP sample to compare Search Console metrics against ads, local pack, and organic competitors.
              </Text>
            )}
          </Stack>
        </Card>

        <Card withBorder radius="md" padding="lg">
          <Stack gap="md">
            <Group justify="space-between" wrap="wrap">
              <Group gap="xs">
                <IconChecklist size={20} />
                <Text fw={600}>Recommended SEO actions</Text>
              </Group>
              <Badge variant="light">{recommendedSeoActions.length} actions</Badge>
            </Group>
            <DateRangeControls range={recommendationRange} onChange={setRecommendationRange} label="Recommendation range" />

            {recommendationQuery.isLoading ? (
              <Text size="sm" c="dimmed">Building recommendations from Search Console data...</Text>
            ) : recommendedSeoActions.length > 0 ? (
              <div style={{ overflowX: "auto" }}>
                <Table withTableBorder withColumnBorders striped highlightOnHover style={{ minWidth: 1060 }}>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Priority</Table.Th>
                      <Table.Th>Recommended action</Table.Th>
                      <Table.Th>Why it matters</Table.Th>
                      <Table.Th>Next step</Table.Th>
                      <Table.Th>Log</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {recommendedSeoActions.map((action) => (
                      <Table.Tr key={action.id}>
                        <Table.Td>
                          <Badge
                            color={
                              action.priority === "High"
                                ? "red"
                                : action.priority === "Medium"
                                  ? "yellow"
                                  : "gray"
                            }
                            variant="light"
                          >
                            {action.priority}
                          </Badge>
                        </Table.Td>
                        <Table.Td>
                          <Stack gap={2}>
                            <Text fw={600} size="sm">{action.title}</Text>
                            {action.targetQuery ? <Text size="xs">Query: {action.targetQuery}</Text> : null}
                            {action.targetPage ? <Text size="xs" c="dimmed">{action.targetPage}</Text> : null}
                          </Stack>
                        </Table.Td>
                        <Table.Td><Text size="sm">{action.why}</Text></Table.Td>
                        <Table.Td><Text size="sm">{action.nextStep}</Text></Table.Td>
                        <Table.Td>
                          <Button size="xs" variant="light" onClick={() => applyRecommendedAction(action)}>
                            Use
                          </Button>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </div>
            ) : (
              <Text size="sm" c="dimmed">
                No recommended actions for this period. Expand the date range if the data set is too small.
              </Text>
            )}
          </Stack>
        </Card>

        <Card withBorder radius="md" padding="lg">
          <Stack gap="md">
            <Group justify="space-between" wrap="wrap">
              <Group gap="xs">
                <IconBulb size={20} />
                <Text fw={600}>SEO opportunities</Text>
              </Group>
              <Badge variant="light">{seoOpportunities.length} flags</Badge>
            </Group>
            <DateRangeControls range={opportunityRange} onChange={setOpportunityRange} label="Opportunity range" />

            {opportunityQuery.isLoading ? (
              <Text size="sm" c="dimmed">Analyzing query and page performance...</Text>
            ) : seoOpportunities.length > 0 ? (
              <div style={{ overflowX: "auto" }}>
                <Table withTableBorder withColumnBorders striped highlightOnHover style={{ minWidth: 980 }}>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Priority</Table.Th>
                      <Table.Th>Issue</Table.Th>
                      <Table.Th>Evidence</Table.Th>
                      <Table.Th>Action</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {seoOpportunities.map((opportunity, index) => (
                      <Table.Tr key={`${opportunity.type}-${opportunity.query ?? ""}-${opportunity.page ?? ""}-${index}`}>
                        <Table.Td>
                          <Badge
                            color={
                              opportunity.priority === "High"
                                ? "red"
                                : opportunity.priority === "Medium"
                                  ? "yellow"
                                  : "gray"
                            }
                            variant="light"
                          >
                            {opportunity.priority}
                          </Badge>
                        </Table.Td>
                        <Table.Td>
                          <Stack gap={2}>
                            <Text fw={600} size="sm">{opportunity.title}</Text>
                            <Text size="xs" c="dimmed">{opportunity.detail}</Text>
                            {opportunity.query ? <Text size="xs">Query: {opportunity.query}</Text> : null}
                            {opportunity.page ? <Text size="xs" c="dimmed">{opportunity.page}</Text> : null}
                          </Stack>
                        </Table.Td>
                        <Table.Td>
                          <Text size="sm">{opportunity.metric ?? "Target keyword coverage check"}</Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size="sm">{opportunity.action}</Text>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </div>
            ) : (
              <Text size="sm" c="dimmed">
                No obvious SEO opportunity flags for this date range.
              </Text>
            )}
          </Stack>
        </Card>

        <Card withBorder radius="md" padding="lg">
          <Stack gap="md">
            <Group justify="space-between" wrap="wrap">
              <Text fw={600}>Target keyword tracker</Text>
              <Badge variant="light">{targetKeywordRows.filter((row) => row.found).length}/{targetKeywordRows.length} visible</Badge>
            </Group>
            <DateRangeControls range={keywordRange} onChange={setKeywordRange} label="Keyword range" />
            {keywordQuery.isLoading ? (
              <Text size="sm" c="dimmed">Loading target keyword visibility...</Text>
            ) : (
            <div style={{ overflowX: "auto" }}>
              <Table withTableBorder withColumnBorders striped highlightOnHover style={{ minWidth: 880 }}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Keyword</Table.Th>
                    <Table.Th>Best page</Table.Th>
                    <Table.Th ta="right">Clicks</Table.Th>
                    <Table.Th ta="right">Impressions</Table.Th>
                    <Table.Th ta="right">CTR</Table.Th>
                    <Table.Th ta="right">Position</Table.Th>
                    <Table.Th>Status</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {targetKeywordRows.map((row) => (
                    <Table.Tr key={row.keyword}>
                      <Table.Td><Text fw={600} size="sm">{row.keyword}</Text></Table.Td>
                      <Table.Td><Text size="xs" c="dimmed">{row.topPage ?? "No page visible"}</Text></Table.Td>
                      <Table.Td ta="right"><NumberFormatter value={row.clicks} thousandSeparator /></Table.Td>
                      <Table.Td ta="right"><NumberFormatter value={row.impressions} thousandSeparator /></Table.Td>
                      <Table.Td ta="right">{formatPercent(row.ctr)}</Table.Td>
                      <Table.Td ta="right">{row.position > 0 ? row.position.toFixed(2) : "-"}</Table.Td>
                      <Table.Td>
                        <Badge color={!row.found ? "red" : row.position <= 3 ? "green" : row.position <= 15 ? "yellow" : "gray"} variant="light">
                          {!row.found ? "Missing" : row.position <= 3 ? "Strong" : row.position <= 15 ? "Opportunity" : "Weak"}
                        </Badge>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </div>
            )}
          </Stack>
        </Card>

        <Card withBorder radius="md" padding="lg">
          <Stack gap="md">
            <Group justify="space-between" wrap="wrap">
              <Text fw={600}>Landing page diagnosis</Text>
              <Badge variant="light">{landingPageRows.length} pages</Badge>
            </Group>
            <DateRangeControls range={landingRange} onChange={setLandingRange} label="Landing range" />
            {landingQuery.isLoading ? (
              <Text size="sm" c="dimmed">Analyzing landing pages...</Text>
            ) : landingPageRows.length > 0 ? (
              <div style={{ overflowX: "auto" }}>
                <Table withTableBorder withColumnBorders striped highlightOnHover style={{ minWidth: 980 }}>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Page</Table.Th>
                      <Table.Th>Top queries</Table.Th>
                      <Table.Th ta="right">Impressions</Table.Th>
                      <Table.Th ta="right">CTR</Table.Th>
                      <Table.Th ta="right">Position</Table.Th>
                      <Table.Th>Diagnosis</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {landingPageRows.map((row) => (
                      <Table.Tr key={row.page}>
                        <Table.Td><Text size="xs" fw={600}>{row.page}</Text></Table.Td>
                        <Table.Td><Text size="xs">{row.topQueries.join(", ") || "No query detail"}</Text></Table.Td>
                        <Table.Td ta="right"><NumberFormatter value={row.impressions} thousandSeparator /></Table.Td>
                        <Table.Td ta="right">{formatPercent(row.ctr)}</Table.Td>
                        <Table.Td ta="right">{row.position > 0 ? row.position.toFixed(2) : "-"}</Table.Td>
                        <Table.Td><Badge variant="light">{row.issue}</Badge></Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </div>
            ) : (
              <Text size="sm" c="dimmed">No landing page rows available for this period.</Text>
            )}
          </Stack>
        </Card>

        <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="lg">
          <Card withBorder radius="md" padding="lg">
            <Stack gap="md">
              <Text fw={600}>URL inspection</Text>
              <TextInput
                label="URL"
                value={inspectionUrl}
                onChange={(event) => setInspectionUrl(event.currentTarget.value)}
                placeholder={`https://${TARGET_DOMAIN}/`}
              />
              <Button onClick={handleInspectUrl} loading={inspectUrlMutation.isPending} disabled={!siteUrl || !inspectionUrl.trim()}>
                Inspect URL
              </Button>
              {inspectUrlMutation.isError ? (
                <Alert color="red" icon={<IconAlertCircle size={16} />}>
                  {extractErrorMessage(inspectUrlMutation.error)}
                </Alert>
              ) : null}
              {inspectUrlMutation.data ? (
                <Stack gap="xs">
                  <Group gap="xs">
                    <Badge color={inspectUrlMutation.data.verdict === "PASS" ? "green" : "yellow"} variant="light">
                      {inspectUrlMutation.data.verdict ?? "Unknown verdict"}
                    </Badge>
                    <Badge variant="light">{inspectUrlMutation.data.coverageState ?? "Unknown coverage"}</Badge>
                  </Group>
                  <Text size="sm">Last crawl: {inspectUrlMutation.data.lastCrawlTime ?? "Unknown"}</Text>
                  <Text size="sm">Google canonical: {inspectUrlMutation.data.googleCanonical ?? "Unknown"}</Text>
                  <Text size="sm">User canonical: {inspectUrlMutation.data.userCanonical ?? "Unknown"}</Text>
                </Stack>
              ) : null}
            </Stack>
          </Card>

          <Card withBorder radius="md" padding="lg">
            <Stack gap="md">
              <Text fw={600}>Log SEO action</Text>
              <Select
                label="Action type"
                data={[
                  { value: "content_update", label: "Content update" },
                  { value: "title_meta", label: "Title/meta update" },
                  { value: "internal_links", label: "Internal links" },
                  { value: "technical_fix", label: "Technical fix" },
                  { value: "backlink_outreach", label: "Backlink outreach" },
                  { value: "other", label: "Other" },
                ]}
                value={actionType}
                onChange={(value) => setActionType(value ?? "other")}
              />
              <TextInput label="Title" value={actionTitle} onChange={(event) => setActionTitle(event.currentTarget.value)} />
              <Group grow>
                <TextInput label="Target query" value={actionQuery} onChange={(event) => setActionQuery(event.currentTarget.value)} />
                <TextInput label="Target page" value={actionPage} onChange={(event) => setActionPage(event.currentTarget.value)} />
              </Group>
              <Textarea label="Details" value={actionDetails} onChange={(event) => setActionDetails(event.currentTarget.value)} minRows={3} />
              <Button onClick={handleCreateAction} loading={createActionLog.isPending} disabled={!siteUrl || !actionTitle.trim()}>
                Save action
              </Button>
            </Stack>
          </Card>
        </SimpleGrid>

        <Card withBorder radius="md" padding="lg">
          <Stack gap="md">
            <Group justify="space-between" wrap="wrap">
              <Text fw={600}>Action history</Text>
              <Badge variant="light">{actionLogsQuery.data?.length ?? 0} actions</Badge>
            </Group>
            {actionLogsQuery.isLoading ? (
              <Text size="sm" c="dimmed">Loading action history...</Text>
            ) : (actionLogsQuery.data ?? []).length > 0 ? (
              <Table withTableBorder withColumnBorders striped highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Date</Table.Th>
                    <Table.Th>Action</Table.Th>
                    <Table.Th>Target</Table.Th>
                    <Table.Th>Details</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {(actionLogsQuery.data ?? []).map((action) => (
                    <Table.Tr key={action.id}>
                      <Table.Td><Text size="xs">{new Date(action.createdAt).toLocaleString()}</Text></Table.Td>
                      <Table.Td>
                        <Stack gap={2}>
                          <Badge variant="light">{action.actionType}</Badge>
                          <Text size="sm" fw={600}>{action.title}</Text>
                        </Stack>
                      </Table.Td>
                      <Table.Td>
                        <Text size="xs">{action.targetQuery ?? "No query"}</Text>
                        <Text size="xs" c="dimmed">{action.targetPage ?? "No page"}</Text>
                      </Table.Td>
                      <Table.Td><Text size="sm">{action.details ?? "-"}</Text></Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            ) : (
              <Text size="sm" c="dimmed">No SEO actions logged yet.</Text>
            )}
          </Stack>
        </Card>

        <Card withBorder radius="md" padding="lg">
          <Stack gap="md">
            <Group justify="space-between" wrap="wrap">
              <Group gap="xs">
                <IconSearch size={20} />
                <Text fw={600}>Performance rows</Text>
              </Group>
              <Group gap="xs">
                <Badge variant="light">{overviewDateRange.startDate} to {overviewDateRange.endDate}</Badge>
                <Badge variant="light">{rows.length} rows</Badge>
              </Group>
            </Group>

            {performanceQuery.isLoading ? (
              <Text size="sm" c="dimmed">Loading Search Console performance...</Text>
            ) : rows.length > 0 ? (
              <div style={{ overflowX: "auto" }}>
                <Table withTableBorder withColumnBorders striped highlightOnHover style={{ minWidth: 860 }}>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>{dimensionMode === "query,page" ? "Query / page" : dimensionMode === "page" ? "Page" : "Query"}</Table.Th>
                      <Table.Th ta="right">Clicks</Table.Th>
                      <Table.Th ta="right">Impressions</Table.Th>
                      <Table.Th ta="right">CTR</Table.Th>
                      <Table.Th ta="right">Position</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {rows.map((row, index) => (
                      <Table.Tr key={`${row.keys.join("-")}-${index}`}>
                        <Table.Td>
                          <Stack gap={2}>
                            <Text size="sm" fw={600}>{row.keys[0] ?? "(not provided)"}</Text>
                            {row.keys[1] ? <Text size="xs" c="dimmed">{row.keys[1]}</Text> : null}
                          </Stack>
                        </Table.Td>
                        <Table.Td ta="right"><NumberFormatter value={row.clicks} thousandSeparator /></Table.Td>
                        <Table.Td ta="right"><NumberFormatter value={row.impressions} thousandSeparator /></Table.Td>
                        <Table.Td ta="right">{formatPercent(row.ctr)}</Table.Td>
                        <Table.Td ta="right">{row.position.toFixed(2)}</Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </div>
            ) : (
              <Text size="sm" c="dimmed">
                No Search Console rows returned for the selected property and date range.
              </Text>
            )}
          </Stack>
        </Card>
      </Stack>
    </PageAccessGuard>
  );
};

export default SearchConsolePage;
