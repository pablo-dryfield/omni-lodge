import React, { useMemo } from "react";
import { Button, Group, Paper, ScrollArea, Stack, Text } from "@mantine/core";
import { UnifiedProduct } from "../store/bookingPlatformsTypes";
import { BookingCell, BookingGrid } from "../utils/prepareBookingGrid";

const getRowKey = (name: string): string => {
  const lowered = name.toLowerCase();
  if (lowered.includes("pub crawl")) return "pub";
  if (lowered.includes("beer")) return "beer";
  if (lowered.includes("brunch")) return "brunch";
  if (lowered.includes("food")) return "food";
  if (lowered.includes("drawing")) return "drawing";
  if (lowered.includes("cocktail")) return "cocktail";
  return "default";
};

type ViewMode = "week" | "month";

type ManifestTarget = {
  productId: string;
  productName: string;
  date: string;
  time: string;
};

type MobileBookingsListProps = {
  products: UnifiedProduct[];
  dateRange: string[];
  grid: BookingGrid;
  selectedDate: string;
  onSelectDate: (date: string) => void;
  viewMode: ViewMode;
  onOpenManifest?: (target: ManifestTarget, orders: BookingCell["orders"]) => void;
};

type TimeslotGroup = {
  product: UnifiedProduct;
  rowKey: string;
  cell: BookingCell;
};

const formatDateLabel = (date: string) => {
  const formatted = new Date(date);
  return {
    weekday: formatted.toLocaleDateString(undefined, { weekday: "short" }),
    day: formatted.getDate(),
    month: formatted.toLocaleDateString(undefined, { month: "short" }),
  };
};

const formatPeopleLabel = (cell: BookingCell) => {
  if (cell.menCount === 0 && cell.womenCount === 0) {
    return `${cell.totalPeople} people`;
  }

  return `${cell.totalPeople} people (M:${cell.menCount} / W:${cell.womenCount})`;
};

export const MobileBookingsList: React.FC<MobileBookingsListProps> = ({
  products,
  dateRange,
  grid,
  selectedDate,
  onSelectDate,
  viewMode,
  onOpenManifest,
}) => {
  const slots: TimeslotGroup[] = useMemo(() => {
    const result: TimeslotGroup[] = [];

    products.forEach((product) => {
      const rowKey = getRowKey(product.name ?? product.id);
      const cells = grid[product.id]?.[selectedDate] ?? [];

      cells
        .slice()
        .sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0))
        .forEach((cell) => {
          result.push({ product, rowKey, cell });
        });
    });

    return result;
  }, [products, grid, selectedDate]);

  return (
    <Stack gap="md">
      <ScrollArea type="auto" scrollbarSize={6} offsetScrollbars>
        <Group gap="sm" wrap="nowrap" style={{ paddingBottom: 8 }}>
          {dateRange.map((date) => {
            const { weekday, day, month } = formatDateLabel(date);
            const active = date === selectedDate;
            return (
              <Paper
                key={date}
                onClick={() => onSelectDate(date)}
                shadow={active ? "md" : "xs"}
                radius="md"
                withBorder
                style={{
                  minWidth: 90,
                  padding: "8px 12px",
                  background: active ? "#fff0d6" : "#fff",
                  cursor: "pointer",
                }}
              >
                <Stack gap={2} align="center" justify="center">
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
              </Paper>
            );
          })}
        </Group>
      </ScrollArea>

      {slots.length === 0 ? (
        <Paper withBorder radius="md" p="lg">
          <Text size="sm" c="dimmed" ta="center">
            No bookings for the selected {(viewMode === "week" ? "day" : "period")}.
          </Text>
        </Paper>
      ) : (
        <Stack gap="sm">
          {slots.map(({ product, rowKey, cell }) => (
            <Paper
              key={`${product.id}-${cell.time}`}
              withBorder
              radius="md"
              shadow="xs"
              style={{
                borderLeft: `5px solid #ef8625`,
                padding: "12px 14px",
                background: "#fff",
              }}
            >
              <Stack gap={6}>
                <Group justify="space-between" align="center">
                  <Stack gap={0}>
                    <Text fw={700} size="md">
                      {cell.time}
                    </Text>
                    <Text size="sm" c="dimmed">
                      {product.name}
                    </Text>
                  </Stack>
                  <Text size="sm" fw={600} c="#0f6d09">
                    {formatPeopleLabel(cell)}
                  </Text>
                </Group>
                {onOpenManifest && (
                  <Button
                    size="xs"
                    variant="light"
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
                    View manifest
                  </Button>
                )}
              </Stack>
            </Paper>
          ))}
        </Stack>
      )}
    </Stack>
  );
};
