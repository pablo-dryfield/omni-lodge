import dayjs from 'dayjs';
import { Op, type Includeable, type Transaction } from 'sequelize';
import HttpError from '../errors/HttpError.js';
import Addon from '../models/Addon.js';
import Channel from '../models/Channel.js';
import ChannelProductPrice from '../models/ChannelProductPrice.js';
import Product from '../models/Product.js';
import ProductAddon from '../models/ProductAddon.js';
import ProductPrice from '../models/ProductPrice.js';
import StorefrontPromotion from '../models/StorefrontPromotion.js';
import type {
  StorefrontAddonConfig,
  StorefrontProductConfig,
} from '../types/storefront.js';
import {
  getAddonInventoryAvailability,
  type AddonInventoryAvailability,
} from './inventoryService.js';

export const STOREFRONT_CURRENCY = 'PLN';
const STOREFRONT_PRICE_CHANNEL = process.env.STOREFRONT_PRICE_CHANNEL?.trim() || 'Ecwid';
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export type StorefrontCartAddonInput = {
  addonId: number;
  quantity?: number;
  value?: string | null;
  variants?: Array<{
    value: string;
    quantity: number;
  }>;
};

export type StorefrontCartItemInput = {
  productId: number;
  quantity: number;
  experienceDate?: string | null;
  experienceTime?: string | null;
  addons?: StorefrontCartAddonInput[];
  options?: Record<string, unknown>;
};

export type StorefrontCartInput = {
  items: StorefrontCartItemInput[];
  discountCode?: string | null;
  discountCodes?: string[];
};

export type StorefrontQuoteItem = {
  productId: number;
  productName: string;
  productSlug: string;
  quantity: number;
  experienceDate: string | null;
  experienceTime: string | null;
  unitPrice: number;
  baseTotal: number;
  addonTotal: number;
  total: number;
  addons: Array<{
    addonId: number;
    name: string;
    quantity: number;
    value: string | null;
    variants: Array<{
      value: string;
      quantity: number;
    }>;
    unitPrice: number;
    total: number;
  }>;
  options: Record<string, unknown>;
};

export type StorefrontQuote = {
  currency: typeof STOREFRONT_CURRENCY;
  subtotal: number;
  addonTotal: number;
  discountTotal: number;
  total: number;
  discountCode: string | null;
  discountCodes: string[];
  promotionId: number | null;
  discounts: Array<{
    promotionId: number;
    code: string;
    name: string;
    amount: number;
    productIds: number[] | null;
  }>;
  items: StorefrontQuoteItem[];
};

const roundMoney = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

const slugify = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const asPositiveInteger = (value: unknown, label: string, max = 50): number => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
    throw new HttpError(400, `${label} must be an integer between 1 and ${max}.`);
  }
  return parsed;
};

const normalizeDate = (value: unknown): string | null => {
  if (value === null || value === undefined || value === '') return null;
  const normalized = String(value).trim();
  const parsed = dayjs(normalized);
  if (!DATE_PATTERN.test(normalized) || !parsed.isValid() || parsed.format('YYYY-MM-DD') !== normalized) {
    throw new HttpError(400, 'Experience date must use YYYY-MM-DD.');
  }
  if (dayjs(normalized).isBefore(dayjs().startOf('day'))) {
    throw new HttpError(400, 'Experience date cannot be in the past.');
  }
  return normalized;
};

const normalizeText = (value: unknown, maxLength = 255): string =>
  value === null || value === undefined ? '' : String(value).trim().slice(0, maxLength);

