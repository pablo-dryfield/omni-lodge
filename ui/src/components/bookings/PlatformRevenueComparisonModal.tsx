import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Badge,
  Box,
  Button,
  Checkbox,
  Group,
  Loader,
  Modal,
  MultiSelect,
  Paper,
  ScrollArea,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
} from "@mantine/core";
import { DatePickerInput } from "@mantine/dates";
import {
  IconAlertCircle,
  IconArrowDown,
  IconArrowUp,
  IconChartLine,
  IconEqual,
  IconRefresh,
} from "@tabler/icons-react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { UnifiedOrder } from "../../store/bookingPlatformsTypes";
import {
  BOOKINGS_SUMMARY_TIMEZONE,
  type BookingsSummaryDateField,
} from "../../utils/bookingsSummaryDate";
import axiosInstance from "../../utils/axiosInstance";
import {
  ALL_PLATFORM_COMPARISON_WEEKDAYS,
  buildPlatformRevenueComparisonPeriods,
  buildPlatformRevenueComparisonPivot,
  comparePlatformRevenueValues,
  getCompletedPlatformComparisonRange,
  getPlatformComparisonCurrencies,
  getPlatformComparisonPlatforms,
  type PlatformComparisonColumnMode,
  type PlatformComparisonWeekday,
  type PlatformComparisonWeekStartsOn,
  type PlatformRevenueComparisonCell,
  type PlatformRevenueComparisonInput,
} from "../../utils/platformRevenueComparison";

export type PlatformRevenueComparisonModalProps = {
  opened: boolean;
  onClose: () => void;
  dateField: BookingsSummaryDateField;
  productTypeIds?: string;
  defaultCurrency: string;
  mapOrder: (order: UnifiedOrder) => PlatformRevenueComparisonInput;
};

type DateRangeValue = [Date | null, Date | null];
type QuickWeekCount = 2 | 4 | 8;

const MAX_WEEK_COLUMNS = 104;
const MAX_DAY_COLUMNS = 93;
const DEFAULT_WEEK_COUNT: QuickWeekCount = 4;
const DEFAULT_WEEK_START: PlatformComparisonWeekStartsOn = 1;
const WEEKDAY_OPTIONS: Array<{ value: PlatformComparisonWeekday; label: string }> = [
  { value: 0, label: "Sun" },
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
];
const SUN_THU_WEEKDAYS: PlatformComparisonWeekday[] = [0, 1, 2, 3, 4];
const FRI_SAT_WEEKDAYS: PlatformComparisonWeekday[] = [5, 6];
const CHART_COLORS = [
  "#214A66",
  "#2B7A78",
  "#EF8354",
  "#345995",
  "#B56576",
  "#6B705C",
  "#7D4E57",
  "#3D5A80",
  "#9C6644",
  "#6A4C93",
];

const normalizeCurrency = (value?: string | null): string =>
  String(value ?? "PLN").trim().toUpperCase() || "PLN";

const formatMoneyNumber = (value: number): string => {
  const safeValue = Number.isFinite(value) ? value : 0;
  return safeValue.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 5,
    useGrouping: true,
  });
};

const formatMoney = (value: number, currency = "PLN"): string => {
  const normalizedCurrency = normalizeCurrency(currency);
  const displayCurrency = normalizedCurrency === "PLN" ? "z\u0142" : normalizedCurrency;
  return `${formatMoneyNumber(value)} ${displayCurrency}`;
};

const formatDateOnly = (value: Date): string => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const parseDateOnlyForPicker = (value: string): Date | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }
  const parsed = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0, 0);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const getWarsawDate = (): string => {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: BOOKINGS_SUMMARY_TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    if (values.year && values.month && values.day) {
      return `${values.year}-${values.month}-${values.day}`;
    }
  } catch {
    // Fall through to the local calendar date when Intl timezone data is unavailable.
  }
  return formatDateOnly(new Date());
};

const toPickerRange = (range: [string, string] | null): DateRangeValue => {
  if (!range) {
    return [null, null];
  }
  return [parseDateOnlyForPicker(range[0]), parseDateOnlyForPicker(range[1])];
};

const toDateOnlyRange = (range: DateRangeValue): [string, string] | null => {
  if (!range[0] || !range[1]) {
    return null;
  }
  return [formatDateOnly(range[0]), formatDateOnly(range[1])];
};

