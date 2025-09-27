import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Box, Button, Flex, Group, Loader, SegmentedControl, Stack, Text, Title, Tooltip } from "@mantine/core";
import { IconArrowLeft, IconArrowRight, IconCalendar, IconRefresh } from "@tabler/icons-react";
import dayjs, { Dayjs } from "dayjs";
import { useAppDispatch } from "../store/hooks";
import { useNavigate } from "react-router-dom";
import { navigateToPage } from "../actions/navigationActions";
import { GenericPageProps } from "../types/general/GenericPageProps";
import { BookingsGrid } from "../components/BookingsGrid";
import axiosInstance from "../utils/axiosInstance";
import { UnifiedOrder, UnifiedProduct } from "../store/bookingPlatformsTypes";
import { prepareBookingGrid, BookingGrid } from "../utils/prepareBookingGrid";
import { PageAccessGuard } from "../components/access/PageAccessGuard";
import { PAGE_SLUGS } from "../constants/pageSlugs";
import { useModuleAccess } from "../hooks/useModuleAccess";

const DATE_FORMAT = "YYYY-MM-DD";

type ViewMode = "week" | "month";

type FetchStatus = "idle" | "loading" | "error" | "success";

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
  const [viewMode, setViewMode] = useState<ViewMode>("week");
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
        const response = await axiosInstance.get("/api/ecwid/orders", {
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
          </Stack>
        )}
      </Stack>
    </PageAccessGuard>
  );
};

export default BookingsPage;


