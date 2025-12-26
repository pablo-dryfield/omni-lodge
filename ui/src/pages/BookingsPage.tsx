import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Accordion,
  Badge,
  Box,
  Button,
  Flex,
  Group,
  Loader,
  Paper,
  ScrollArea,
  SegmentedControl,
  Stack,
  Table,
  Tabs,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import { IconArrowLeft, IconArrowRight, IconCalendar, IconPlus, IconRefresh } from "@tabler/icons-react";
import dayjs, { Dayjs } from "dayjs";
import { useAppDispatch } from "../store/hooks";
import { useNavigate } from "react-router-dom";
import { navigateToPage } from "../actions/navigationActions";
import { GenericPageProps } from "../types/general/GenericPageProps";
import { BookingsGrid } from "../components/BookingsGrid";
import axiosInstance from "../utils/axiosInstance";
import { OrderExtras, PlatformBreakdownEntry, UnifiedOrder, UnifiedProduct } from "../store/bookingPlatformsTypes";
import { prepareBookingGrid, BookingGrid } from "../utils/prepareBookingGrid";
import { PageAccessGuard } from "../components/access/PageAccessGuard";
import { PAGE_SLUGS } from "../constants/pageSlugs";
import { useModuleAccess } from "../hooks/useModuleAccess";

const DATE_FORMAT = "YYYY-MM-DD";

type ViewMode = "week" | "month";

type FetchStatus = "idle" | "loading" | "error" | "success";

type BookingFilter = "all" | "active" | "cancelled";

type PendingGroup = {
  platformBookingId: string;
  date: string;
  timeslot: string;
  pickupLabel: string;
  customerName: string;
  customerPhone?: string;
  productNames: string[];
  totalPeople: number;
  menCount: number;
  womenCount: number;
};

type PendingDiff = {
  platformBookingId: string;
  ecwid: PendingGroup;
  db: PendingGroup;
  differences: Array<{ field: string; ecwid: string; db: string }>;
  hasDateMismatch: boolean;
};

const PLATFORM_COLORS: Record<string, string> = {
  ecwid: "orange",
  fareharbor: "blue",
  viator: "teal",
  getyourguide: "grape",
  freetour: "gray",
  xperiencepoland: "red",
  airbnb: "pink",
  unknown: "dark",
};

const normalizePlatformKey = (value?: string | null): string => {
  if (!value) {
    return "unknown";
  }
  const key = value.toLowerCase().trim();
  return PLATFORM_COLORS[key] ? key : "unknown";
};

const formatPlatformLabel = (value?: string | null): string => {
  const safe = value ?? "Unknown";
  return safe
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");
};

const resolvePlatformColor = (value?: string | null): string => {
  const key = normalizePlatformKey(value);
  return PLATFORM_COLORS[key] ?? PLATFORM_COLORS.unknown;
};

const PlatformBadge = ({ platform }: { platform?: string }) => {
  if (!platform) {
    return null;
  }
  return (
    <Badge variant="light" color={resolvePlatformColor(platform)} size="sm">
      {formatPlatformLabel(platform)}
    </Badge>
  );
};

type BookingSummaryStats = {
  totalOrders: number;
  totalPeople: number;
  men: number;
  women: number;
  extras: OrderExtras;
  platformBreakdown: PlatformBreakdownEntry[];
};

const emptyExtras = (): OrderExtras => ({ tshirts: 0, cocktails: 0, photos: 0 });

const filterOrdersByStatus = (orders: UnifiedOrder[], filter: BookingFilter): UnifiedOrder[] => {
  if (filter === "all") {
    return orders;
  }
  if (filter === "cancelled") {
    return orders.filter((order) => order.status === "cancelled");
  }
  return orders.filter((order) => {
    const quantity = Number.isFinite(order.quantity) ? order.quantity : 0;
    return order.status !== "cancelled" && quantity > 0;
  });
};

const computeSummaryStats = (orders: UnifiedOrder[]): BookingSummaryStats => {
  const extras = emptyExtras();
  const platformMap = new Map<string, PlatformBreakdownEntry>();

  let men = 0;
  let women = 0;
  let totalPeople = 0;

  orders.forEach((order) => {
    const menCount = Number.isFinite(order.menCount) ? order.menCount : 0;
    const womenCount = Number.isFinite(order.womenCount) ? order.womenCount : 0;
    const fallback = Number.isFinite(order.quantity) ? order.quantity : 0;
    const participants = menCount + womenCount > 0 ? menCount + womenCount : fallback;

    men += menCount;
    women += womenCount;
    totalPeople += participants;

    extras.tshirts += order.extras?.tshirts ?? 0;
    extras.cocktails += order.extras?.cocktails ?? 0;
    extras.photos += order.extras?.photos ?? 0;

    const platformKey = order.platform ?? "unknown";
    const bucket =
      platformMap.get(platformKey) ??
      {
        platform: platformKey,
        totalPeople: 0,
        men: 0,
        women: 0,
        orderCount: 0,
      };

    bucket.totalPeople += participants;
    bucket.men += menCount;
    bucket.women += womenCount;
    bucket.orderCount += 1;
    platformMap.set(platformKey, bucket);
  });

  const platformBreakdown = Array.from(platformMap.values()).sort((a, b) =>
    a.platform.localeCompare(b.platform),
  );

  return {
    totalOrders: orders.length,
    totalPeople,
    men,
    women,
    extras,
    platformBreakdown,
  };
};

