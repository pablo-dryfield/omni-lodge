import dayjs from 'dayjs';
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

const COUNTABLE_STATUSES = new Set<UnifiedOrder['status']>(['confirmed', 'amended']);
const isCountableStatus = (order: UnifiedOrder): boolean => COUNTABLE_STATUSES.has(order.status);

const normalizeCount = (value?: number): number => {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 0;
  }
  return value;
};

const resolveDisplayTime = (order: UnifiedOrder): string => {
  if (order.pickupDateTime) {
    const parsed = dayjs(order.pickupDateTime);
    if (parsed.isValid()) {
      return parsed.format('HH:mm');
    }
  }

  if (order.timeslot && order.timeslot.trim()) {
    return order.timeslot;
  }

  return '--:--';
};

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

    const displayTime = resolveDisplayTime(order);
    const dateCells = grid[order.productId][order.date];
    let cell = dateCells.find((entry) => entry.time === displayTime);

    if (!cell) {
      cell = {
        time: displayTime,
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

    const menBase = normalizeCount(order.menCount);
    const womenBase = normalizeCount(order.womenCount);
    const menCount = isCountableStatus(order) ? menBase : 0;
    const womenCount = isCountableStatus(order) ? womenBase : 0;

    cell.totalPeople += menCount + womenCount;
    cell.menCount += menCount;
    cell.womenCount += womenCount;
    cell.orders.push({ ...order, timeslot: displayTime });
  });

  sortTimeslots(grid);

  return grid;
}
