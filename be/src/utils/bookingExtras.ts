import type { OrderExtras } from '../types/booking.js';

const EMPTY_BOOKING_EXTRAS: Readonly<OrderExtras> = {
  tshirts: 0,
  cocktails: 0,
  photos: 0,
};

const createEmptyBookingExtras = (): OrderExtras => ({ ...EMPTY_BOOKING_EXTRAS });

/**
 * Normalizes the two add-on snapshot shapes currently stored on bookings:
 * legacy/channel bookings use `extras`, while storefront bookings use `addons[]`.
 */
export const normalizeBookingExtrasSnapshot = (snapshot: unknown): OrderExtras => {
  if (!snapshot || typeof snapshot !== 'object') {
    return createEmptyBookingExtras();
  }

  const extras = (snapshot as { extras?: Partial<OrderExtras> }).extras;
  if (extras && typeof extras === 'object') {
    return {
      tshirts: Number(extras.tshirts) || 0,
      cocktails: Number(extras.cocktails) || 0,
      photos: Number(extras.photos) || 0,
    };
  }

  const normalized = createEmptyBookingExtras();
  const addons = (snapshot as { addons?: unknown }).addons;
  if (!Array.isArray(addons)) {
    return normalized;
  }

  addons.forEach((addon) => {
    if (!addon || typeof addon !== 'object') {
      return;
    }

    const record = addon as Record<string, unknown>;
    const quantity = Math.max(0, Math.round(Number(record.quantity) || 0));
    if (quantity <= 0) {
      return;
    }

    const keyParts = [record.category, record.label, record.name, record.key]
      .map((value) => String(value ?? '').toLowerCase())
      .join(' ');
    if (keyParts.includes('cocktail') || keyParts.includes('drink')) {
      normalized.cocktails += quantity;
      return;
    }
    if (keyParts.includes('shirt')) {
      normalized.tshirts += quantity;
      return;
    }
    if (keyParts.includes('photo')) {
      normalized.photos += quantity;
    }
  });

  return normalized;
};