const formatExtrasSummary = (extras: OrderExtras): string => {
  const tokens: string[] = [];
  if (extras.tshirts > 0) tokens.push(`T-Shirts: ${extras.tshirts}`);
  if (extras.cocktails > 0) tokens.push(`Cocktails: ${extras.cocktails}`);
  if (extras.photos > 0) tokens.push(`Photos: ${extras.photos}`);
  return tokens.join(" • ");
};

const formatOrderExtras = (extras?: OrderExtras): string => {
  if (!extras) {
    return "—";
  }
  const parts: string[] = [];
  if (extras.tshirts > 0) parts.push(`${extras.tshirts} tee${extras.tshirts === 1 ? "" : "s"}`);
  if (extras.cocktails > 0) parts.push(`${extras.cocktails} cocktail${extras.cocktails === 1 ? "" : "s"}`);
  if (extras.photos > 0) parts.push(`${extras.photos} photo${extras.photos === 1 ? "" : "s"}`);
  return parts.length > 0 ? parts.join(", ") : "—";
};

const derivePickupMoment = (order: UnifiedOrder) => {
  if (order.pickupDateTime) {
    const parsed = dayjs(order.pickupDateTime);
    if (parsed.isValid()) {
      return parsed;
    }
  }
  const candidate = dayjs(`${order.date} ${order.timeslot}`, ["YYYY-MM-DD HH:mm", "YYYY-MM-DD H:mm"], true);
  return candidate.isValid() ? candidate : null;
};

const formatPickupLabel = (order: UnifiedOrder): string => {
  const moment = derivePickupMoment(order);
  if (moment) {
    return moment.format("ddd, MMM D • HH:mm");
  }
  return `${order.date} ${order.timeslot}`;
};
const formatPendingCounts = (order: UnifiedOrder) => {
  const men = Number.isFinite(order.menCount) ? order.menCount : 0;
  const women = Number.isFinite(order.womenCount) ? order.womenCount : 0;
  const fallback = Number.isFinite(order.quantity) ? order.quantity : 0;
  const total = men + women > 0 ? men + women : fallback;
  return { men, women, total };
};

const groupOrdersByBookingId = (orders: UnifiedOrder[]): PendingGroup[] => {
  const groups = new Map<
    string,
    {
      group: PendingGroup;
      pickupMoment: Dayjs | null;
      products: Set<string>;
    }
  >();

  orders.forEach((order) => {
    if (!order.platformBookingId) {
      return;
    }
    const pickupMoment = derivePickupMoment(order);
    const displayLabel = formatPickupLabel(order);
    const { men, women, total } = formatPendingCounts(order);
    const existing = groups.get(order.platformBookingId);

    if (!existing) {
      const products = new Set<string>();
      if (order.productName) {
        products.add(order.productName);
      }
      groups.set(order.platformBookingId, {
        products,
        pickupMoment,
        group: {
          platformBookingId: order.platformBookingId,
          date: order.date,
          timeslot: order.timeslot,
          pickupLabel: displayLabel,
          customerName: order.customerName || "Unknown",
          customerPhone: order.customerPhone,
          productNames: order.productName ? [order.productName] : [],
          totalPeople: total,
          menCount: men,
          womenCount: women,
        },
      });
      return;
    }

    if (order.productName) {
      existing.products.add(order.productName);
    }
    existing.group.totalPeople += total;
    existing.group.menCount += men;
    existing.group.womenCount += women;
    if (!existing.group.customerName && order.customerName) {
      existing.group.customerName = order.customerName;
    }
    if (!existing.group.customerPhone && order.customerPhone) {
      existing.group.customerPhone = order.customerPhone;
    }

    if (!existing.pickupMoment || (pickupMoment && pickupMoment.isBefore(existing.pickupMoment))) {
      existing.pickupMoment = pickupMoment;
      existing.group.date = order.date;
      existing.group.timeslot = order.timeslot;
      existing.group.pickupLabel = displayLabel;
    }
  });

  return Array.from(groups.values())
    .map(({ group, products, pickupMoment }) => ({
      ...group,
      productNames: Array.from(products.values()),
      pickupMoment,
    }))
    .sort((a, b) => {
      const momentA = dayjs(`${a.date} ${a.timeslot}`, ["YYYY-MM-DD HH:mm", "YYYY-MM-DD H:mm"], true);
      const momentB = dayjs(`${b.date} ${b.timeslot}`, ["YYYY-MM-DD HH:mm", "YYYY-MM-DD H:mm"], true);
      if (momentA.isValid() && momentB.isValid()) {
        if (momentA.isBefore(momentB)) return -1;
        if (momentA.isAfter(momentB)) return 1;
      }
      return a.platformBookingId.localeCompare(b.platformBookingId);
    })
    .map(({ pickupMoment, ...rest }) => rest);
};