export const normalizeStorefrontAddonVariants = (
  input: unknown,
  addonName: string,
  addonQuantity: number,
  inventory?: AddonInventoryAvailability,
): Array<{ value: string; quantity: number }> => {
  const rawVariants = Array.isArray(input) ? input : [];
  if (!inventory?.variantSelectionRequired) {
    if (rawVariants.length > 0) {
      throw new HttpError(400, `${addonName} does not support inventory variants.`);
    }
    return [];
  }
  if (rawVariants.length === 0) {
    throw new HttpError(400, `Please select sizes for all ${addonQuantity} ${addonName} items.`);
  }

  const availabilityByValue = new Map(
    inventory.variants.map((variant, index) => [
      variant.variant.toUpperCase(),
      { ...variant, index },
    ]),
  );
  const seen = new Set<string>();
  const normalized = rawVariants.map((rawVariant, index) => {
    if (!rawVariant || typeof rawVariant !== 'object' || Array.isArray(rawVariant)) {
      throw new HttpError(400, `${addonName} size selection ${index + 1} is invalid.`);
    }
    const record = rawVariant as Record<string, unknown>;
    const value = normalizeText(record.value, 40).toUpperCase();
    const available = availabilityByValue.get(value);
    if (!available) {
      throw new HttpError(400, `${value || 'Selected size'} is not an available size for ${addonName}.`);
    }
    if (seen.has(value)) {
      throw new HttpError(400, `${addonName} size ${value} was selected more than once.`);
    }
    seen.add(value);

    const quantity = Number(record.quantity);
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new HttpError(400, `${addonName} size ${value} quantity must be a positive whole number.`);
    }
    if (quantity > available.availableQuantity) {
      throw new HttpError(
        409,
        `${addonName} size ${value} only has ${available.availableQuantity} available.`,
      );
    }
    return { value, quantity, sortOrder: available.index };
  });

  const selectedTotal = normalized.reduce((total, variant) => total + variant.quantity, 0);
  if (selectedTotal !== addonQuantity) {
    throw new HttpError(
      400,
      `${addonName} size quantities must add up to ${addonQuantity}; received ${selectedTotal}.`,
    );
  }

  return normalized
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map(({ value, quantity }) => ({ value, quantity }));
};

const normalizeParticipantCount = (
  rawQuantity: unknown,
  options: Record<string, unknown>,
  config: StorefrontProductConfig,
  itemIndex: number,
): { quantity: number; options: Record<string, unknown> } => {
  const min = Math.max(1, Number(config.minParticipants) || 1);
  const max = Math.max(min, Number(config.maxParticipants) || 50);
  if (config.participantMode !== 'gender_split') {
    const quantity = asPositiveInteger(rawQuantity, `items[${itemIndex}].quantity`, max);
    if (quantity < min) throw new HttpError(400, `At least ${min} participants are required.`);
    return { quantity, options };
  }

  const participantInput =
    options.participants && typeof options.participants === 'object'
      ? (options.participants as Record<string, unknown>)
      : {};
  const men = Number(participantInput.men ?? options.men ?? 0);
  const women = Number(participantInput.women ?? options.women ?? 0);
  if (![men, women].every((value) => Number.isInteger(value) && value >= 0 && value <= max)) {
    throw new HttpError(400, 'Men and women participant counts must be whole positive numbers.');
  }
  const quantity = men + women;
  if (quantity < min || quantity > max) {
    throw new HttpError(400, `Participant total must be between ${min} and ${max}.`);
  }
  return {
    quantity,
    options: { ...options, participants: { men, women } },
  };
};

const validateCustomerOptions = (
  options: Record<string, unknown>,
  config: StorefrontProductConfig,
): Record<string, unknown> => {
  const normalized = { ...options };
  const fullName = normalizeText(options.fullName);
  const email = normalizeText(options.email).toLowerCase();
  const phone = normalizeText(options.phone, 32);

  if (config.fullNameRequired && fullName.length < 2) {
    throw new HttpError(400, 'Full name is required.');
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, 'Email address is invalid.');
  }
  if (config.emailRequired && !email) throw new HttpError(400, 'Email address is required.');
  if (phone && !/^\+[1-9]\d{6,14}$/.test(phone)) {
    throw new HttpError(400, 'Phone number must include a country code followed by digits only.');
  }
  if (config.phoneRequired && !phone) throw new HttpError(400, 'Phone number is required.');

  if (fullName) normalized.fullName = fullName;
  if (email) normalized.email = email;
  if (phone) normalized.phone = phone;
  return normalized;
};

