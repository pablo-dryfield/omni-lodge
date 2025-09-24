import React, { useMemo, useState } from "react";
import { Stack, Table, Text } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { UnifiedProduct } from "../store/bookingPlatformsTypes";
import { BookingCell, BookingGrid } from "../utils/prepareBookingGrid";
import { MobileBookingsList } from "./MobileBookingsList";
import { BookingPopup } from "./BookingPopup";

type ViewMode = "week" | "month";

type ManifestTarget = {
  productId: string;
  productName: string;
  date: string;
  time: string;
};

type BookingsGridProps = {
  products: UnifiedProduct[];
  dateRange: string[];
  grid: BookingGrid;
  selectedDate: string;
  onSelectDate: (date: string) => void;
  viewMode: ViewMode;
  onOpenManifest?: (target: ManifestTarget, orders: BookingCell["orders"]) => void;
};

type ActiveCell = ManifestTarget | null;

type TimeslotRectProps = {
  rowKey: string;
  cell: BookingCell;
  onClick?: () => void;
};

const ROW_COLORS: Record<string, string> = {
  pub: "#ffe5cc",
  beer: "#e3ffe7",
  brunch: "#fffbe3",
  food: "#fffbe3",
  drawing: "#e3ffe7",
  cocktail: "#e3edff",
  default: "#f1f5fb",
};

const BORDER_BOTTOM_COLORS: Record<string, string> = {
  pub: "#bf6d17",
  beer: "#20643e",
  brunch: "#b89b44",
  food: "#b89b44",
  drawing: "#20643e",
  cocktail: "#276eae",
  default: "#bbb",
};

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

const formatDateHeader = (date: string) => {
  const formatter = new Date(date);
  return {
    weekday: formatter.toLocaleDateString(undefined, { weekday: "short" }),
    day: formatter.getDate(),
    month: formatter.toLocaleDateString(undefined, { month: "short" }),
  };
};

const formatPeopleLabel = (total: number, men: number, women: number): string => {
  if (men === 0 && women === 0) {
    return `${total}`;
  }

  return `${total} (M:${men} / W:${women})`;
};

export const BookingsGrid: React.FC<BookingsGridProps> = ({
  products,
  dateRange,
  grid,
  selectedDate,
  onSelectDate,
  viewMode,
  onOpenManifest,
}) => {
  const isMobile = useMediaQuery("(max-width: 900px)");
  const [activeCell, setActiveCell] = useState<ActiveCell>(null);

  const sanitizedProducts = useMemo(() => {
    if (products.length > 0) {
      return products;
    }

    const fallback = Object.keys(grid);
    return fallback.map((id) => ({ id, name: id, platform: "ecwid" }));
  }, [products, grid]);

  if (isMobile) {
    return (
      <MobileBookingsList
        products={sanitizedProducts}
        dateRange={dateRange}
        grid={grid}
        selectedDate={selectedDate}
        onSelectDate={onSelectDate}
        viewMode={viewMode}
        onOpenManifest={onOpenManifest}
      />
    );
  }

  return (
    <div
      style={{
        width: "100%",
        background: "#fff",
        borderRadius: 8,
        boxShadow: "0 24px 40px rgba(15, 23, 42, 0.04)",
        overflow: "hidden",
      }}
    >
      <Table horizontalSpacing="md" verticalSpacing="xs" highlightOnHover={false} withRowBorders={false}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th style={{ width: 260, background: "#f5f6fa" }}>
              <Text fw={600} size="sm" c="dimmed">
                Experience
              </Text>
            </Table.Th>
            {dateRange.map((date) => {
              const { weekday, day, month } = formatDateHeader(date);
              const isActive = date === selectedDate;
              return (
                <Table.Th
                  key={date}
                  onClick={() => onSelectDate(date)}
                  style={{
                    minWidth: 140,
                    cursor: "pointer",
                    background: isActive ? "#fff0d6" : "#f5f6fa",
                    borderBottom: isActive ? "3px solid #ffb347" : "3px solid transparent",
                    transition: "background 0.12s",
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
                </Table.Th>
              );
            })}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {sanitizedProducts.map((product) => {
            const rowKey = getRowKey(product.name ?? product.id);
            return (
              <Table.Tr key={product.id}>
                <Table.Td style={{ fontWeight: 600, fontSize: 15 }}>{product.name}</Table.Td>
                {dateRange.map((date) => {
                  const cells = grid[product.id]?.[date] ?? [];
                  const isActive = date === selectedDate;

                  return (
                    <Table.Td
                      key={`${product.id}-${date}`}
                      style={{
                        background: isActive ? "#fffaf1" : "#fff",
                        minHeight: 88,
                        verticalAlign: "top",
                        padding: "6px 4px",
                      }}
                    >
                      {cells.length === 0 ? (
                        <div style={{ minHeight: 48 }} />
                      ) : (
                        cells.map((cell) => {
                          const isOpen =
                            activeCell?.productId === product.id &&
                            activeCell?.date === cell.date &&
                            activeCell?.time === cell.time;

                          return (
                            <div key={`${cell.time}-${cell.date}`} style={{ position: "relative" }}>
                              <TimeslotRect
                                rowKey={rowKey}
                                cell={cell}
                                onClick={() => {
                                  if (isOpen) {
                                    setActiveCell(null);
                                  } else {
                                    setActiveCell({
                                      productId: product.id,
                                      productName: product.name,
                                      date: cell.date,
                                      time: cell.time,
                                    });
                                  }
                                }}
                              />
                              {isOpen && (
                                <BookingPopup
                                  cell={cell}
                                  onClose={() => setActiveCell(null)}
                                  onViewManifest={() =>
                                    onOpenManifest?.(
                                      {
                                        productId: product.id,
                                        productName: product.name,
                                        date: cell.date,
                                        time: cell.time,
                                      },
                                      cell.orders,
                                    )
                                  }
                                />
                              )}
                            </div>
                          );
                        })
                      )}
                    </Table.Td>
                  );
                })}
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
    </div>
  );
};

const TimeslotRect: React.FC<TimeslotRectProps> = ({ rowKey, cell, onClick }) => {
  const [hovered, setHovered] = useState(false);
  const totalLabel = useMemo(
    () => formatPeopleLabel(cell.totalPeople, cell.menCount, cell.womenCount),
    [cell.totalPeople, cell.menCount, cell.womenCount],
  );

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onClick}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        background: hovered ? "#bdf9b8" : ROW_COLORS[rowKey] ?? ROW_COLORS.default,
        borderRadius: 6,
        margin: "6px",
        padding: "6px 10px",
        border: "1.5px solid #ef8625",
        borderBottom: `3px solid ${BORDER_BOTTOM_COLORS[rowKey] ?? BORDER_BOTTOM_COLORS.default}`,
        boxSizing: "border-box",
        minWidth: 80,
        cursor: "pointer",
        transition: "background 0.12s",
      }}
    >
      <Text size="sm" fw={700} c="#2B3137">
        {cell.time}
      </Text>
      <Text size="xs" c="#0f6d09" fw={500}>
        {totalLabel}
      </Text>
    </div>
  );
};
