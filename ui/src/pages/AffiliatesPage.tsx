import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Alert,
  Button,
  Card,
  Divider,
  Group,
  Loader,
  Paper,
  MultiSelect,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
  ThemeIcon,
  ScrollArea,
  Accordion,
  ActionIcon,
} from "@mantine/core";
import { DatePickerInput } from "@mantine/dates";
import { useMediaQuery } from "@mantine/hooks";
import {
  IconCalendarEvent,
  IconChartBar,
  IconDeviceFloppy,
  IconPlus,
  IconTrash,
  IconUsers,
} from "@tabler/icons-react";
import { isAxiosError } from "axios";
import dayjs from "dayjs";
import { navigateToPage } from "../actions/navigationActions";
import { PageAccessGuard } from "../components/access/PageAccessGuard";
import AffiliateChartSection from "../components/affiliates/AffiliateChartSection";
import { PAGE_SLUGS } from "../constants/pageSlugs";
import { useAppDispatch } from "../store/hooks";
import type { GenericPageProps } from "../types/general/GenericPageProps";
import {
  fetchAffiliateOverview,
  saveAffiliateAssignments,
  type AffiliateAssignmentRule,
  type AffiliateOverviewResponse,
} from "../api/affiliates";

const PAGE_SLUG = PAGE_SLUGS.affiliates;

type DatePreset =
  | "today"
  | "yesterday"
  | "this_week"
  | "last_week"
  | "last_7_days"
  | "last_14_days"
  | "this_month"
  | "last_month"
  | "all_time"
  | "custom";

type DateRangeValue = [Date | null, Date | null];

const DATE_PRESET_OPTIONS: Array<{ value: DatePreset; label: string }> = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "this_week", label: "This week" },
  { value: "last_week", label: "Last week" },
  { value: "last_7_days", label: "Last 7 days" },
  { value: "last_14_days", label: "Last 14 days" },
  { value: "this_month", label: "This month" },
  { value: "last_month", label: "Last month" },
  { value: "all_time", label: "All time" },
  { value: "custom", label: "Custom" },
];

const formatMoney = (value: number, currency?: string | null): string => {
  if (currency === "PLN") {
    return `${new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value)} z\u0142`;
  }

  if (currency) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  }

  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
};

const formatCount = (value: number): string =>
  new Intl.NumberFormat("en-US", {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
  }).format(value);

const formatDisplayRange = (range: DateRangeValue): string => {
  const [start, end] = range;
  if (!start || !end) {
    return "Select a range";
  }
  const startLabel = dayjs(start).format("MMM D, YYYY");
  const endLabel = dayjs(end).format("MMM D, YYYY");
  return startLabel === endLabel ? startLabel : `${startLabel} - ${endLabel}`;
};

const createRange = (start: Date, end: Date): DateRangeValue => [start, end];

const getPresetRange = (preset: Exclude<DatePreset, "custom">, reference: dayjs.Dayjs = dayjs()): DateRangeValue => {
  const today = reference.startOf("day");
  switch (preset) {
    case "today":
      return createRange(today.toDate(), today.toDate());
    case "yesterday": {
      const yesterday = today.subtract(1, "day");
      return createRange(yesterday.toDate(), yesterday.toDate());
    }
    case "this_week":
      return createRange(today.startOf("week").toDate(), today.toDate());
    case "last_week": {
      const lastWeekEnd = today.startOf("week").subtract(1, "day");
      return createRange(lastWeekEnd.startOf("week").toDate(), lastWeekEnd.toDate());
    }
    case "last_7_days": {
      const yesterday = today.subtract(1, "day");
      return createRange(yesterday.subtract(6, "day").toDate(), yesterday.toDate());
    }
    case "last_14_days": {
      const yesterday = today.subtract(1, "day");
      return createRange(yesterday.subtract(13, "day").toDate(), yesterday.toDate());
    }
    case "this_month":
      return createRange(today.startOf("month").toDate(), today.toDate());
    case "last_month": {
      const lastMonthEnd = today.startOf("month").subtract(1, "day");
      return createRange(lastMonthEnd.startOf("month").toDate(), lastMonthEnd.toDate());
    }
    case "all_time":
      return createRange(new Date("2000-01-01T00:00:00.000Z"), today.toDate());
  }
};