const formatPendingProducts = (products: string[]): string => {
  const unique = Array.from(new Set(products.filter(Boolean)));
  if (unique.length === 0) {
    return "Unknown product";
  }
  return unique.sort((a, b) => a.localeCompare(b)).join(", ");
};

const normalizePendingText = (value?: string | null): string => (value ?? "").trim().toLowerCase();

const normalizePendingPhone = (value?: string | null): string =>
  (value ?? "").trim().replace(/[^\d+]/g, "");

const buildPendingDiffs = (ecwidGroups: PendingGroup[], dbGroups: PendingGroup[]): PendingDiff[] => {
  const dbMap = new Map(dbGroups.map((group) => [group.platformBookingId, group]));
  const diffs: PendingDiff[] = [];

  ecwidGroups.forEach((ecwid) => {
    const db = dbMap.get(ecwid.platformBookingId);
    if (!db) {
      return;
    }

    const differences: Array<{ field: string; ecwid: string; db: string }> = [];
    const ecwidPickup = `${ecwid.date} ${ecwid.timeslot}`;
    const dbPickup = `${db.date} ${db.timeslot}`;
    const hasDateMismatch = ecwidPickup !== dbPickup;
    if (hasDateMismatch) {
      differences.push({
        field: "Pickup",
        ecwid: ecwid.pickupLabel,
        db: db.pickupLabel,
      });
    }

    const ecwidProducts = formatPendingProducts(ecwid.productNames);
    const dbProducts = formatPendingProducts(db.productNames);
    if (normalizePendingText(ecwidProducts) !== normalizePendingText(dbProducts)) {
      differences.push({
        field: "Product",
        ecwid: ecwidProducts,
        db: dbProducts,
      });
    }

    if (ecwid.totalPeople !== db.totalPeople) {
      differences.push({
        field: "People",
        ecwid: String(ecwid.totalPeople),
        db: String(db.totalPeople),
      });
    }

    if (ecwid.menCount !== db.menCount) {
      differences.push({
        field: "Men",
        ecwid: String(ecwid.menCount),
        db: String(db.menCount),
      });
    }

    if (ecwid.womenCount !== db.womenCount) {
      differences.push({
        field: "Women",
        ecwid: String(ecwid.womenCount),
        db: String(db.womenCount),
      });
    }

    if (normalizePendingText(ecwid.customerName) !== normalizePendingText(db.customerName)) {
      differences.push({
        field: "Customer",
        ecwid: ecwid.customerName,
        db: db.customerName,
      });
    }

    if (normalizePendingPhone(ecwid.customerPhone) !== normalizePendingPhone(db.customerPhone)) {
      differences.push({
        field: "Phone",
        ecwid: ecwid.customerPhone ?? "-",
        db: db.customerPhone ?? "-",
      });
    }

    if (differences.length > 0) {
      diffs.push({
        platformBookingId: ecwid.platformBookingId,
        ecwid,
        db,
        differences,
        hasDateMismatch,
      });
    }
  });

  return diffs.sort((a, b) => a.platformBookingId.localeCompare(b.platformBookingId));
};

const createDateArray = (start: Dayjs, end: Dayjs): string[] => {
  const values: string[] = [];
  let cursor = start.startOf("day");

  while (cursor.isBefore(end, "day") || cursor.isSame(end, "day")) {
    values.push(cursor.format(DATE_FORMAT));
    cursor = cursor.add(1, "day");
  }

  return values;
};

const formatRangeLabel = (start: Dayjs, end: Dayjs, mode: ViewMode): string => {
  if (mode === "month") {
    return start.format("MMMM YYYY");
  }

  if (start.isSame(end, "day")) {
    return start.format("D MMM YYYY");
  }

  return `${start.format("D MMM")} - ${end.format("D MMM YYYY")}`;
};

