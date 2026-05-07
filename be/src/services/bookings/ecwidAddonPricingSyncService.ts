import Booking from '../../models/Booking.js';
import BookingAddon from '../../models/BookingAddon.js';
import { getEcwidOrder, type EcwidOrderItem, type EcwidOption } from '../ecwidService.js';
import logger from '../../utils/logger.js';

type EcwidAddonCategory = 'cocktails' | 'tshirts' | 'photos';

const stripEcwidItemSuffix = (value: string): string => value.replace(/-\d+$/, '');

const normalizeCurrency = (value: string | null | undefined): string | null => {
  const normalized = String(value ?? '').trim().toUpperCase();
  return normalized.length > 0 ? normalized.slice(0, 3) : null;
};

const normalizeLabel = (value: unknown): string => String(value ?? '').trim().toLowerCase();

const resolveAddonCategoryFromText = (value: unknown): EcwidAddonCategory | null => {
  const normalized = normalizeLabel(value);
  if (!normalized) {
    return null;
  }
  if (
    normalized.includes('cocktail') ||
    normalized.includes('cocktails') ||
    normalized.includes('drink') ||
    normalized.includes('drinks')
  ) {
    return 'cocktails';
  }
  if (normalized.includes('shirt') || normalized.includes('t-shirt') || normalized.includes('tee')) {
    return 'tshirts';
  }
  if (normalized.includes('photo') || normalized.includes('photos')) {
    return 'photos';
  }
  return null;
};

const parseNumericValue = (value: unknown): number | null => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== 'string') {
    return null;
  }
  const compact = value.replace(/\u00a0/g, ' ').replace(/\s+/g, '').trim();
  if (!compact) {
    return null;
  }
  const normalized = compact.replace(/,/g, '.');
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const resolveModifierFromOption = (option: EcwidOption): number | null => {
  const source = option as Record<string, unknown>;
  const directCandidates = [
    source.selectionModifier,
    source.modifier,
    source.priceModifier,
    source.amount,
  ];
  for (const candidate of directCandidates) {
    const parsed = parseNumericValue(candidate);
    if (parsed !== null && Number.isFinite(parsed)) {
      return Math.abs(parsed);
    }
  }

  const selections = Array.isArray(option.selections) ? option.selections : [];
  for (const selection of selections) {
    const selectionSource = selection as Record<string, unknown>;
    const selectionCandidates = [
      selectionSource.selectionModifier,
      selectionSource.modifier,
      selectionSource.priceModifier,
      selectionSource.amount,
    ];
    for (const candidate of selectionCandidates) {
      const parsed = parseNumericValue(candidate);
      if (parsed !== null && Number.isFinite(parsed)) {
        return Math.abs(parsed);
      }
    }
  }

  return null;
};

const getItemOptions = (item: EcwidOrderItem): EcwidOption[] => {
  if (Array.isArray(item.selectedOptions) && item.selectedOptions.length > 0) {
    return item.selectedOptions.filter(Boolean);
  }
  if (Array.isArray(item.options) && item.options.length > 0) {
    return item.options.filter(Boolean);
  }
  return [];
};

const resolveCategoryFromOption = (option: EcwidOption): EcwidAddonCategory | null => {
  const optionCategory =
    resolveAddonCategoryFromText(option.name) ??
    resolveAddonCategoryFromText(option.value) ??
    resolveAddonCategoryFromText(option.selectionTitle);
  if (optionCategory) {
    return optionCategory;
  }

  const selections = Array.isArray(option.selections) ? option.selections : [];
  for (const selection of selections) {
    const category =
      resolveAddonCategoryFromText(selection.name) ??
      resolveAddonCategoryFromText(selection.selectionTitle) ??
      resolveAddonCategoryFromText(selection.value);
    if (category) {
      return category;
    }
  }

  return null;
};

const resolveModifiersByCategory = (item: EcwidOrderItem): Partial<Record<EcwidAddonCategory, number>> => {
  const buckets: Partial<Record<EcwidAddonCategory, number>> = {};
  const options = getItemOptions(item);
  for (const option of options) {
    const category = resolveCategoryFromOption(option);
    if (!category) {
      continue;
    }
    const modifier = resolveModifierFromOption(option);
    if (modifier === null || modifier <= 0) {
      continue;
    }
    buckets[category] = (buckets[category] ?? 0) + modifier;
  }
  return buckets;
};

