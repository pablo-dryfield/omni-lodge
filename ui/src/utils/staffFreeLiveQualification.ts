import type { StaffFreeOverview, StaffFreePerson } from '../api/staffFreeEntries';
import type { WalkInChannelState } from '../components/counters/WalkInsPanel';
import type { UnifiedOrder } from '../store/bookingPlatformsTypes';

export type StaffFreeQualification = NonNullable<StaffFreeOverview['qualification']>;
export type StaffFreeLiveAttendance = {
  reservationOrders: readonly UnifiedOrder[] | null;
  walkIns: Record<number, WalkInChannelState>;
  freePeople: Record<number, { qty: number }>;
};

const amount = (value: unknown): number | null => value == null || value === '' || !Number.isFinite(Number(value)) || Number(value) < 0 ? null : Number(value);
const count = (value: unknown) => Math.max(0, Math.floor(Number(value) || 0));
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const includedStatuses = new Set(['pending', 'confirmed', 'amended', 'completed', 'rebooked', 'no_show']);

/** Match bookingBaseTicketTotal on the server, using the manifest already loaded by Reservation Check. */
function bookingBaseTotal(order: UnifiedOrder): number | null {
  const raw = object(order.rawData);
  const gross = amount(raw.priceGross);
  if (gross === null) return null;
  let addons = amount(raw.addonsAmount);
  if (addons === null) {
    const snapshot = object(raw.addonsSnapshot);
    const rows = snapshot.addons;
    if (Array.isArray(rows) && rows.length) {
      addons = 0;
      for (const value of rows) {
        const row = object(value);
        if (row.isIncluded === true) continue;
        const total = amount(row.totalPrice ?? row.total), unit = amount(row.unitPrice);
        if (total !== null) addons += total;
        else if (unit !== null) addons += unit * count(row.quantity);
        else return null;
      }
    } else {
      if (Object.values(object(snapshot.extras)).some(qty => count(qty) > 0) || Object.values(order.extras ?? {}).some(qty => count(qty) > 0)) return null;
      addons = 0;
    }
  }
  return Math.max(0, gross - (amount(raw.discountAmount) ?? 0) - addons - (amount(raw.tipAmount) ?? 0) - (amount(raw.refundedAmount) ?? 0));
}

/** A pure preview: never saves attendance or requests a server verification. */
export function getLiveStaffFreeQualification(
  attendance: StaffFreeLiveAttendance,
  normalPrices: Record<string, number>,
  minimumPercent: number,
): StaffFreeQualification | null {
  if (attendance.reservationOrders === null) return null;
  const result: StaffFreeQualification = { count: 0, totalCustomers: 0, free: 0, belowMinimum: 0, unpriced: 0, normalPrices, minimumPercent };
  const add = (attended: number, party: number, currency: string, base: number | null) => {
    if (attended <= 0) return;
    result.totalCustomers += attended;
    if (base === 0) { result.free += attended; return; }
    const normal = amount(normalPrices[currency]);
    if (base === null || normal === null || normal <= 0 || party <= 0) { result.unpriced += attended; return; }
    // Currency minor units; exactly the configured minimum (normally half price) qualifies.
    if (Math.round(base * 100) * 100 >= Math.round(normal * 100) * minimumPercent * party) result.count += attended;
    else result.belowMinimum += attended;
  };
  const seen = new Set<string>();
  attendance.reservationOrders.forEach(order => {
    if (!includedStatuses.has(order.status)) return;
    const raw = object(order.rawData);
    const id = raw.bookingId != null ? `booking:${raw.bookingId}` : `${order.platform}:${order.id}`;
    if (seen.has(id)) return;
    seen.add(id);
    const party = count(order.quantity);
    add(Math.min(party, count(order.attendedTotal)), party, String(raw.currency ?? ''), bookingBaseTotal(order));
  });
  Object.values(attendance.walkIns).forEach(channel => channel.ticketOrder.forEach(key => {
    // Cash collected for a reservation does not represent another customer.
    if (key.startsWith('booking-cash:')) return;
    const ticket = channel.tickets[key];
    ticket?.currencyOrder.forEach(currency => {
      const row = ticket.currencies[currency];
      if (!row) return;
      let addonsTotal = 0, unknownAddon = false;
      Object.entries(row.addons).forEach(([id, qty]) => {
        const quantity = count(qty);
        if (!quantity) return;
        const price = amount(row.addonUnitPrices?.[Number(id)]);
        if (price === null) unknownAddon = true;
        else addonsTotal += quantity * price;
      });
      const total = amount(row.cash), people = count(row.people);
      add(people, people, currency, total === null || unknownAddon ? null : Math.max(0, total - addonsTotal));
    });
  }));
  Object.values(attendance.freePeople).forEach(entry => add(count(entry.qty), count(entry.qty), '', 0));
  return result;
}

/** Re-evaluate attendance-dependent eligibility while retaining server-loaded identity restrictions. */
export function getLiveStaffFreeDecision(person: StaffFreePerson, checkedIn: number, policy: StaffFreeOverview['policy']): StaffFreePerson['decision'] {
  if (person.onShift || (!person.decision.allowed && !person.decision.canOverride)) return person.decision;
  if (person.unlimited) return person.decision;
  if (checkedIn >= policy.busyThreshold) return { allowed: true, benefit: 'busy_night', canOverride: false, message: `${checkedIn} qualifying customers already checked in. This visit will not use the allowance.` };
  if (person.used < policy.allowance) return { allowed: true, benefit: 'allowance', canOverride: false, message: `Uses one free crawl. ${Math.max(0, policy.allowance - person.used - 1)} will remain.` };
  return { allowed: false, benefit: null, canOverride: true, message: `Lifetime allowance used. Wait until ${policy.busyThreshold} qualifying customers are checked in, or record an override with a reason.` };
}
