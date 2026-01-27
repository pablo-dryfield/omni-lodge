import React, { useEffect, useMemo, useRef } from "react";
import { Badge, Button, Group, Paper, Stack, Text } from "@mantine/core";
import { UnifiedProduct, OrderExtras } from "../store/bookingPlatformsTypes";
import { BookingCell, BookingGrid } from "../utils/prepareBookingGrid";
import { IconListDetails } from "@tabler/icons-react";

type ViewMode = "week" | "month";

type ManifestTarget = {
  productId: string;
  productName: string;
  date: string;
  time: string | null;
};

type MobileBookingsListProps = {
  products: UnifiedProduct[];
  dateRange: string[];
  grid: BookingGrid;
  selectedDate: string;
  onSelectDate: (date: string) => void;
  viewMode: ViewMode;
  onOpenManifest?: (target: ManifestTarget, orders: BookingCell["orders"]) => void;
  scrollToDate?: string | null;
  onScrollComplete?: () => void;
};

type TimeslotGroup = {
  product: UnifiedProduct;
  cell: BookingCell;
  extras: OrderExtras;
};

type DateEntry = {
  slots: TimeslotGroup[];
  totalPeople: number;
  totalSlots: number;
  totalOrders: number;
  totalMen: number;
  totalWomen: number;
  extras: OrderExtras;
};

const createEmptyExtras = (): OrderExtras => ({ tshirts: 0, cocktails: 0, photos: 0 });

const summarizeExtras = (orders: BookingCell["orders"]): OrderExtras => {
  const totals = createEmptyExtras();

  orders.forEach((order) => {
    totals.tshirts += order.extras?.tshirts ?? 0;
    totals.cocktails += order.extras?.cocktails ?? 0;
    totals.photos += order.extras?.photos ?? 0;
  });

  return totals;
};

const mergeExtras = (target: OrderExtras, payload: OrderExtras) => {
  target.tshirts += payload.tshirts;
  target.cocktails += payload.cocktails;
  target.photos += payload.photos;
};

const formatDateLabel = (date: string) => {
  const formatted = new Date(date);
  return {
    weekday: formatted.toLocaleDateString(undefined, { weekday: "short" }),
    day: formatted.getDate(),
    month: formatted.toLocaleDateString(undefined, { month: "short" }),
  };
};

const formatBookingCount = (value: number) => {
  if (value === 0) {
    return "No slots";
  }
  if (value === 1) {
    return "1 slot";
  }
  return `${value} slots`;
};

const ensureDateEntry = (map: Record<string, DateEntry>, date: string): DateEntry => {
  if (!map[date]) {
    map[date] = {
      slots: [],
      totalPeople: 0,
      totalSlots: 0,
      totalOrders: 0,
      totalMen: 0,
      totalWomen: 0,
      extras: createEmptyExtras(),
    };
  }
  return map[date];
};

const renderExtrasBadges = (extras: OrderExtras) => {
  const badges: React.ReactNode[] = [];
  if (extras.tshirts > 0) {
    badges.push(
      <Badge key="tshirts" color="blue" variant="light">
        {`T-Shirts: ${extras.tshirts}`}
      </Badge>,
    );
  }
  if (extras.cocktails > 0) {
    badges.push(
      <Badge key="cocktails" color="violet" variant="light">
        {`Cocktails: ${extras.cocktails}`}
      </Badge>,
    );
  }
  if (extras.photos > 0) {
    badges.push(
      <Badge key="photos" color="grape" variant="light">
        {`Photos: ${extras.photos}`}
      </Badge>,
    );
  }
  return badges;
};

const buildEmptyEntry = (): DateEntry => ({
  slots: [],
  totalPeople: 0,
  totalSlots: 0,
  totalOrders: 0,
  totalMen: 0,
  totalWomen: 0,
  extras: createEmptyExtras(),
});

