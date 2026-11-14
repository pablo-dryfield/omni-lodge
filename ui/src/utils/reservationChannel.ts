import type { UnifiedOrder } from '../store/bookingPlatformsTypes';
import type { WalkInChannelState } from '../components/counters/WalkInsPanel';

/** A booking's persisted Channel is authoritative; platform names are a legacy fallback. */
export function reservationChannelId(order: Pick<UnifiedOrder, 'rawData' | 'platform'>, fallback: ReadonlyMap<string, number>): number | undefined {
  const id = Number(order.rawData?.channelId);
  return Number.isSafeInteger(id) && id > 0 ? id : fallback.get(String(order.platform || '').toLowerCase().replace(/[^a-z0-9]+/g, ''));
}
export function partnerCashOnArrival(order: Pick<UnifiedOrder, 'rawData' | 'platform' | 'paymentStatus'>): boolean {
  return String(order.platform).toLowerCase() === 'omnilodge'
    && String(order.rawData?.paymentMethod || '').toLowerCase() === 'cash'
    && !['paid', 'refunded', 'partial', 'partially_refunded'].includes(String(order.paymentStatus || order.rawData?.paymentStatus || ''));
}
export function walkInReservationBaseline(state: WalkInChannelState | undefined, cocktailAddonIds: number[]) {
  let total = 0;
  const addons = new Map<number, number>();
  for (const [key, ticket] of Object.entries(state?.tickets || {})) {
    if (key.startsWith('booking-cash:')) continue;
    for (const entry of Object.values(ticket.currencies)) {
      total += Math.max(0, Number(entry.people) || 0);
      for (const [id, quantity] of Object.entries(entry.addons)) addons.set(Number(id), (addons.get(Number(id)) || 0) + Math.max(0, Number(quantity) || 0));
    }
  }
  return { people: Math.max(0, total - cocktailAddonIds.reduce((sum, id) => sum + (addons.get(id) || 0), 0)), addons };
}
