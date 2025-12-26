import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";

import {
  Alert,
  Anchor,
  Badge,
  Box,
  Button,
  Divider,
  Flex,
  Group,
  Loader,
  Modal,
  Paper,
  Select,
  SegmentedControl,
  Stack,
  Table,
  Text,
  Title,
  TextInput,
} from "@mantine/core";

import { DatePickerInput, TimeInput } from "@mantine/dates";
import { useMediaQuery } from '@mantine/hooks';

import { IconArrowLeft, IconArrowRight, IconCalendar, IconRefresh, IconSearch } from "@tabler/icons-react";

import dayjs, { Dayjs } from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";

dayjs.extend(customParseFormat);

import { useSearchParams } from "react-router-dom";

import { useAppDispatch } from "../store/hooks";

import { navigateToPage } from "../actions/navigationActions";

import { GenericPageProps } from "../types/general/GenericPageProps";

import { PageAccessGuard } from "../components/access/PageAccessGuard";

import { PAGE_SLUGS } from "../constants/pageSlugs";

import { useModuleAccess } from "../hooks/useModuleAccess";

import axiosInstance from "../utils/axiosInstance";

import {
  UnifiedOrder,
  OrderExtras,
  ManifestGroup,
  ManifestSummary,
  PlatformBreakdownEntry,
  BookingStatus,
} from "../store/bookingPlatformsTypes";



const DATE_FORMAT = "YYYY-MM-DD";

const MANIFEST_MODULE = "booking-manifest";

const toWhatsAppLink = (raw?: string) => {
  if (!raw) return null;

  // Keep digits and '+' only
  let s = raw.trim().replace(/[^\d+]/g, '');

  // Convert '00' prefix to '+'
  if (s.startsWith('00')) s = '+' + s.slice(2);

  // Handle UK numbers that start with 07 -> +44 (drop the 0)
  if (s.startsWith('07')) {
    s = '+44' + s.slice(1);
  } else if (s.startsWith('44')) {
    // If someone typed '44...' without '+'
    s = '+44' + s.slice(2);
  } else if (!s.startsWith('+')) {
    // If no '+' is present at all, add it (user requirement)
    s = '+' + s;
  }

  // wa.me requires digits only (no '+', no symbols)
  const href = `https://wa.me/${s.replace(/^\+/, '')}`;
  return { display: s, href };
};

type ManifestResponse = {
  date: string;
  manifest: ManifestGroup[];
  orders: UnifiedOrder[];
  summary?: ManifestSummary;
};



type FetchStatus = "idle" | "loading" | "success" | "error";

type BookingFilter = "all" | "active" | "cancelled";



type SelectOption = {

  value: string;

  label: string;

};



const deriveDate = (value: string | null): Dayjs => {

  if (!value) {

    return dayjs().startOf("day");

  }



  const parsed = dayjs(value);

  return parsed.isValid() ? parsed.startOf("day") : dayjs().startOf("day");

};



const deriveGroupKey = (productId: string | null, time: string | null): string => {

  if (productId && time) {

    return `${productId}|${time}`;

  }

  return "all";

};