const getDefaultRange = (
  weekCount: QuickWeekCount = DEFAULT_WEEK_COUNT,
  weekStartsOn: PlatformComparisonWeekStartsOn = DEFAULT_WEEK_START,
): [string, string] | null =>
  getCompletedPlatformComparisonRange(getWarsawDate(), weekCount, weekStartsOn);

const isComparisonWeekday = (value: number): value is PlatformComparisonWeekday =>
  Number.isInteger(value) && value >= 0 && value <= 6;

const parseWeekdays = (values: string[]): PlatformComparisonWeekday[] =>
  values
    .map((value) => Number(value))
    .filter(isComparisonWeekday)
    .sort((left, right) => left - right);

const sameWeekdays = (
  left: readonly PlatformComparisonWeekday[],
  right: readonly PlatformComparisonWeekday[],
): boolean =>
  left.length === right.length && left.every((weekday, index) => weekday === right[index]);

const deriveErrorMessage = (error: unknown): string => {
  const candidate = error as {
    message?: string;
    response?: { data?: { message?: string; error?: string } };
  };
  return (
    candidate.response?.data?.message ||
    candidate.response?.data?.error ||
    candidate.message ||
    "Unable to load bookings for this comparison."
  );
};

const RevenueCell = ({
  cell,
  previousCell,
  currency,
  neutral = false,
}: {
  cell: PlatformRevenueComparisonCell;
  previousCell?: PlatformRevenueComparisonCell;
  currency: string;
  neutral?: boolean;
}) => {
  const direction = !neutral && previousCell
    ? comparePlatformRevenueValues(cell.revenue, previousCell.revenue)
    : null;
  const color = direction === "higher"
    ? "green.7"
    : direction === "lower"
      ? "red.7"
      : direction === "equal"
        ? "black"
        : "dark";
  const iconColor = direction === "higher"
    ? "var(--mantine-color-green-7)"
    : direction === "lower"
      ? "var(--mantine-color-red-7)"
      : "var(--mantine-color-black)";
  const DirectionIcon = direction === "higher"
    ? IconArrowUp
    : direction === "lower"
      ? IconArrowDown
      : direction === "equal"
        ? IconEqual
        : null;

  return (
    <Stack gap={2} align="center" miw={150}>
      <Group gap={4} wrap="nowrap" justify="center">
        <Text fw={800} c={color} ta="center" size="sm">
          {formatMoney(cell.revenue, currency)}
        </Text>
        {DirectionIcon ? <DirectionIcon size={15} color={iconColor} aria-hidden /> : null}
      </Group>
      <Text size="xs" c="dimmed" ta="center">
        {`${cell.bookings.toLocaleString()} bookings \u00b7 ${cell.people.toLocaleString()} guests`}
      </Text>
    </Stack>
  );
};

