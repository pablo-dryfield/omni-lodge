import type { OrderExtras } from '../types/booking.js';

const EMPTY_BOOKING_EXTRAS: Readonly<OrderExtras> = {
  tshirts: 0,
  cocktails: 0,
  photos: 0,
};

const createEmptyBookingExtras = (): OrderExtras => ({ ...EMPTY_BOOKING_EXTRAS });

const addonIdentity = (addon: Record<string, unknown>): string =>
  [addon.category, addon.label, addon.name, addon.key]
    .map((value) => String(value ?? '').toLowerCase())
    .join(' ');

const isTshirtAddon = (addon: Record<string, unknown>): boolean =>
  addonIdentity(addon).includes('shirt');

const normalizeTshirtSize = (value: unknown): string | null => {
  const size = String(value ?? '').trim().toUpperCase();
  if (!size || ['TRUE', 'FALSE', 'YES', 'NO', '1', '0'].includes(size)) {
    return null;
  }
  return size;
};

/**
 * Extracts the T-shirt sizes selected during storefront checkout. This is kept
 * separate from attended T-shirt sizes, which are assigned later at check-in.
 */
export const normalizeBookingTshirtSizeSnapshot = (snapshot: unknown): Record<string, number> => {
  const addons = Array.isArray(snapshot)
    ? snapshot
    : snapshot && typeof snapshot === 'object'
      ? (snapshot as { addons?: unknown }).addons
      : null;
  if (!Array.isArray(addons)) {
    return {};
  }

  const normalized = new Map<string, number>();
  addons.forEach((addon) => {
    if (!addon || typeof addon !== 'object' || !isTshirtAddon(addon as Record<string, unknown>)) {
      return;
    }

    const record = addon as Record<string, unknown>;
    const variants = Array.isArray(record.variants) ? record.variants : [];
    variants.forEach((variant) => {
      if (!variant || typeof variant !== 'object' || Array.isArray(variant)) {
        return;
      }
      const variantRecord = variant as Record<string, unknown>;
      const size = normalizeTshirtSize(variantRecord.value);
      const quantity = Number(variantRecord.quantity);
      if (!size || !Number.isInteger(quantity) || quantity <= 0) {
        return;
      }
      normalized.set(size, (normalized.get(size) ?? 0) + quantity);
    });

    // Older storefront snapshots stored a single selected value on the add-on.
    if (variants.length === 0) {
      const size = normalizeTshirtSize(record.value);
      const quantity = Number(record.quantity);
      if (size && Number.isInteger(quantity) && quantity > 0) {
        normalized.set(size, (normalized.get(size) ?? 0) + quantity);
      }
    }
  });

  return Object.fromEntries(normalized);
};

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

    const keyParts = addonIdentity(record);
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
