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
  productName?: string;
  variant?: "grid" | "calendar";
};

type CalendarWeek = (string | null)[];

const ROW_COLORS: Record<string, string> = {
  pub: "#ffe5cc",
  beer: "#e3ffe7",
  brunch: "#fffbe3",
  food: "#fffbe3",
  drawing: "#e3ffe7",
  cocktail: "#e3edff",
  default: "#f1f5fb",
};

const BORDER_ACCENT_COLORS: Record<string, string> = {
  pub: "#d97706",
  beer: "#0f766e",
  brunch: "#b45309",
  food: "#b45309",
  drawing: "#0f766e",
  cocktail: "#2563eb",
  default: "#94a3b8",
};

const COUNTABLE_STATUS_SET = new Set(["confirmed", "amended"]);
const isCountableStatus = (status?: string | null): boolean => {
  if (!status) {
    return false;
  }
  return COUNTABLE_STATUS_SET.has(status);
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

const matchesActiveCell = (active: ActiveCell, target: ManifestTarget): boolean => {
  if (!active) {
    return false;
  }
  return active.productId === target.productId && active.date === target.date && active.time === target.time;
};

const buildCalendarWeeks = (dates: string[]): CalendarWeek[] => {
  if (dates.length === 0) {
    return [];
  }

  const weeks: CalendarWeek[] = [];
  let currentWeek: (string | null)[] = [];

  const firstDate = new Date(dates[0]);
  const startPadding = (firstDate.getDay() + 6) % 7;
  for (let i = 0; i < startPadding; i += 1) {
    currentWeek.push(null);
  }

  dates.forEach((date) => {
    currentWeek.push(date);

    const cursor = new Date(date);
    const isoWeekday = (cursor.getDay() + 6) % 7;

    if (isoWeekday === 6) {
      while (currentWeek.length < 7) {
        currentWeek.push(null);
      }
      weeks.push(currentWeek);
      currentWeek = [];
    }
  });

  if (currentWeek.length > 0) {
    while (currentWeek.length < 7) {
      currentWeek.push(null);
    }
    weeks.push(currentWeek);
  }

  return weeks;
};

const MonthlyCalendar: React.FC<{
  weeks: CalendarWeek[];
  products: UnifiedProduct[];
  grid: BookingGrid;
  selectedDate: string;
  onSelectDate: (date: string) => void;
  activeCell: ActiveCell;
  onToggleCell: (target: ManifestTarget) => void;
  onCloseCell: () => void;
  onOpenManifest?: (target: ManifestTarget, orders: BookingCell["orders"]) => void;
}> = ({ weeks, products, grid, selectedDate, onSelectDate, activeCell, onToggleCell, onCloseCell, onOpenManifest }) => {
  if (weeks.length === 0) {
    return (
      <div
        style={{
          width: "100%",
          minHeight: 320,
          borderRadius: 12,
          border: "1px solid #e2e8f0",
          background: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text size="sm" c="dimmed">
          No dates available.
        </Text>
      </div>
    );
  }

  return (
    <Stack gap="lg">
      {weeks.map((week, index) => {
        const firstActiveDate = week.find((value): value is string => Boolean(value));
        const weekLabel = firstActiveDate
          ? (() => {
              const { day, month } = formatDateHeader(firstActiveDate);
              return `Week of ${month} ${day}`;
            })()
          : `Week ${index + 1}`;

        return (
          <Stack key={`week-${index}`} gap="sm">
            <Text size="sm" fw={600} c="dimmed">
              {weekLabel}
            </Text>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                gap: 12,
              }}
            >
              {week.map((date, dayIndex) => {
                if (!date) {
                  return (
                    <div
                      key={`empty-${index}-${dayIndex}`}
                      style={{
                        borderRadius: 12,
                        border: "1px dashed #e2e8f0",
                        minHeight: 120,
                        background: "#f8fafc",
                      }}
                    />
                  );
                }

                const { weekday, day, month } = formatDateHeader(date);
                const isSelected = date === selectedDate;

                const daySlots = products
                  .flatMap((product) => {
                    const rowKey = getRowKey(product.name ?? product.id);
                    const entries = grid[product.id]?.[date] ?? [];
                    return entries.map((cell) => ({
                      product,
                      rowKey,
                      cell,
                    }));
                  })
                  .sort((a, b) => (a.cell.time < b.cell.time ? -1 : a.cell.time > b.cell.time ? 1 : 0));

                return (
                  <div
                    key={date}
                    style={{
                      borderRadius: 12,
                      border: "1px solid #e2e8f0",
                      background: isSelected ? "#fff7eb" : "#ffffff",
                      padding: "12px 14px",
                      display: "flex",
                      flexDirection: "column",
                      gap: 10,
                      minHeight: 180,
                    }}
                  >
                      <div
                        onClick={() => onSelectDate(date)}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                        cursor: "pointer",
                        gap: 8,
                      }}
                    >
                      <div>
                        <Text size="xs" fw={600} c="dimmed">
                          {weekday.toUpperCase()}
                        </Text>
                        <Text size="lg" fw={700}>
                          {day}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {month}
                        </Text>
                      </div>
                      <Text size="xs" c="dimmed" fw={600}>
                        {(() => {
                          const countableBookings = daySlots.reduce(
                            (acc, entry) =>
                              acc +
                              entry.cell.orders.filter((order) => isCountableStatus(order.status)).length,
                            0,
                          );
                          if (countableBookings === 0) {
                            return "No bookings";
                          }
                          return countableBookings === 1 ? "1 booking" : `${countableBookings} bookings`;
                        })()}
                      </Text>
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {daySlots.length === 0 ? (
                        <Text size="xs" c="#94a3b8">
                          No bookings
                        </Text>
                      ) : (
                        daySlots.map(({ product, rowKey, cell }) => {
                          const target: ManifestTarget = {
                            productId: product.id,
                            productName: product.name,
                            date: cell.date,
                            time: cell.time,
                          };
                          const isOpen = matchesActiveCell(activeCell, target);

                          return (
                            <div key={`${product.id}-${cell.time}`} style={{ position: "relative" }}>
                              <TimeslotRect
                                rowKey={rowKey}
                                cell={cell}
                                onClick={() => {
                                  onSelectDate(date);
                                  onToggleCell(target);
                                }}
                                productName={product.name}
                                variant="calendar"
                              />
                              {isOpen && (
                                <BookingPopup
                                  cell={cell}
                                  onClose={onCloseCell}
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
                    </div>
                  </div>
                );
              })}
            </div>
          </Stack>
        );
      })}
    </Stack>
  );
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

  const calendarWeeks = useMemo(() => {
    if (viewMode !== "month") {
      return [];
    }
    return buildCalendarWeeks(dateRange);
  }, [dateRange, viewMode]);

  const toggleActiveCell = (target: ManifestTarget) => {
    setActiveCell((current) => (matchesActiveCell(current, target) ? null : target));
  };

  const closeActiveCell = () => {
    setActiveCell(null);
  };

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

  if (viewMode === "month") {
    return (
      <MonthlyCalendar
        weeks={calendarWeeks}
        products={sanitizedProducts}
        grid={grid}
        selectedDate={selectedDate}
        onSelectDate={onSelectDate}
        activeCell={activeCell}
        onToggleCell={toggleActiveCell}
        onCloseCell={closeActiveCell}
        onOpenManifest={onOpenManifest}
      />
    );
  }

  return (
    <div style={{ width: "100%", overflowX: "auto" }}>
      <div
        style={{
          width: "100%",
          background: "#fff",
          borderRadius: 8,
          boxShadow: "0 24px 40px rgba(15, 23, 42, 0.04)",
          border: "1px solid #e2e8f0",
          minHeight: 320,
        }}
      >
        <Table striped highlightOnHover withColumnBorders style={{ minWidth: 960 }}>
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
                      background: isActive ? "#fff0d6" : "#f5f6fa",
                      cursor: "pointer",
                      padding: "10px 12px",
                    }}
                  >
                    <Stack gap={2} align="center">
                      <Text size="sm" fw={600} c="#1f2937">
                        {weekday}
                      </Text>
                      <Text size="lg" fw={700}>
                        {day}
                      </Text>
                      <Text size="sm" c="#64748b">
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
                          minHeight: 96,
                          verticalAlign: "top",
                          padding: "6px 6px",
                        }}
                      >
                        {cells.length === 0 ? (
                          <div style={{ minHeight: 48 }} />
                        ) : (
                          cells.map((cell) => {
                            const target: ManifestTarget = {
                              productId: product.id,
                              productName: product.name,
                              date: cell.date,
                              time: cell.time,
                            };
                            const isOpen = matchesActiveCell(activeCell, target);

                            return (
                              <div key={`${cell.time}-${cell.date}`} style={{ position: "relative" }}>
                                <TimeslotRect
                                  rowKey={rowKey}
                                  cell={cell}
                                  onClick={() => toggleActiveCell(target)}
                                />
                                {isOpen && (
                                  <BookingPopup
                                    cell={cell}
                                    onClose={closeActiveCell}
                                    onViewManifest={() => onOpenManifest?.(target, cell.orders)}
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
    </div>
  );
};

const TimeslotRect: React.FC<TimeslotRectProps> = ({ rowKey, cell, onClick, productName, variant = "grid" }) => {
  const [hovered, setHovered] = useState(false);
  const totalLabel = useMemo(() => `${cell.totalPeople} booked`, [cell.totalPeople]);
  const genderLabel = useMemo(
    () =>
      variant === "calendar"
        ? `M: ${cell.menCount} / W: ${cell.womenCount}`
        : `Men: ${cell.menCount} | Women: ${cell.womenCount}`,
    [cell.menCount, cell.womenCount, variant],
  );
  const baseColor = ROW_COLORS[rowKey] ?? ROW_COLORS.default;
  const accentColor = BORDER_ACCENT_COLORS[rowKey] ?? BORDER_ACCENT_COLORS.default;
  const isCalendar = variant === "calendar";

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onClick}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: isCalendar ? 2 : 4,
        background: hovered ? "#ffffff" : baseColor,
        borderRadius: 12,
        borderLeft: `4px solid ${accentColor}`,
        borderRight: "1px solid rgba(148, 163, 184, 0.4)",
        borderTop: "1px solid rgba(148, 163, 184, 0.4)",
        borderBottom: "1px solid rgba(148, 163, 184, 0.4)",
        margin: isCalendar ? "4px 0" : "6px 4px",
        padding: isCalendar ? "8px 10px" : "10px 12px",
        minWidth: isCalendar ? "auto" : 120,
        width: "100%",
        minHeight: isCalendar ? 72 : 88,
        cursor: "pointer",
        boxShadow: hovered ? "0 12px 24px rgba(15, 23, 42, 0.18)" : "0 6px 18px rgba(15, 23, 42, 0.08)",
        transition: "transform 0.15s ease, box-shadow 0.15s ease, background 0.15s ease",
        transform: hovered ? "translateY(-3px)" : undefined,
      }}
    >
      <Text size="sm" fw={700} c="#1f2937">
        {cell.time}
      </Text>
      {isCalendar && productName && (
        <Text size="xs" fw={600} c="#1f2937">
          {productName}
        </Text>
      )}
      <Text size="xs" fw={600} c="#065f46">
        {totalLabel}
      </Text>
      <Text size="xs" c="#475569">
        {genderLabel}
      </Text>
    </div>
  );
};
