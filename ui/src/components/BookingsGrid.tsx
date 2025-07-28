import React, { useMemo, useState } from "react";
import { Table, Button, ActionIcon, Group } from "@mantine/core";
import { ChevronLeft, ChevronRight, Lock, Phone } from "lucide-react";
import { useMediaQuery } from "@mantine/hooks";
import { UnifiedProduct } from "../store/bookingPlatformsTypes";
import { BookingCell } from "../utils/prepareBookingGrid";
import { MobileBookingsList } from "./MobileBookingsList";
import { BookingPopup } from "./BookingPopup";

const ROW_COLORS: Record<string, string> = {
  pub: "#ffe5cc",
  beer: "#e3ffe7",
  brunch: "#fffbe3",
  food: "#fffbe3",
  drawing: "#e3ffe7",
  cocktail: "#e3edff",
  default: "#f1f5fb"
};

const BORDER_BOTTOM_COLORS: Record<string, string> = {
  pub: "#bf6d17",
  beer: "#20643e",
  brunch: "#b89b44",
  food: "#b89b44",
  drawing: "#20643e",
  cocktail: "#276eae",
  default: "#bbb"
};

const ICONS: Record<string, JSX.Element> = {
  pub: <Lock size={13} fill="#5a6672" strokeWidth={0} style={{ marginRight: 3, color: "#5a6672", verticalAlign: "middle" }} />,
  beer: <Phone size={13} fill="#5a6672" strokeWidth={0} style={{ marginRight: 3, color: "#5a6672", verticalAlign: "middle" }} />,
  brunch: <Lock size={13} fill="#5a6672" strokeWidth={0} style={{ marginRight: 3, color: "#5a6672", verticalAlign: "middle" }} />,
  food: <Lock size={13} fill="#5a6672" strokeWidth={0} style={{ marginRight: 3, color: "#5a6672", verticalAlign: "middle" }} />,
  drawing: <Phone size={13} fill="#5a6672" strokeWidth={0} style={{ marginRight: 3, color: "#5a6672", verticalAlign: "middle" }} />,
  cocktail: <Lock size={13} fill="#5a6672" strokeWidth={0} style={{ marginRight: 3, color: "#5a6672", verticalAlign: "middle" }} />,
  default: <Lock size={13} fill="#5a6672" strokeWidth={0} style={{ marginRight: 3, color: "#5a6672", verticalAlign: "middle" }} />
};