const MetricCard = ({
  label,
  value,
  description,
  icon,
}: {
  label: string;
  value: string;
  description: string;
  icon: ReactNode;
}) => (
  <Card withBorder radius="lg" p="md" shadow="xs">
    <Stack gap={8} align="center">
      <ThemeIcon radius="xl" variant="light" size="lg">
        {icon}
      </ThemeIcon>
      <Text size="xs" tt="uppercase" fw={700} c="dimmed" ta="center" style={{ letterSpacing: "0.12em" }}>
        {label}
      </Text>
      <Text fw={800} fz={{ base: 24, sm: 28 }} ta="center">
        {value}
      </Text>
      <Text size="sm" c="dimmed" ta="center">
        {description}
      </Text>
    </Stack>
  </Card>
);

const SectionCard = ({ title, icon, right, children }: { title: string; icon: ReactNode; right?: ReactNode; children: ReactNode }) => (
  <Card withBorder radius="lg" p="md" shadow="xs">
    <Stack gap="md">
      <Group justify="space-between" align="center" wrap="nowrap">
        <Group gap="sm" wrap="nowrap">
          <ThemeIcon radius="xl" variant="light" size="lg">
            {icon}
          </ThemeIcon>
          <Text fw={800} size="lg">
            {title}
          </Text>
        </Group>
        {right}
      </Group>
      {children}
    </Stack>
  </Card>
);

const formatBookingDate = (value: string | null): string => {
  if (!value) {
    return "-";
  }
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format("MMM D, YYYY") : "-";
};

const normalizeRule = (rule: AffiliateAssignmentRule): AffiliateAssignmentRule => ({
  ...rule,
  utmSource: rule.utmSource?.trim() ? rule.utmSource.trim() : null,
  utmMedium: rule.utmMedium?.trim() ? rule.utmMedium.trim() : null,
  utmCampaign: rule.utmCampaign?.trim() ? rule.utmCampaign.trim() : null,
  notes: rule.notes?.trim() ? rule.notes.trim() : null,
});

const parseCsvValues = (value: string | null): string[] =>
  value
    ? value
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
    : [];