const normalizeExperienceTime = (
  value: unknown,
  config: StorefrontProductConfig,
): string | null => {
  const supplied = normalizeText(value, 64);
  const configuredTimes = (config.startTimes ?? []).map((time) => normalizeText(time, 64)).filter(Boolean);
  if (config.timeMode === 'fixed') {
    const fixed = normalizeText(config.defaultStartTime, 64);
    if (!fixed) throw new HttpError(409, 'This product does not have a configured start time.');
    return fixed;
  }
  if (config.timeMode === 'select') {
    if (!supplied || !configuredTimes.includes(supplied)) {
      throw new HttpError(400, 'Please select an available start time.');
    }
    return supplied;
  }
  return supplied || null;
};

const productIncludes: Includeable[] = [
  {
    model: ProductAddon,
    as: 'productAddons',
    required: false,
    include: [{ model: Addon, as: 'addon', required: false }],
  },
];

const resolveProductPrices = async (
  products: Product[],
  transaction?: Transaction,
): Promise<Map<number, number>> => {
  const ids = products.map((product) => product.id);
  const prices = new Map<number, number>();
  if (ids.length === 0) return prices;

  const today = dayjs().format('YYYY-MM-DD');
  const scheduled = await ProductPrice.findAll({
    where: {
      productId: { [Op.in]: ids },
      validFrom: { [Op.lte]: today },
      [Op.or]: [{ validTo: null }, { validTo: { [Op.gte]: today } }],
    },
    order: [['validFrom', 'DESC']],
    transaction,
  });
  scheduled.forEach((row) => {
    if (!prices.has(row.productId)) prices.set(row.productId, Number(row.price));
  });

  products.forEach((product) => {
    const basePrice = Number(product.price);
    if (!prices.has(product.id) && Number.isFinite(basePrice) && basePrice > 0) {
      prices.set(product.id, basePrice);
    }
  });

  const unresolved = ids.filter((id) => !prices.has(id));
  if (unresolved.length > 0) {
    const channelPrices = await ChannelProductPrice.findAll({
      where: {
        productId: { [Op.in]: unresolved },
        ticketType: 'normal',
        currencyCode: STOREFRONT_CURRENCY,
        validFrom: { [Op.lte]: today },
        [Op.or]: [{ validTo: null }, { validTo: { [Op.gte]: today } }],
      },
      include: [{ model: Channel, as: 'channel', where: { name: STOREFRONT_PRICE_CHANNEL } }],
      order: [['validFrom', 'DESC']],
      transaction,
    });
    channelPrices.forEach((row) => {
      if (!prices.has(row.productId)) prices.set(row.productId, Number(row.price));
    });
  }

  return prices;
};

const normalizeDiscountCodes = (input: StorefrontCartInput): string[] => {
  const values = [...(Array.isArray(input.discountCodes) ? input.discountCodes : []), input.discountCode];
  return [...new Set(values.map((value) => normalizeText(value, 64).toUpperCase()).filter(Boolean))].slice(0, 10);
};