function getRowKey(name: string): string {
  name = name.toLowerCase();
  if (name.includes("pub crawl")) return "pub";
  if (name.includes("beer")) return "beer";
  if (name.includes("brunch")) return "brunch";
  if (name.includes("food")) return "food";
  if (name.includes("drawing")) return "drawing";
  if (name.includes("cocktail")) return "cocktail";
  return "default";
}
function isSameDay(a: string, b: string) {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

type Props = {
  products: UnifiedProduct[];
  dateRange: string[];
  grid: { [productId: string]: { [date: string]: BookingCell[] } };
  startDate: string;
  setStartDate: (date: string) => void;
  weekStart: string;
  setWeekStart: (date: string) => void;
  goToToday: () => void;
};

export const BookingsGrid: React.FC<Props> = ({
  products,
  dateRange,
  grid,
  startDate,
  setStartDate,
  weekStart,
  setWeekStart,
  goToToday,
}) => {
  const todayISO = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const isMobile = useMediaQuery("(max-width: 900px)");
  const [openPopup, setOpenPopup] = useState<{
    productId: string;
    date: string;
    time: string;
  } | null>(null);
  
  const handleTimeslotClick = (productId: string, date: string, time: string) => {
    // If already open, close it. Else, open it for this cell.
    if (openPopup &&
        openPopup.productId === productId &&
        openPopup.date === date &&
        openPopup.time === time) {
      setOpenPopup(null);
    } else {
      setOpenPopup({ productId, date, time });
    }
  };

  // --- MOBILE ---
  if (isMobile) {
    return (
      <MobileBookingsList
        products={products}
        dateRange={dateRange}
        grid={grid}
        startDate={startDate}
        setStartDate={setStartDate}
        weekStart={weekStart}
        setWeekStart={setWeekStart}
        goToToday={goToToday}
      />
    );
  }

  // --- DESKTOP ---
  const shiftWeek = (days: number) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + days);
    setWeekStart(d.toISOString().slice(0, 10));
  };

  const CURRENT_DAY_BG = "#FFF6DF";

  return (
    <div style={{
      width: "100%",
      background: "none",
      margin: 0,
      padding: 0,
      borderRadius: 0,
      boxShadow: "none"
    }}>
      {/* Toolbar */}
      <div style={{
        display: "flex",
        justifyContent: "flex-end",
        marginBottom: 8,
        marginRight: 8,
      }}>
        <Group gap={2}>
          <ActionIcon
            variant="subtle"
            onClick={() => shiftWeek(-7)}
            style={{ border: "1px solid #ddd", background: "#fff" }}
          >
            <ChevronLeft size={19} />
          </ActionIcon>
          <Button
            size="xs"
            variant="default"
            style={{
              fontWeight: 700,
              border: "1.5px solid #f9eebe",
              color: "#111",
              minWidth: 60
            }}
            onClick={goToToday}
          >
            Today
          </Button>
          <ActionIcon
            variant="subtle"
            onClick={() => shiftWeek(7)}
            style={{ border: "1px solid #ddd", background: "#fff" }}
          >
            <ChevronRight size={19} />
          </ActionIcon>
        </Group>
      </div>
      {/* Table */}
      <div style={{ width: "100%", background: "none", margin: 0, padding: 0 }}>
        <Table
          style={{
            width: "100%",
            fontSize: 13,
            borderCollapse: "collapse",
            tableLayout: "fixed",
            background: "none"
          }}
          withColumnBorders={false}
          withRowBorders={false}
        >
          <thead>
            <tr>
              <th style={{
                width: 210,
                minWidth: 210,
                padding: 0,
                background: "#fff",
                borderBottom: "2px solid #babfc4",
                borderRight: "1.5px solid #d2d4d6"
              }}></th>
              {dateRange.map((date, idx) => {
                const isToday = isSameDay(date, todayISO);
                return (
                  <th
                    key={date}
                    style={{
                      fontWeight: 700,
                      fontSize: 12,
                      textAlign: "center",
                      minWidth: 98,
                      maxWidth: 124,
                      height: 36,
                      letterSpacing: "0.13px",
                      background: isToday ? CURRENT_DAY_BG : "#fff",
                      borderBottom: "2px solid #babfc4",
                      borderRight: idx < dateRange.length - 1 ? "1.5px solid #d2d4d6" : undefined,
                      borderTop: isToday ? "2.5px solid #ffe388" : undefined,
                      color: "#222",
                      padding: 0,
                      fontFamily: "Roboto,-apple-system,BlinkMacSystemFont,Segoe UI,Oxygen,Ubuntu,Cantarell,Fira Sans,Droid Sans,Helvetica Neue,sans-serif",
                      cursor: "default" // Not clickable!
                    }}
                  >
                    <div style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      height: 33,
                      width: "100%"
                    }}>
                      {new Date(date).toLocaleDateString(undefined, {
                        weekday: "short",
                        day: "2-digit",
                        month: "2-digit"
                      })}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {products.map((product, rowIdx) => {
              const rowKey = getRowKey(product.name);
              return (
                <tr key={product.id} style={{ height: 38 }}>
                  <td
                    style={{
                      padding: "0 10px 0 0",
                      fontWeight: 600,
                      fontSize: 13,
                      color: "#111",
                      borderRight: "1.5px solid #d2d4d6",
                      borderBottom: rowIdx < products.length - 1 ? "1px solid #ececec" : undefined,
                      textAlign: "right",
                      background: "#fff",
                      height: 38,
                      verticalAlign: "middle",
                      letterSpacing: ".01em",
                      lineHeight: "1.2",
                      fontFamily: "Roboto,-apple-system,BlinkMacSystemFont,Segoe UI,Oxygen,Ubuntu,Cantarell,Fira Sans,Droid Sans,Helvetica Neue,sans-serif",
                    }}
                  >
                    {product.name}
                  </td>
                  {dateRange.map((date, colIdx) => {
                    const isToday = isSameDay(date, todayISO);
                    return (
                      <td
                        key={date}
                        style={{
                          padding: 0,
                          background: isToday ? CURRENT_DAY_BG : "#fff",
                          minWidth: 98,
                          maxWidth: 124,
                          borderRight: colIdx < dateRange.length - 1 ? "1.5px solid #d2d4d6" : undefined,
                          borderBottom: rowIdx < products.length - 1 ? "1px solid #ececec" : undefined,
                          height: 38,
                          verticalAlign: "middle"
                        }}
                      >
                        {/* --- Timeslot Cell --- */}
                        {grid[product.id][date].length === 0 ? (
                          <></>
                        ) : (
                          grid[product.id][date].map((cell, cellIdx) => (
                            <div style={{ position: "relative" }} key={cell.time + cellIdx}>
                              <TimeslotRect
                                rowKey={rowKey}
                                cell={cell}
                                onClick={() => handleTimeslotClick(product.id, date, cell.time)}
                              />
                              {openPopup &&
                                openPopup.productId === product.id &&
                                openPopup.date === date &&
                                openPopup.time === cell.time && (
                                  <BookingPopup
                                    // Pass any props needed for the popup content
                                    cell={cell}
                                    // ...other props
                                    onClose={() => setOpenPopup(null)}
                                  />
                                )}
                            </div>
                          ))
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </Table>
      </div>
    </div>
  );
};

// --- Subcomponent for the hoverable timeslot rectangle ---

type TimeslotRectProps = {
  rowKey: string;
  cell: BookingCell;
  onClick?: () => void;  
};

const TimeslotRect: React.FC<TimeslotRectProps> = ({ rowKey, cell, onClick }) => {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onClick}  // <-- Pass the handler here
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        background: hovered ? "#bdf9b8" : ROW_COLORS[rowKey],
        borderRadius: 5,
        margin: "6px 6px 6px 6px",
        padding: "2.5px 10px 2.5px 8px",
        minHeight: 26,
        minWidth: 51,
        border: "1px solid #ef8625",
        borderBottom: `3.5px solid #d3b69a`,
        boxSizing: "border-box",
        cursor: "pointer",
        transition: "background 0.12s"
      }}
    >
      {/* Icon + time */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 2,
        fontSize: 13,
        fontWeight: 700,
        color: "#42913d",
      }}>
        {ICONS[rowKey]}
        <span style={{
          fontWeight: 600,
          fontSize: 13,
          fontFamily: "Roboto,-apple-system,BlinkMacSystemFont,Segoe UI,Oxygen,Ubuntu,Cantarell,Fira Sans,Droid Sans,Helvetica Neue,sans-serif",
          color: "#42913d",
          lineHeight: "1.12",
          letterSpacing: "-0.3px",
        }}>
          {cell.time}
        </span>
      </div>
      {/* Booking count row: square + number */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        marginLeft: 1,
        marginTop: 1
      }}>
        <span
          style={{
            display: "inline-block",
            width: 10,
            height: 10,
            border: `1.5px solid #0f6d09`,
            borderRadius: 3,
            marginRight: 3,
            background: "transparent"
          }}
        />
        <span style={{
          fontSize: 11,
          color: "#0f6d09",
          fontWeight: 400,
          letterSpacing: "0.13px",
          lineHeight: "1.2",
          fontFamily: "Roboto,-apple-system,BlinkMacSystemFont,Segoe UI,Oxygen,Ubuntu,Cantarell,Fira Sans,Droid Sans,Helvetica Neue,sans-serif",
        }}>
          {cell.bookingCount}
        </span>
      </div>
    </div>
  );
};