const resolveBookingItemIndex = (platformBookingId: string, orderId: string): number => {
  const normalizedBookingId = String(platformBookingId ?? '').trim();
  if (!normalizedBookingId || normalizedBookingId === orderId) {
    return 0;
  }
  if (!normalizedBookingId.startsWith(`${orderId}-`)) {
    return 0;
  }
  const suffix = normalizedBookingId.slice(orderId.length + 1);
  const indexToken = Number.parseInt(suffix, 10);
  if (!Number.isFinite(indexToken) || indexToken <= 1) {
    return 0;
  }
  return indexToken - 1;
};

const resolveAddonCategoryFromRecord = (addon: BookingAddon): EcwidAddonCategory | null => {
  const metadataCategory = (() => {
    const metadata = addon.metadata as Record<string, unknown> | null;
    const value = metadata?.category;
    return typeof value === 'string' ? value : null;
  })();

  return (
    resolveAddonCategoryFromText(metadataCategory) ??
    resolveAddonCategoryFromText(addon.platformAddonName) ??
    resolveAddonCategoryFromText(addon.platformAddonId)
  );
};

const formatMoney = (value: number): string => Math.max(value, 0).toFixed(2);

const parseStoredMoney = (value: string | null | undefined): number | null => {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : null;
};

export const syncEcwidBookingAddonPricingByBookingId = async (bookingId: number): Promise<void> => {
  const booking = await Booking.findByPk(bookingId, {
    attributes: ['id', 'platform', 'platformBookingId', 'platformOrderId', 'currency'],
  });
  if (!booking || booking.platform !== 'ecwid') {
    return;
  }

  const rawOrderId = booking.platformOrderId?.trim() || booking.platformBookingId?.trim() || '';
  const orderId = stripEcwidItemSuffix(rawOrderId);
  if (!orderId) {
    return;
  }

  const addonRecords = await BookingAddon.findAll({
    where: { bookingId: booking.id },
    order: [['id', 'ASC']],
  });
  if (addonRecords.length === 0) {
    return;
  }

  try {
    const ecwidOrder = await getEcwidOrder(orderId);
    const items = Array.isArray(ecwidOrder.items) ? ecwidOrder.items : [];
    if (items.length === 0) {
      return;
    }

    const itemIndex = resolveBookingItemIndex(booking.platformBookingId, orderId);
    const targetItem = items[itemIndex] ?? items[0];
    if (!targetItem) {
      return;
    }

    const modifiersByCategory = resolveModifiersByCategory(targetItem);
    const hasAnyModifier = Object.values(modifiersByCategory).some(
      (value) => value !== undefined && Number.isFinite(value) && value > 0,
    );
    if (!hasAnyModifier) {
      return;
    }

    const currency = normalizeCurrency(booking.currency) ?? 'PLN';

    for (const addon of addonRecords) {
      const category = resolveAddonCategoryFromRecord(addon);
      if (!category) {
        continue;
      }

      const totalPrice = modifiersByCategory[category];
      if (totalPrice === undefined || !Number.isFinite(totalPrice) || totalPrice <= 0) {
        continue;
      }

      const quantity = Number.isFinite(addon.quantity) && addon.quantity > 0 ? addon.quantity : 1;
      const unitPrice = totalPrice / quantity;
      const nextTotal = formatMoney(totalPrice);
      const nextUnit = formatMoney(unitPrice);
      const currentTotal = parseStoredMoney(addon.totalPrice);
      const currentUnit = parseStoredMoney(addon.unitPrice);
      const isSameTotal = currentTotal !== null && Math.abs(currentTotal - totalPrice) < 0.005;
      const isSameUnit = currentUnit !== null && Math.abs(currentUnit - unitPrice) < 0.005;
      const isSameCurrency = normalizeCurrency(addon.currency) === currency;
      if (isSameTotal && isSameUnit && isSameCurrency) {
        continue;
      }

      addon.totalPrice = nextTotal;
      addon.unitPrice = nextUnit;
      addon.currency = currency;
      await addon.save();
    }
  } catch (error) {
    logger.warn(
      `[booking-email] Unable to sync Ecwid addon pricing for booking ${booking.id} (order ${orderId})`,
      error,
    );
  }
};