const makeRuleId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `rule-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const AffiliatesPage = ({ title }: GenericPageProps) => {
  const dispatch = useAppDispatch();
  const isMobile = useMediaQuery("(max-width: 48em)");
  const [preset, setPreset] = useState<DatePreset>("this_month");
  const [range, setRange] = useState<DateRangeValue>(() => getPresetRange("this_month"));
  const [affiliateFilter, setAffiliateFilter] = useState<string>("all");
  const [data, setData] = useState<AffiliateOverviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [draftRules, setDraftRules] = useState<AffiliateAssignmentRule[]>([]);

  useEffect(() => {
    dispatch(navigateToPage("Affiliates"));
  }, [dispatch, title]);

  const startDate = useMemo(() => dayjs(range[0] ?? new Date()).format("YYYY-MM-DD"), [range]);
  const endDate = useMemo(() => dayjs(range[1] ?? range[0] ?? new Date()).format("YYYY-MM-DD"), [range]);

  const canManageAssignments = Boolean(data?.currentUser.canManageAssignments);
  const isAffiliateUser = data?.currentUser.roleSlug === "affiliate";
  const selectedAffiliateUserId = affiliateFilter === "all" ? null : Number(affiliateFilter);
  const affiliateOptions = useMemo(
    () => [
      { value: "all", label: "All affiliates" },
      ...(data?.affiliateUsers ?? []).map((affiliate) => ({
        value: String(affiliate.id),
        label: affiliate.fullName,
      })),
    ],
    [data?.affiliateUsers],
  );

  const createEmptyRule = useCallback(
    (): AffiliateAssignmentRule => ({
      id: makeRuleId(),
      userId: data?.affiliateUsers[0]?.id ?? data?.currentUser.id ?? 0,
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
      notes: null,
    }),
    [data?.affiliateUsers, data?.currentUser.id],
  );

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const next = await fetchAffiliateOverview(startDate, endDate, selectedAffiliateUserId);
        if (!active) {
          return;
        }
        setData(next);
        setDraftRules(next.assignments.rules.length > 0 ? next.assignments.rules : [createEmptyRule()]);
        if (!next.currentUser.canManageAssignments) {
          setAffiliateFilter("all");
        }
      } catch (err: unknown) {
        if (!active) {
          return;
        }
        const message = isAxiosError(err) ? err.response?.data?.message ?? err.message : "Unable to load affiliate overview";
        setError(message);
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      active = false;
    };
  }, [createEmptyRule, endDate, selectedAffiliateUserId, startDate]);

  useEffect(() => {
    if (!canManageAssignments) {
      return;
    }
    if (draftRules.length === 0) {
      setDraftRules([createEmptyRule()]);
    }
  }, [canManageAssignments, createEmptyRule, draftRules.length]);

  const applyPreset = (value: Exclude<DatePreset, "custom">) => {
    setPreset(value);
    setRange(getPresetRange(value));
  };

  const addRule = () => {
    setDraftRules((current) => [...current, createEmptyRule()]);
  };

  const updateRule = (ruleId: string, patch: Partial<AffiliateAssignmentRule>) => {
    setDraftRules((current) =>
      current.map((rule) => (rule.id === ruleId ? normalizeRule({ ...rule, ...patch }) : rule)),
    );
  };

  const removeRule = (ruleId: string) => {
    setDraftRules((current) => current.filter((rule) => rule.id !== ruleId));
  };

  const handleSaveAssignments = async () => {
    try {
      setSaving(true);
      setSaveError(null);
      const cleanedRules = draftRules.map((rule) => normalizeRule(rule)).filter((rule) => rule.userId > 0);
      await saveAffiliateAssignments(cleanedRules);
      const refreshed = await fetchAffiliateOverview(startDate, endDate, selectedAffiliateUserId);
      setData(refreshed);
      setDraftRules(refreshed.assignments.rules.length > 0 ? refreshed.assignments.rules : [createEmptyRule()]);
    } catch (err: unknown) {
      const message = isAxiosError(err) ? err.response?.data?.message ?? err.message : "Unable to save affiliate assignments";
      setSaveError(message);
    } finally {
      setSaving(false);
    }
  };

  const revenueCurrency = data?.bookings.find((booking) => booking.currency)?.currency ?? "PLN";
  const utmCatalog = data?.utmCatalog ?? { utmSource: [], utmMedium: [], utmCampaign: [] };

  const sourceRows = data?.sourceBreakdown ?? [];
  const mediumRows = data?.mediumBreakdown ?? [];
  const campaignRows = data?.campaignBreakdown ?? [];
  const bookings = data?.bookings ?? [];

  return (
    <PageAccessGuard pageSlug={PAGE_SLUG}>
      <Stack gap="lg">
        <Paper withBorder radius="xl" p={isMobile ? "md" : "lg"} shadow="sm">
          <Stack gap="md">
            <Group justify="center" align="center">
              <Group gap="sm" wrap="nowrap" justify="center">
                <ThemeIcon size={isMobile ? 42 : 48} radius="xl" variant="filled" color="dark">
                  <IconChartBar size={isMobile ? 22 : 26} />
                </ThemeIcon>
                <Stack gap={0} align="center">
                  <Text size="xs" tt="uppercase" fw={700} c="dimmed" style={{ letterSpacing: "0.08em" }}>
                    Affiliate Sales
                  </Text>
                  <Title order={isMobile ? 2 : 1}>{title}</Title>
                </Stack>
              </Group>
            </Group>

            <Group grow align="end" wrap="wrap">
              {canManageAssignments ? (
                <Select
                  label="Affiliate"
                  data={affiliateOptions}
                  value={affiliateFilter}
                  onChange={(value) => setAffiliateFilter(value ?? "all")}
                  w={isMobile ? "100%" : 260}
                />
              ) : (
                <Paper withBorder radius="md" p="sm" style={{ width: isMobile ? "100%" : 260 }}>
                  <Stack gap={2}>
                    <Text size="xs" tt="uppercase" fw={700} c="dimmed" style={{ letterSpacing: "0.12em" }}>
                      Affiliate
                    </Text>
                    <Text fw={600}>{isAffiliateUser ? "Your bookings only" : "All visible bookings"}</Text>
                  </Stack>
                </Paper>
              )}
              <Select
                label="Period"
                data={DATE_PRESET_OPTIONS}
                value={preset}
                onChange={(value) => {
                  if (!value) {
                    return;
                  }
                  if (value === "custom") {
                    setPreset("custom");
                    return;
                  }
                  applyPreset(value as Exclude<DatePreset, "custom">);
                }}
                w={isMobile ? "100%" : 240}
              />
              <DatePickerInput
                type="range"
                label="Custom range"
                value={range}
                onChange={(nextRange) => {
                  const normalized: DateRangeValue = [nextRange[0] ?? null, nextRange[1] ?? null];
                  setPreset("custom");
                  setRange(normalized);
                }}
                disabled={preset !== "custom"}
                w={isMobile ? "100%" : 320}
              />
            </Group>

            <Text size="sm" c="dimmed" ta="center">
              {formatDisplayRange(range)}
            </Text>
          </Stack>
        </Paper>

        {error ? (
          <Alert color="red" radius="lg" title="Affiliate overview unavailable">
            {error}
          </Alert>
        ) : null}

        {saveError ? (
          <Alert color="red" radius="lg" title="Assignment save failed">
            {saveError}
          </Alert>
        ) : null}

        {loading && !data ? (
          <Group justify="center" py="xl">
            <Loader />
          </Group>
        ) : null}

        {data ? (
          <>
            <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="md">
              <MetricCard
                label="Bookings"
                value={formatCount(data.summary.bookingCount)}
                description={`${formatCount(data.summary.matchedAffiliateCount)} matched / ${formatCount(
                  data.summary.unassignedBookingCount,
                )} unassigned`}
                icon={<IconCalendarEvent size={18} />}
              />
              <MetricCard
                label="Revenue"
                value={formatMoney(data.summary.revenueTotal, revenueCurrency)}
                description={`${formatCount(data.summary.affiliateCount)} affiliates with sales`}
                icon={<IconChartBar size={18} />}
              />
              <MetricCard
                label="Affiliate users"
                value={formatCount(data.affiliateUsers.length)}
                description={data.currentUser.canManageAssignments ? "Assignable accounts" : "Your account"}
                icon={<IconUsers size={18} />}
              />
              <MetricCard
                label="Unassigned tags"
                value={formatCount(
                  data.unassignedTags.utmSource.length + data.unassignedTags.utmMedium.length + data.unassignedTags.utmCampaign.length,
                )}
                description="UTM values not mapped yet"
                icon={<IconChartBar size={18} />}
              />
            </SimpleGrid>

            <AffiliateChartSection
              data={data.dailySeries}
              formatCount={formatCount}
              formatMoney={formatMoney}
              revenueCurrency={revenueCurrency}
              isMobile={Boolean(isMobile)}
              sectionCard={(children) => (
                <SectionCard title="Sales trend" icon={<IconChartBar size={18} />}>
                  {children}
                </SectionCard>
              )}
            />

            <SimpleGrid cols={{ base: 1, xl: 2 }} spacing="md">
              <SectionCard title="Breakdown by source" icon={<IconCalendarEvent size={18} />}>
                <ScrollArea h={320}>
                  <Table stickyHeader withColumnBorders highlightOnHover>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Source</Table.Th>
                        <Table.Th ta="right">Bookings</Table.Th>
                        <Table.Th ta="right">Revenue</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {sourceRows.length === 0 ? (
                        <Table.Tr>
                          <Table.Td colSpan={3}>
                            <Text c="dimmed" ta="center">
                              No source data
                            </Text>
                          </Table.Td>
                        </Table.Tr>
                      ) : (
                        sourceRows.map((row) => (
                          <Table.Tr key={row.label}>
                            <Table.Td>{row.label}</Table.Td>
                            <Table.Td ta="right">{formatCount(row.bookingCount)}</Table.Td>
                            <Table.Td ta="right">{formatMoney(row.revenue, revenueCurrency)}</Table.Td>
                          </Table.Tr>
                        ))
                      )}
                    </Table.Tbody>
                  </Table>
                </ScrollArea>
              </SectionCard>

              <SectionCard title="Breakdown by campaign" icon={<IconCalendarEvent size={18} />}>
                <ScrollArea h={320}>
                  <Table stickyHeader withColumnBorders highlightOnHover>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Campaign</Table.Th>
                        <Table.Th ta="right">Bookings</Table.Th>
                        <Table.Th ta="right">Revenue</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {campaignRows.length === 0 ? (
                        <Table.Tr>
                          <Table.Td colSpan={3}>
                            <Text c="dimmed" ta="center">
                              No campaign data
                            </Text>
                          </Table.Td>
                        </Table.Tr>
                      ) : (
                        campaignRows.map((row) => (
                          <Table.Tr key={row.label}>
                            <Table.Td>{row.label}</Table.Td>
                            <Table.Td ta="right">{formatCount(row.bookingCount)}</Table.Td>
                            <Table.Td ta="right">{formatMoney(row.revenue, revenueCurrency)}</Table.Td>
                          </Table.Tr>
                        ))
                      )}
                    </Table.Tbody>
                  </Table>
                </ScrollArea>
              </SectionCard>
            </SimpleGrid>

            <SectionCard title="Breakdown by medium" icon={<IconCalendarEvent size={18} />}>
              <ScrollArea h={280}>
                <Table stickyHeader withColumnBorders highlightOnHover>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Medium</Table.Th>
                      <Table.Th ta="right">Bookings</Table.Th>
                      <Table.Th ta="right">Revenue</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {mediumRows.length === 0 ? (
                      <Table.Tr>
                        <Table.Td colSpan={3}>
                          <Text c="dimmed" ta="center">
                            No medium data
                          </Text>
                        </Table.Td>
                      </Table.Tr>
                    ) : (
                      mediumRows.map((row) => (
                        <Table.Tr key={row.label}>
                          <Table.Td>{row.label}</Table.Td>
                          <Table.Td ta="right">{formatCount(row.bookingCount)}</Table.Td>
                          <Table.Td ta="right">{formatMoney(row.revenue, revenueCurrency)}</Table.Td>
                        </Table.Tr>
                      ))
                    )}
                  </Table.Tbody>
                </Table>
              </ScrollArea>
            </SectionCard>

            <Accordion variant="separated" radius="lg">
              <Accordion.Item value="tags">
                <Accordion.Control>
                  <Text fw={800}>Discovered UTM tags</Text>
                </Accordion.Control>
                <Accordion.Panel>
                  <SimpleGrid cols={{ base: 1, lg: 3 }} spacing="md">
                    <TagListCard title="utm_source" rows={data.discoveredTags.utmSource} currency={revenueCurrency} />
                    <TagListCard title="utm_medium" rows={data.discoveredTags.utmMedium} currency={revenueCurrency} />
                    <TagListCard title="utm_campaign" rows={data.discoveredTags.utmCampaign} currency={revenueCurrency} />
                  </SimpleGrid>
                </Accordion.Panel>
              </Accordion.Item>
            </Accordion>

            <SectionCard title="Bookings" icon={<IconUsers size={18} />}>
              <ScrollArea h={520}>
                <Table stickyHeader withColumnBorders highlightOnHover>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Date</Table.Th>
                      <Table.Th>Booking</Table.Th>
                      <Table.Th>Guest</Table.Th>
                      <Table.Th>Product</Table.Th>
                      <Table.Th ta="right">Revenue</Table.Th>
                      <Table.Th>Affiliate</Table.Th>
                      <Table.Th>UTM</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {bookings.length === 0 ? (
                      <Table.Tr>
                        <Table.Td colSpan={7}>
                          <Text c="dimmed" ta="center">
                            No bookings found for this range
                          </Text>
                        </Table.Td>
                      </Table.Tr>
                    ) : (
                      bookings.map((booking) => (
                        <Table.Tr key={booking.id}>
                          <Table.Td>{formatBookingDate(booking.sourceReceivedAt)}</Table.Td>
                          <Table.Td>{booking.platformBookingId}</Table.Td>
                          <Table.Td>{booking.guestName}</Table.Td>
                          <Table.Td>{booking.productName ?? "-"}</Table.Td>
                          <Table.Td ta="right">{formatMoney(booking.baseAmount, booking.currency ?? revenueCurrency)}</Table.Td>
                          <Table.Td>{booking.affiliateUserName ?? "-"}</Table.Td>
                          <Table.Td>
                            <Stack gap={4}>
                              <Text size="xs" c="dimmed">
                                Source: {booking.utmSource ?? "-"}
                              </Text>
                              <Text size="xs" c="dimmed">
                                Medium: {booking.utmMedium ?? "-"}
                              </Text>
                              <Text size="xs" c="dimmed">
                                Campaign: {booking.utmCampaign ?? "-"}
                              </Text>
                            </Stack>
                          </Table.Td>
                        </Table.Tr>
                      ))
                    )}
                  </Table.Tbody>
                </Table>
              </ScrollArea>
            </SectionCard>

            {canManageAssignments ? (
              <SectionCard
                title="Affiliate assignments"
                icon={<IconUsers size={18} />}
                right={
                  <Button variant="light" leftSection={<IconPlus size={16} />} onClick={addRule}>
                    Add rule
                  </Button>
                }
              >
                <Alert color="blue" variant="light" radius="md">
                  UTM matches are exact and comma-separated values are allowed. Admins and managers can map tags to affiliate users here.
                </Alert>

                <Stack gap="md">
                  {draftRules.map((rule, index) => (
                    <Card key={rule.id} withBorder radius="md" p="md">
                      <Stack gap="sm">
                        <Group justify="space-between" align="center">
                          <Text fw={700}>Rule {index + 1}</Text>
                          <ActionIcon variant="light" color="red" aria-label="Delete rule" onClick={() => removeRule(rule.id)}>
                            <IconTrash size={16} />
                          </ActionIcon>
                        </Group>

                        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="sm">
                          <Select
                            label="Affiliate user"
                            data={data.affiliateUsers.map((affiliate) => ({
                              value: String(affiliate.id),
                              label: affiliate.fullName,
                            }))}
                            value={String(rule.userId)}
                            onChange={(value) => {
                              if (!value) {
                                return;
                              }
                              updateRule(rule.id, { userId: Number(value) });
                            }}
                          />
                          <TextInput
                            label="Notes"
                            value={rule.notes ?? ""}
                            onChange={(event) => updateRule(rule.id, { notes: event.currentTarget.value })}
                          />
                          <MultiSelect
                            label="UTM Source"
                            data={utmCatalog.utmSource}
                            searchable
                            clearable
                            nothingFoundMessage="No catalog values found"
                            placeholder="Select source tags"
                            value={parseCsvValues(rule.utmSource)}
                            onChange={(value) =>
                              updateRule(rule.id, { utmSource: value.length > 0 ? value.join(', ') : null })
                            }
                          />
                          <MultiSelect
                            label="UTM Medium"
                            data={utmCatalog.utmMedium}
                            searchable
                            clearable
                            nothingFoundMessage="No catalog values found"
                            placeholder="Select medium tags"
                            value={parseCsvValues(rule.utmMedium)}
                            onChange={(value) =>
                              updateRule(rule.id, { utmMedium: value.length > 0 ? value.join(', ') : null })
                            }
                          />
                          <MultiSelect
                            label="UTM Campaign"
                            data={utmCatalog.utmCampaign}
                            searchable
                            clearable
                            nothingFoundMessage="No catalog values found"
                            placeholder="Select campaign tags"
                            value={parseCsvValues(rule.utmCampaign)}
                            onChange={(value) =>
                              updateRule(rule.id, { utmCampaign: value.length > 0 ? value.join(', ') : null })
                            }
                          />
                        </SimpleGrid>
                      </Stack>
                    </Card>
                  ))}

                  <Group justify="flex-end">
                    <Button leftSection={<IconDeviceFloppy size={16} />} onClick={handleSaveAssignments} loading={saving}>
                      Save assignments
                    </Button>
                  </Group>
                </Stack>
              </SectionCard>
            ) : null}
          </>
        ) : null}
      </Stack>
    </PageAccessGuard>
  );
};

const TagListCard = ({
  title,
  rows,
  currency,
}: {
  title: string;
  rows: Array<{ value: string; bookingCount: number; revenue: number }>;
  currency?: string | null;
}) => (
  <Card withBorder radius="md" p="md">
    <Stack gap="sm">
      <Text fw={800}>{title}</Text>
      <Divider />
      <Stack gap={6}>
        {rows.length === 0 ? (
          <Text c="dimmed" size="sm">
            No values discovered
          </Text>
        ) : (
          rows.map((row) => (
            <Group key={row.value} justify="space-between" wrap="nowrap">
              <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
                <Text fw={600} lineClamp={1}>
                  {row.value}
                </Text>
                <Text size="xs" c="dimmed">
                  {formatCount(row.bookingCount)} bookings
                </Text>
              </Stack>
              <Text size="sm" fw={700} style={{ whiteSpace: "nowrap" }}>
                {formatMoney(row.revenue, currency)}
              </Text>
            </Group>
          ))
        )}
      </Stack>
    </Stack>
  </Card>
);

export default AffiliatesPage;
