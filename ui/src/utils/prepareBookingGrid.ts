import { UnifiedProduct, UnifiedOrder } from '../store/bookingPlatformsTypes';

export type BookingCell = {
  time: string;
  date: string;
  productId: string;
  productName: string;
  totalPeople: number;
  menCount: number;
  womenCount: number;
  orders: UnifiedOrder[];
};

export type BookingGrid = Record<string, Record<string, BookingCell[]>>;

const ensureProductDates = (
  grid: BookingGrid,
  productId: string,
  dateRange: string[],
): void => {
  if (!grid[productId]) {
    grid[productId] = {};
  }

  dateRange.forEach((date) => {
    if (!grid[productId][date]) {
      grid[productId][date] = [];
    }
  });
};

const sortTimeslots = (grid: BookingGrid): void => {
  Object.values(grid).forEach((dateMap) => {
    Object.values(dateMap).forEach((cells) => {
      cells.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
    });
  });
};

export function prepareBookingGrid(
  products: UnifiedProduct[],
  orders: UnifiedOrder[],
  dateRange: string[],
): BookingGrid {
  const grid: BookingGrid = {};

  products.forEach((product) => {
    ensureProductDates(grid, product.id, dateRange);
  });

  orders.forEach((order) => {
    if (!dateRange.includes(order.date)) {
      return;
    }

    ensureProductDates(grid, order.productId, dateRange);

    const dateCells = grid[order.productId][order.date];
    let cell = dateCells.find((entry) => entry.time === order.timeslot);

    if (!cell) {
      cell = {
        time: order.timeslot,
        date: order.date,
        productId: order.productId,
        productName: order.productName,
        totalPeople: 0,
        menCount: 0,
        womenCount: 0,
        orders: [],
      };
      dateCells.push(cell);
    }

    cell.totalPeople += order.quantity;
    cell.menCount += order.menCount;
    cell.womenCount += order.womenCount;
    cell.orders.push(order);
  });

  sortTimeslots(grid);

  return grid;
}
