import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActionIcon,
  Alert,
  Box,
  Button,
  Group,
  Loader,
  MultiSelect,
  SegmentedControl,
  Select,
  Stack,
  Tooltip,
  useMantineTheme,
} from "@mantine/core";
import { DatePickerInput } from "@mantine/dates";
import { useMediaQuery } from "@mantine/hooks";
import { IconFilter, IconRefresh } from "@tabler/icons-react";
import dayjs from "dayjs";
import axiosInstance from "../../utils/axiosInstance";
import type { UnifiedOrder } from "../../store/bookingPlatformsTypes";
import { PageAccessGuard } from "../access/PageAccessGuard";
import { PAGE_SLUGS } from "../../constants/pageSlugs";
import { useModuleAccess } from "../../hooks/useModuleAccess";
import {
  resolveBookingsSummaryProductTypeValues,
  serializeProductTypeSelection,
} from "../../utils/productTypeQuery";
import {
  BOOKINGS_SUMMARY_PRESET_OPTIONS,
  DEFAULT_BOOKINGS_SUMMARY_FILTERS,
  normalizeBookingsSummaryFilters,
  parseBookingsSummaryDateField,
  parseBookingsSummaryMetric,
  parseBookingsSummaryPreset,
  resolveBookingsSummaryRange,
  type BookingsSummaryFilters,
} from "../../utils/bookingsSummaryQuery";
import {
  parseBookingOpenBarRateBands,
  parseBookingOtherExpensesInsight,
  parseBookingStaffPaymentBreakdown,
} from "../../utils/bookingCostInsights";
import type {
  BookingAddonDashboardRow,
  BookingCostsSummary,
  BookingCounterInsights,
  VenueCommissionCurrencyTotal,
  VenueCommissionVenueRow,
} from "./BookingsExecutiveDashboard";
import type {
  BookingOpenBarCostDetail,
  BookingStaffPaymentCostDetail,
} from "./BookingCostsDashboard";

export type { BookingsSummaryFilters } from "../../utils/bookingsSummaryQuery";

const BookingsExecutiveDashboard = lazy(() => import("./BookingsExecutiveDashboard"));

const BOOKINGS_MODULE = "booking-management";
const COST_SUMMARY_CURRENCY = "PLN";

type ProductTypeOption = { value: string; label: string };
type FetchStatus = "idle" | "loading" | "error" | "success";

export type BookingsSummaryWorkspaceProps = {
  initialFilters?: Partial<BookingsSummaryFilters>;
  filters?: BookingsSummaryFilters;
  onFiltersChange?: (filters: BookingsSummaryFilters) => void;
  productTypesExplicit?: boolean;
  embedded?: boolean;
  filtersVisible?: boolean;
  onFiltersVisibleChange?: (visible: boolean) => void;
  refreshToken?: number;
};

type SummaryPayloadProjection = {
  orders: UnifiedOrder[];
  bookingAddons: BookingAddonDashboardRow[];
  addonCatalog: Array<{ id: number; name: string; basePrice: number }>;
  counterInsights: BookingCounterInsights | null;
  venueCommissionTotals: VenueCommissionCurrencyTotal[] | null;
  venueCommissionVenues: VenueCommissionVenueRow[] | null;
  costsSummary: BookingCostsSummary | null;
};

