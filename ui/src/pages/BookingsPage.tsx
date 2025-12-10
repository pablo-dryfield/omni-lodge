import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
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
import { IconArrowLeft, IconArrowRight, IconCalendar, IconRefresh } from "@tabler/icons-react";
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
  const [activeTab, setActiveTab] = useState<"calendar" | "summary">("calendar");
  const [rangeAnchor, setRangeAnchor] = useState<Dayjs>(() => dayjs().startOf("day"));
  const [selectedDate, setSelectedDate] = useState<Dayjs>(() => dayjs().startOf("day"));
  const [products, setProducts] = useState<UnifiedProduct[]>([]);
  const [orders, setOrders] = useState<UnifiedOrder[]>([]);
  const [fetchStatus, setFetchStatus] = useState<FetchStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
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

  const handleReload = () => setReloadToken((token) => token + 1);

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

  const grid: BookingGrid = useMemo(() => {
    return prepareBookingGrid(products, orders, dateRange);
  }, [products, orders, dateRange]);

  const summaryStats = useMemo(() => computeSummaryStats(orders), [orders]);

  const sortedOrders = useMemo(() => {
    const copy = [...orders];
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
  }, [orders]);

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
                    loading={fetchStatus === "loading"}
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
              onChange={(value) => setActiveTab((value as "calendar" | "summary") ?? "calendar")}
              keepMounted={false}
            >
              <Tabs.List>
                <Tabs.Tab value="calendar">Calendar</Tabs.Tab>
                <Tabs.Tab value="summary">Summary</Tabs.Tab>
              </Tabs.List>

              <Tabs.Panel value="calendar" pt="md">
                {isLoading ? (
                  <Box style={{ minHeight: 320 }}>
                    <Loader variant="bars" />
                  </Box>
                ) : (
                  <BookingsGrid
                    products={products}
                    dateRange={dateRange}
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
                    {orders.length === 0 ? (
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
            </Tabs>
          </Stack>
        )}
      </Stack>
    </PageAccessGuard>
  );
};

export default BookingsPage;