export const PlatformRevenueComparisonModal = ({
  opened,
  onClose,
  dateField,
  productTypeIds,
  defaultCurrency,
  mapOrder,
}: PlatformRevenueComparisonModalProps) => {
  const normalizedDefaultCurrency = normalizeCurrency(defaultCurrency);
  const initialRange = useMemo(() => getDefaultRange(), []);
  const [dateRange, setDateRange] = useState<DateRangeValue>(() => toPickerRange(initialRange));
  const [appliedRange, setAppliedRange] = useState<[string, string] | null>(null);
  const [columnMode, setColumnMode] = useState<PlatformComparisonColumnMode>("week");
  const [weekStartsOn, setWeekStartsOn] = useState<PlatformComparisonWeekStartsOn>(DEFAULT_WEEK_START);
  const [weekdays, setWeekdays] = useState<PlatformComparisonWeekday[]>([
    ...ALL_PLATFORM_COMPARISON_WEEKDAYS,
  ]);
  const [activeQuickWeeks, setActiveQuickWeeks] = useState<QuickWeekCount | null>(DEFAULT_WEEK_COUNT);
  const [currency, setCurrency] = useState(normalizedDefaultCurrency);
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [rows, setRows] = useState<PlatformRevenueComparisonInput[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestAbortRef = useRef<AbortController | null>(null);
  const mapOrderRef = useRef(mapOrder);
  mapOrderRef.current = mapOrder;

  const fetchComparisonRows = useCallback(
    async ({
      startDate,
      endDate,
      preferredCurrency,
      requestDateField,
      requestProductTypeIds,
    }: {
      startDate: string;
      endDate: string;
      preferredCurrency: string;
      requestDateField: BookingsSummaryDateField;
      requestProductTypeIds?: string;
    }) => {
      requestAbortRef.current?.abort();
      const controller = new AbortController();
      requestAbortRef.current = controller;
      setLoading(true);
      setError(null);

      try {
        const response = await axiosInstance.get("/bookings", {
          params: {
            pickupFrom: startDate,
            pickupTo: endDate,
            dateField: requestDateField,
            productTypeIds: requestProductTypeIds || undefined,
            ordersOnly: true,
          },
          signal: controller.signal,
          withCredentials: true,
        });
        if (controller.signal.aborted || requestAbortRef.current !== controller) {
          return;
        }

        const ordersPayload = Array.isArray(response.data?.orders)
          ? (response.data.orders as UnifiedOrder[])
          : [];
        const nextRows = ordersPayload.map((order) => mapOrderRef.current(order));
        const nextCurrencies = getPlatformComparisonCurrencies(nextRows);
        const normalizedPreferredCurrency = normalizeCurrency(preferredCurrency);
        const nextCurrency = nextCurrencies.includes(normalizedPreferredCurrency)
          ? normalizedPreferredCurrency
          : nextCurrencies[0] ?? normalizedPreferredCurrency;
        const nextAvailablePlatforms = new Set(
          getPlatformComparisonPlatforms(nextRows, nextCurrency),
        );

        setRows(nextRows);
        setCurrency(nextCurrency);
        setSelectedPlatforms((current) =>
          current.filter((platform) => nextAvailablePlatforms.has(platform)),
        );
        setAppliedRange([startDate, endDate]);
        setLoaded(true);
      } catch (fetchError) {
        if (controller.signal.aborted || requestAbortRef.current !== controller) {
          return;
        }
        setError(deriveErrorMessage(fetchError));
      } finally {
        if (requestAbortRef.current === controller) {
          requestAbortRef.current = null;
          setLoading(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    if (!opened) {
      requestAbortRef.current?.abort();
      requestAbortRef.current = null;
      return;
    }

    const nextRange = getDefaultRange(DEFAULT_WEEK_COUNT, DEFAULT_WEEK_START);
    setDateRange(toPickerRange(nextRange));
    setAppliedRange(null);
    setColumnMode("week");
    setWeekStartsOn(DEFAULT_WEEK_START);
    setWeekdays([...ALL_PLATFORM_COMPARISON_WEEKDAYS]);
    setActiveQuickWeeks(DEFAULT_WEEK_COUNT);
    setCurrency(normalizedDefaultCurrency);
    setSelectedPlatforms([]);
    setRows([]);
    setLoaded(false);
    setError(null);

    if (nextRange) {
      void fetchComparisonRows({
        startDate: nextRange[0],
        endDate: nextRange[1],
        preferredCurrency: normalizedDefaultCurrency,
        requestDateField: dateField,
        requestProductTypeIds: productTypeIds,
      });
    }

    return () => {
      requestAbortRef.current?.abort();
    };
  }, [dateField, fetchComparisonRows, normalizedDefaultCurrency, opened, productTypeIds]);

  const selectedRange = useMemo(() => toDateOnlyRange(dateRange), [dateRange]);
  const previewPeriods = useMemo(() => {
    if (!selectedRange) {
      return [];
    }
    return buildPlatformRevenueComparisonPeriods({
      startDate: selectedRange[0],
      endDate: selectedRange[1],
      columnMode,
      weekStartsOn,
      weekdays,
    });
  }, [columnMode, selectedRange, weekStartsOn, weekdays]);

  const validationMessage = useMemo(() => {
    if (!dateRange[0] || !dateRange[1]) {
      return "Choose both ends of the inclusive date range. To compare one day, select the same date twice.";
    }
    if (!selectedRange) {
      return "Choose a valid comparison range.";
    }
    if (selectedRange[1] < selectedRange[0]) {
      return "The end date must be on or after the start date.";
    }
    if (weekdays.length === 0) {
      return "Select at least one weekday.";
    }
    const maxColumns = columnMode === "week" ? MAX_WEEK_COLUMNS : MAX_DAY_COLUMNS;
    if (previewPeriods.length > maxColumns) {
      return columnMode === "week"
        ? `Weekly comparisons support up to ${MAX_WEEK_COLUMNS} columns.`
        : `Daily comparisons support up to ${MAX_DAY_COLUMNS} columns.`;
    }
    if (previewPeriods.length === 0) {
      return "No selected weekdays occur inside this date range.";
    }
    return null;
  }, [columnMode, dateRange, previewPeriods.length, selectedRange, weekdays.length]);

  const rangeIsPending = Boolean(
    selectedRange &&
      (!appliedRange || selectedRange[0] !== appliedRange[0] || selectedRange[1] !== appliedRange[1]),
  );

  const currencies = useMemo(() => getPlatformComparisonCurrencies(rows), [rows]);
  const currencyOptions = useMemo(() => {
    const values = currencies.length > 0 ? currencies : [currency];
    return values.map((value) => ({ value, label: value === "PLN" ? "PLN (z\u0142)" : value }));
  }, [currencies, currency]);
  const platforms = useMemo(
    () => getPlatformComparisonPlatforms(rows, currency),
    [currency, rows],
  );
  const platformOptions = useMemo(
    () => platforms.map((platform) => ({ value: platform, label: platform })),
    [platforms],
  );

  useEffect(() => {
    const availablePlatforms = new Set(platforms);
    setSelectedPlatforms((current) => {
      const next = current.filter((platform) => availablePlatforms.has(platform));
      return next.length === current.length ? current : next;
    });
  }, [platforms]);

  const pivot = useMemo(() => {
    if (!appliedRange) {
      return null;
    }
    return buildPlatformRevenueComparisonPivot(rows, {
      startDate: appliedRange[0],
      endDate: appliedRange[1],
      columnMode,
      weekStartsOn,
      weekdays,
      dateField,
      currency,
      platforms: selectedPlatforms,
    });
  }, [appliedRange, columnMode, currency, dateField, rows, selectedPlatforms, weekStartsOn, weekdays]);

  const chartSeries = useMemo(() => {
    if (!pivot) {
      return [];
    }
    return [
      { key: "comparison_total", label: "Total", color: "#111827", total: true },
      ...pivot.rows.map((row, index) => ({
        key: `comparison_platform_${index}`,
        label: row.platform,
        color: CHART_COLORS[index % CHART_COLORS.length],
        total: false,
      })),
    ];
  }, [pivot]);

  const chartData = useMemo(() => {
    if (!pivot) {
      return [];
    }
    return pivot.periods.map((period) => {
      const point: Record<string, string | number> = {
        period: period.label,
        comparison_total: pivot.columnTotals[period.id]?.revenue ?? 0,
      };
      pivot.rows.forEach((row, index) => {
        point[`comparison_platform_${index}`] = row.cells[period.id]?.revenue ?? 0;
      });
      return point;
    });
  }, [pivot]);

  const applyQuickRange = (weekCount: QuickWeekCount) => {
    const range = getDefaultRange(weekCount, weekStartsOn);
    setActiveQuickWeeks(weekCount);
    setDateRange(toPickerRange(range));
  };

  const handleWeekStartChange = (value: string) => {
    const nextWeekStart: PlatformComparisonWeekStartsOn = value === "1" ? 1 : 0;
    setWeekStartsOn(nextWeekStart);
    if (activeQuickWeeks) {
      setDateRange(toPickerRange(getDefaultRange(activeQuickWeeks, nextWeekStart)));
    }
  };

  const handleRunComparison = () => {
    if (!selectedRange || validationMessage) {
      return;
    }
    void fetchComparisonRows({
      startDate: selectedRange[0],
      endDate: selectedRange[1],
      preferredCurrency: currency,
      requestDateField: dateField,
      requestProductTypeIds: productTypeIds,
    });
  };

  const handleClose = () => {
    requestAbortRef.current?.abort();
    requestAbortRef.current = null;
    onClose();
  };

  const dateFieldLabel = dateField === "source_received_at"
    ? `Source Received At (${BOOKINGS_SUMMARY_TIMEZONE})`
    : "Experience Date";
  const productFilterLabel = productTypeIds
    ? "Uses the current Summary product-type selection"
    : "All product types allowed for your account";
  const weekdaySummary = WEEKDAY_OPTIONS
    .filter((option) => weekdays.includes(option.value))
    .map((option) => option.label)
    .join(", ");
  const showResults = Boolean(
    loaded && !loading && !error && !rangeIsPending && !validationMessage && pivot,
  );
  const hasPivotRows = Boolean(pivot && pivot.periods.length > 0 && pivot.rows.length > 0);
  const tableMinWidth = pivot ? 210 + (pivot.periods.length + 1) * 180 : 640;
  const tableHeight = pivot ? Math.min(560, 150 + (pivot.rows.length + 1) * 76) : 300;

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      title="Compare Platform Revenue"
      fullScreen
      radius={0}
      styles={{
        header: { borderBottom: "1px solid var(--mantine-color-gray-3)" },
        title: { width: "100%", textAlign: "center", fontWeight: 800 },
        close: { position: "absolute", right: 16 },
        body: { background: "var(--mantine-color-gray-0)", minHeight: "calc(100dvh - 60px)" },
      }}
    >
      <Stack gap="md" maw={1800} mx="auto">
        <Paper withBorder radius="lg" p="md" shadow="xs">
          <Stack gap="md">
            <Group justify="space-between" align="flex-start" wrap="wrap" gap="sm">
              <Stack gap={4}>
                <Text fw={800}>Comparison scope</Text>
                <Text size="sm" c="dimmed">
                  Date ranges are inclusive. Revenue uses the same formula as Platform Revenue Share.
                </Text>
              </Stack>
              <Stack gap={4} align="flex-end">
                <Badge variant="light" color="blue">
                  Date basis: {dateFieldLabel}
                </Badge>
                <Text size="xs" c="dimmed" ta="right">
                  {productFilterLabel}
                </Text>
              </Stack>
            </Group>

            <SimpleGrid cols={{ base: 1, md: 2, xl: 4 }} spacing="md" verticalSpacing="sm">
              <Stack gap={6}>
                <DatePickerInput
                  type="range"
                  label="Inclusive date range"
                  value={dateRange}
                  onChange={(value) => {
                    setActiveQuickWeeks(null);
                    setDateRange(value);
                  }}
                  valueFormat="YYYY-MM-DD"
                  allowSingleDateInRange
                  clearable
                  disabled={loading}
                  placeholder="Select start and end dates"
                />
                <Group gap={6} grow>
                  {([2, 4, 8] as QuickWeekCount[]).map((weekCount) => (
                    <Button
                      key={`quick-${weekCount}-weeks`}
                      size="xs"
                      variant={activeQuickWeeks === weekCount ? "filled" : "light"}
                      onClick={() => applyQuickRange(weekCount)}
                      disabled={loading}
                    >
                      {`${weekCount} completed weeks`}
                    </Button>
                  ))}
                </Group>
              </Stack>

              <Stack gap="sm">
                <SegmentedControl
                  value={columnMode}
                  onChange={(value) => setColumnMode(value as PlatformComparisonColumnMode)}
                  data={[
                    { value: "week", label: "Weeks as columns" },
                    { value: "day", label: "Days as columns" },
                  ]}
                  fullWidth
                  disabled={loading}
                />
                <SegmentedControl
                  value={String(weekStartsOn)}
                  onChange={handleWeekStartChange}
                  data={[
                    { value: "0", label: "Week starts Sunday" },
                    { value: "1", label: "Week starts Monday" },
                  ]}
                  fullWidth
                  disabled={loading || columnMode === "day"}
                />
              </Stack>

              <Select
                label="Currency"
                value={currency}
                onChange={(value) => {
                  setCurrency(normalizeCurrency(value));
                  setSelectedPlatforms([]);
                }}
                data={currencyOptions}
                allowDeselect={false}
                checkIconPosition="right"
                disabled={loading || currencyOptions.length === 0}
              />

              <MultiSelect
                label="Platforms"
                description="Empty means all platforms"
                value={selectedPlatforms}
                onChange={setSelectedPlatforms}
                data={platformOptions}
                searchable
                clearable
                checkIconPosition="right"
                placeholder="All platforms"
                disabled={loading || platformOptions.length === 0}
              />
            </SimpleGrid>

            <Stack gap="xs">
              <Group justify="space-between" align="flex-end" wrap="wrap">
                <Stack gap={6}>
                  <Checkbox.Group
                    label="Include weekdays"
                    value={weekdays.map(String)}
                    onChange={(values) => setWeekdays(parseWeekdays(values))}
                  >
                    <Group gap="sm" mt={6} wrap="wrap">
                      {WEEKDAY_OPTIONS.map((weekday) => (
                        <Checkbox
                          key={`weekday-${weekday.value}`}
                          value={String(weekday.value)}
                          label={weekday.label}
                          disabled={loading}
                        />
                      ))}
                    </Group>
                  </Checkbox.Group>
                  <Group gap={6}>
                    <Button
                      size="compact-xs"
                      variant={sameWeekdays(weekdays, ALL_PLATFORM_COMPARISON_WEEKDAYS) ? "filled" : "light"}
                      onClick={() => setWeekdays([...ALL_PLATFORM_COMPARISON_WEEKDAYS])}
                      disabled={loading}
                    >
                      All
                    </Button>
                    <Button
                      size="compact-xs"
                      variant={sameWeekdays(weekdays, SUN_THU_WEEKDAYS) ? "filled" : "light"}
                      onClick={() => setWeekdays([...SUN_THU_WEEKDAYS])}
                      disabled={loading}
                    >
                      Sun-Thu
                    </Button>
                    <Button
                      size="compact-xs"
                      variant={sameWeekdays(weekdays, FRI_SAT_WEEKDAYS) ? "filled" : "light"}
                      onClick={() => setWeekdays([...FRI_SAT_WEEKDAYS])}
                      disabled={loading}
                    >
                      Fri-Sat
                    </Button>
                  </Group>
                </Stack>

                <Button
                  leftSection={<IconRefresh size={17} />}
                  onClick={handleRunComparison}
                  loading={loading}
                  disabled={Boolean(validationMessage)}
                  miw={170}
                >
                  Run comparison
                </Button>
              </Group>

              {validationMessage ? (
                <Alert color="yellow" icon={<IconAlertCircle size={17} />}>
                  {validationMessage}
                </Alert>
              ) : null}
              {!validationMessage && rangeIsPending && !loading ? (
                <Alert color="blue">
                  The date range has changed. Run the comparison to load the selected dates.
                </Alert>
              ) : null}
            </Stack>
          </Stack>
        </Paper>

        {error ? (
          <Alert color="red" title="Comparison unavailable" icon={<IconAlertCircle size={18} />}>
            {error}
          </Alert>
        ) : null}

        {loading ? (
          <Paper withBorder radius="lg" p="xl" mih={220}>
            <Stack align="center" justify="center" h="100%" gap="sm">
              <Loader variant="bars" />
              <Text c="dimmed">Loading bookings for this comparison...</Text>
            </Stack>
          </Paper>
        ) : null}

        {showResults && !hasPivotRows ? (
          <Alert color="blue" title="No matching revenue">
            No non-cancelled bookings match the selected dates, weekdays, currency, and platforms.
          </Alert>
        ) : null}

        {showResults && hasPivotRows && pivot ? (
          <>
            <Paper withBorder radius="lg" p="md" shadow="xs">
              <Stack gap="sm">
                <Group justify="space-between" align="center" wrap="wrap">
                  <Stack gap={0}>
                    <Text fw={800}>Platform revenue pivot</Text>
                    <Text size="sm" c="dimmed">
                      {`Included days: ${weekdaySummary}. Each period is compared with the period immediately before it.`}
                    </Text>
                  </Stack>
                  <Group gap="xs">
                    <Badge variant="light">{`${pivot.periods.length} ${columnMode === "week" ? "weeks" : "days"}`}</Badge>
                    <Badge variant="light" color="teal">{`${pivot.rows.length} platforms`}</Badge>
                    <Badge variant="light" color="grape">{formatMoney(pivot.grandTotal.revenue, currency)}</Badge>
                  </Group>
                </Group>

                <ScrollArea h={tableHeight} type="auto" offsetScrollbars>
                  <Table
                    striped
                    highlightOnHover
                    withColumnBorders
                    stickyHeader
                    miw={tableMinWidth}
                    verticalSpacing="sm"
                    styles={{
                      th: {
                        textAlign: "center",
                        verticalAlign: "middle",
                        background: "var(--mantine-color-gray-1)",
                      },
                      td: { textAlign: "center", verticalAlign: "middle" },
                    }}
                  >
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th
                          style={{
                            position: "sticky",
                            left: 0,
                            zIndex: 12,
                            minWidth: 200,
                            background: "var(--mantine-color-gray-1)",
                          }}
                        >
                          Platform
                        </Table.Th>
                        {pivot.periods.map((period) => (
                          <Table.Th key={`period-heading-${period.id}`} miw={180}>
                            <Stack gap={1} align="center">
                              <Text size="sm" fw={800} ta="center">
                                {period.label}
                              </Text>
                              <Text size="xs" c="dimmed" fw={500}>
                                {period.startDate === period.endDate
                                  ? period.startDate
                                  : `${period.startDate} to ${period.endDate}`}
                              </Text>
                            </Stack>
                          </Table.Th>
                        ))}
                        <Table.Th miw={180}>Total</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {pivot.rows.map((row) => (
                        <Table.Tr key={`comparison-row-${row.platform}`}>
                          <Table.Th
                            scope="row"
                            style={{
                              position: "sticky",
                              left: 0,
                              zIndex: 6,
                              minWidth: 200,
                              background: "var(--mantine-color-body)",
                            }}
                          >
                            <Text fw={800} ta="left" pl="xs">
                              {row.platform}
                            </Text>
                          </Table.Th>
                          {pivot.periods.map((period, periodIndex) => (
                            <Table.Td key={`${row.platform}-${period.id}`} miw={180}>
                              <RevenueCell
                                cell={row.cells[period.id]}
                                previousCell={
                                  periodIndex > 0
                                    ? row.cells[pivot.periods[periodIndex - 1].id]
                                    : undefined
                                }
                                currency={currency}
                              />
                            </Table.Td>
                          ))}
                          <Table.Td miw={180}>
                            <RevenueCell cell={row.total} currency={currency} neutral />
                          </Table.Td>
                        </Table.Tr>
                      ))}
                      <Table.Tr>
                        <Table.Th
                          scope="row"
                          style={{
                            position: "sticky",
                            left: 0,
                            zIndex: 7,
                            minWidth: 200,
                            background: "var(--mantine-color-gray-1)",
                            borderTop: "2px solid var(--mantine-color-gray-5)",
                          }}
                        >
                          <Text fw={900} ta="left" pl="xs">
                            Total
                          </Text>
                        </Table.Th>
                        {pivot.periods.map((period, periodIndex) => (
                          <Table.Td
                            key={`comparison-total-${period.id}`}
                            miw={180}
                            style={{
                              background: "var(--mantine-color-gray-1)",
                              borderTop: "2px solid var(--mantine-color-gray-5)",
                            }}
                          >
                            <RevenueCell
                              cell={pivot.columnTotals[period.id]}
                              previousCell={
                                periodIndex > 0
                                  ? pivot.columnTotals[pivot.periods[periodIndex - 1].id]
                                  : undefined
                              }
                              currency={currency}
                            />
                          </Table.Td>
                        ))}
                        <Table.Td
                          miw={180}
                          style={{
                            background: "var(--mantine-color-gray-1)",
                            borderTop: "2px solid var(--mantine-color-gray-5)",
                          }}
                        >
                          <RevenueCell cell={pivot.grandTotal} currency={currency} neutral />
                        </Table.Td>
                      </Table.Tr>
                    </Table.Tbody>
                  </Table>
                </ScrollArea>
              </Stack>
            </Paper>

            <Paper withBorder radius="lg" p="md" shadow="xs">
              <Stack gap="sm">
                <Group gap="xs">
                  <IconChartLine size={19} />
                  <Text fw={800}>Revenue by comparison period</Text>
                </Group>
                <Box h={360} w="100%">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 10, right: 24, left: 12, bottom: 18 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="period" minTickGap={28} interval="preserveStartEnd" />
                      <YAxis tickFormatter={(value: number) => formatMoneyNumber(Number(value))} />
                      <RechartsTooltip
                        formatter={(value: number, name: string) => [formatMoney(Number(value), currency), name]}
                      />
                      <Legend />
                      {chartSeries.map((series) => (
                        <Line
                          key={series.key}
                          type="monotone"
                          dataKey={series.key}
                          name={series.label}
                          stroke={series.color}
                          strokeWidth={series.total ? 3 : 2}
                          dot={pivot.periods.length <= 24}
                          activeDot={{ r: 5 }}
                          connectNulls
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </Box>
              </Stack>
            </Paper>
          </>
        ) : null}
      </Stack>
    </Modal>
  );
};

export default PlatformRevenueComparisonModal;