const deriveErrorMessage = (error: unknown): string => {
  const responseMessage = (
    error as { response?: { data?: { message?: unknown } } }
  )?.response?.data?.message;
  if (typeof responseMessage === "string" && responseMessage.trim()) {
    return responseMessage;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Unable to load Booking Summary right now.";
};

const asFiniteNumber = (value: unknown, fallback = 0): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const asNullableFiniteNumber = (value: unknown): number | null => {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const projectBookingsSummaryPayload = (
  payload: unknown,
): SummaryPayloadProjection => {
  const response = payload && typeof payload === "object"
    ? (payload as Record<string, unknown>)
    : {};
  const orders = Array.isArray(response.orders)
    ? (response.orders as UnifiedOrder[])
    : [];
  const bookingAddons = Array.isArray(response.bookingAddons)
    ? (response.bookingAddons as BookingAddonDashboardRow[])
    : [];
  const counterInsights = response.counterInsights && typeof response.counterInsights === "object"
    ? (response.counterInsights as BookingCounterInsights)
    : null;
  const otherExpensesInsight = parseBookingOtherExpensesInsight(response.costInsights);
  const summaryInsights = response.summaryInsights && typeof response.summaryInsights === "object"
    ? (response.summaryInsights as Record<string, unknown>)
    : null;

  const venueSummaryResponseData = summaryInsights?.venueSummary;
  const venueSummaryRoot = Array.isArray(venueSummaryResponseData) && venueSummaryResponseData[0]
    ? venueSummaryResponseData[0]
    : null;
  const venueSummaryData = venueSummaryRoot && typeof venueSummaryRoot === "object"
    ? (venueSummaryRoot as { data?: unknown }).data
    : null;
  const venueSummary = Array.isArray(venueSummaryData) && venueSummaryData.length > 0
    ? venueSummaryData[0]
    : venueSummaryData;
  const venueTotalsRaw = venueSummary && typeof venueSummary === "object"
    ? (venueSummary as { totalsByCurrency?: unknown }).totalsByCurrency
    : null;
  const venueRowsRaw = venueSummary && typeof venueSummary === "object"
    ? (venueSummary as { venues?: unknown }).venues
    : null;
  const venueCollectionDataAvailable = venueSummary && typeof venueSummary === "object"
    ? (venueSummary as { collectionDataAvailable?: unknown }).collectionDataAvailable === true
    : false;

  const venueCommissionTotals: VenueCommissionCurrencyTotal[] | null = Array.isArray(venueTotalsRaw)
    ? venueTotalsRaw.reduce<VenueCommissionCurrencyTotal[]>((rows, value) => {
        if (!value || typeof value !== "object") return rows;
        const raw = value as Record<string, unknown>;
        rows.push({
          currency: String(raw.currency ?? "PLN").toUpperCase(),
          receivable: asFiniteNumber(raw.receivable),
          receivableCollected: asFiniteNumber(raw.receivableCollected),
          receivableOutstanding: asFiniteNumber(raw.receivableOutstanding),
          payable: asFiniteNumber(raw.payable),
          payableCollected: asFiniteNumber(raw.payableCollected),
          payableOutstanding: asFiniteNumber(raw.payableOutstanding),
        });
        return rows;
      }, [])
    : null;

  const venueCommissionVenues: VenueCommissionVenueRow[] | null = Array.isArray(venueRowsRaw)
    ? venueRowsRaw.reduce<VenueCommissionVenueRow[]>((rows, value) => {
        if (!value || typeof value !== "object") return rows;
        const raw = value as Record<string, unknown>;
        const rawVenueId = asNullableFiniteNumber(raw.venueId);
        const daily = Array.isArray(raw.daily)
          ? raw.daily.reduce<VenueCommissionVenueRow["daily"]>((days, entry) => {
              if (!entry || typeof entry !== "object") return days;
              const day = entry as Record<string, unknown>;
              const date = typeof day.date === "string" ? day.date.trim() : "";
              const direction = day.direction;
              if (!date || (direction !== "receivable" && direction !== "payable")) {
                return days;
              }
              days.push({
                date,
                totalPeople: asFiniteNumber(day.totalPeople),
                amount: asFiniteNumber(day.amount),
                direction,
                normalCount: asFiniteNumber(day.normalCount),
                cocktailsCount: asFiniteNumber(day.cocktailsCount),
                brunchCount: asFiniteNumber(day.brunchCount),
                rateBands: parseBookingOpenBarRateBands(day.rateBands),
                rateBreakdownMatchesPayout:
                  typeof day.rateBreakdownMatchesPayout === "boolean"
                    ? day.rateBreakdownMatchesPayout
                    : null,
              });
              return days;
            }, [])
          : [];
        rows.push({
          venueId:
            rawVenueId != null && Number.isSafeInteger(rawVenueId) && rawVenueId > 0
              ? rawVenueId
              : null,
          venueName: String(raw.venueName ?? "").trim() || "Unknown Venue",
          currency: String(raw.currency ?? "PLN").toUpperCase(),
          allowsOpenBar: raw.allowsOpenBar === true,
          receivable: asFiniteNumber(raw.receivable),
          receivableCollected: asFiniteNumber(raw.receivableCollected),
          receivableOutstanding: asFiniteNumber(raw.receivableOutstanding),
          payable: asFiniteNumber(raw.payable),
          payableCollected: asFiniteNumber(raw.payableCollected),
          payableOutstanding: asFiniteNumber(raw.payableOutstanding),
          totalPeople: asFiniteNumber(raw.totalPeople),
          totalPeoplePayable: asFiniteNumber(raw.totalPeoplePayable),
          daily,
        });
        return rows;
      }, [])
    : null;

  const costSummaryCurrency = otherExpensesInsight?.currency ?? COST_SUMMARY_CURRENCY;
  const staffPaymentsRaw = summaryInsights?.staffPayments;
  const parsedStaffPaymentDetails: BookingStaffPaymentCostDetail[] | null = !Array.isArray(staffPaymentsRaw)
    ? null
    : staffPaymentsRaw
        .reduce<BookingStaffPaymentCostDetail[]>((rows, value) => {
          if (!value || typeof value !== "object") return rows;
          const item = value as Record<string, unknown>;
          const rawUserId = asNullableFiniteNumber(item.userId);
          const userId = rawUserId != null && Number.isSafeInteger(rawUserId) && rawUserId > 0
            ? rawUserId
            : null;
          rows.push({
            userId,
            fullName:
              String(item.fullName ?? "").trim()
              || (userId == null ? "Unknown Staff Member" : `Staff #${userId}`),
            staffType: String(item.staffType ?? "").trim() || null,
            currency: String(item.currency ?? "").trim().toUpperCase(),
            amount: asFiniteNumber(item.amount),
            paid: asNullableFiniteNumber(item.paid),
            outstanding: asNullableFiniteNumber(item.outstanding),
            breakdown: parseBookingStaffPaymentBreakdown(item.breakdown),
          });
          return rows;
        }, [])
        .sort((left, right) => right.amount - left.amount || left.fullName.localeCompare(right.fullName));
  const staffPaymentDetails = parsedStaffPaymentDetails?.filter((row) => row.amount > 0) ?? null;
  const hasUnsupportedStaffCurrency = (parsedStaffPaymentDetails ?? []).some(
    (item) => item.amount !== 0 && item.currency !== costSummaryCurrency,
  );
  const staffPaymentsTotal = parsedStaffPaymentDetails == null || hasUnsupportedStaffCurrency
    ? null
    : parsedStaffPaymentDetails.reduce((sum, item) => sum + item.amount, 0);
  const hasUnsupportedVenueCurrency = (venueCommissionTotals ?? []).some(
    (row) => row.payable !== 0 && row.currency !== costSummaryCurrency,
  );
  const openBarPayoutsTotal = venueCommissionTotals == null || hasUnsupportedVenueCurrency
    ? null
    : venueCommissionTotals.reduce((sum, row) => sum + asFiniteNumber(row.payable), 0);
  const openBarDetails: BookingOpenBarCostDetail[] | null = venueCommissionVenues == null
    ? null
    : venueCommissionVenues
        .filter(
          (row) => row.payable > 0 && row.daily.some((day) => day.direction === "payable" && day.amount > 0),
        )
        .map((row) => {
          const daily = row.daily
            .filter((day) => day.direction === "payable" && day.amount > 0)
            .map((day) => ({
              date: day.date,
              amount: day.amount,
              totalPeople: day.totalPeople,
              normalCount: day.normalCount,
              cocktailCount: day.cocktailsCount,
              brunchCount: day.brunchCount,
              rateBands: day.rateBands,
              rateBreakdownMatchesPayout: day.rateBreakdownMatchesPayout,
            }));
          return {
            venueId: row.venueId,
            venueName: row.venueName,
            currency: row.currency,
            amount: row.payable,
            paid: venueCollectionDataAvailable ? row.payableCollected : null,
            outstanding: venueCollectionDataAvailable ? row.payableOutstanding : null,
            totalPeople: daily.reduce((sum, day) => sum + day.totalPeople, 0),
            daily,
          };
        })
        .sort((left, right) => right.amount - left.amount || left.venueName.localeCompare(right.venueName));

  const addonCatalog = Array.isArray(response.addonCatalog)
    ? response.addonCatalog
        .map((value) => {
          const raw = value as Record<string, unknown>;
          const id = Number(raw.id);
          const name = String(raw.name ?? "").trim();
          const basePrice = Number(raw.basePrice ?? 0);
          if (!Number.isFinite(id) || id <= 0 || !name) return null;
          return { id, name, basePrice: Number.isFinite(basePrice) ? basePrice : 0 };
        })
        .filter(
          (row): row is { id: number; name: string; basePrice: number } => row !== null,
        )
    : [];

  return {
    orders,
    bookingAddons,
    addonCatalog,
    counterInsights,
    venueCommissionTotals,
    venueCommissionVenues,
    costsSummary: {
      currency: costSummaryCurrency,
      openBarPayouts: openBarPayoutsTotal,
      staffPayments: staffPaymentsTotal,
      otherExpenses: otherExpensesInsight?.amount ?? null,
      otherExpensesTransactionCount: otherExpensesInsight?.transactionCount ?? null,
      openBarDetails,
      staffPaymentDetails,
      otherExpenseCategories: otherExpensesInsight?.categories ?? null,
      otherExpenseDates: otherExpensesInsight?.dates ?? null,
      otherExpenseTransactions: otherExpensesInsight?.transactions ?? null,
      otherExpenseTransactionLimit: otherExpensesInsight?.transactionLimit ?? null,
      otherExpenseTransactionsTruncated: otherExpensesInsight?.transactionsTruncated ?? false,
    },
  };
};

const filtersEqual = (left: BookingsSummaryFilters, right: BookingsSummaryFilters): boolean =>
  left.summaryDateField === right.summaryDateField
  && left.summaryPreset === right.summaryPreset
  && left.summaryMetric === right.summaryMetric
  && left.summaryStart === right.summaryStart
  && left.summaryEnd === right.summaryEnd
  && left.summaryProductTypes.length === right.summaryProductTypes.length
  && left.summaryProductTypes.every((value, index) => value === right.summaryProductTypes[index]);

const BookingsSummaryWorkspace = ({
  initialFilters,
  filters: controlledFilters,
  onFiltersChange,
  productTypesExplicit,
  embedded = false,
  filtersVisible: controlledFiltersVisible,
  onFiltersVisibleChange,
  refreshToken = 0,
}: BookingsSummaryWorkspaceProps) => {
  const modulePermissions = useModuleAccess(BOOKINGS_MODULE);
  const theme = useMantineTheme();
  const isMobile = useMediaQuery(`(max-width: ${theme.breakpoints.sm})`);
  const [uncontrolledFilters, setUncontrolledFilters] = useState<BookingsSummaryFilters>(() =>
    normalizeBookingsSummaryFilters(initialFilters ?? DEFAULT_BOOKINGS_SUMMARY_FILTERS),
  );
  const filters = useMemo(
    () => controlledFilters
      ? normalizeBookingsSummaryFilters(controlledFilters)
      : uncontrolledFilters,
    [controlledFilters, uncontrolledFilters],
  );
  const initialProductTypeSelectionRef = useRef(filters.summaryProductTypes);
  const [internalFiltersVisible, setInternalFiltersVisible] = useState(false);
  const filtersVisible = controlledFiltersVisible ?? internalFiltersVisible;
  const [productTypeOptions, setProductTypeOptions] = useState<ProductTypeOption[]>([]);
  const [productTypesLoaded, setProductTypesLoaded] = useState(false);
  const [projection, setProjection] = useState<SummaryPayloadProjection>({
    orders: [],
    bookingAddons: [],
    addonCatalog: [],
    counterInsights: null,
    venueCommissionTotals: null,
    venueCommissionVenues: null,
    costsSummary: null,
  });
  const [fetchStatus, setFetchStatus] = useState<FetchStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [ingestStatus, setIngestStatus] = useState<FetchStatus>("idle");
  const [internalReloadToken, setInternalReloadToken] = useState(0);

  const inferredExplicitProductTypes = Object.prototype.hasOwnProperty.call(
    initialFilters ?? {},
    "summaryProductTypes",
  );
  const hasExplicitProductTypes = productTypesExplicit ?? inferredExplicitProductTypes;

  const updateFilters = useCallback(
    (patch: Partial<BookingsSummaryFilters>) => {
      const next = normalizeBookingsSummaryFilters({ ...filters, ...patch });
      if (filtersEqual(filters, next)) return;
      if (!controlledFilters) {
        setUncontrolledFilters(next);
      }
      onFiltersChange?.(next);
    },
    [controlledFilters, filters, onFiltersChange],
  );

  const setFiltersVisible = useCallback(
    (visible: boolean) => {
      if (controlledFiltersVisible === undefined) {
        setInternalFiltersVisible(visible);
      }
      onFiltersVisibleChange?.(visible);
    },
    [controlledFiltersVisible, onFiltersVisibleChange],
  );

  useEffect(() => {
    if (!modulePermissions.ready || !modulePermissions.canView) return;
    const controller = new AbortController();
    setProductTypesLoaded(false);
    axiosInstance
      .get("/productTypes", { signal: controller.signal, withCredentials: true })
      .then((response) => {
        const rows: Array<{ id?: unknown; name?: unknown }> = Array.isArray(response.data?.[0]?.data)
          ? response.data[0].data
          : [];
        const options = rows
          .map((row) => {
            const id = Number(row.id);
            const name = String(row.name ?? "").trim();
            return Number.isFinite(id) && id > 0 && name
              ? ({ value: String(id), label: name } satisfies ProductTypeOption)
              : null;
          })
          .filter((row): row is ProductTypeOption => row !== null)
          .sort((left, right) => left.label.localeCompare(right.label));
        setProductTypeOptions(options);
        setProductTypesLoaded(true);
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        const requestedProductTypes = initialProductTypeSelectionRef.current;
        if (requestedProductTypes.length > 0) {
          setProductTypeOptions(
            requestedProductTypes.map((value) => ({
              value,
              label: `Product type ${value}`,
            })),
          );
          setProductTypesLoaded(true);
          return;
        }
        setFetchStatus("error");
        setErrorMessage(deriveErrorMessage(error));
      });
    return () => controller.abort();
  }, [modulePermissions.canView, modulePermissions.ready]);

  const resolvedProductTypeSelection = useMemo(
    () => productTypesLoaded
      ? resolveBookingsSummaryProductTypeValues(
          productTypeOptions,
          filters.summaryProductTypes,
          hasExplicitProductTypes,
        )
      : [],
    [
      filters.summaryProductTypes,
      hasExplicitProductTypes,
      productTypeOptions,
      productTypesLoaded,
    ],
  );
  const productTypeSelectionReady = productTypesLoaded
    && [...filters.summaryProductTypes].sort().join(",")
      === [...resolvedProductTypeSelection].sort().join(",");

  useEffect(() => {
    if (!productTypesLoaded || productTypeSelectionReady) return;
    updateFilters({ summaryProductTypes: resolvedProductTypeSelection });
  }, [
    filters.summaryProductTypes,
    productTypeSelectionReady,
    productTypesLoaded,
    resolvedProductTypeSelection,
    updateFilters,
  ]);

  const productTypeIds = useMemo(
    () => serializeProductTypeSelection(
      filters.summaryProductTypes,
      productTypeOptions.map((option) => option.value),
      { omitWhenAllSelected: false },
    ),
    [filters.summaryProductTypes, productTypeOptions],
  );
  const range = useMemo(() => resolveBookingsSummaryRange(filters), [filters]);

  useEffect(() => {
    if (
      !modulePermissions.ready
      || !modulePermissions.canView
      || !productTypesLoaded
      || !productTypeSelectionReady
    ) return;
    const controller = new AbortController();
    setFetchStatus("loading");
    setErrorMessage(null);
    axiosInstance
      .get("/bookings", {
        params: {
          pickupFrom: range.start.startOf("day").format("YYYY-MM-DD"),
          pickupTo: range.end.endOf("day").format("YYYY-MM-DD"),
          dateField: filters.summaryDateField,
          productTypeIds,
          includeSummaryInsights: true,
          limit: 200,
        },
        signal: controller.signal,
        withCredentials: true,
      })
      .then((response) => {
        setProjection(projectBookingsSummaryPayload(response.data));
        setFetchStatus("success");
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setFetchStatus("error");
        setErrorMessage(deriveErrorMessage(error));
      });
    return () => controller.abort();
  }, [
    filters.summaryDateField,
    internalReloadToken,
    modulePermissions.canView,
    modulePermissions.ready,
    productTypeIds,
    productTypeSelectionReady,
    productTypesLoaded,
    range.end,
    range.start,
    refreshToken,
  ]);

  const activeOrders = useMemo(
    () => projection.orders.filter((order) => order.status !== "cancelled"),
    [projection.orders],
  );
  const activeBookingIds = useMemo(
    () => new Set(
      activeOrders
        .map((order) => Number(order.id))
        .filter((id) => Number.isFinite(id) && id > 0),
    ),
    [activeOrders],
  );
  const activeBookingAddons = useMemo(
    () => projection.bookingAddons.filter((addon) => activeBookingIds.has(Number(addon.bookingId))),
    [activeBookingIds, projection.bookingAddons],
  );

  const handleRefresh = useCallback(async () => {
    if (ingestStatus === "loading") return;
    setIngestStatus("loading");
    setErrorMessage(null);
    try {
      await axiosInstance.post("/bookings/ingest-emails", {}, { withCredentials: true });
      setInternalReloadToken((token) => token + 1);
      setIngestStatus("success");
    } catch (error) {
      setIngestStatus("error");
      setErrorMessage(deriveErrorMessage(error));
    }
  }, [ingestStatus]);

  const customDateRange = useMemo<[Date | null, Date | null]>(
    () => [
      filters.summaryStart ? dayjs(filters.summaryStart).toDate() : null,
      filters.summaryEnd ? dayjs(filters.summaryEnd).toDate() : null,
    ],
    [filters.summaryEnd, filters.summaryStart],
  );

  const content = !modulePermissions.ready || modulePermissions.loading ? (
    <Box style={{ minHeight: 240 }}><Loader variant="dots" /></Box>
  ) : !modulePermissions.canView ? (
    <Alert color="yellow" title="No access">
      You do not have permission to view booking information.
    </Alert>
  ) : (
    <Stack gap="md">
      {embedded && (
        <Group justify="space-between" align="center">
          <ActionIcon
            variant={filtersVisible ? "filled" : "subtle"}
            size="lg"
            aria-label={filtersVisible ? "Hide Booking Summary filters" : "Show Booking Summary filters"}
            onClick={() => setFiltersVisible(!filtersVisible)}
          >
            <IconFilter size={18} />
          </ActionIcon>
          <Tooltip label="Refresh bookings" withArrow>
            <Button
              variant="subtle"
              size="sm"
              aria-label="Refresh bookings"
              onClick={handleRefresh}
              loading={ingestStatus === "loading" || fetchStatus === "loading"}
            >
              <IconRefresh size={16} />
            </Button>
          </Tooltip>
        </Group>
      )}

      {filtersVisible && (
        <Group gap="sm" wrap="wrap" align="center" justify="center">
          <SegmentedControl
            value={filters.summaryDateField}
            onChange={(value) => updateFilters({ summaryDateField: parseBookingsSummaryDateField(value) })}
            data={[
              { value: "experience_date", label: "Experience Date" },
              { value: "source_received_at", label: "Source Received At" },
            ]}
            size={isMobile ? "xs" : "sm"}
          />
          <MultiSelect
            value={filters.summaryProductTypes}
            onChange={(summaryProductTypes) => updateFilters({
              summaryProductTypes:
                summaryProductTypes.length > 0
                  ? summaryProductTypes
                  : resolveBookingsSummaryProductTypeValues(productTypeOptions, [], false),
            })}
            data={productTypeOptions}
            placeholder="Select product types"
            clearable
            size={isMobile ? "xs" : "sm"}
            w={isMobile ? "100%" : 320}
            checkIconPosition="right"
          />
        </Group>
      )}

      <Stack gap="sm" mx="auto" style={{ width: "100%", maxWidth: 860 }}>
        <Group gap="sm" wrap="wrap" align="center" justify="center">
          <Select
            value={filters.summaryPreset}
            onChange={(value) => updateFilters({ summaryPreset: parseBookingsSummaryPreset(value) })}
            data={BOOKINGS_SUMMARY_PRESET_OPTIONS}
            placeholder="This Month"
            size={isMobile ? "xs" : "sm"}
            w={isMobile ? "100%" : 220}
            checkIconPosition="right"
            allowDeselect={false}
            styles={{
              input: { textAlign: "center", fontWeight: 700 },
              dropdown: { textAlign: "center" },
              options: { textAlign: "center" },
              option: { justifyContent: "center", textAlign: "center", fontWeight: 600 },
            }}
          />
          {filters.summaryPreset === "custom" && (
            <DatePickerInput
              type="range"
              allowSingleDateInRange
              value={customDateRange}
              onChange={(value) => updateFilters({
                summaryStart: value[0] ? dayjs(value[0]).format("YYYY-MM-DD") : null,
                summaryEnd: value[1] ? dayjs(value[1]).format("YYYY-MM-DD") : null,
              })}
              placeholder="Select custom range"
              size={isMobile ? "xs" : "sm"}
              valueFormat="YYYY-MM-DD"
              clearable
              w={isMobile ? "100%" : 280}
              styles={{ input: { textAlign: "center" } }}
            />
          )}
        </Group>
        <SegmentedControl
          value={filters.summaryMetric}
          onChange={(value) => updateFilters({ summaryMetric: parseBookingsSummaryMetric(value) })}
          data={[
            { value: "earnings", label: "Earnings" },
            { value: "revenue", label: "Revenue" },
            { value: "costs", label: "Costs" },
          ]}
          fullWidth
          radius="md"
          size={isMobile ? "sm" : "md"}
          color="blue"
          styles={{
            root: { backgroundColor: "#eef3f8", border: "1px solid #d7e3f0" },
            label: { fontWeight: 600, paddingTop: 8, paddingBottom: 8 },
            indicator: { boxShadow: "0 2px 10px rgba(24, 100, 171, 0.18)" },
          }}
        />
      </Stack>

      {errorMessage && (
        <Alert color="red" title="Failed to load Booking Summary">
          {errorMessage}
        </Alert>
      )}

      {(!productTypeSelectionReady || (fetchStatus === "loading" && projection.orders.length === 0)) ? (
        <Box style={{ minHeight: 320 }}><Loader variant="bars" /></Box>
      ) : (
        <Suspense fallback={<Box style={{ minHeight: 320 }}><Loader variant="bars" /></Box>}>
          <BookingsExecutiveDashboard
            orders={activeOrders}
            allOrders={projection.orders}
            bookingAddons={activeBookingAddons}
            addonCatalog={projection.addonCatalog}
            counterInsights={projection.counterInsights}
            venueCommissionTotals={projection.venueCommissionTotals}
            venueCommissionVenues={projection.venueCommissionVenues}
            metricMode={filters.summaryMetric}
            costsSummary={projection.costsSummary}
            dateField={filters.summaryDateField}
            productTypeIds={productTypeIds}
            onDataChanged={() => setInternalReloadToken((token) => token + 1)}
          />
        </Suspense>
      )}
    </Stack>
  );

  return <PageAccessGuard pageSlug={PAGE_SLUGS.bookings}>{content}</PageAccessGuard>;
};

export default BookingsSummaryWorkspace;
