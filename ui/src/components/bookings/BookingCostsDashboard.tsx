import { Fragment, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Accordion,
  Alert,
  Badge,
  Box,
  Button,
  Group,
  Paper,
  ScrollArea,
  SimpleGrid,
  Stack,
  Table,
  Text,
  ThemeIcon,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import {
  IconCash,
  IconChevronDown,
  IconDownload,
  IconFileInvoice,
  IconReceipt2,
  IconTicket,
  IconUsersGroup,
} from "@tabler/icons-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import dayjs from "dayjs";
import axiosInstance from "../../utils/axiosInstance";
import {
  isPreviewableInvoiceMimeType,
  type NightReportPhotoPreview,
} from "../../utils/nightReportPhotoUtils";
import NightReportPhotoPreviewDialog from "../venueNumbers/NightReportPhotoPreviewDialog";

export type BookingOpenBarRateBand = {
  ticketType: "normal" | "cocktail" | "brunch" | "generic";
  configuredTicketType: "normal" | "cocktail" | "brunch" | "generic";
  count: number;
  rateBandId: number | null;
  rateAmount: number;
  rateUnit: "per_person" | "flat";
  source: "ticket_rate" | "generic_rate" | "term_default";
  amount: number;
};

export type BookingOpenBarCostDay = {
  date: string;
  amount: number;
  totalPeople: number;
  normalCount: number;
  cocktailCount: number;
  brunchCount: number;
  rateBands: BookingOpenBarRateBand[];
  rateBreakdownMatchesPayout: boolean | null;
};

export type BookingOpenBarCostDetail = {
  venueId: number | null;
  venueName: string;
  currency: string;
  amount: number;
  paid: number | null;
  outstanding: number | null;
  totalPeople: number;
  daily: BookingOpenBarCostDay[];
};

export type BookingStaffPaymentCostDetail = {
  userId: number | null;
  fullName: string;
  staffType: string | null;
  currency: string;
  amount: number;
  paid: number | null;
  outstanding: number | null;
  breakdown: BookingStaffPaymentBreakdown[] | null;
};

export type BookingStaffPaymentBreakdown = {
  label: string;
  category: string;
  amount: number;
  earningStart: string | null;
  earningEnd: string | null;
  staffType: string | null;
};

export type BookingOtherExpenseCategoryDetail = {
  categoryId: number | null;
  categoryName: string;
  amount: number;
  transactionCount: number;
};

export type BookingOtherExpenseDateDetail = {
  date: string;
  amount: number;
  transactionCount: number;
};

export type BookingOtherExpenseTransactionDetail = {
  id: number;
  date: string;
  description: string | null;
  currency: string;
  amount: number;
  baseCurrency: string;
  baseAmount: number;
  categoryId: number | null;
  categoryName: string;
  vendorId: number | null;
  vendorName: string | null;
  accountId: number | null;
  accountName: string | null;
  paymentMethod: string | null;
  source: string | null;
  invoiceFile: BookingOtherExpenseInvoiceFile | null;
};

export type BookingOtherExpenseInvoiceFile = {
  id: number;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
};

export type BookingCostsSummary = {
  currency: string;
  openBarPayouts: number | null;
  staffPayments: number | null;
  otherExpenses: number | null;
  otherExpensesTransactionCount: number | null;
  openBarDetails: BookingOpenBarCostDetail[] | null;
  staffPaymentDetails: BookingStaffPaymentCostDetail[] | null;
  otherExpenseCategories: BookingOtherExpenseCategoryDetail[] | null;
  otherExpenseDates: BookingOtherExpenseDateDetail[] | null;
  otherExpenseTransactions: BookingOtherExpenseTransactionDetail[] | null;
  otherExpenseTransactionLimit: number | null;
  otherExpenseTransactionsTruncated: boolean;
};

const EMPTY_BOOKING_COSTS_SUMMARY: BookingCostsSummary = {
  currency: "PLN",
  openBarPayouts: null,
  staffPayments: null,
  otherExpenses: null,
  otherExpensesTransactionCount: null,
  openBarDetails: null,
  staffPaymentDetails: null,
  otherExpenseCategories: null,
  otherExpenseDates: null,
  otherExpenseTransactions: null,
  otherExpenseTransactionLimit: null,
  otherExpenseTransactionsTruncated: false,
};

type CostMixRow = {
  key: "open-bar" | "staff" | "other";
  name: string;
  value: number;
  color: string;
};

export type CostDriverRow = {
  key: string;
  label: string;
  shortLabel: string;
  source: string;
  value: number;
  color: string;
};

export type DatedCostTrendRow = {
  date: string;
  label: string;
  openBar: number;
  otherExpenses: number;
  total: number;
};

export type OpenBarGuestMixItem = {
  key: "normal" | "cocktail" | "brunch";
  label: string;
  count: number;
  color: string;
};

export type OpenBarRateBandRow = BookingOpenBarRateBand & {
  key: string;
  applications: number;
};

const COST_COLORS = {
  openBar: "#087f5b",
  staff: "#1c5d99",
  other: "#d9480f",
};

const OPEN_BAR_GUEST_COLORS = {
  normal: "blue",
  cocktail: "grape",
  brunch: "orange",
};

const roundMoney = (value: number): number => Math.round(value * 100) / 100;

const formatMoney = (value: number, currency: string): string => {
  const normalizedCurrency = String(currency || "PLN").trim().toUpperCase();
  const amount = (Number.isFinite(value) ? value : 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${amount} ${normalizedCurrency === "PLN" ? "z\u0142" : normalizedCurrency}`;
};

const formatDate = (value: string): string => {
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format("D MMM YYYY") : value;
};

const truncateLabel = (value: string, length = 22): string =>
  value.length > length ? `${value.slice(0, length - 3)}...` : value;

const buildInvoiceDownloadPath = (fileId: number): string => `/finance/files/${fileId}/download`;

const buildInvoiceDownloadHref = (fileId: number): string => {
  const path = buildInvoiceDownloadPath(fileId);
  const baseUrl = axiosInstance.defaults.baseURL;
  return typeof baseUrl === "string" && baseUrl.trim()
    ? `${baseUrl.replace(/\/+$/, "")}${path}`
    : path;
};

export const buildCostMixRows = (summary: BookingCostsSummary): CostMixRow[] => [
  ...(summary.openBarPayouts == null
    ? []
    : [{ key: "open-bar" as const, name: "Open Bar", value: summary.openBarPayouts, color: COST_COLORS.openBar }]),
  ...(summary.staffPayments == null
    ? []
    : [{ key: "staff" as const, name: "Staff Payments", value: summary.staffPayments, color: COST_COLORS.staff }]),
  ...(summary.otherExpenses == null
    ? []
    : [{ key: "other" as const, name: "Other Expenses", value: summary.otherExpenses, color: COST_COLORS.other }]),
];

export const buildCostDriverRows = (summary: BookingCostsSummary): CostDriverRow[] => {
  const currency = summary.currency.trim().toUpperCase();
  const rows: CostDriverRow[] = [];

  (summary.openBarDetails ?? []).forEach((row) => {
    if (row.currency.trim().toUpperCase() !== currency || row.amount <= 0) return;
    rows.push({
      key: `open-bar-${row.venueId ?? row.venueName}`,
      label: row.venueName,
      shortLabel: truncateLabel(row.venueName),
      source: "Open Bar",
      value: row.amount,
      color: COST_COLORS.openBar,
    });
  });

  (summary.staffPaymentDetails ?? []).forEach((row) => {
    if (row.currency.trim().toUpperCase() !== currency || row.amount <= 0) return;
    rows.push({
      key: `staff-${row.userId ?? row.fullName}`,
      label: row.fullName,
      shortLabel: truncateLabel(row.fullName),
      source: "Staff Payments",
      value: row.amount,
      color: COST_COLORS.staff,
    });
  });

  (summary.otherExpenseCategories ?? []).forEach((row) => {
    if (row.amount <= 0) return;
    rows.push({
      key: `other-${row.categoryId ?? row.categoryName}`,
      label: row.categoryName,
      shortLabel: truncateLabel(row.categoryName),
      source: "Other Expenses",
      value: row.amount,
      color: COST_COLORS.other,
    });
  });

  return rows
    .map((row) => ({ ...row, value: roundMoney(row.value) }))
    .sort((left, right) => right.value - left.value || left.label.localeCompare(right.label))
    .slice(0, 10);
};

export const buildDatedCostTrendRows = (summary: BookingCostsSummary): DatedCostTrendRow[] => {
  const currency = summary.currency.trim().toUpperCase();
  const byDate = new Map<string, DatedCostTrendRow>();
  const ensureDate = (date: string): DatedCostTrendRow => {
    const current = byDate.get(date) ?? {
      date,
      label: date,
      openBar: 0,
      otherExpenses: 0,
      total: 0,
    };
    byDate.set(date, current);
    return current;
  };

  (summary.openBarDetails ?? []).forEach((venue) => {
    if (venue.currency.trim().toUpperCase() !== currency) return;
    venue.daily.forEach((row) => {
      if (!row.date || row.amount === 0) return;
      const current = ensureDate(row.date);
      current.openBar = roundMoney(current.openBar + row.amount);
    });
  });

  (summary.otherExpenseDates ?? []).forEach((row) => {
    if (!row.date) return;
    const current = ensureDate(row.date);
    current.otherExpenses = roundMoney(current.otherExpenses + row.amount);
  });

  const rows = Array.from(byDate.values())
    .map((row) => ({ ...row, total: roundMoney(row.openBar + row.otherExpenses) }))
    .sort((left, right) => left.date.localeCompare(right.date));
  const spansYears = new Set(rows.map((row) => row.date.slice(0, 4))).size > 1;
  return rows.map((row) => ({
    ...row,
    label: dayjs(row.date).isValid()
      ? dayjs(row.date).format(spansYears ? "DD MMM YY" : "DD MMM")
      : row.date,
  }));
};

export const buildOpenBarGuestMix = (
  row: BookingOpenBarCostDetail,
): OpenBarGuestMixItem[] => {
  const totals = row.daily.reduce(
    (sum, day) => ({
      normal: sum.normal + day.normalCount,
      cocktail: sum.cocktail + day.cocktailCount,
      brunch: sum.brunch + day.brunchCount,
    }),
    { normal: 0, cocktail: 0, brunch: 0 },
  );

  return [
    { key: "normal" as const, label: "Normal", count: totals.normal, color: OPEN_BAR_GUEST_COLORS.normal },
    { key: "cocktail" as const, label: "Cocktail", count: totals.cocktail, color: OPEN_BAR_GUEST_COLORS.cocktail },
    { key: "brunch" as const, label: "Brunch", count: totals.brunch, color: OPEN_BAR_GUEST_COLORS.brunch },
  ].filter((item) => item.count > 0);
};

export const buildOpenBarRateBandRows = (
  row: BookingOpenBarCostDetail,
): OpenBarRateBandRow[] => {
  const grouped = new Map<string, OpenBarRateBandRow>();
  row.daily.forEach((day) => {
    day.rateBands.forEach((band) => {
      if (band.rateAmount <= 0 || band.amount <= 0) return;
      // Rate-band IDs are product-specific. This view presents a venue-level
      // breakdown, so equivalent visible rates share one row across products.
      const key = [
        band.ticketType,
        band.configuredTicketType,
        band.rateAmount,
        band.rateUnit,
        band.source,
      ].join("|");
      const current = grouped.get(key);
      if (current) {
        current.count += band.count;
        current.amount = roundMoney(current.amount + band.amount);
        current.applications += 1;
        return;
      }
      grouped.set(key, {
        ...band,
        key,
        amount: roundMoney(band.amount),
        applications: 1,
      });
    });
  });

  const order = { normal: 0, cocktail: 1, brunch: 2, generic: 3 } as const;
  return Array.from(grouped.values()).sort((left, right) => (
    order[left.ticketType] - order[right.ticketType]
    || left.rateAmount - right.rateAmount
    || left.source.localeCompare(right.source)
  ));
};

const CostKpiCard = ({
  icon,
  label,
  value,
  subtitle,
  accent,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  subtitle: ReactNode;
  accent: string;
}) => (
  <Paper
    withBorder
    radius="lg"
    p="md"
    shadow="sm"
    style={{
      position: "relative",
      minHeight: 132,
      background: `linear-gradient(135deg, ${accent}18 0%, #ffffff 100%)`,
      borderColor: `${accent}70`,
    }}
  >
    <ThemeIcon
      size={38}
      radius="md"
      variant="light"
      color="dark"
      style={{ position: "absolute", top: 14, right: 14 }}
    >
      {icon}
    </ThemeIcon>
    <Stack gap={5} align="center" justify="center" h="100%" px={32}>
      <Text size="xs" tt="uppercase" fw={800} c="dimmed" ta="center" style={{ letterSpacing: 0.5 }}>
        {label}
      </Text>
      <Text fw={900} fz="xl" ta="center" style={{ lineHeight: 1.15, overflowWrap: "anywhere" }}>
        {value}
      </Text>
      <Box w="100%">{subtitle}</Box>
    </Stack>
  </Paper>
);

const CostChartCard = ({ title, children }: { title: string; children: ReactNode }) => (
  <Paper withBorder radius="lg" p="md" shadow="sm" style={{ minHeight: 330 }}>
    <Stack gap="sm" h="100%">
      <Text fw={800} ta="center">
        {title}
      </Text>
      <Box style={{ flex: 1, minHeight: 270 }}>{children}</Box>
    </Stack>
  </Paper>
);

const EmptyDetail = ({ children }: { children: ReactNode }) => (
  <Text size="sm" c="dimmed" ta="center" py="lg">
    {children}
  </Text>
);

const DetailStat = ({ label, value }: { label: string; value: ReactNode }) => (
  <Stack gap={1} align="center">
    <Text size="xs" c="dimmed" ta="center" tt="uppercase" fw={700}>
      {label}
    </Text>
    <Text size="sm" fw={700} ta="center" style={{ overflowWrap: "anywhere" }}>
      {value}
    </Text>
  </Stack>
);

const OpenBarGuestMix = ({ row, emptyFallback = false }: {
  row: BookingOpenBarCostDetail;
  emptyFallback?: boolean;
}) => {
  const items = buildOpenBarGuestMix(row);
  if (items.length === 0) {
    return emptyFallback ? <Text c="dimmed">—</Text> : null;
  }

  return (
    <Group gap={6} justify="center" wrap="wrap">
      {items.map((item) => (
        <Badge key={item.key} variant="light" color={item.color} size="sm">
          {`${item.label} ${item.count.toLocaleString()}`}
        </Badge>
      ))}
    </Group>
  );
};

const OPEN_BAR_RATE_LABELS: Record<BookingOpenBarRateBand["ticketType"], string> = {
  normal: "Normal",
  cocktail: "Cocktail",
  brunch: "Brunch",
  generic: "Generic",
};

const OpenBarRateBands = ({ row, compact = false }: {
  row: BookingOpenBarCostDetail;
  compact?: boolean;
}) => {
  const bands = buildOpenBarRateBandRows(row);
  const hasCurrentRateMismatch = row.daily.some((day) => day.rateBreakdownMatchesPayout === false);
  if (bands.length === 0) {
    return <Text size="xs" c="dimmed" ta="center">Rate breakdown unavailable</Text>;
  }

  return (
    <Stack gap={compact ? 3 : 6} align="stretch">
      {bands.map((band) => {
        const units = band.rateUnit === "per_person"
          ? `${band.count.toLocaleString()} ${band.count === 1 ? "guest" : "guests"}`
          : `${band.applications.toLocaleString()} ${band.applications === 1 ? "night" : "nights"}`;
        const rateSuffix = band.rateUnit === "per_person" ? "/ guest" : "flat";
        return (
          <Group key={band.key} justify="center" gap={6} wrap="wrap">
            <Badge variant="light" color={OPEN_BAR_GUEST_COLORS[band.ticketType === "generic" ? "normal" : band.ticketType]} size="sm">
              {OPEN_BAR_RATE_LABELS[band.ticketType]}
            </Badge>
            <Text size="xs" ta="center">
              {`${units} × ${formatMoney(band.rateAmount, row.currency)} ${rateSuffix}`}
            </Text>
            <Text size="xs" fw={800} ta="center">
              {`= ${formatMoney(band.amount, row.currency)}`}
            </Text>
          </Group>
        );
      })}
      {hasCurrentRateMismatch ? (
        <Badge variant="light" color="yellow" size="sm" style={{ alignSelf: "center" }}>
          Current rate setup differs from saved payout
        </Badge>
      ) : null}
    </Stack>
  );
};

const formatEarningPeriod = (start: string | null, end: string | null): string | null => {
  if (!start && !end) return null;
  if (start && end && start === end) return formatDate(start);
  if (start && end) return `${formatDate(start)} – ${formatDate(end)}`;
  return formatDate(start ?? end ?? "");
};

const StaffPaymentExpandedContent = ({
  row,
  rowKey,
  isMobile,
}: {
  row: BookingStaffPaymentCostDetail;
  rowKey: string;
  isMobile: boolean;
}) => (
  <Stack gap="md">
    <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm">
      <DetailStat label="Due" value={formatMoney(row.amount, row.currency)} />
      <DetailStat
        label="Paid"
        value={row.paid == null ? "Unavailable" : formatMoney(row.paid, row.currency)}
      />
      <DetailStat
        label="Outstanding"
        value={row.outstanding == null ? "Unavailable" : formatMoney(row.outstanding, row.currency)}
      />
    </SimpleGrid>
    {row.breakdown == null ? (
      <EmptyDetail>Payment breakdown is unavailable.</EmptyDetail>
    ) : row.breakdown.length === 0 ? (
      <EmptyDetail>No payment components.</EmptyDetail>
    ) : isMobile ? (
      <Stack gap="xs">
        {row.breakdown.map((item, index) => {
          const period = formatEarningPeriod(item.earningStart, item.earningEnd);
          return (
            <Paper
              key={`${rowKey}-${item.category}-${item.earningStart ?? "all"}-${index}`}
              withBorder
              radius="md"
              p="sm"
            >
              <Stack gap={5} align="center">
                <Group gap={6} justify="center" wrap="wrap">
                  <Text size="sm" fw={700} ta="center">{item.label}</Text>
                  {item.category ? <Badge size="xs" variant="light">{item.category}</Badge> : null}
                  {item.staffType ? <Badge size="xs" variant="outline" color="gray">{item.staffType}</Badge> : null}
                </Group>
                {period ? <Text size="xs" c="dimmed" ta="center">{period}</Text> : null}
                <Text size="sm" fw={800} ta="center">{formatMoney(item.amount, row.currency)}</Text>
              </Stack>
            </Paper>
          );
        })}
      </Stack>
    ) : (
      <Paper withBorder radius="md" style={{ overflow: "hidden" }}>
        <ScrollArea type="auto" offsetScrollbars>
          <Table striped highlightOnHover miw={680}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th ta="center">Component</Table.Th>
                <Table.Th ta="center">Category</Table.Th>
                <Table.Th ta="center">Staff type</Table.Th>
                <Table.Th ta="center">Earning period</Table.Th>
                <Table.Th ta="center">Amount</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {row.breakdown.map((item, index) => {
                const period = formatEarningPeriod(item.earningStart, item.earningEnd);
                return (
                  <Table.Tr key={`${rowKey}-${item.category}-${item.earningStart ?? "all"}-${index}`}>
                    <Table.Td ta="center" fw={700}>{item.label}</Table.Td>
                    <Table.Td ta="center">{item.category || "—"}</Table.Td>
                    <Table.Td ta="center">{item.staffType || "—"}</Table.Td>
                    <Table.Td ta="center">{period || "—"}</Table.Td>
                    <Table.Td ta="center" fw={800}>{formatMoney(item.amount, row.currency)}</Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      </Paper>
    )}
  </Stack>
);

const BookingCostsDashboard = ({ summary }: { summary: BookingCostsSummary | null | undefined }) => {
  const isMobile = useMediaQuery("(max-width: 48em)") ?? false;
  const [mobileTransactionLimit, setMobileTransactionLimit] = useState(20);
  const [expandedStaffRows, setExpandedStaffRows] = useState<string[]>([]);
  const [invoicePreview, setInvoicePreview] = useState<NightReportPhotoPreview | null>(null);
  const [invoicePreviewLoadingId, setInvoicePreviewLoadingId] = useState<number | null>(null);
  const [invoicePreviewError, setInvoicePreviewError] = useState<string | null>(null);
  const invoiceObjectUrlRef = useRef<string | null>(null);
  const safeSummary = useMemo(
    () => summary ?? EMPTY_BOOKING_COSTS_SUMMARY,
    [summary],
  );
  const currency = safeSummary.currency;
  const totalCosts = safeSummary.openBarPayouts == null
    || safeSummary.staffPayments == null
    || safeSummary.otherExpenses == null
    ? null
    : roundMoney(safeSummary.openBarPayouts + safeSummary.staffPayments + safeSummary.otherExpenses);
  const allCostSourcesAvailable = totalCosts != null;
  const allDetailSourcesAvailable = safeSummary.openBarDetails != null
    && safeSummary.staffPaymentDetails != null
    && safeSummary.otherExpenseCategories != null;
  const mixRows = useMemo(() => buildCostMixRows(safeSummary), [safeSummary]);
  const mixTotal = roundMoney(mixRows.reduce((sum, row) => sum + row.value, 0));
  const driverRows = useMemo(() => buildCostDriverRows(safeSummary), [safeSummary]);
  const driverChartHeight = Math.max(230, driverRows.length * (isMobile ? 38 : 34) + 24);
  const datedTrendRows = useMemo(() => buildDatedCostTrendRows(safeSummary), [safeSummary]);
  const openBarRows = useMemo(
    () => (safeSummary.openBarDetails ?? []).filter((row) => row.amount > 0),
    [safeSummary.openBarDetails],
  );
  const staffRows = useMemo(
    () => (safeSummary.staffPaymentDetails ?? []).filter((row) => row.amount > 0),
    [safeSummary.staffPaymentDetails],
  );
  const otherRows = safeSummary.otherExpenseTransactions ?? [];
  const visibleOtherRows = isMobile ? otherRows.slice(0, mobileTransactionLimit) : otherRows;

  const toggleStaffRow = useCallback((rowKey: string) => {
    setExpandedStaffRows((current) => (
      current.includes(rowKey)
        ? current.filter((key) => key !== rowKey)
        : [...current, rowKey]
    ));
  }, []);

  const releaseInvoiceObjectUrl = useCallback(() => {
    const objectUrl = invoiceObjectUrlRef.current;
    if (objectUrl && typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
      URL.revokeObjectURL(objectUrl);
    }
    invoiceObjectUrlRef.current = null;
  }, []);

  const handleCloseInvoicePreview = useCallback(() => {
    setInvoicePreview(null);
    releaseInvoiceObjectUrl();
  }, [releaseInvoiceObjectUrl]);

  const handleOpenInvoicePreview = useCallback(async (row: BookingOtherExpenseTransactionDetail) => {
    if (!row.invoiceFile) return;
    setInvoicePreviewError(null);
    setInvoicePreviewLoadingId(row.id);
    try {
      const response = await axiosInstance.get<Blob>(buildInvoiceDownloadPath(row.invoiceFile.id), {
        responseType: "blob",
        withCredentials: true,
      });
      const objectUrl = URL.createObjectURL(response.data);
      releaseInvoiceObjectUrl();
      invoiceObjectUrlRef.current = objectUrl;
      setInvoicePreview({
        src: objectUrl,
        name: row.invoiceFile.originalName,
        capturedAt: null,
        downloadHref: objectUrl,
        mimeType: row.invoiceFile.mimeType || response.data.type || null,
      });
    } catch (error) {
      console.error("Failed to fetch finance invoice preview", error);
      setInvoicePreviewError("Unable to open this invoice. Please try again.");
    } finally {
      setInvoicePreviewLoadingId(null);
    }
  }, [releaseInvoiceObjectUrl]);

  useEffect(() => {
    setMobileTransactionLimit(20);
  }, [summary?.otherExpenseTransactions]);

  useEffect(() => () => {
    releaseInvoiceObjectUrl();
  }, [releaseInvoiceObjectUrl]);

  return (
    <Stack gap="md">
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="md">
        <CostKpiCard
          icon={<IconReceipt2 size={20} />}
          label="Total Costs"
          value={totalCosts == null ? "Unavailable" : formatMoney(totalCosts, currency)}
          subtitle={<Text size="xs" c="dimmed" ta="center">Open Bar + Staff Payments + Other Expenses</Text>}
          accent="#214A66"
        />
        <CostKpiCard
          icon={<IconTicket size={20} />}
          label="Open Bar"
          value={safeSummary.openBarPayouts == null ? "Unavailable" : formatMoney(safeSummary.openBarPayouts, currency)}
          subtitle={
            <Text size="xs" c="dimmed" ta="center">
              {safeSummary.openBarDetails == null
                ? "Details unavailable"
                : `${openBarRows.length} ${openBarRows.length === 1 ? "venue" : "venues"}`}
            </Text>
          }
          accent={COST_COLORS.openBar}
        />
        <CostKpiCard
          icon={<IconUsersGroup size={20} />}
          label="Staff Payments"
          value={safeSummary.staffPayments == null ? "Unavailable" : formatMoney(safeSummary.staffPayments, currency)}
          subtitle={
            <Text size="xs" c="dimmed" ta="center">
              {safeSummary.staffPaymentDetails == null
                ? "Details unavailable"
                : `${staffRows.length} ${staffRows.length === 1 ? "staff member" : "staff members"}`}
            </Text>
          }
          accent={COST_COLORS.staff}
        />
        <CostKpiCard
          icon={<IconCash size={20} />}
          label="Other Expenses"
          value={safeSummary.otherExpenses == null ? "Unavailable" : formatMoney(safeSummary.otherExpenses, currency)}
          subtitle={
            <Stack gap={1}>
              <Text size="xs" c="dimmed" ta="center">
                {safeSummary.otherExpensesTransactionCount == null
                  ? "Paid finance transactions unavailable"
                  : `${safeSummary.otherExpensesTransactionCount} paid ${
                      safeSummary.otherExpensesTransactionCount === 1 ? "transaction" : "transactions"
                    }`}
              </Text>
              {safeSummary.otherExpensesTransactionCount != null ? (
                <Text size="xs" c="dimmed" ta="center">Finance transaction date | all product types</Text>
              ) : null}
            </Stack>
          }
          accent={COST_COLORS.other}
        />
      </SimpleGrid>

      <Text size="xs" c="dimmed" ta="center">
        Costs use the selected period but are not changed by the Booking Summary product-type filter. Access rules can limit
        available sources. Open Bar and Staff Payments are period earnings; Other Expenses uses the paid Finance transaction date.
      </Text>

      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
        <CostChartCard title="Cost Mix">
          {!allCostSourcesAvailable ? (
            <Alert color="orange" variant="light" ta="center">
              Composition is unavailable because one or more cost sources could not be loaded in the same currency.
            </Alert>
          ) : mixTotal <= 0 ? (
            <Alert color="gray" variant="light" ta="center">No cost activity for this period.</Alert>
          ) : (
            <Stack gap="xs" h="100%">
              <Box h={220}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={mixRows} dataKey="value" nameKey="name" innerRadius={56} outerRadius={88} paddingAngle={2}>
                      {mixRows.map((row) => <Cell key={row.key} fill={row.color} />)}
                    </Pie>
                    <RechartsTooltip formatter={(value: number) => formatMoney(Number(value), currency)} />
                  </PieChart>
                </ResponsiveContainer>
              </Box>
              <Group gap="md" justify="center" wrap="wrap">
                {mixRows.map((row) => (
                  <Group key={`cost-mix-${row.key}`} gap={5} wrap="nowrap">
                    <Box w={9} h={9} style={{ borderRadius: 99, background: row.color, flexShrink: 0 }} />
                    <Text size="xs" c="dimmed">
                      <Text span fw={800}>{row.name}</Text>
                      {`: ${formatMoney(row.value, currency)} (${mixTotal > 0 ? ((row.value / mixTotal) * 100).toFixed(1) : "0.0"}%)`}
                    </Text>
                  </Group>
                ))}
              </Group>
            </Stack>
          )}
        </CostChartCard>

        <CostChartCard title="Largest Cost Drivers">
          {!allCostSourcesAvailable || !allDetailSourcesAvailable ? (
            <Alert color="orange" variant="light" ta="center">
              Cost drivers are unavailable because one or more detailed sources could not be loaded safely.
            </Alert>
          ) : driverRows.length === 0 ? (
            <Alert color="gray" variant="light" ta="center">No detailed cost rows are available.</Alert>
          ) : (
            <Stack h="100%" gap="xs">
              <Box h={driverChartHeight}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={driverRows} layout="vertical" margin={{ top: 4, right: 18, bottom: 4, left: 6 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" tickFormatter={(value: number) => Number(value).toLocaleString("en-US")} />
                    <YAxis
                      type="category"
                      dataKey="shortLabel"
                      width={isMobile ? 88 : 112}
                      tick={{ fontSize: 11 }}
                      interval={0}
                    />
                    <RechartsTooltip
                      formatter={(value: number, _name: string, item: { payload?: CostDriverRow }) => [
                        formatMoney(Number(value), currency),
                        item.payload?.source ?? "Cost",
                      ]}
                      labelFormatter={(_label: string, rows: Array<{ payload?: CostDriverRow }>) => rows[0]?.payload?.label ?? ""}
                    />
                    <Bar dataKey="value" name="Cost" radius={[0, 5, 5, 0]}>
                      {driverRows.map((row) => <Cell key={row.key} fill={row.color} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </Box>
              <Group gap="md" justify="center" wrap="wrap">
                {[
                  { label: "Open Bar", color: COST_COLORS.openBar },
                  { label: "Staff Payments", color: COST_COLORS.staff },
                  { label: "Other Expenses", color: COST_COLORS.other },
                ].map((item) => (
                  <Group key={`driver-legend-${item.label}`} gap={5} wrap="nowrap">
                    <Box w={9} h={9} style={{ borderRadius: 99, background: item.color, flexShrink: 0 }} />
                    <Text size="xs" c="dimmed">{item.label}</Text>
                  </Group>
                ))}
              </Group>
            </Stack>
          )}
        </CostChartCard>
      </SimpleGrid>

      {safeSummary.openBarPayouts != null
      && safeSummary.otherExpenses != null
      && safeSummary.openBarDetails != null
      && safeSummary.otherExpenseDates != null
      && datedTrendRows.length > 0 ? (
        <CostChartCard title="Dated Cost Activity: Open Bar and Other Expenses">
          <Stack h="100%" gap="xs">
            <Box h={235}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={datedTrendRows} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" minTickGap={18} />
                  <YAxis width={isMobile ? 42 : 60} tickFormatter={(value: number) => Number(value).toLocaleString("en-US")} />
                  <RechartsTooltip formatter={(value: number, name: string) => [formatMoney(Number(value), currency), name]} />
                  <Legend />
                  <Bar dataKey="openBar" stackId="cost" name="Open Bar" fill={COST_COLORS.openBar} />
                  <Bar dataKey="otherExpenses" stackId="cost" name="Other Expenses" fill={COST_COLORS.other} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Box>
            <Text size="xs" c="dimmed" ta="center">
              Staff Payments are period-based and are not included in this dated chart.
            </Text>
          </Stack>
        </CostChartCard>
      ) : null}

      <Accordion
        multiple
        defaultValue={["open-bar", "staff-payments", "other-expenses"]}
        variant="separated"
        radius="lg"
      >
        <Accordion.Item value="open-bar">
          <Accordion.Control icon={<IconTicket size={19} color={COST_COLORS.openBar} />}>
            <Group justify="space-between" gap="sm" wrap="wrap" pr="sm">
              <Text fw={800}>Open Bar Detail</Text>
              <Group gap="xs">
                {safeSummary.openBarDetails == null ? (
                  <Badge variant="light" color="gray">Unavailable</Badge>
                ) : (
                  <Badge variant="light" color="teal">{`${openBarRows.length} venues`}</Badge>
                )}
                {safeSummary.openBarPayouts != null ? <Text fw={800}>{formatMoney(safeSummary.openBarPayouts, currency)}</Text> : null}
              </Group>
            </Group>
          </Accordion.Control>
          <Accordion.Panel>
            {safeSummary.openBarDetails == null ? (
              <EmptyDetail>Open Bar detail is unavailable.</EmptyDetail>
            ) : openBarRows.length === 0 ? (
              <EmptyDetail>No Open Bar venues for this period.</EmptyDetail>
            ) : isMobile ? (
              <Stack gap="sm">
                {openBarRows.map((row) => (
                  <Paper
                    key={`open-bar-mobile-${row.venueId ?? row.venueName}-${row.currency}`}
                    withBorder
                    radius="md"
                    p="sm"
                    style={{ borderTop: `3px solid ${COST_COLORS.openBar}` }}
                  >
                    <Stack gap="sm" align="center">
                      <Stack gap={1} align="center">
                        <Text fw={800} ta="center">{row.venueName}</Text>
                        <Text fz="lg" fw={900} ta="center">{formatMoney(row.amount, row.currency)}</Text>
                      </Stack>
                      <OpenBarGuestMix row={row} />
                      <Paper withBorder radius="md" p="xs" w="100%">
                        <OpenBarRateBands row={row} />
                      </Paper>
                      <SimpleGrid cols={2} spacing="xs" w="100%">
                        <DetailStat label="Guests" value={row.totalPeople.toLocaleString()} />
                        <DetailStat label="Nights" value={new Set(row.daily.map((day) => day.date)).size} />
                        <DetailStat
                          label="Paid"
                          value={row.paid == null ? "Unavailable" : formatMoney(row.paid, row.currency)}
                        />
                        <DetailStat
                          label="Outstanding"
                          value={row.outstanding == null ? "Unavailable" : formatMoney(row.outstanding, row.currency)}
                        />
                      </SimpleGrid>
                    </Stack>
                  </Paper>
                ))}
              </Stack>
            ) : (
              <ScrollArea type="auto" offsetScrollbars>
                <Table striped highlightOnHover withColumnBorders miw={1120}>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th ta="center">Venue</Table.Th>
                      <Table.Th ta="center">Guests</Table.Th>
                      <Table.Th ta="center">Guest types</Table.Th>
                      <Table.Th ta="center">Rate bands</Table.Th>
                      <Table.Th ta="center">Nights</Table.Th>
                      <Table.Th ta="center">Due</Table.Th>
                      <Table.Th ta="center">Paid</Table.Th>
                      <Table.Th ta="center">Outstanding</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {openBarRows.map((row) => (
                      <Table.Tr key={`open-bar-detail-${row.venueId ?? row.venueName}-${row.currency}`}>
                        <Table.Td ta="center" fw={700}>{row.venueName}</Table.Td>
                        <Table.Td ta="center">{row.totalPeople.toLocaleString()}</Table.Td>
                        <Table.Td ta="center"><OpenBarGuestMix row={row} emptyFallback /></Table.Td>
                        <Table.Td ta="center"><OpenBarRateBands row={row} compact /></Table.Td>
                        <Table.Td ta="center">{new Set(row.daily.map((day) => day.date)).size}</Table.Td>
                        <Table.Td ta="center" fw={700}>{formatMoney(row.amount, row.currency)}</Table.Td>
                        <Table.Td ta="center">{row.paid == null ? "Unavailable" : formatMoney(row.paid, row.currency)}</Table.Td>
                        <Table.Td ta="center">{row.outstanding == null ? "Unavailable" : formatMoney(row.outstanding, row.currency)}</Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </ScrollArea>
            )}
          </Accordion.Panel>
        </Accordion.Item>

        <Accordion.Item value="staff-payments">
          <Accordion.Control icon={<IconUsersGroup size={19} color={COST_COLORS.staff} />}>
            <Group justify="space-between" gap="sm" wrap="wrap" pr="sm">
              <Text fw={800}>Staff Payments Detail</Text>
              <Group gap="xs">
                {safeSummary.staffPaymentDetails == null ? (
                  <Badge variant="light" color="gray">Unavailable</Badge>
                ) : (
                  <Badge variant="light" color="blue">{`${staffRows.length} people`}</Badge>
                )}
                {safeSummary.staffPayments != null ? <Text fw={800}>{formatMoney(safeSummary.staffPayments, currency)}</Text> : null}
              </Group>
            </Group>
          </Accordion.Control>
          <Accordion.Panel>
            {safeSummary.staffPaymentDetails == null ? (
              <EmptyDetail>Staff Payment detail is unavailable.</EmptyDetail>
            ) : staffRows.length === 0 ? (
              <EmptyDetail>No staff earnings for this period.</EmptyDetail>
            ) : (
              <Paper withBorder radius="md" style={{ overflow: "hidden" }}>
                <ScrollArea type="auto" offsetScrollbars>
                  <Table
                    striped
                    highlightOnHover
                    withColumnBorders
                    miw={isMobile ? 320 : 760}
                    style={{ tableLayout: isMobile ? "fixed" : "auto" }}
                  >
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th w={46} aria-label="Payment details" />
                        <Table.Th ta="center">Name</Table.Th>
                        {!isMobile ? <Table.Th ta="center">Staff type</Table.Th> : null}
                        <Table.Th ta="center" w={isMobile ? 118 : undefined}>Due</Table.Th>
                        {!isMobile ? <Table.Th ta="center">Paid</Table.Th> : null}
                        {!isMobile ? <Table.Th ta="center">Outstanding</Table.Th> : null}
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {staffRows.map((row, index) => {
                        const rowKey = `${row.userId ?? row.fullName}-${row.currency}`;
                        const isExpanded = expandedStaffRows.includes(rowKey);
                        const detailId = `staff-payment-detail-${index}`;
                        return (
                          <Fragment key={`staff-cost-${rowKey}`}>
                            <Table.Tr
                              role="button"
                              tabIndex={0}
                              aria-label={`${isExpanded ? "Hide" : "Show"} payment details for ${row.fullName}, ${formatMoney(row.amount, row.currency)}`}
                              aria-controls={detailId}
                              aria-expanded={isExpanded}
                              onClick={() => toggleStaffRow(rowKey)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === " ") {
                                  event.preventDefault();
                                  toggleStaffRow(rowKey);
                                }
                              }}
                              style={{ cursor: "pointer" }}
                            >
                              <Table.Td ta="center" px="xs">
                                <ThemeIcon
                                  variant={isExpanded ? "light" : "transparent"}
                                  color="blue"
                                  size="sm"
                                  aria-hidden="true"
                                >
                                  <IconChevronDown
                                    size={17}
                                    style={{
                                      transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
                                      transition: "transform 150ms ease",
                                    }}
                                  />
                                </ThemeIcon>
                              </Table.Td>
                              <Table.Td ta="center" fw={700} style={{ overflowWrap: "anywhere" }}>
                                <Stack gap={3} align="center">
                                  <Text size="sm" fw={800} ta="center">{row.fullName}</Text>
                                  {isMobile && row.staffType ? (
                                    <Badge size="xs" variant="light" color="blue">{row.staffType}</Badge>
                                  ) : null}
                                </Stack>
                              </Table.Td>
                              {!isMobile ? (
                                <Table.Td ta="center">
                                  {row.staffType ? <Badge variant="light" color="blue">{row.staffType}</Badge> : "—"}
                                </Table.Td>
                              ) : null}
                              <Table.Td ta="center" fw={800}>{formatMoney(row.amount, row.currency)}</Table.Td>
                              {!isMobile ? (
                                <Table.Td ta="center">
                                  {row.paid == null ? "Unavailable" : formatMoney(row.paid, row.currency)}
                                </Table.Td>
                              ) : null}
                              {!isMobile ? (
                                <Table.Td ta="center">
                                  {row.outstanding == null ? "Unavailable" : formatMoney(row.outstanding, row.currency)}
                                </Table.Td>
                              ) : null}
                            </Table.Tr>
                            {isExpanded ? (
                              <Table.Tr id={detailId}>
                                <Table.Td colSpan={isMobile ? 3 : 6} p={0}>
                                  <Box
                                    p={isMobile ? "sm" : "md"}
                                    style={{
                                      background: "var(--mantine-color-blue-0)",
                                      borderTop: "1px solid var(--mantine-color-blue-2)",
                                    }}
                                  >
                                    <StaffPaymentExpandedContent
                                      row={row}
                                      rowKey={rowKey}
                                      isMobile={isMobile}
                                    />
                                  </Box>
                                </Table.Td>
                              </Table.Tr>
                            ) : null}
                          </Fragment>
                        );
                      })}
                    </Table.Tbody>
                  </Table>
                </ScrollArea>
              </Paper>
            )}
          </Accordion.Panel>
        </Accordion.Item>

        <Accordion.Item value="other-expenses">
          <Accordion.Control icon={<IconCash size={19} color={COST_COLORS.other} />}>
            <Group justify="space-between" gap="sm" wrap="wrap" pr="sm">
              <Text fw={800}>Other Expenses Detail</Text>
              <Group gap="xs">
                {safeSummary.otherExpensesTransactionCount == null ? (
                  <Badge variant="light" color="gray">Unavailable</Badge>
                ) : (
                  <Badge variant="light" color="orange">
                    {`${safeSummary.otherExpensesTransactionCount} transactions`}
                  </Badge>
                )}
                {safeSummary.otherExpenses != null ? <Text fw={800}>{formatMoney(safeSummary.otherExpenses, currency)}</Text> : null}
              </Group>
            </Group>
          </Accordion.Control>
          <Accordion.Panel>
            {safeSummary.otherExpenseTransactions == null ? (
              <EmptyDetail>Other Expense transactions are unavailable.</EmptyDetail>
            ) : otherRows.length === 0 ? (
              <EmptyDetail>No paid Other Expense transactions for this period.</EmptyDetail>
            ) : (
              <Stack gap="xs">
                {invoicePreviewError ? (
                  <Alert color="red" variant="light" ta="center" withCloseButton onClose={() => setInvoicePreviewError(null)}>
                    {invoicePreviewError}
                  </Alert>
                ) : null}
                {safeSummary.otherExpenseTransactionsTruncated ? (
                  <Alert color="orange" variant="light" ta="center">
                    {`Showing the newest ${safeSummary.otherExpenseTransactionLimit ?? otherRows.length} transactions. The KPI and graphics still include the complete period.`}
                  </Alert>
                ) : null}
                {isMobile ? (
                  <Stack gap="sm">
                    {visibleOtherRows.map((row) => {
                      const nativeDiffers = row.currency !== row.baseCurrency || row.amount !== row.baseAmount;
                      return (
                        <Paper
                          key={`other-expense-mobile-${row.id}`}
                          withBorder
                          radius="md"
                          p="sm"
                          style={{ borderTop: `3px solid ${COST_COLORS.other}` }}
                        >
                          <Stack gap="sm" align="center">
                            <Stack gap={2} align="center">
                              <Text fw={800} ta="center">{row.description || `Transaction #${row.id}`}</Text>
                              <Text size="xs" c="dimmed" ta="center">
                                {`${formatDate(row.date)} | #${row.id}${row.paymentMethod ? ` | ${row.paymentMethod}` : ""}`}
                              </Text>
                              <Text fz="lg" fw={900} ta="center">{formatMoney(row.baseAmount, row.baseCurrency)}</Text>
                              {nativeDiffers ? (
                                <Text size="xs" c="dimmed" ta="center">{formatMoney(row.amount, row.currency)}</Text>
                              ) : null}
                            </Stack>
                            <SimpleGrid cols={2} spacing="xs" w="100%">
                              <DetailStat label="Category" value={row.categoryName} />
                              <DetailStat label="Vendor" value={row.vendorName || "—"} />
                              <DetailStat label="Account" value={row.accountName || "—"} />
                              <DetailStat label="Source" value={row.source || "Finance"} />
                            </SimpleGrid>
                            {row.invoiceFile && isPreviewableInvoiceMimeType(row.invoiceFile.mimeType) ? (
                              <Button
                                variant="light"
                                color="orange"
                                leftSection={<IconFileInvoice size={17} />}
                                loading={invoicePreviewLoadingId === row.id}
                                onClick={() => void handleOpenInvoicePreview(row)}
                              >
                                View invoice
                              </Button>
                            ) : row.invoiceFile ? (
                              <Button
                                component="a"
                                href={buildInvoiceDownloadHref(row.invoiceFile.id)}
                                download={row.invoiceFile.originalName}
                                target="_blank"
                                rel="noopener noreferrer"
                                variant="light"
                                color="orange"
                                leftSection={<IconDownload size={17} />}
                              >
                                Download invoice
                              </Button>
                            ) : null}
                          </Stack>
                        </Paper>
                      );
                    })}
                    {visibleOtherRows.length < otherRows.length ? (
                      <Button
                        variant="light"
                        color="orange"
                        fullWidth
                        onClick={() => setMobileTransactionLimit((current) => current + 20)}
                      >
                        {`Show ${Math.min(20, otherRows.length - visibleOtherRows.length)} more`}
                      </Button>
                    ) : null}
                  </Stack>
                ) : (
                  <ScrollArea h={Math.min(520, 94 + otherRows.length * 58)}>
                    <Table striped highlightOnHover withColumnBorders miw={980}>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th ta="center">Date</Table.Th>
                        <Table.Th ta="center">Transaction</Table.Th>
                        <Table.Th ta="center">Category</Table.Th>
                        <Table.Th ta="center">Vendor</Table.Th>
                        <Table.Th ta="center">Account</Table.Th>
                        <Table.Th ta="center">Amount</Table.Th>
                        <Table.Th ta="center">Invoice</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {otherRows.map((row) => {
                        const nativeDiffers = row.currency !== row.baseCurrency || row.amount !== row.baseAmount;
                        return (
                          <Table.Tr key={`other-expense-${row.id}`}>
                            <Table.Td ta="center" style={{ whiteSpace: "nowrap" }}>{formatDate(row.date)}</Table.Td>
                            <Table.Td ta="center">
                              <Stack gap={0} align="center">
                                <Text size="sm" fw={700}>{row.description || `Transaction #${row.id}`}</Text>
                                <Text size="xs" c="dimmed">{`#${row.id}${row.paymentMethod ? ` · ${row.paymentMethod}` : ""}`}</Text>
                              </Stack>
                            </Table.Td>
                            <Table.Td ta="center">{row.categoryName}</Table.Td>
                            <Table.Td ta="center">{row.vendorName || "—"}</Table.Td>
                            <Table.Td ta="center">{row.accountName || "—"}</Table.Td>
                            <Table.Td ta="center">
                              <Stack gap={0} align="center">
                                <Text fw={800}>{formatMoney(row.baseAmount, row.baseCurrency)}</Text>
                                {nativeDiffers ? <Text size="xs" c="dimmed">{formatMoney(row.amount, row.currency)}</Text> : null}
                              </Stack>
                            </Table.Td>
                            <Table.Td ta="center">
                              {row.invoiceFile && isPreviewableInvoiceMimeType(row.invoiceFile.mimeType) ? (
                                <Button
                                  variant="subtle"
                                  color="orange"
                                  size="compact-sm"
                                  leftSection={<IconFileInvoice size={16} />}
                                  loading={invoicePreviewLoadingId === row.id}
                                  onClick={() => void handleOpenInvoicePreview(row)}
                                >
                                  View invoice
                                </Button>
                              ) : row.invoiceFile ? (
                                <Button
                                  component="a"
                                  href={buildInvoiceDownloadHref(row.invoiceFile.id)}
                                  download={row.invoiceFile.originalName}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  variant="subtle"
                                  color="orange"
                                  size="compact-sm"
                                  leftSection={<IconDownload size={16} />}
                                >
                                  Download invoice
                                </Button>
                              ) : (
                                <Text c="dimmed">—</Text>
                              )}
                            </Table.Td>
                          </Table.Tr>
                        );
                      })}
                    </Table.Tbody>
                    </Table>
                  </ScrollArea>
                )}
              </Stack>
            )}
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
      <NightReportPhotoPreviewDialog preview={invoicePreview} onClose={handleCloseInvoicePreview} />
    </Stack>
  );
};

export default BookingCostsDashboard;
