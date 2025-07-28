import { UnifiedProduct, UnifiedOrder } from '../store/bookingPlatformsTypes';

export type BookingCell = {
  time: string;
  date: string;
  productId: string;
  productName: string;
  bookingCount: number;
};

export function prepareBookingGrid(
  products: UnifiedProduct[],
  orders: UnifiedOrder[],
  dateRange: string[]
): { [productId: string]: { [date: string]: BookingCell[] } } {
  const grid: { [productId: string]: { [date: string]: BookingCell[] } } = {};
  products.forEach(product => {
    grid[product.id] = {};
    dateRange.forEach(date => { grid[product.id][date] = []; });
  });
  orders.forEach(order => {
    if (!grid[order.productId] || !grid[order.productId][order.date]) return;
    let cell = grid[order.productId][order.date].find(c => c.time === order.timeslot);
    if (!cell) {
      cell = {
        time: order.timeslot,
        date: order.date,
        productId: order.productId,
        productName: order.productName,
        bookingCount: 0,
      };
      grid[order.productId][order.date].push(cell);
    }
    cell.bookingCount += order.quantity;
  });
  return grid;
}