const promotionProductIds = (promotion: StorefrontPromotion): number[] | null => {
  const raw = promotion.metadata?.productIds;
  if (!Array.isArray(raw)) return null;
  const ids = [...new Set(raw.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  return ids.length > 0 ? ids : null;
};

const resolvePromotions = async (
  codes: string[],
  merchandiseSubtotal: number,
  quoteItems: StorefrontQuoteItem[],
  transaction?: Transaction,
): Promise<StorefrontQuote['discounts']> => {
  if (codes.length === 0) return [];
  const now = new Date();
  const promotions = await StorefrontPromotion.findAll({
    where: {
      code: { [Op.in]: codes },
      isActive: true,
      [Op.and]: [
        { [Op.or]: [{ validFrom: null }, { validFrom: { [Op.lte]: now } }] },
        { [Op.or]: [{ validTo: null }, { validTo: { [Op.gte]: now } }] },
      ],
    },
    transaction,
  });
  const byCode = new Map(promotions.map((promotion) => [promotion.code.toUpperCase(), promotion]));
  const missing = codes.find((code) => !byCode.has(code));
  if (missing) throw new HttpError(400, `Discount code ${missing} is invalid or expired.`);

  const remainingByProduct = new Map<number, number>();
  quoteItems.forEach((item) => {
    remainingByProduct.set(
      item.productId,
      roundMoney((remainingByProduct.get(item.productId) ?? 0) + item.total),
    );
  });
  const discounts: StorefrontQuote['discounts'] = [];

  codes.forEach((code) => {
    const promotion = byCode.get(code);
    if (!promotion) return;
    if (promotion.currency && promotion.currency !== STOREFRONT_CURRENCY) {
      throw new HttpError(400, `Discount code ${code} is not available for this currency.`);
    }
    if (promotion.maxRedemptions !== null && promotion.redemptionCount >= promotion.maxRedemptions) {
      throw new HttpError(400, `Discount code ${code} has reached its redemption limit.`);
    }
    if (promotion.minSubtotal !== null && merchandiseSubtotal < Number(promotion.minSubtotal)) {
      throw new HttpError(400, `Discount code ${code} requires a minimum subtotal of ${promotion.minSubtotal}.`);
    }

    const scopedProductIds = promotionProductIds(promotion);
    const eligibleIds = scopedProductIds ?? [...remainingByProduct.keys()];
    const eligibleRemaining = roundMoney(
      eligibleIds.reduce((sum, productId) => sum + (remainingByProduct.get(productId) ?? 0), 0),
    );
    if (eligibleRemaining <= 0) {
      throw new HttpError(400, `Discount code ${code} does not apply to the products in this cart.`);
    }
    const rawDiscount =
      promotion.type === 'percentage'
        ? eligibleRemaining * (Number(promotion.value) / 100)
        : Number(promotion.value);
    const amount = roundMoney(Math.min(eligibleRemaining, Math.max(0, rawDiscount)));
    if (amount <= 0) throw new HttpError(400, `Discount code ${code} has no applicable value.`);

    let undistributed = amount;
    eligibleIds.forEach((productId, index) => {
      const remaining = remainingByProduct.get(productId) ?? 0;
      if (remaining <= 0) return;
      const reduction =
        index === eligibleIds.length - 1
          ? undistributed
          : roundMoney(amount * (remaining / eligibleRemaining));
      const applied = Math.min(remaining, undistributed, reduction);
      remainingByProduct.set(productId, roundMoney(remaining - applied));
      undistributed = roundMoney(undistributed - applied);
    });
    if (undistributed > 0) {
      for (const productId of eligibleIds) {
        const remaining = remainingByProduct.get(productId) ?? 0;
        if (remaining <= 0) continue;
        const applied = Math.min(remaining, undistributed);
        remainingByProduct.set(productId, roundMoney(remaining - applied));
        undistributed = roundMoney(undistributed - applied);
        if (undistributed <= 0) break;
      }
    }

    discounts.push({
      promotionId: promotion.id,
      code: promotion.code,
      name: promotion.name,
      amount,
      productIds: scopedProductIds,
    });
  });

  return discounts;
};

export const quoteStorefrontCart = async (
  input: StorefrontCartInput,
  transaction?: Transaction,
): Promise<StorefrontQuote> => {
  if (!input || !Array.isArray(input.items) || input.items.length === 0) {
    throw new HttpError(400, 'The cart must contain at least one item.');
  }
  if (input.items.length > 20) throw new HttpError(400, 'The cart cannot contain more than 20 items.');

  const normalizedItems = input.items.map((item, index) => ({
    productId: asPositiveInteger(item.productId, `items[${index}].productId`, Number.MAX_SAFE_INTEGER),
    quantity: item.quantity,
    experienceDate: normalizeDate(item.experienceDate),
    experienceTime: item.experienceTime,
    addons: Array.isArray(item.addons) ? item.addons : [],
    options:
      item.options && typeof item.options === 'object' && !Array.isArray(item.options)
        ? { ...item.options }
        : {},
    index,
  }));

  const uniqueProductIds = [...new Set(normalizedItems.map((item) => item.productId))];
  const products = await Product.findAll({
    where: { id: { [Op.in]: uniqueProductIds }, status: true },
    include: productIncludes,
    transaction,
  });
  if (products.length !== uniqueProductIds.length) {
    throw new HttpError(400, 'One or more products are unavailable.');
  }
  const productsById = new Map(products.map((product) => [product.id, product]));
  const availableAddonIds = Array.from(
    new Set(
      products.flatMap((product) =>
        (product.productAddons ?? []).map((productAddon) => productAddon.addonId),
      ),
    ),
  );
  const [prices, inventoryByAddon] = await Promise.all([
    resolveProductPrices(products, transaction),
    getAddonInventoryAvailability(availableAddonIds, transaction),
  ]);

  const quoteItems: StorefrontQuoteItem[] = normalizedItems.map((item) => {
    const product = productsById.get(item.productId);
    if (!product) throw new HttpError(400, 'Product is unavailable.');
    const unitPrice = prices.get(product.id);
    if (unitPrice === undefined || !Number.isFinite(unitPrice) || unitPrice < 0) {
      throw new HttpError(409, `${product.name} does not have a valid storefront price.`);
    }
    const productConfig = product.storefrontConfig ?? {};
    const participantSelection = normalizeParticipantCount(
      item.quantity,
      item.options,
      productConfig,
      item.index,
    );
    const quantity = participantSelection.quantity;
    const experienceDate = item.experienceDate;
    if (productConfig.dateRequired && !experienceDate) {
      throw new HttpError(400, `Please select an activity date for ${product.name}.`);
    }
    const experienceTime = normalizeExperienceTime(item.experienceTime, productConfig);
    const options = validateCustomerOptions(participantSelection.options, productConfig);

    const availableProductAddons = new Map(
      (product.productAddons ?? []).map((productAddon) => [productAddon.addonId, productAddon]),
    );
    const seenAddonIds = new Set<number>();
    const addons = item.addons.map((addonInput, addonIndex) => {
      const addonId = asPositiveInteger(
        addonInput.addonId,
        `items addon ${addonIndex}.addonId`,
        Number.MAX_SAFE_INTEGER,
      );
      if (seenAddonIds.has(addonId)) throw new HttpError(400, 'Duplicate add-ons are not allowed.');
      seenAddonIds.add(addonId);
      const productAddon = availableProductAddons.get(addonId);
      const addon = productAddon?.addon as Addon | undefined;
      if (!productAddon || !addon || !addon.isActive) {
        throw new HttpError(400, `An add-on selected for ${product.name} is unavailable.`);
      }
      const addonConfig: StorefrontAddonConfig = productAddon.storefrontConfig ?? {};
      const selectionMode = String(addonConfig.selectionMode ?? 'quantity').toLowerCase();
      const maxQuantity =
        productAddon.maxPerAttendee === null
          ? Math.max(50, quantity)
          : Math.max(1, productAddon.maxPerAttendee * quantity);
      const baseUnitPrice =
        productAddon.priceOverride === null ? Number(addon.basePrice ?? 0) : Number(productAddon.priceOverride);
      if (!Number.isFinite(baseUnitPrice) || baseUnitPrice < 0) {
        throw new HttpError(409, `${addon.name} does not have a valid price.`);
      }

      let addonQuantity = 1;
      let value = normalizeText(addonInput.value, 128) || null;
      let addonUnitPrice = baseUnitPrice;
      let addonLineTotal = baseUnitPrice;
      if (selectionMode === 'boolean') {
        const selected =
          addonInput.quantity === undefined
            ? ['true', 'yes', '1', 'on'].includes((value ?? '').toLowerCase())
            : Number(addonInput.quantity) > 0;
        if (!selected) throw new HttpError(400, `${addon.name} was not selected.`);
        value = 'true';
      } else if (selectionMode === 'options') {
        const selectedOption = (addonConfig.options ?? []).find((option) => option.value === value);
        if (!selectedOption) throw new HttpError(400, `Please select a valid option for ${addon.name}.`);
        addonUnitPrice = Number(selectedOption.price ?? baseUnitPrice);
        addonLineTotal = addonUnitPrice;
      } else {
        addonQuantity = asPositiveInteger(addonInput.quantity, `${addon.name} quantity`, maxQuantity);
        if (selectionMode === 'range') {
          const minimum = Math.max(1, Math.floor(Number(addonConfig.minQuantity ?? 1)));
          const maximum = Math.max(minimum, Math.floor(Number(addonConfig.maxQuantity ?? minimum)));
          if (addonQuantity < minimum || addonQuantity > maximum) {
            throw new HttpError(
              400,
              `${addon.name} quantity must be between ${minimum} and ${maximum}.`,
            );
          }
        }
        const allowedQuantities = selectionMode === 'quantity' ? addonConfig.allowedQuantities ?? [] : [];
        if (allowedQuantities.length > 0 && !allowedQuantities.includes(addonQuantity)) {
          throw new HttpError(
            400,
            `${addon.name} quantity must be one of: ${allowedQuantities.join(', ')}.`,
          );
        }
        const configuredTotal = addonConfig.quantityPrices?.[String(addonQuantity)];
        if (configuredTotal !== undefined) {
          addonLineTotal = Number(configuredTotal);
          addonUnitPrice = addonLineTotal / addonQuantity;
        } else {
          addonLineTotal = baseUnitPrice * addonQuantity;
        }
      }
      if (![addonUnitPrice, addonLineTotal].every((price) => Number.isFinite(price) && price >= 0)) {
        throw new HttpError(409, `${addon.name} does not have a valid configured price.`);
      }
      const variants = normalizeStorefrontAddonVariants(
        addonInput.variants,
        addon.name,
        addonQuantity,
        inventoryByAddon.get(addonId),
      );
      return {
        addonId,
        name: addon.name,
        quantity: addonQuantity,
        value,
        variants,
        unitPrice: roundMoney(addonUnitPrice),
        total: roundMoney(addonLineTotal),
      };
    });

    const baseTotal = roundMoney(unitPrice * quantity);
    const addonTotal = roundMoney(addons.reduce((sum, addon) => sum + addon.total, 0));
    return {
      productId: product.id,
      productName: product.name,
      productSlug: `${slugify(product.name) || 'experience'}-${product.id}`,
      quantity,
      experienceDate,
      experienceTime,
      unitPrice: roundMoney(unitPrice),
      baseTotal,
      addonTotal,
      total: roundMoney(baseTotal + addonTotal),
      addons,
      options,
    };
  });

  const subtotal = roundMoney(quoteItems.reduce((sum, item) => sum + item.baseTotal, 0));
  const addonTotal = roundMoney(quoteItems.reduce((sum, item) => sum + item.addonTotal, 0));
  const merchandiseSubtotal = roundMoney(subtotal + addonTotal);
  const requestedCodes = normalizeDiscountCodes(input);
  const discounts = await resolvePromotions(requestedCodes, merchandiseSubtotal, quoteItems, transaction);
  const discountTotal = roundMoney(discounts.reduce((sum, discount) => sum + discount.amount, 0));

  return {
    currency: STOREFRONT_CURRENCY,
    subtotal,
    addonTotal,
    discountTotal,
    total: roundMoney(merchandiseSubtotal - discountTotal),
    discountCode: discounts[0]?.code ?? null,
    discountCodes: discounts.map((discount) => discount.code),
    promotionId: discounts[0]?.promotionId ?? null,
    discounts,
    items: quoteItems,
  };
};
