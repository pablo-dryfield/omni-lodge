import { UnifiedOrder } from '../store/bookingPlatformsTypes';

// Example UnifiedOrder type for reference (adapt if needed):
// export type UnifiedOrder = {
//   id: string;
//   productId: string;
//   productName: string;
//   date: string; // YYYY-MM-DD
//   timeslot: string; // e.g. "21:00"
//   quantity: number;
//   customerName?: string;
//   platform: string;
//   rawData: any;
// };

export function ecwidOrdersToUnifiedOrders(rawOrders: any[]): UnifiedOrder[] {
  return rawOrders.flatMap(order =>
    order.items.map((item: any) => {
      // Extract date from order.createDate (YYYY-MM-DD)
      const dateObj = new Date(order.createDate.replace(' +0000', '').replace(' ', 'T'));
      const date = dateObj.toISOString().slice(0, 10);

      // Timeslot is now directly in item.time
      const timeslot = item.time || "21:00";

      return {
        id: String(order.id),
        productId: String(item.productId),
        productName: item.name,
        date,
        timeslot,
        quantity: item.quantity,
        customerName: '', // (Can add customer if you include it in the dummy)
        platform: "ecwid",
        rawData: order,
      };
    })
  );
}
