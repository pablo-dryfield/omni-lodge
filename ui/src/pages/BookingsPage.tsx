import React, { useMemo, useState } from "react";
import { BookingsGrid } from "../components/BookingsGrid";
import { prepareBookingGrid } from "../utils/prepareBookingGrid";
import { ecwidOrdersToUnifiedOrders } from "../dummy/fromEcwidOrder";
import { ecwidDummyOrders } from '../dummy/ecwidDummyOrders';

// Dummy product data
const dummyProducts = [
  { id: "p1", name: "Krakow Pub Crawl", platform: "ecwid" },
  { id: "p2", name: "Krakow Beer Tastings Tour", platform: "ecwid" },
  { id: "p3", name: "Krakow Brewery Tour", platform: "ecwid" },
  { id: "p4", name: "Krakow Food Tour", platform: "ecwid" },
  { id: "p5", name: "Bottomless Brunch", platform: "ecwid" },
  { id: "p6", name: "Life Drawing", platform: "ecwid" },
  { id: "p7", name: "Premium Cocktail Hour", platform: "ecwid" },
];

// Utils
function formatISO(date: Date) {
  return date.toISOString().slice(0, 10);
}
function getDateRange(start: string, days: number): string[] {
  const arr: string[] = [];
  let d = new Date(start);
  for (let i = 0; i < days; i++) {
    arr.push(formatISO(d));
    d.setDate(d.getDate() + 1);
  }
  return arr;
}
// Get Monday as week start
function getMonday(d: Date) {
  d = new Date(d);
  const day = d.getDay();
  // JS: Sunday = 0, Monday = 1, ..., Saturday = 6
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // adjust when day is Sunday
  d.setDate(diff);
  return d;
}
function todayInISO() {
  return new Date().toISOString().slice(0, 10);
}

const BookingsPage = () => {
  const todayISO = todayInISO();
  // State for the selected date (for mobile)
  const [startDate, setStartDate] = useState(todayISO);
  // State for week start (Monday)
  const [weekStart, setWeekStart] = useState(() => formatISO(getMonday(new Date())));

  // Date range = current week
  const dateRange = useMemo(() => getDateRange(weekStart, 7), [weekStart]);

  // Orders and grid prep
  const dummyOrders = useMemo(
    () => ecwidOrdersToUnifiedOrders(ecwidDummyOrders),
    []
  );
  const grid = useMemo(
    () => prepareBookingGrid(dummyProducts, dummyOrders, dateRange),
    [dummyProducts, dummyOrders, dateRange]
  );

  // "Today" = reset week and active date
  const goToToday = () => {
    const today = new Date();
    setStartDate(formatISO(today));
    setWeekStart(formatISO(getMonday(today)));
  };

  return (
    <div
      style={{
        width: "100%",
        background: "#f4f6fa",
        padding: 0,
        margin: 0,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: "100%",
          background: "#fff",
          borderRadius: 0,
          padding: 0,
          margin: 0,
          overflow: "hidden",
          cursor: "default",
          userSelect: "none",
          outline: "none"
        }}
      >
        <BookingsGrid
          products={dummyProducts}
          dateRange={dateRange}
          grid={grid}
          startDate={startDate}
          setStartDate={setStartDate}
          weekStart={weekStart}
          setWeekStart={setWeekStart}
          goToToday={goToToday}
        />
      </div>
    </div>
  );
};

export default BookingsPage;