const deriveErrorMessage = (error: unknown): string => {
  if (!error) {
    return "Unknown error while loading bookings.";
  }

  if (typeof error === "string") {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Unable to load bookings right now.";
};

const BOOKINGS_MODULE = "booking-management";

const BookingsPage = ({ title }: GenericPageProps) => {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const [viewMode, setViewMode] = useState<ViewMode>("month");
  const [activeTab, setActiveTab] = useState<"calendar" | "summary" | "pending">("calendar");
  const [rangeAnchor, setRangeAnchor] = useState<Dayjs>(() => dayjs().startOf("day"));
  const [selectedDate, setSelectedDate] = useState<Dayjs>(() => dayjs().startOf("day"));
  const [products, setProducts] = useState<UnifiedProduct[]>([]);
  const [orders, setOrders] = useState<UnifiedOrder[]>([]);
  const [pendingOrders, setPendingOrders] = useState<UnifiedOrder[]>([]);
  const [statusFilter, setStatusFilter] = useState<BookingFilter>("active");
  const [fetchStatus, setFetchStatus] = useState<FetchStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingStatus, setPendingStatus] = useState<FetchStatus>("idle");
  const [pendingError, setPendingError] = useState<string | null>(null);
  const [pendingCreateId, setPendingCreateId] = useState<string | null>(null);
  const [pendingCreateError, setPendingCreateError] = useState<string | null>(null);
  const [ingestStatus, setIngestStatus] = useState<FetchStatus>("idle");
  const [reloadToken, setReloadToken] = useState(0);

  const modulePermissions = useModuleAccess(BOOKINGS_MODULE);

  useEffect(() => {
    dispatch(navigateToPage(title));
  }, [dispatch, title]);

  const rangeStart = useMemo(() => {
    return viewMode === "week"
      ? rangeAnchor.startOf("day")
      : rangeAnchor.startOf("month");
  }, [rangeAnchor, viewMode]);

  const rangeEnd = useMemo(() => {
    return viewMode === "week"
      ? rangeStart.add(6, "day")
      : rangeStart.endOf("month");
  }, [rangeStart, viewMode]);

  const dateRange = useMemo(() => createDateArray(rangeStart, rangeEnd), [rangeStart, rangeEnd]);

  const rangeLabel = useMemo(() => formatRangeLabel(rangeStart, rangeEnd, viewMode), [rangeStart, rangeEnd, viewMode]);

  const selectedDateKey = selectedDate.format(DATE_FORMAT);

  const handleViewModeChange = (mode: ViewMode) => {
    setViewMode(mode);

    if (mode === "week") {
      const newAnchor = selectedDate.startOf("day");
      setRangeAnchor(newAnchor);
    } else {
      const newAnchor = selectedDate.startOf("month");
      setRangeAnchor(newAnchor);
    }
  };

  const handleShiftRange = (direction: number) => {
    if (viewMode === "week") {
      const newAnchor = rangeStart.add(direction * 7, "day");
      const newRangeEnd = newAnchor.add(6, "day");
      setRangeAnchor(newAnchor);

      if (selectedDate.isBefore(newAnchor, "day") || selectedDate.isAfter(newRangeEnd, "day")) {
        setSelectedDate(newAnchor);
      }
    } else {
      const newAnchor = rangeStart.add(direction, "month");
      setRangeAnchor(newAnchor);
      setSelectedDate((prev) => prev.add(direction, "month").startOf("day"));
    }
  };

  const handleGoToToday = () => {
    const today = dayjs().startOf("day");
    setSelectedDate(today);
    setRangeAnchor(viewMode === "week" ? today : today.startOf("month"));
  };

  const handleReload = async () => {
    if (ingestStatus === "loading") {
      return;
    }
    setIngestStatus("loading");
    setErrorMessage(null);
    try {
      await axiosInstance.post("/bookings/ingest-emails", {}, { withCredentials: true });
      setFetchStatus("loading");
      setReloadToken((token) => token + 1);
      setIngestStatus("success");
    } catch (error) {
      setIngestStatus("error");
      setErrorMessage(deriveErrorMessage(error));
    }
  };

  const handleCreateEcwidBooking = async (orderId: string) => {
    if (!orderId || pendingCreateId) {
      return;
    }
    setPendingCreateId(orderId);
    setPendingCreateError(null);
    try {
      await axiosInstance.post(
        "/bookings/import-ecwid",
        { orderId },
        { withCredentials: true },
      );
      setReloadToken((token) => token + 1);
    } catch (error) {
      setPendingCreateError(deriveErrorMessage(error));
    } finally {
      setPendingCreateId(null);
    }
  };

  const handleOpenManifest = useCallback(
    (target: { productId: string; productName: string; date: string; time: string }, orders: UnifiedOrder[]) => {
      const params = new URLSearchParams({
        date: target.date,
        productId: target.productId,
        time: target.time,
      });
      params.set("productName", target.productName);

      navigate(`/bookings/manifest?${params.toString()}`, { state: { orders } });
    },
    [navigate],
  );

  useEffect(() => {
    if (!modulePermissions.ready || !modulePermissions.canView) {
      return;
    }

    const controller = new AbortController();
    const startIso = rangeStart.startOf("day").format('YYYY-MM-DD');
    const endIso = rangeEnd.endOf("day").format('YYYY-MM-DD');

    const fetchOrders = async () => {
      setFetchStatus("loading");
      setErrorMessage(null);

      try {
        const response = await axiosInstance.get("/bookings", {
          params: {
            pickupFrom: startIso,
            pickupTo: endIso,
            limit: 200,
          },
          signal: controller.signal,
          withCredentials: true,
        });
        const productsPayload = Array.isArray(response.data?.products) ? response.data.products : [];
        const ordersPayload = Array.isArray(response.data?.orders) ? response.data.orders : [];

        setProducts(productsPayload as UnifiedProduct[]);
        setOrders(ordersPayload as UnifiedOrder[]);
        setFetchStatus("success");
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        setFetchStatus("error");
        setErrorMessage(deriveErrorMessage(error));
      }
    };

    fetchOrders();

    return () => {
      controller.abort();
    };
  }, [modulePermissions.ready, modulePermissions.canView, rangeStart, rangeEnd, reloadToken]);

  useEffect(() => {
    if (!modulePermissions.ready || !modulePermissions.canView) {
      return;
    }
    if (activeTab !== "pending") {
      return;
    }

    const controller = new AbortController();
    const startIso = rangeStart.startOf("day").format("YYYY-MM-DD");
    const endIso = rangeEnd.endOf("day").format("YYYY-MM-DD");

    const fetchPendingOrders = async () => {
      setPendingStatus("loading");
      setPendingError(null);

      try {
        const aggregated: UnifiedOrder[] = [];
        let offset = 0;
        const limit = 200;

        while (true) {
          const response = await axiosInstance.get("/ecwid/orders", {
            params: {
              pickupFrom: startIso,
              pickupTo: endIso,
              limit: String(limit),
              offset: String(offset),
            },
            signal: controller.signal,
            withCredentials: true,
          });
          const batch = Array.isArray(response.data?.orders) ? response.data.orders : [];
          const count = Number(response.data?.count ?? batch.length);
          const total = Number(response.data?.total ?? 0);

          aggregated.push(...(batch as UnifiedOrder[]));

          if (!count || count < limit) {
            break;
          }
          offset += count;
          if (total && offset >= total) {
            break;
          }
        }

        setPendingOrders(aggregated);
        setPendingStatus("success");
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        setPendingStatus("error");
        setPendingError(deriveErrorMessage(error));
      }
    };

    fetchPendingOrders();

    return () => {
      controller.abort();
    };
  }, [
    modulePermissions.ready,
    modulePermissions.canView,
    activeTab,
    rangeStart,
    rangeEnd,
    reloadToken,
  ]);

  const filteredOrders = useMemo(
    () => filterOrdersByStatus(orders, statusFilter),
    [orders, statusFilter],
  );

  const filteredProducts = useMemo(() => {
    if (statusFilter === "all") {
      return products;
    }
    const ids = new Set(filteredOrders.map((order) => order.productId));
    return products.filter((product) => ids.has(product.id));
  }, [products, filteredOrders, statusFilter]);

  const filteredDateRange = useMemo(() => {
    if (statusFilter === "all") {
      return dateRange;
    }
    const dates = new Set(filteredOrders.map((order) => order.date));
    return dateRange.filter((date) => dates.has(date));
  }, [dateRange, filteredOrders, statusFilter]);

  const grid: BookingGrid = useMemo(() => {
    return prepareBookingGrid(filteredProducts, filteredOrders, filteredDateRange);
  }, [filteredProducts, filteredOrders, filteredDateRange]);

  const summaryStats = useMemo(() => computeSummaryStats(filteredOrders), [filteredOrders]);

  const sortedOrders = useMemo(() => {
    const copy = [...filteredOrders];
    return copy.sort((a, b) => {
      const momentA = derivePickupMoment(a);
      const momentB = derivePickupMoment(b);
      if (momentA && momentB) {
        if (momentA.isBefore(momentB)) return -1;
        if (momentA.isAfter(momentB)) return 1;
      } else if (momentA && !momentB) {
        return -1;
      } else if (!momentA && momentB) {
        return 1;
      }
      if (a.productName !== b.productName) {
        return a.productName.localeCompare(b.productName);
      }
      return a.id.localeCompare(b.id);
    });
  }, [filteredOrders]);

  const dbEcwidOrders = useMemo(
    () => orders.filter((order) => (order.platform ?? "").toLowerCase() === "ecwid"),
    [orders],
  );

  const pendingGroupedEcwid = useMemo(
    () => groupOrdersByBookingId(pendingOrders),
    [pendingOrders],
  );

  const pendingGroupedDb = useMemo(
    () => groupOrdersByBookingId(dbEcwidOrders),
    [dbEcwidOrders],
  );

  const pendingMissingInDb = useMemo(() => {
    const dbIds = new Set(pendingGroupedDb.map((group) => group.platformBookingId));
    return pendingGroupedEcwid.filter((group) => !dbIds.has(group.platformBookingId));
  }, [pendingGroupedDb, pendingGroupedEcwid]);

  const pendingMissingInEcwid = useMemo(() => {
    const ecwidIds = new Set(pendingGroupedEcwid.map((group) => group.platformBookingId));
    return pendingGroupedDb.filter((group) => !ecwidIds.has(group.platformBookingId));
  }, [pendingGroupedDb, pendingGroupedEcwid]);

  const pendingMismatches = useMemo(
    () => buildPendingDiffs(pendingGroupedEcwid, pendingGroupedDb),
    [pendingGroupedEcwid, pendingGroupedDb],
  );

  const pendingDateMismatches = useMemo(
    () => pendingMismatches.filter((entry) => entry.hasDateMismatch),
    [pendingMismatches],
  );

  const pendingIsLoading = pendingStatus === "loading" && pendingOrders.length === 0;

  const renderPendingTable = (
    groups: PendingGroup[],
    options?: { showActions?: boolean; onAdd?: (id: string) => void },
  ) => (
    <Paper withBorder radius="lg" shadow="sm" p="md">
      <ScrollArea style={{ width: "100%" }}>
        <Table striped highlightOnHover withColumnBorders horizontalSpacing="md" verticalSpacing="sm">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Booking</Table.Th>
              <Table.Th>Pickup</Table.Th>
              <Table.Th>Customer</Table.Th>
              <Table.Th>Products</Table.Th>
              <Table.Th align="right">People</Table.Th>
              <Table.Th align="right">Men</Table.Th>
              <Table.Th align="right">Women</Table.Th>
              <Table.Th>Phone</Table.Th>
              {options?.showActions && <Table.Th>Actions</Table.Th>}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {groups.map((group) => (
              <Table.Tr key={group.platformBookingId}>
                <Table.Td>
                  <Text fw={600}>{group.platformBookingId}</Text>
                </Table.Td>
                <Table.Td>{group.pickupLabel}</Table.Td>
                <Table.Td>{group.customerName || "-"}</Table.Td>
                <Table.Td>{formatPendingProducts(group.productNames)}</Table.Td>
                <Table.Td align="right">{group.totalPeople}</Table.Td>
                <Table.Td align="right">{group.menCount}</Table.Td>
                <Table.Td align="right">{group.womenCount}</Table.Td>
                <Table.Td>{group.customerPhone ?? "-"}</Table.Td>
                {options?.showActions && (
                  <Table.Td>
                    <Button
                      size="xs"
                      variant="light"
                      leftSection={<IconPlus size={14} />}
                      loading={pendingCreateId === group.platformBookingId}
                      disabled={Boolean(pendingCreateId)}
                      onClick={() => options?.onAdd?.(group.platformBookingId)}
                    >
                      Add booking
                    </Button>
                  </Table.Td>
                )}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </ScrollArea>
    </Paper>
  );

  const renderMismatchTable = (rows: PendingDiff[]) => (
    <Paper withBorder radius="lg" shadow="sm" p="md">
      <ScrollArea style={{ width: "100%" }}>
        <Table striped highlightOnHover withColumnBorders horizontalSpacing="md" verticalSpacing="sm">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Booking</Table.Th>
              <Table.Th>OmniLodge</Table.Th>
              <Table.Th>Ecwid</Table.Th>
              <Table.Th>Differences</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((row) => (
              <Table.Tr key={row.platformBookingId}>
                <Table.Td>
                  <Text fw={600}>{row.platformBookingId}</Text>
                </Table.Td>
                <Table.Td>
                  <Stack gap={2}>
                    <Text size="sm">{row.db.pickupLabel}</Text>
                    <Text size="sm">{formatPendingProducts(row.db.productNames)}</Text>
                    <Text size="sm">{`People: ${row.db.totalPeople} (M ${row.db.menCount} / W ${row.db.womenCount})`}</Text>
                    <Text size="sm">{row.db.customerName || "-"}</Text>
                    <Text size="sm" c="dimmed">
                      {row.db.customerPhone ?? "-"}
                    </Text>
                  </Stack>
                </Table.Td>
                <Table.Td>
                  <Stack gap={2}>
                    <Text size="sm">{row.ecwid.pickupLabel}</Text>
                    <Text size="sm">{formatPendingProducts(row.ecwid.productNames)}</Text>
                    <Text size="sm">{`People: ${row.ecwid.totalPeople} (M ${row.ecwid.menCount} / W ${row.ecwid.womenCount})`}</Text>
                    <Text size="sm">{row.ecwid.customerName || "-"}</Text>
                    <Text size="sm" c="dimmed">
                      {row.ecwid.customerPhone ?? "-"}
                    </Text>
                  </Stack>
                </Table.Td>
                <Table.Td>
                  <Stack gap={4}>
                    {row.differences.map((diff) => (
                      <Text key={`${row.platformBookingId}-${diff.field}`} size="sm">
                        {`${diff.field}: ${diff.db} → ${diff.ecwid}`}
                      </Text>
                    ))}
                  </Stack>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </ScrollArea>
    </Paper>
  );

  const isLoading = fetchStatus === "loading" && orders.length === 0;

  return (
    <PageAccessGuard pageSlug={PAGE_SLUGS.bookings}>
      <Stack gap="lg">
        <Title order={2}>Bookings</Title>

        {!modulePermissions.ready || modulePermissions.loading ? (
          <Box style={{ minHeight: 240 }}>
            <Loader variant="dots" />
          </Box>
        ) : !modulePermissions.canView ? (
          <Alert color="yellow" title="No access">
            You do not have permission to view booking information.
          </Alert>
        ) : (
          <Stack gap="md">
            <Flex justify="space-between" align="center" wrap="wrap" gap="sm">
              <Group gap="sm" wrap="wrap">
                <SegmentedControl
                  value={viewMode}
                  onChange={(value) => handleViewModeChange(value as ViewMode)}
                  data={[
                    { label: "Week", value: "week" },
                    { label: "Month", value: "month" },
                  ]}
                  size="sm"
                />
                <SegmentedControl
                  value={statusFilter}
                  onChange={(value) => setStatusFilter(value as BookingFilter)}
                  data={[
                    { label: "All", value: "all" },
                    { label: "Has people", value: "active" },
                    { label: "Cancelled", value: "cancelled" },
                  ]}
                  size="sm"
                />
                <Button
                  size="sm"
                  variant="light"
                  leftSection={<IconCalendar size={16} />}
                  onClick={handleGoToToday}
                >
                  Today
                </Button>
              </Group>

              <Group gap="xs" wrap="wrap" align="center">
                <Tooltip label="Previous" withArrow>
                  <Button
                    variant="subtle"
                    size="sm"
                    onClick={() => handleShiftRange(-1)}
                    leftSection={<IconArrowLeft size={16} />}
                  >
                    Prev
                  </Button>
                </Tooltip>
                <Text fw={600}>{rangeLabel}</Text>
                <Tooltip label="Next" withArrow>
                  <Button
                    variant="subtle"
                    size="sm"
                    onClick={() => handleShiftRange(1)}
                    rightSection={<IconArrowRight size={16} />}
                  >
                    Next
                  </Button>
                </Tooltip>
                <Tooltip label="Refresh" withArrow>
                  <Button
                    variant="subtle"
                    size="sm"
                    onClick={handleReload}
                    leftSection={<IconRefresh size={16} />}
                    loading={ingestStatus === "loading" || fetchStatus === "loading"}
                  >
                    Refresh
                  </Button>
                </Tooltip>
              </Group>
            </Flex>

            {errorMessage && (
              <Alert color="red" title="Failed to sync bookings">
                {errorMessage}
              </Alert>
            )}

            <Tabs
              value={activeTab}
              onChange={(value) => setActiveTab((value as "calendar" | "summary" | "pending") ?? "calendar")}
              keepMounted={false}
            >
              <Tabs.List>
                <Tabs.Tab value="calendar">Calendar</Tabs.Tab>
                <Tabs.Tab value="summary">Summary</Tabs.Tab>
                <Tabs.Tab value="pending">Pending Bookings</Tabs.Tab>
              </Tabs.List>

              <Tabs.Panel value="calendar" pt="md">
                {isLoading ? (
                  <Box style={{ minHeight: 320 }}>
                    <Loader variant="bars" />
                  </Box>
                ) : filteredOrders.length === 0 ? (
                  <Alert color="blue" title="No bookings">
                    No bookings match the current filters.
                  </Alert>
                ) : (
                  <BookingsGrid
                    products={filteredProducts}
                    dateRange={filteredDateRange}
                    grid={grid}
                    selectedDate={selectedDateKey}
                    onSelectDate={(nextDate) => setSelectedDate(dayjs(nextDate))}
                    onOpenManifest={handleOpenManifest}
                    viewMode={viewMode}
                  />
                )}
              </Tabs.Panel>

              <Tabs.Panel value="summary" pt="md">
                {fetchStatus === "loading" && orders.length === 0 ? (
                  <Box style={{ minHeight: 320 }}>
                    <Loader variant="bars" />
                  </Box>
                ) : (
                  <Stack gap="md">
                    <Title order={3}>Bookings summary</Title>
                    {filteredOrders.length === 0 ? (
                      <Alert color="blue" title="No bookings">
                        No bookings found for the selected range.
                      </Alert>
                    ) : (
                      <>
                        <Group gap="sm" wrap="wrap">
                          <Badge size="lg" color="blue" variant="light">
                            {`Bookings: ${summaryStats.totalOrders}`}
                          </Badge>
                          <Badge size="lg" color="green" variant="light">
                            {`Total people: ${summaryStats.totalPeople}`}
                          </Badge>
                          <Badge size="lg" color="teal" variant="light">
                            {`Men: ${summaryStats.men}`}
                          </Badge>
                          <Badge size="lg" color="pink" variant="light">
                            {`Women: ${summaryStats.women}`}
                          </Badge>
                          {summaryStats.extras.tshirts > 0 ||
                          summaryStats.extras.cocktails > 0 ||
                          summaryStats.extras.photos > 0 ? (
                            <Badge size="lg" color="violet" variant="light">
                              {formatExtrasSummary(summaryStats.extras)}
                            </Badge>
                          ) : null}
                        </Group>

                        {summaryStats.platformBreakdown.length > 0 && (
                          <Group gap="xs" wrap="wrap">
                            {summaryStats.platformBreakdown.map((entry) => (
                              <Badge
                                key={`platform-${entry.platform}`}
                                color={resolvePlatformColor(entry.platform)}
                                variant="outline"
                              >
                                {`${formatPlatformLabel(entry.platform)}: ${entry.totalPeople} (${entry.orderCount} ${
                                  entry.orderCount === 1 ? "booking" : "bookings"
                                })`}
                              </Badge>
                            ))}
                          </Group>
                        )}

                        <Paper withBorder radius="lg" shadow="sm" p="md">
                          <ScrollArea style={{ width: "100%" }}>
                            <Table striped highlightOnHover withColumnBorders horizontalSpacing="md" verticalSpacing="sm">
                              <Table.Thead>
                                <Table.Tr>
                                  <Table.Th>Booking</Table.Th>
                                  <Table.Th>Product</Table.Th>
                                  <Table.Th>Platform</Table.Th>
                                  <Table.Th>Pickup</Table.Th>
                                  <Table.Th align="right">People</Table.Th>
                                  <Table.Th align="right">Men</Table.Th>
                                  <Table.Th align="right">Women</Table.Th>
                                  <Table.Th>Contact</Table.Th>
                                  <Table.Th>Phone</Table.Th>
                                  <Table.Th>Extras</Table.Th>
                                </Table.Tr>
                              </Table.Thead>
                              <Table.Tbody>
                                {sortedOrders.map((order) => (
                                  <Table.Tr key={`${order.id}-${order.productId}`}>
                                    <Table.Td>
                                      <Stack gap={2} style={{ minWidth: 140 }}>
                                        <Text fw={600}>{order.id}</Text>
                                        <Text size="xs" c="dimmed">
                                          {formatPlatformLabel(order.platform)}
                                        </Text>
                                      </Stack>
                                    </Table.Td>
                                    <Table.Td>
                                      <Stack gap={2}>
                                        <Text fw={600}>{order.productName}</Text>
                                        <Text size="xs" c="dimmed">
                                          {order.productId}
                                        </Text>
                                      </Stack>
                                    </Table.Td>
                                    <Table.Td>
                                      <PlatformBadge platform={order.platform} />
                                    </Table.Td>
                                    <Table.Td>{formatPickupLabel(order)}</Table.Td>
                                    <Table.Td align="right">{order.quantity}</Table.Td>
                                    <Table.Td align="right">{order.menCount}</Table.Td>
                                    <Table.Td align="right">{order.womenCount}</Table.Td>
                                    <Table.Td>
                                      <Stack gap={2}>
                                        <Text fw={600}>{order.customerName || "—"}</Text>
                                      </Stack>
                                    </Table.Td>
                                    <Table.Td>{order.customerPhone ?? "—"}</Table.Td>
                                    <Table.Td>{formatOrderExtras(order.extras)}</Table.Td>
                                  </Table.Tr>
                                ))}
                              </Table.Tbody>
                            </Table>
                          </ScrollArea>
                        </Paper>
                      </>
                    )}
                  </Stack>
                )}
              </Tabs.Panel>

              <Tabs.Panel value="pending" pt="md">
                {pendingIsLoading ? (
                  <Box style={{ minHeight: 320 }}>
                    <Loader variant="bars" />
                  </Box>
                ) : (
                  <Stack gap="md">
                    {pendingError && (
                      <Alert color="red" title="Failed to load Ecwid orders">
                        {pendingError}
                      </Alert>
                    )}
                    {pendingCreateError && (
                      <Alert color="red" title="Failed to add booking">
                        {pendingCreateError}
                      </Alert>
                    )}
                    <Group gap="sm" wrap="wrap">
                      <Badge size="lg" color="orange" variant="light">
                        {`Missing in OmniLodge: ${pendingMissingInDb.length}`}
                      </Badge>
                      <Badge size="lg" color="grape" variant="light">
                        {`Mismatched: ${pendingMismatches.length}`}
                      </Badge>
                      <Badge size="lg" color="yellow" variant="light">
                        {`Date mismatches: ${pendingDateMismatches.length}`}
                      </Badge>
                      <Badge size="lg" color="gray" variant="light">
                        {`Missing in Ecwid: ${pendingMissingInEcwid.length}`}
                      </Badge>
                    </Group>
                    {pendingMissingInDb.length === 0 &&
                    pendingMissingInEcwid.length === 0 &&
                    pendingMismatches.length === 0 ? (
                      <Alert color="blue" title="No discrepancies">
                        Ecwid orders match the bookings stored in OmniLodge for this range.
                      </Alert>
                    ) : (
                      <>
                        <Accordion variant="separated" chevronPosition="right">
                          {pendingMismatches.length > 0 && (
                            <Accordion.Item value="mismatches">
                              <Accordion.Control>
                                {`Mismatched bookings (${pendingMismatches.length})`}
                              </Accordion.Control>
                              <Accordion.Panel>{renderMismatchTable(pendingMismatches)}</Accordion.Panel>
                            </Accordion.Item>
                          )}
                          {pendingMissingInDb.length > 0 && (
                            <Accordion.Item value="missing-omnilodge">
                              <Accordion.Control>
                                {`Missing in OmniLodge (${pendingMissingInDb.length})`}
                              </Accordion.Control>
                              <Accordion.Panel>
                                {renderPendingTable(pendingMissingInDb, {
                                  showActions: true,
                                  onAdd: handleCreateEcwidBooking,
                                })}
                              </Accordion.Panel>
                            </Accordion.Item>
                          )}
                          {pendingMissingInEcwid.length > 0 && (
                            <Accordion.Item value="missing-ecwid">
                              <Accordion.Control>
                                {`Missing in Ecwid (${pendingMissingInEcwid.length})`}
                              </Accordion.Control>
                              <Accordion.Panel>{renderPendingTable(pendingMissingInEcwid)}</Accordion.Panel>
                            </Accordion.Item>
                          )}
                        </Accordion>
                      </>
                    )}
                  </Stack>
                )}
              </Tabs.Panel>
            </Tabs>
          </Stack>
        )}
      </Stack>
    </PageAccessGuard>
  );
};

export default BookingsPage;



