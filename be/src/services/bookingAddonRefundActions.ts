import type Booking from '../models/Booking.js';
import { normalizeBookingExtrasSnapshot as normalizeExtras } from '../utils/bookingExtras.js';
import type { OrderExtras } from '../types/booking.js';

export type BookingAddonRefundActionRecord = Record<string, unknown> & {
  id: string;
  status: 'pending' | 'completed' | 'declined';
  addonKey: keyof OrderExtras;
  quantity: number;
};

export const normalizeBookingAddonRefundActions = (value: unknown): BookingAddonRefundActionRecord[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry): BookingAddonRefundActionRecord | null => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }
      const record = entry as Record<string, unknown>;
      const id = String(record.id ?? '').trim();
      const addonKey = String(record.addonKey ?? '').trim() as keyof OrderExtras;
      if (!id || !(['cocktails', 'tshirts', 'photos'] as string[]).includes(addonKey)) {
        return null;
      }
      const quantity = Math.max(0, Math.round(Number(record.quantity ?? 0) || 0));
      if (quantity <= 0) {
        return null;
      }
      const rawStatus = String(record.status ?? '').trim().toLowerCase();
      const status = rawStatus === 'completed' || rawStatus === 'declined' ? rawStatus : 'pending';
      return {
        ...record,
        id,
        status,
        addonKey,
        quantity,
      };
    })
    .filter((entry): entry is BookingAddonRefundActionRecord => entry !== null);
};

export const removeAddonFromBookingSnapshot = (
  booking: Booking,
  addonKey: keyof OrderExtras,
  quantity: number,
): number => {
  const requested = Math.max(0, Math.round(Number(quantity) || 0));
  if (requested <= 0) {
    return 0;
  }
  const snapshot =
    booking.addonsSnapshot && typeof booking.addonsSnapshot === 'object'
      ? { ...(booking.addonsSnapshot as Record<string, unknown>) }
      : {};
  const extras = normalizeExtras(snapshot);
  const current = Math.max(0, Math.round(Number(extras[addonKey]) || 0));
  const consumed = Math.min(current, requested);
  if (consumed <= 0) {
    return 0;
  }
  extras[addonKey] = Math.max(current - consumed, 0);
  snapshot.extras = extras;
  booking.addonsSnapshot = snapshot;
  return consumed;
};