const manifestToOptions = (groups: ManifestGroup[]): SelectOption[] => {
  const seen = new Set<string>();
  const options: SelectOption[] = [];
  groups.forEach((group) => {
    const value = `${group.productId}|${group.time}`;
    if (seen.has(value)) {
      return;
    }
    seen.add(value);
    options.push({
      value,
      label: `${group.productName} @ ${group.time}`,
    });
  });
  return options;
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

const BOOKING_STATUSES: BookingStatus[] = [
  "pending",
  "confirmed",
  "amended",
  "rebooked",
  "cancelled",
  "completed",
  "no_show",
  "unknown",
];

const STATUS_COLORS: Record<BookingStatus, string> = {
  pending: "gray",
  confirmed: "green",
  amended: "yellow",
  rebooked: "orange",
  cancelled: "red",
  completed: "teal",
  no_show: "grape",
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

const PLATFORM_BOOKING_LINKS: Record<string, (bookingId: string) => string> = {
  ecwid: (id: string) => `https://my.ecwid.com/store/100323031#order:id=${encodeURIComponent(id)}`,
  viator: (id: string) =>
    `https://supplier.viator.com/bookings/search?bookingRef=${encodeURIComponent(id)}&sortBy=NEW_BOOKINGS&pageNumber=1&pageSize=10`,
  getyourguide: (id: string) => `https://supplier.getyourguide.com/bookings/${encodeURIComponent(id)}?from=/bookings`,
  airbnb: (id: string) => `https://www.airbnb.com/hosting/reservations/details/${encodeURIComponent(id)}`,
};

const getPlatformBookingLink = (platform?: string | null, bookingId?: string | null): string | null => {
  if (!platform || !bookingId) {
    return null;
  }
  const key = platform.toLowerCase();
  const builder = PLATFORM_BOOKING_LINKS[key];
  if (!builder) {
    return null;
  }
  try {
    return builder(bookingId);
  } catch {
    return null;
  }
};

const formatStatusLabel = (value?: BookingStatus | null): string => {
  const status = value ?? "unknown";
  if (status === "no_show") {
    return "No show";
  }
  if (status === "rebooked") {
    return "Rebooked";
  }
  return status.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
};

const createEmptyStatusCounts = (): Record<BookingStatus, number> => {
  return BOOKING_STATUSES.reduce((acc, status) => {
    acc[status] = 0;
    return acc;
  }, {} as Record<BookingStatus, number>);
};

const resolveStatusColor = (value?: BookingStatus | null): string => {
  const key = value ?? "unknown";
  return STATUS_COLORS[key] ?? STATUS_COLORS.unknown;
};

const StatusBadge = ({ status }: { status?: BookingStatus | null }) => {
  const safeStatus = status ?? "unknown";
  return (
    <Badge color={resolveStatusColor(safeStatus)} variant="light">
      {formatStatusLabel(safeStatus)}
    </Badge>
  );
};

const buildPlatformBreakdown = (groups: ManifestGroup[]): PlatformBreakdownEntry[] => {
  const map = new Map<string, PlatformBreakdownEntry>();
  groups.forEach((group) => {
    (group.platformBreakdown ?? []).forEach((entry) => {
      const key = entry.platform || "unknown";
      const existing = map.get(key);
      if (existing) {
        existing.totalPeople += entry.totalPeople;
        existing.men += entry.men;
        existing.women += entry.women;
        existing.orderCount += entry.orderCount;
        return;
      }
      map.set(key, { ...entry, platform: key });
    });
  });
  return Array.from(map.values()).sort((a, b) => a.platform.localeCompare(b.platform));
};

const createSummaryFromGroups = (groups: ManifestGroup[]): ManifestSummary => ({
  totalPeople: groups.reduce((acc, group) => acc + group.totalPeople, 0),
  men: groups.reduce((acc, group) => acc + group.men, 0),
  women: groups.reduce((acc, group) => acc + group.women, 0),
  totalOrders: groups.reduce((acc, group) => acc + group.orders.length, 0),
  extras: {
    tshirts: groups.reduce((acc, group) => acc + (group.extras?.tshirts ?? 0), 0),
    cocktails: groups.reduce((acc, group) => acc + (group.extras?.cocktails ?? 0), 0),
    photos: groups.reduce((acc, group) => acc + (group.extras?.photos ?? 0), 0),
  },
  platformBreakdown: buildPlatformBreakdown(groups),
  statusCounts: groups.reduce((acc, group) => {
    group.orders.forEach((order) => {
      const status = order.status ?? "unknown";
      acc[status] = (acc[status] ?? 0) + 1;
    });
    return acc;
  }, createEmptyStatusCounts()),
});

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

const getOrderCounts = (order: UnifiedOrder) => {
  const men = Number.isFinite(order.menCount) ? order.menCount : 0;
  const women = Number.isFinite(order.womenCount) ? order.womenCount : 0;
  const fallback = Number.isFinite(order.quantity) ? order.quantity : 0;
  const total = men + women > 0 ? men + women : fallback;
  return { men, women, total };
};

const buildPlatformBreakdownFromOrders = (orders: UnifiedOrder[]): PlatformBreakdownEntry[] => {
  const map = new Map<string, PlatformBreakdownEntry>();
  orders.forEach((order) => {
    const { men, women, total } = getOrderCounts(order);
    const key = order.platform ?? "unknown";
    const existing = map.get(key);
    if (existing) {
      existing.totalPeople += total;
      existing.men += men;
      existing.women += women;
      existing.orderCount += 1;
      return;
    }
    map.set(key, {
      platform: key,
      totalPeople: total,
      men,
      women,
      orderCount: 1,
    });
  });
  return Array.from(map.values()).sort((a, b) => a.platform.localeCompare(b.platform));
};

const buildGroupTotalsFromOrders = (orders: UnifiedOrder[]) => {
  const extras: OrderExtras = { tshirts: 0, cocktails: 0, photos: 0 };
  let men = 0;
  let women = 0;
  let totalPeople = 0;

  orders.forEach((order) => {
    const counts = getOrderCounts(order);
    men += counts.men;
    women += counts.women;
    totalPeople += counts.total;
    extras.tshirts += order.extras?.tshirts ?? 0;
    extras.cocktails += order.extras?.cocktails ?? 0;
    extras.photos += order.extras?.photos ?? 0;
  });

  return {
    totalPeople,
    men,
    women,
    extras,
    platformBreakdown: buildPlatformBreakdownFromOrders(orders),
  };
};

const applyBookingFilterToManifest = (groups: ManifestGroup[], filter: BookingFilter): ManifestGroup[] => {
  if (filter === "all") {
    return groups;
  }
  return groups
    .map((group) => {
      const filteredOrders = filterOrdersByStatus(group.orders, filter);
      if (filteredOrders.length === 0) {
        return null;
      }
      const totals = buildGroupTotalsFromOrders(filteredOrders);
      return {
        ...group,
        ...totals,
        orders: filteredOrders,
      };
    })
    .filter((group): group is ManifestGroup => Boolean(group));
};

const OrderPlatformBadge = ({ platform }: { platform?: string }) => {
  if (!platform) {
    return null;
  }
  return (
    <Badge size="sm" variant="light" color={resolvePlatformColor(platform)}>
      {formatPlatformLabel(platform)}
    </Badge>
  );
};

const PlatformBadges = ({
  entries,
  prefix,
  withMargin = true,
}: {
  entries?: PlatformBreakdownEntry[];
  prefix: string;
  withMargin?: boolean;
}) => {
  if (!entries || entries.length === 0) {
    return null;
  }
  return (
    <Group gap="xs" wrap="wrap" mt={withMargin ? 4 : 0}>
      {entries.map((entry) => (
        <Badge
          key={`${prefix}-${entry.platform}`}
          variant="light"
          color={resolvePlatformColor(entry.platform)}
        >
          {`${formatPlatformLabel(entry.platform)}: ${entry.totalPeople} (${entry.orderCount} ${
            entry.orderCount === 1 ? "order" : "orders"
          })`}
        </Badge>
      ))}
    </Group>
  );
};

const formatAddonValue = (value?: number): string => {
  return value && value > 0 ? String(value) : '';
};

const normalizeExtrasSnapshot = (extras?: OrderExtras): OrderExtras => ({
  tshirts: extras?.tshirts ?? 0,
  cocktails: extras?.cocktails ?? 0,
  photos: extras?.photos ?? 0,
});

const mergePlatformBreakdownEntries = (
  base: PlatformBreakdownEntry[] = [],
  incoming?: PlatformBreakdownEntry[],
): PlatformBreakdownEntry[] => {
  const map = new Map<string, PlatformBreakdownEntry>();
  const consume = (entries?: PlatformBreakdownEntry[]) => {
    entries?.forEach((entry) => {
      if (!entry) {
        return;
      }
      const key = entry.platform || "unknown";
      const existing = map.get(key);
      if (existing) {
        existing.totalPeople += entry.totalPeople;
        existing.men += entry.men;
        existing.women += entry.women;
        existing.orderCount += entry.orderCount;
        return;
      }
      map.set(key, {
        platform: key,
        totalPeople: entry.totalPeople,
        men: entry.men,
        women: entry.women,
        orderCount: entry.orderCount,
      });
    });
  };
  consume(base);
  consume(incoming);
  return Array.from(map.values()).sort((a, b) => a.platform.localeCompare(b.platform));
};

const mergeManifestGroups = (groups: ManifestGroup[]): ManifestGroup[] => {
  const map = new Map<string, ManifestGroup>();
  const order: string[] = [];

  groups.forEach((group) => {
    const key = `${group.productId}|${group.date}|${group.time}`;
    const normalizedExtras = normalizeExtrasSnapshot(group.extras);
    const normalizedBreakdown = group.platformBreakdown ?? [];

    if (!map.has(key)) {
      map.set(key, {
        ...group,
        extras: { ...normalizedExtras },
        orders: [...group.orders],
        platformBreakdown: [...normalizedBreakdown],
      });
      order.push(key);
      return;
    }

    const existing = map.get(key)!;
    existing.totalPeople += group.totalPeople;
    existing.men += group.men;
    existing.women += group.women;
    existing.extras.tshirts += normalizedExtras.tshirts;
    existing.extras.cocktails += normalizedExtras.cocktails;
    existing.extras.photos += normalizedExtras.photos;
    existing.orders = existing.orders.concat(group.orders);
    existing.platformBreakdown = mergePlatformBreakdownEntries(existing.platformBreakdown, normalizedBreakdown);
  });

  return order.map((key) => {
    const merged = map.get(key)!;
    merged.platformBreakdown = mergePlatformBreakdownEntries(merged.platformBreakdown);
    return merged;
  });
};

const isEcwidOrder = (order: UnifiedOrder): boolean => {
  return (order.platform ?? '').toLowerCase() === 'ecwid';
};

const getBookingIdFromOrder = (order: UnifiedOrder): number | null => {
  if (!order || !order.rawData) {
    return null;
  }
  const candidate = (order.rawData as { bookingId?: unknown }).bookingId;
  if (typeof candidate === 'number' && Number.isFinite(candidate)) {
    return candidate;
  }
  if (typeof candidate === 'string' && candidate.trim().length > 0) {
    const parsed = Number.parseInt(candidate.trim(), 10);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
};

const normalizeTimeInput = (value: string): string | null => {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const formats = ['HH:mm', 'H:mm'];
  for (const format of formats) {
    const parsed = dayjs(trimmed, format, true);
    if (parsed.isValid()) {
      return parsed.format('HH:mm');
    }
  }
  const fallback = dayjs(`1970-01-01 ${trimmed}`);
  return fallback.isValid() ? fallback.format('HH:mm') : null;
};

const extractErrorMessage = (error: unknown): string => {
  if (!error) {
    return 'Something went wrong';
  }
  if (typeof error === 'string') {
    return error;
  }
  if (typeof error === 'object') {
    const withMessage = error as { message?: string };
    if ('response' in error && error.response) {
      const responseData = (error as { response: { data?: unknown } }).response.data;
      if (typeof responseData === 'string') {
        return responseData;
      }
      if (responseData && typeof responseData === 'object' && 'message' in responseData) {
        const nested = responseData as { message?: string };
        if (nested.message) {
          return nested.message;
        }
      }
    }
    if (withMessage.message) {
      return withMessage.message;
    }
  }
  return 'Something went wrong';
};

type AmendModalState = {
  opened: boolean;
  order: UnifiedOrder | null;
  bookingId: number | null;
  formDate: Date | null;
  formTime: string;
  submitting: boolean;
  error: string | null;
};

const createDefaultAmendState = (): AmendModalState => ({
  opened: false,
  order: null,
  bookingId: null,
  formDate: null,
  formTime: '',
  submitting: false,
  error: null,
});

const BookingsManifestPage = ({ title }: GenericPageProps) => {

  const dispatch = useAppDispatch();

  const [searchParams, setSearchParams] = useSearchParams();

  const modulePermissions = useModuleAccess(MANIFEST_MODULE);

  const isMobile = useMediaQuery("(max-width: 900px)");

  const dateParam = searchParams.get("date");

  const productIdParam = searchParams.get("productId");

  const timeParam = searchParams.get("time");

  const searchParamValue = searchParams.get("search");
  const searchParam = searchParamValue ? searchParamValue.trim() : "";
  const hasSearchParam = searchParam.length > 0;



  const effectiveDate = useMemo(() => deriveDate(dateParam), [dateParam]);

  const effectiveGroupKey = useMemo(
    () => (hasSearchParam ? "all" : deriveGroupKey(productIdParam, timeParam)),
    [hasSearchParam, productIdParam, timeParam],
  );



  const [selectedDate, setSelectedDate] = useState<Dayjs>(effectiveDate);

  const [selectedGroupKey, setSelectedGroupKey] = useState<string>(effectiveGroupKey);

  const [manifest, setManifest] = useState<ManifestGroup[]>([]);

  const [summary, setSummary] = useState<ManifestSummary>({
    totalPeople: 0,
    men: 0,
    women: 0,
    totalOrders: 0,
    extras: { tshirts: 0, cocktails: 0, photos: 0 },
    platformBreakdown: [],
    statusCounts: createEmptyStatusCounts(),
  });

  const [fetchStatus, setFetchStatus] = useState<FetchStatus>("idle");

  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [ingestStatus, setIngestStatus] = useState<FetchStatus>("idle");

  const [reloadToken, setReloadToken] = useState(0);
  const [statusFilter, setStatusFilter] = useState<BookingFilter>("active");
  const [searchInput, setSearchInput] = useState(searchParam);
  const [amendState, setAmendState] = useState<AmendModalState>(createDefaultAmendState());

  useEffect(() => {
    setSearchInput(searchParam);
  }, [searchParam]);



  useEffect(() => {

    if (!selectedDate.isSame(effectiveDate, "day")) {

      setSelectedDate(effectiveDate);

    }

  }, [effectiveDate, selectedDate]);



  useEffect(() => {

    if (selectedGroupKey !== effectiveGroupKey) {

      setSelectedGroupKey(effectiveGroupKey);

    }

  }, [effectiveGroupKey, selectedGroupKey]);



  useEffect(() => {

    dispatch(navigateToPage(title));

  }, [dispatch, title]);



  const updateSearchParamDate = (next: Dayjs) => {

    const formatted = next.format(DATE_FORMAT);

    if (formatted === dateParam) {

      return;

    }

    const params = new URLSearchParams(searchParams);

    params.set("date", formatted);

    setSearchParams(params);

  };



  const updateSearchParamGroup = (groupKey: string, groupLabel?: string) => {
    const params = new URLSearchParams(searchParams);
    if (groupKey === "all") {
      params.delete("productId");
      params.delete("time");
      params.delete("productName");
    } else {
      const [productId, time] = groupKey.split("|");
      params.set("productId", productId);
      params.set("time", time);
      if (groupLabel) {
        params.set("productName", groupLabel);
      }
    }
    setSearchParams(params);
  };

  const applySearchParamValue = (value: string) => {
    const params = new URLSearchParams(searchParams);
    if (value) {
      params.set("search", value);
    } else {
      params.delete("search");
    }
    setSearchParams(params);
  };

  const handleSearchSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    applySearchParamValue(searchInput.trim());
  };

  const handleSearchChange = (event: ChangeEvent<HTMLInputElement>) => {
    setSearchInput(event.currentTarget.value);
  };

  const handleSearchClear = () => {
    setSearchInput("");
    applySearchParamValue("");
  };

  const openAmendModal = (order: UnifiedOrder) => {
    const baseState = createDefaultAmendState();
    baseState.opened = true;
    baseState.order = order;
    baseState.bookingId = getBookingIdFromOrder(order);
    baseState.formDate = order.date && dayjs(order.date, DATE_FORMAT, true).isValid()
      ? dayjs(order.date, DATE_FORMAT).toDate()
      : null;
    baseState.formTime = order.timeslot && /^\d{1,2}:\d{2}$/.test(order.timeslot) ? order.timeslot : '';
    if (!baseState.bookingId) {
      baseState.error = "Unable to locate OmniLodge booking reference for this order.";
    }
    setAmendState(baseState);
  };

  const closeAmendModal = () => {
    setAmendState(createDefaultAmendState());
  };

  const handleAmendDateChange = (value: Date | null) => {
    setAmendState((prev) => ({ ...prev, formDate: value }));
  };

  const handleAmendTimeChange = (value: string | Date | null) => {
    const nextValue = value instanceof Date ? dayjs(value).format("HH:mm") : value ?? "";
    setAmendState((prev) => ({ ...prev, formTime: nextValue }));
  };

  const handleAmendSubmit = async () => {
    if (!amendState.bookingId) {
      setAmendState((prev) => ({ ...prev, error: "Missing OmniLodge booking reference." }));
      return;
    }
    if (!amendState.formDate || !amendState.formTime) {
      setAmendState((prev) => ({ ...prev, error: "Pickup date and time are required." }));
      return;
    }
    const normalizedTime = normalizeTimeInput(amendState.formTime);
    if (!normalizedTime) {
      setAmendState((prev) => ({ ...prev, error: "Please provide a valid pickup time (HH:mm)." }));
      return;
    }
    setAmendState((prev) => ({ ...prev, submitting: true, error: null }));
    try {
      await axiosInstance.post(`/bookings/${amendState.bookingId}/amend-ecwid`, {
        pickupDate: dayjs(amendState.formDate).format(DATE_FORMAT),
        pickupTime: normalizedTime,
      });
      setAmendState(createDefaultAmendState());
      setReloadToken((token) => token + 1);
    } catch (error) {
      const message = extractErrorMessage(error);
      setAmendState((prev) => ({ ...prev, submitting: false, error: message }));
    }
  };

  const handleCancelOrder = async (order: UnifiedOrder) => {
    const bookingId = getBookingIdFromOrder(order);
    if (!bookingId) {
      window.alert("Unable to locate OmniLodge booking reference for this order.");
      return;
    }
    if (!window.confirm("Cancel this Ecwid booking? This will only update OmniLodge for now.")) {
      return;
    }
    try {
      await axiosInstance.post(`/bookings/${bookingId}/cancel-ecwid`);
      setReloadToken((token) => token + 1);
    } catch (error) {
      const message = extractErrorMessage(error);
      window.alert(message);
    }
  };



  useEffect(() => {

    if (!modulePermissions.ready || !modulePermissions.canView) {

      return;

    }



    const controller = new AbortController();



    const fetchManifest = async () => {

      setFetchStatus("loading");

      setErrorMessage(null);



      try {

        const response = await axiosInstance.get<ManifestResponse>("/bookings/manifest", {
          params: {
            date: selectedDate.format(DATE_FORMAT),
            productId: hasSearchParam ? undefined : productIdParam ?? undefined,
            time: hasSearchParam ? undefined : timeParam ?? undefined,
            search: searchParam || undefined,
          },
          signal: controller.signal,
          withCredentials: true,
        });



        const payload = response.data;

        const groups = Array.isArray(payload?.manifest) ? payload.manifest : [];
        const mergedGroups = mergeManifestGroups(groups);

        setManifest(mergedGroups);

        const serverSummary = payload?.summary;
        const computedSummary = serverSummary
          ? {
              ...serverSummary,
              platformBreakdown: serverSummary.platformBreakdown ?? buildPlatformBreakdown(mergedGroups),
              statusCounts: (() => {
                const normalized = createEmptyStatusCounts();
                BOOKING_STATUSES.forEach((status) => {
                  normalized[status] = serverSummary.statusCounts?.[status] ?? 0;
                });
                return normalized;
              })(),
            }
          : createSummaryFromGroups(mergedGroups);

        setSummary(computedSummary);

        setFetchStatus("success");

      } catch (error) {

        if (controller.signal.aborted) {

          return;

        }

        setFetchStatus("error");

        setErrorMessage(error instanceof Error ? error.message : "Failed to load manifest data.");

      }

    };



    fetchManifest();



    return () => {

      controller.abort();

    };

  }, [
    modulePermissions.ready,
    modulePermissions.canView,
    selectedDate,
    productIdParam,
    timeParam,
    searchParam,
    hasSearchParam,
    reloadToken,
  ]);



  const filteredManifest = useMemo(
    () => applyBookingFilterToManifest(manifest, statusFilter),
    [manifest, statusFilter],
  );

  const filteredSummary = useMemo(() => {
    if (statusFilter === "all") {
      return summary;
    }
    return createSummaryFromGroups(filteredManifest);
  }, [filteredManifest, statusFilter, summary]);

  const groupOptions = useMemo(() => {

    const options = manifestToOptions(filteredManifest);

    if (options.length === 0) {

      return [{ value: "all", label: "All events" }];

    }

    return [{ value: "all", label: "All events" }, ...options];

  }, [filteredManifest]);



  const activeGroups = useMemo(() => {
    if (hasSearchParam || selectedGroupKey === "all") {
      return filteredManifest;
    }

    return filteredManifest.filter((group) => `${group.productId}|${group.time}` === selectedGroupKey);
  }, [hasSearchParam, filteredManifest, selectedGroupKey]);



  const handleShiftDate = (delta: number) => {

    const next = selectedDate.add(delta, "day");

    setSelectedDate(next);

    updateSearchParamDate(next);

  };



  const handleGoToToday = () => {

    const today = dayjs().startOf("day");

    setSelectedDate(today);

    updateSearchParamDate(today);

  };



  const handleDateInputChange = (event: ChangeEvent<HTMLInputElement>) => {

    const value = event.currentTarget.value;

    if (!value) {

      return;

    }

    const parsed = dayjs(value);

    if (parsed.isValid()) {

      const normalized = parsed.startOf("day");

      setSelectedDate(normalized);

      updateSearchParamDate(normalized);

    }

  };



  const handleGroupChange = (value: string | null) => {

    const nextValue = value ?? "all";

    setSelectedGroupKey(nextValue);

    const label = groupOptions.find((option) => option.value === nextValue)?.label;

    updateSearchParamGroup(nextValue, label);

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
      setErrorMessage(extractErrorMessage(error));
    }
  };



  const isLoading = fetchStatus === "loading" && manifest.length === 0;



  return (

    <PageAccessGuard pageSlug={PAGE_SLUGS.bookingsManifest}>

      <Stack gap="lg">

        <Title order={2}>{title}</Title>



        {!modulePermissions.ready || modulePermissions.loading ? (

          <Box style={{ minHeight: 240 }}>

            <Loader variant="dots" />

          </Box>

        ) : !modulePermissions.canView ? (

          <Alert color="yellow" title="No access">

            You do not have permission to view manifest information.

          </Alert>

        ) : (

          <Stack gap="md">

            <Flex justify="space-between" align="center" wrap="wrap" gap="sm">

              <Group gap="sm" wrap="wrap">

                <Button size="sm" variant="light" leftSection={<IconCalendar size={16} />} onClick={handleGoToToday}>

                  Today

                </Button>

                <Button size="sm" variant="subtle" leftSection={<IconArrowLeft size={16} />} onClick={() => handleShiftDate(-1)}>

                  Prev day

                </Button>

                <Button size="sm" variant="subtle" rightSection={<IconArrowRight size={16} />} onClick={() => handleShiftDate(1)}>

                  Next day

                </Button>

                <input

                  type="date"

                  value={selectedDate.format(DATE_FORMAT)}

                  onChange={handleDateInputChange}

                  style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #ced4da" }}

                />

              </Group>



              <Group gap="xs" wrap="wrap" align="center">

                <Select
                  data={groupOptions}
                  value={selectedGroupKey}
                  onChange={handleGroupChange}
                  size="sm"
                  allowDeselect={false}
                  style={{ minWidth: 220 }}
                  label="Event"
                  disabled={hasSearchParam}
                />

                <Button

                  variant="subtle"

                  size="sm"

                  onClick={handleReload}

                  leftSection={<IconRefresh size={16} />}

                  loading={ingestStatus === "loading" || fetchStatus === "loading"}

                >

                  Refresh

                </Button>

              </Group>

            </Flex>

            <form onSubmit={handleSearchSubmit}>
              <Stack gap={4}>
                <Group gap="xs" wrap="wrap" align="flex-end">
                  <TextInput
                    value={searchInput}
                    onChange={handleSearchChange}
                    placeholder="Search booking id, name, or phone"
                    leftSection={<IconSearch size={16} />}
                    size="sm"
                    w={isMobile ? "100%" : 320}
                  />
                  <Button type="submit" size="sm">
                    Search
                  </Button>
                  {hasSearchParam && (
                    <Button variant="subtle" color="gray" size="sm" onClick={handleSearchClear}>
                      Clear
                    </Button>
                  )}
                </Group>
                {hasSearchParam && (
                  <Text size="sm" c="dimmed">
                    Showing results for &ldquo;{searchParam}&rdquo;. Date and event filters are ignored while
                    search is active.
                  </Text>
                )}
              </Stack>
            </form>

            <Group gap="sm" wrap="wrap" align="center">
              <Text size="sm" fw={600}>
                Filters
              </Text>
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
            </Group>



            <Group gap="md" wrap="wrap">
              {hasSearchParam ? (
                <Badge size="lg" color="gray" variant="light">
                  {`Search: ${searchParam}`}
                </Badge>
              ) : (
                <Badge size="lg" color="blue" variant="light">
                  {selectedDate.format("dddd, MMM D")}
                </Badge>
              )}

              <Badge size="lg" color="green" variant="light">

                {`Total: ${filteredSummary.totalPeople} people`}

              </Badge>

              <Badge size="lg" color="teal" variant="light">

                {`Men: ${filteredSummary.men}`}

              </Badge>

              <Badge size="lg" color="pink" variant="light">

                {`Women: ${filteredSummary.women}`}

              </Badge>

              {filteredSummary.extras.tshirts > 0 && (
                <Badge size="lg" color="blue" variant="light">

                  {`T-Shirts: ${filteredSummary.extras.tshirts}`}

                </Badge>
              )}

              {filteredSummary.extras.cocktails > 0 && (
                <Badge size="lg" color="violet" variant="light">

                  {`Cocktails: ${filteredSummary.extras.cocktails}`}

                </Badge>
              )}

              {filteredSummary.extras.photos > 0 && (
                <Badge size="lg" color="grape" variant="light">

                  {`Photos: ${filteredSummary.extras.photos}`}

                </Badge>
              )}

              <Badge size="lg" color="gray" variant="light">

                {`Bookings: ${filteredSummary.totalOrders}`}

              </Badge>

              <PlatformBadges entries={filteredSummary.platformBreakdown} prefix="summary" />

              <Stack gap={4} w="100%">
                <Text fw={600} size="sm">
                  Booking statuses
                </Text>
                <Group gap="xs" wrap="wrap">
                  {BOOKING_STATUSES.map((status) => (
                    <Badge
                      key={`summary-status-${status}`}
                      color={STATUS_COLORS[status]}
                      variant="light"
                    >
                      {`${formatStatusLabel(status)}: ${filteredSummary.statusCounts?.[status] ?? 0}`}
                    </Badge>
                  ))}
                </Group>
              </Stack>

            </Group>



            {errorMessage && (

              <Alert color="red" title="Failed to load manifest">

                {errorMessage}

              </Alert>

            )}



            {isLoading ? (

              <Box style={{ minHeight: 320 }}>

                <Loader variant="bars" />

              </Box>

            ) : activeGroups.length === 0 ? (
              <Alert color="blue" title="No data">
                {hasSearchParam
                  ? `No bookings matched “${searchParam}”.`
                  : statusFilter === "cancelled"
                    ? "No cancelled bookings found for the selected date."
                    : statusFilter === "active"
                      ? "No active bookings found for the selected date."
                      : "No bookings found for the selected date."}
              </Alert>

            ) : (

              <Stack gap="lg">
                {activeGroups.map((group) => {
                  const readableDate = dayjs(group.date).format("dddd, MMM D");
                  const bookingsLabel = `${group.orders.length} booking${group.orders.length === 1 ? "" : "s"}`;
                  const sortedOrders = [...group.orders].sort((a, b) => {
                    const platformA = (a.platform ?? "").toLowerCase();
                    const platformB = (b.platform ?? "").toLowerCase();
                    if (platformA !== platformB) {
                      return platformA.localeCompare(platformB);
                    }
                    return (a.customerName ?? "").localeCompare(b.customerName ?? "");
                  });

                  if (isMobile) {
                    return (
                      <Paper
                        key={`${group.productId}-${group.date}-${group.time}`}
                        withBorder
                        radius="lg"
                        shadow="sm"
                        p="md"
                      >
                        <Stack gap="sm">
                          <Stack gap={4}>
                            <Text fw={700} size="lg">
                              {group.productName}
                            </Text>
                            <Group gap="xs" align="center">
                              <Badge color="orange" variant="filled" radius="sm">
                                {group.time}
                              </Badge>
                              <Text size="sm" c="dimmed">
                                {readableDate}
                              </Text>
                            </Group>
                          </Stack>
                          <Group gap="xs" wrap="wrap">
                            <Badge color="green" variant="light">
                              {`${group.totalPeople} people`}
                            </Badge>
                            <Badge color="teal" variant="light">
                              {`Men: ${group.men}`}
                            </Badge>
                            <Badge color="pink" variant="light">
                              {`Women: ${group.women}`}
                            </Badge>
                            {group.extras.tshirts > 0 && (
                              <Badge color="blue" variant="light">
                                {`T-Shirts: ${group.extras.tshirts}`}
                              </Badge>
                            )}
                            {group.extras.cocktails > 0 && (
                              <Badge color="violet" variant="light">
                                {`Cocktails: ${group.extras.cocktails}`}
                              </Badge>
                            )}
                          {group.extras.photos > 0 && (
                            <Badge color="grape" variant="light">
                              {`Photos: ${group.extras.photos}`}
                            </Badge>
                          )}
                          <Badge color="gray" variant="light">
                            {bookingsLabel}
                          </Badge>
                          <PlatformBadges
                            entries={group.platformBreakdown}
                            prefix={`group-desktop-${group.productId}-${group.time}`}
                          />
                        </Group>
                          <Divider />
                          <Stack gap="sm">
                            {sortedOrders.map((order) => {
                              const bookingDisplay = order.platformBookingId ?? order.id;
                              const bookingLink =
                                order.platformBookingUrl ?? getPlatformBookingLink(order.platform, order.platformBookingId);
                              const bookingId = getBookingIdFromOrder(order);
                              const canAmend = isEcwidOrder(order) && Boolean(bookingId);
                              const canCancel = canAmend && order.status !== "cancelled";
                              return (
                                <Paper
                                  key={order.id}
                                  withBorder
                                  radius="md"
                                  shadow="xs"
                                  p="sm"
                                  style={{ background: "#f8fafc" }}
                                >
                                  <Stack gap={8}>
                                    <Group justify="space-between" align="flex-start">
                                      <Stack gap={2}>
                                        <Text fw={600}>{order.customerName || "Unnamed guest"}</Text>
                                        <Text size="xs" c="dimmed">
                                          {bookingLink ? (
                                            <Anchor
                                              href={bookingLink}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              size="xs"
                                            >
                                              {bookingDisplay}
                                            </Anchor>
                                          ) : (
                                            bookingDisplay
                                          )}
                                        </Text>
                                      </Stack>
                                    <Badge color="orange" variant="light">
                                      {`${order.quantity} people`}
                                    </Badge>
                                  </Group>
                                  <Group gap="xs" wrap="wrap">
                                      <Badge color="teal" variant="light">
                                        {`Men: ${order.menCount}`}
                                      </Badge>
                                      <Badge color="pink" variant="light">
                                        {`Women: ${order.womenCount}`}
                                      </Badge>
                                      <OrderPlatformBadge platform={order.platform} />
                                      <StatusBadge status={order.status} />
                                    {order.extras && (order.extras.tshirts ?? 0) > 0 ? (
                                      <Badge color="blue" variant="light">
                                        {`T-Shirts: ${order.extras.tshirts}`}
                                      </Badge>
                                    ) : null}
                                    {order.extras && (order.extras.cocktails ?? 0) > 0 ? (
                                      <Badge color="violet" variant="light">
                                        {`Cocktails: ${order.extras.cocktails}`}
                                      </Badge>
                                    ) : null}
                                    {order.extras && (order.extras.photos ?? 0) > 0 ? (
                                      <Badge color="grape" variant="light">
                                        {`Photos: ${order.extras.photos}`}
                                      </Badge>
                                    ) : null}
                                  </Group>
                                  <Stack gap={4}>
                                    <Text size="sm" c="dimmed">
                                      Pickup time: {order.timeslot}
                                    </Text>
                                    {(() => {
                                      const link = toWhatsAppLink(order.customerPhone);
                                      return (
                                        <Text size="sm" c="dimmed">
                                          Phone:{' '}
                                          {link ? (
                                            <Text
                                              component="a"
                                              href={link.href}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              fw={600}
                                              c="blue"
                                              style={{ textDecoration: 'none' }}
                                              title="Open in WhatsApp"
                                            >
                                              {link.display}
                                            </Text>
                                          ) : (
                                            order.customerPhone || "Not provided"
                                          )}
                                        </Text>
                                      );
                                    })()}
                                    <Group gap="xs">
                                      {canAmend && (
                                        <Button
                                          size="xs"
                                          variant="light"
                                          onClick={() => openAmendModal(order)}
                                        >
                                          Amend
                                        </Button>
                                      )}
                                      {canCancel && (
                                        <Button
                                          size="xs"
                                          color="red"
                                          variant="outline"
                                          onClick={() => handleCancelOrder(order)}
                                        >
                                          Cancel
                                        </Button>
                                      )}
                                    </Group>
                                  </Stack>
                                </Stack>
                              </Paper>
                            );
                          })}
                          </Stack>
                        </Stack>
                      </Paper>
                    );
                  }
                  return (
                    <Box
                      key={`${group.productId}-${group.date}-${group.time}`}
                      style={{
                        background: "#fff",
                        borderRadius: 10,
                        boxShadow: "0 18px 36px rgba(15, 23, 42, 0.08)",
                        border: "1px solid #e2e8f0",
                        padding: 24,
                      }}
                    >
                      <Flex justify="space-between" align="center" wrap="wrap" gap="sm">
                        <Stack gap={4}>
                          <Text fw={700} size="lg">
                            {group.productName}
                          </Text>
                          <Group gap="xs" align="center">
                            <Badge color="orange" variant="filled" radius="sm">
                              {group.time}
                            </Badge>
                            <Text size="sm" c="dimmed">
                              {readableDate}
                            </Text>
                          </Group>
                        </Stack>
                        <Group gap="xs" wrap="wrap">
                          <Badge color="green" variant="light">
                            {`${group.totalPeople} people`}
                          </Badge>
                          <Badge color="teal" variant="light">
                            {`Men: ${group.men}`}
                          </Badge>
                          <Badge color="pink" variant="light">
                            {`Women: ${group.women}`}
                          </Badge>
                          {group.extras.tshirts > 0 && (
                            <Badge color="blue" variant="light">
                              {`T-Shirts: ${group.extras.tshirts}`}
                            </Badge>
                          )}
                          {group.extras.cocktails > 0 && (
                            <Badge color="violet" variant="light">
                              {`Cocktails: ${group.extras.cocktails}`}
                            </Badge>
                          )}
                          {group.extras.photos > 0 && (
                            <Badge color="grape" variant="light">
                              {`Photos: ${group.extras.photos}`}
                            </Badge>
                          )}
                          <Badge color="gray" variant="light">
                            {bookingsLabel}
                          </Badge>
                          <PlatformBadges
                            entries={group.platformBreakdown}
                            prefix={`group-mobile-${group.productId}-${group.time}`}
                          />
                        </Group>
                      </Flex>

                      <Table striped highlightOnHover withColumnBorders mt="md" horizontalSpacing="md" verticalSpacing="sm">
                          <Table.Thead>
                            <Table.Tr>
                              <Table.Th>Booking #</Table.Th>
                              <Table.Th>Contact</Table.Th>
                              <Table.Th>Platform</Table.Th>
                              <Table.Th>Status</Table.Th>
                              <Table.Th>Phone</Table.Th>
                              <Table.Th align="right">People</Table.Th>
                          <Table.Th align="right">Men</Table.Th>
                          <Table.Th align="right">Women</Table.Th>
                          <Table.Th align="right">T-Shirts</Table.Th>
                          <Table.Th align="right">Cocktails</Table.Th>
                          <Table.Th align="right">Photos</Table.Th>
                          <Table.Th>Pickup time</Table.Th>
                          <Table.Th>Actions</Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                        <Table.Tbody>
                          <Table.Tr style={{ background: "#fff7e6" }}>
                            <Table.Td fw={600} c="#475569">Summary</Table.Td>
                              <Table.Td fw={600}>{bookingsLabel}</Table.Td>
                              <Table.Td>
                                <PlatformBadges
                                  entries={group.platformBreakdown}
                                  prefix={`table-summary-${group.productId}-${group.time}`}
                                  withMargin={false}
                                />
                              </Table.Td>
                              <Table.Td />
                              <Table.Td />
                              <Table.Td align="right" fw={600}>
                                {group.totalPeople}
                            </Table.Td>
                            <Table.Td align="right" fw={600}>
                              {group.men}
                            </Table.Td>
                            <Table.Td align="right" fw={600}>
                              {group.women}
                            </Table.Td>
                            <Table.Td align="right" fw={600}>
                              {formatAddonValue(group.extras.tshirts)}
                            </Table.Td>
                            <Table.Td align="right" fw={600}>
                              {formatAddonValue(group.extras.cocktails)}
                            </Table.Td>
                            <Table.Td align="right" fw={600}>
                              {formatAddonValue(group.extras.photos)}
                            </Table.Td>
                            <Table.Td fw={600}>{group.time}</Table.Td>
                            <Table.Td />
                          </Table.Tr>
                          {sortedOrders.map((order) => {
                            const bookingDisplay = order.platformBookingId ?? order.id;
                            const bookingLink =
                              order.platformBookingUrl ?? getPlatformBookingLink(order.platform, order.platformBookingId);
                            const bookingId = getBookingIdFromOrder(order);
                            const canAmend = isEcwidOrder(order) && Boolean(bookingId);
                            const canCancel = canAmend && order.status !== "cancelled";
                            return (
                              <Table.Tr key={order.id}>
                                <Table.Td>
                                  {bookingLink ? (
                                    <Anchor
                                      href={bookingLink}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      size="sm"
                                    >
                                      {bookingDisplay}
                                    </Anchor>
                                  ) : (
                                    bookingDisplay
                                  )}
                                </Table.Td>
                              <Table.Td>{order.customerName || "-"}</Table.Td>
                              <Table.Td>
                                <OrderPlatformBadge platform={order.platform} />
                              </Table.Td>
                              <Table.Td>
                                <StatusBadge status={order.status} />
                              </Table.Td>
                              <Table.Td>
                                {(() => {
                                  const link = toWhatsAppLink(order.customerPhone);
                                  return link ? (
                                    <a
                                      href={link.href}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      style={{ fontWeight: 600, textDecoration: 'none', color: 'var(--mantine-color-blue-7)' }}
                                      title="Open in WhatsApp"
                                    >
                                      {link.display}
                                    </a>
                                  ) : (order.customerPhone || "-");
                                })()}
                              </Table.Td>
                              <Table.Td align="right">{order.quantity}</Table.Td>
                              <Table.Td align="right">{order.menCount}</Table.Td>
                              <Table.Td align="right">{order.womenCount}</Table.Td>
                              <Table.Td align="right">{formatAddonValue(order.extras?.tshirts)}</Table.Td>
                              <Table.Td align="right">{formatAddonValue(order.extras?.cocktails)}</Table.Td>
                              <Table.Td align="right">{formatAddonValue(order.extras?.photos)}</Table.Td>
                              <Table.Td>{order.timeslot}</Table.Td>
                              <Table.Td>
                                {canAmend || canCancel ? (
                                  <Group gap="xs">
                                    {canAmend && (
                                      <Button size="xs" variant="light" onClick={() => openAmendModal(order)}>
                                        Amend
                                      </Button>
                                    )}
                                    {canCancel && (
                                      <Button
                                        size="xs"
                                        color="red"
                                        variant="outline"
                                        onClick={() => handleCancelOrder(order)}
                                      >
                                        Cancel
                                      </Button>
                                    )}
                                  </Group>
                                ) : (
                                  <Text size="sm" c="dimmed">
                                    -
                                  </Text>
                                )}
                              </Table.Td>
                            </Table.Tr>
                          );
                        })}
                        </Table.Tbody>
                      </Table>
                    </Box>
                  );
                })}

              </Stack>

            )}

          </Stack>

        )}

      </Stack>

      <Modal
        opened={amendState.opened}
        onClose={closeAmendModal}
        title={
          amendState.order
            ? `Amend booking ${amendState.order.platformBookingId ?? amendState.order.id}`
            : "Amend Ecwid booking"
        }
        size="md"
        centered
      >
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            Updating the pickup details will sync the change to Ecwid first and then to OmniLodge.
          </Text>
          {amendState.order && (
            <Stack gap={2}>
              <Text fw={600}>{amendState.order.customerName || "Unnamed guest"}</Text>
              <Text size="sm" c="dimmed">
                Current pickup: {amendState.order.date} @ {amendState.order.timeslot}
              </Text>
            </Stack>
          )}
          <DatePickerInput
            label="Pickup date"
            value={amendState.formDate}
            onChange={handleAmendDateChange}
            required
            placeholder="Select new pickup date"
          />
          <TimeInput
            label="Pickup time"
            value={amendState.formTime}
            onChange={handleAmendTimeChange}
            required
            placeholder="HH:mm"
          />
          {amendState.error && (
            <Alert color="red" title="Unable to update booking">
              {amendState.error}
            </Alert>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={closeAmendModal}>
              Cancel
            </Button>
            <Button
              onClick={handleAmendSubmit}
              loading={amendState.submitting}
              disabled={!amendState.formDate || !amendState.formTime || amendState.submitting}
            >
              Save changes
            </Button>
          </Group>
        </Stack>
      </Modal>

    </PageAccessGuard>

  );

};



export default BookingsManifestPage;