export const MobileBookingsList: React.FC<MobileBookingsListProps> = ({
  products,
  dateRange,
  grid,
  selectedDate,
  onSelectDate,
  viewMode,
  onOpenManifest,
  scrollToDate,
  onScrollComplete,
}) => {
  const dateRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const sanitizedProducts = useMemo(() => {
    if (products.length > 0) {
      return products;
    }

    const fallbackIds = Object.keys(grid);
    return fallbackIds.map((id) => ({ id, name: id, platform: "ecwid" }));
  }, [products, grid]);

  const dateData = useMemo(() => {
    const map: Record<string, DateEntry> = {};

    dateRange.forEach((date) => {
      map[date] = buildEmptyEntry();
    });

    sanitizedProducts.forEach((product) => {
      dateRange.forEach((date) => {
        const cells = grid[product.id]?.[date] ?? [];
        if (cells.length === 0) {
          return;
        }

        const entry = ensureDateEntry(map, date);

        cells.forEach((cell) => {
          const slotExtras = summarizeExtras(cell.orders);

          entry.slots.push({ product, cell, extras: slotExtras });
          entry.totalPeople += cell.totalPeople;
          entry.totalMen += cell.menCount;
          entry.totalWomen += cell.womenCount;
          entry.totalSlots += 1;
          entry.totalOrders += cell.orders.length;
          mergeExtras(entry.extras, slotExtras);
        });
      });
    });

    Object.values(map).forEach((entry) => {
      entry.slots.sort((a, b) => {
        const aTime = a.cell.time ?? "";
        const bTime = b.cell.time ?? "";
        if (aTime === bTime) {
          const aName = a.product.name ?? a.product.id;
          const bName = b.product.name ?? b.product.id;
          return aName.localeCompare(bName);
        }
        if (!aTime) {
          return 1;
        }
        if (!bTime) {
          return -1;
        }
        return aTime.localeCompare(bTime);
      });
    });

    return map;
  }, [sanitizedProducts, grid, dateRange]);

  useEffect(() => {
    if (!scrollToDate) {
      return;
    }
    const node = dateRefs.current[scrollToDate];
    if (node) {
      requestAnimationFrame(() => {
        node.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
    if (onScrollComplete) {
      onScrollComplete();
    }
  }, [scrollToDate, onScrollComplete]);

  return (
    <Stack gap="lg">
      {dateRange.map((date) => {
        const entry = dateData[date] ?? buildEmptyEntry();
        const { weekday, day, month } = formatDateLabel(date);
        const active = date === selectedDate;
        const entryHasBookings = entry.totalSlots > 0;
        const firstSlot = entry.slots[0];

        return (
          <div key={date} ref={(node) => { dateRefs.current[date] = node; }} style={{ scrollMarginTop: 96 }}>
            <Stack gap="xs">
            <Paper
              onClick={() => onSelectDate(date)}
              withBorder
              radius="md"
              shadow={active ? "md" : "xs"}
              style={{
                background: active ? "#fff7eb" : entryHasBookings ? "#f8fff3" : "#fff",
                border: active ? "2px solid #ef8625" : undefined,
                cursor: "pointer",
                padding: "12px 16px",
              }}
            >
              <Group justify="space-between" align="flex-start">
                <Stack gap={2}>
                  <Text size="xs" c="dimmed" fw={600} tt="uppercase">
                    {weekday}
                  </Text>
                  <Text size="lg" fw={700}>
                    {day}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {month}
                  </Text>
                </Stack>

                <Stack gap={6} align="flex-end">
                  <Badge color={entryHasBookings ? "teal" : "gray"} variant="light">
                    {formatBookingCount(entry.totalSlots)}
                  </Badge>
                  {entryHasBookings && (
                    <Badge color="orange" variant="light">
                      {`${entry.totalPeople} people`}
                    </Badge>
                  )}
                </Stack>
              </Group>
            </Paper>

            {active && (
              entryHasBookings ? (
                <Stack gap="sm" px="xs">
                  {entry.slots.map(({ product, cell, extras }) => {
                    const bookingLabel = cell.orders.length === 1 ? '1 booking' : `${cell.orders.length} bookings`;
                    return (
                      <Paper
                        key={`${product.id}-${cell.time}`}
                        withBorder
                        radius="md"
                        shadow="xs"
                        style={{
                          borderLeft: "5px solid #ef8625",
                          padding: "12px 14px",
                          background: "#fff",
                        }}
                      >
                        <Stack gap={10}>
                          <Group justify="space-between" align="flex-start">
                            <Stack gap={2}>
                              {cell.time && (
                                <Text fw={700} size="md">
                                  {cell.time}
                                </Text>
                              )}
                              <Text size="sm" c="dimmed">
                                {product.name}
                              </Text>
                            </Stack>
                          </Group>

                          <Group gap="xs" wrap="wrap">
                            <Badge color="orange" variant="light">
                              {`${cell.totalPeople} people`}
                            </Badge>
                            <Badge color="teal" variant="light">
                              {`Men: ${cell.menCount}`}
                            </Badge>
                            <Badge color="pink" variant="light">
                              {`Women: ${cell.womenCount}`}
                            </Badge>
                            {cell.undefinedCount > 0 && (
                              <Badge color="gray" variant="light">
                                {`Undefined Genre: ${cell.undefinedCount}`}
                              </Badge>
                            )}
                            <Badge color="gray" variant="light">
                              {bookingLabel}
                            </Badge>
                            {renderExtrasBadges(extras)}
                          </Group>
                          {onOpenManifest && (
                            <Group mt={4} justify="center">
                              <Button
                                fullWidth
                                size="md"
                                radius="xl"
                                variant="gradient"
                                gradient={{ from: "orange", to: "grape", deg: 45 }}
                                leftSection={<IconListDetails size={18} />}
                                aria-label={`Open manifest for ${product.name} at ${cell.time}`}
                                styles={{
                                  label: { fontWeight: 700, letterSpacing: 0.2 },
                                }}
                                onClick={() =>
                                  onOpenManifest(
                                    {
                                      productId: product.id,
                                      productName: product.name,
                                      date: cell.date,
                                      time: cell.time,
                                    },
                                    cell.orders,
                                  )
                                }
                              >
                                View Manifest
                              </Button>
                            </Group>
                          )}
                        </Stack>
                      </Paper>
                    );
                  })}
                </Stack>
              ) : (
                <Paper withBorder radius="md" p="lg" bg="#fff" px="xs">
                  <Text size="sm" c="dimmed" ta="center">
                    No bookings for the selected {viewMode === "week" ? "day" : "date"}.
                  </Text>
                </Paper>
              )
            )}
            </Stack>
          </div>
        );
      })}
    </Stack>
  );
};
