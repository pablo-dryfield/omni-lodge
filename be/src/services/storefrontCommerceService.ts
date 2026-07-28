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

export const STOREFRONT_CURRENCY = 'PLN';
const STOREFRONT_PRICE_CHANNEL = process.env.STOREFRONT_PRICE_CHANNEL?.trim() || 'Ecwid';
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export type StorefrontCartAddonInput = {
  addonId: number;
  quantity: number;
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
  promotionId: number | null;
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
  if (!DATE_PATTERN.test(normalized) || !dayjs(normalized, 'YYYY-MM-DD', true).isValid()) {
    throw new HttpError(400, 'Experience date must use YYYY-MM-DD.');
  }
  if (dayjs(normalized).isBefore(dayjs().startOf('day'))) {
    throw new HttpError(400, 'Experience date cannot be in the past.');
  }
  return normalized;
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

const resolvePromotion = async (
  code: string | null,
  merchandiseSubtotal: number,
  transaction?: Transaction,
): Promise<{ promotion: StorefrontPromotion | null; discount: number }> => {
  if (!code) return { promotion: null, discount: 0 };
  const now = new Date();
  const promotion = await StorefrontPromotion.findOne({
    where: {
      code,
      isActive: true,
      [Op.and]: [
        { [Op.or]: [{ validFrom: null }, { validFrom: { [Op.lte]: now } }] },
        { [Op.or]: [{ validTo: null }, { validTo: { [Op.gte]: now } }] },
      ],
    },
    transaction,
  });
  if (!promotion) throw new HttpError(400, 'This discount code is invalid or expired.');
  if (promotion.currency && promotion.currency !== STOREFRONT_CURRENCY) {
    throw new HttpError(400, 'This discount code is not available for this currency.');
  }
  if (promotion.maxRedemptions !== null && promotion.redemptionCount >= promotion.maxRedemptions) {
    throw new HttpError(400, 'This discount code has reached its redemption limit.');
  }
  if (promotion.minSubtotal !== null && merchandiseSubtotal < Number(promotion.minSubtotal)) {
    throw new HttpError(400, `This discount code requires a minimum subtotal of ${promotion.minSubtotal}.`);
  }
  const rawDiscount =
    promotion.type === 'percentage'
      ? merchandiseSubtotal * (Number(promotion.value) / 100)
      : Number(promotion.value);
  return {
    promotion,
    discount: roundMoney(Math.min(merchandiseSubtotal, Math.max(0, rawDiscount))),
  };
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
    quantity: asPositiveInteger(item.quantity, `items[${index}].quantity`),
    experienceDate: normalizeDate(item.experienceDate),
    experienceTime: item.experienceTime ? String(item.experienceTime).trim().slice(0, 64) : null,
    addons: Array.isArray(item.addons) ? item.addons : [],
    options: item.options && typeof item.options === 'object' ? item.options : {},
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
  const prices = await resolveProductPrices(products, transaction);

  const quoteItems: StorefrontQuoteItem[] = normalizedItems.map((item) => {
    const product = productsById.get(item.productId);
    if (!product) throw new HttpError(400, 'Product is unavailable.');
    const unitPrice = prices.get(product.id);
    if (unitPrice === undefined || !Number.isFinite(unitPrice) || unitPrice < 0) {
      throw new HttpError(409, `${product.name} does not have a valid storefront price.`);
    }

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
      const maxQuantity =
        productAddon.maxPerAttendee === null
          ? Math.max(50, item.quantity)
          : Math.max(1, productAddon.maxPerAttendee * item.quantity);
      const quantity = asPositiveInteger(addonInput.quantity, `${addon.name} quantity`, maxQuantity);
      const addonUnitPrice =
        productAddon.priceOverride === null ? Number(addon.basePrice ?? 0) : Number(productAddon.priceOverride);
      if (!Number.isFinite(addonUnitPrice) || addonUnitPrice < 0) {
        throw new HttpError(409, `${addon.name} does not have a valid price.`);
      }
      return {
        addonId,
        name: addon.name,
        quantity,
        unitPrice: roundMoney(addonUnitPrice),
        total: roundMoney(addonUnitPrice * quantity),
      };
    });

    const baseTotal = roundMoney(unitPrice * item.quantity);
    const addonTotal = roundMoney(addons.reduce((sum, addon) => sum + addon.total, 0));
    return {
      productId: product.id,
      productName: product.name,
      productSlug: `${slugify(product.name) || 'experience'}-${product.id}`,
      quantity: item.quantity,
      experienceDate: item.experienceDate,
      experienceTime: item.experienceTime,
      unitPrice: roundMoney(unitPrice),
      baseTotal,
      addonTotal,
      total: roundMoney(baseTotal + addonTotal),
      addons,
      options: item.options,
    };
  });

  const subtotal = roundMoney(quoteItems.reduce((sum, item) => sum + item.baseTotal, 0));
  const addonTotal = roundMoney(quoteItems.reduce((sum, item) => sum + item.addonTotal, 0));
  const merchandiseSubtotal = roundMoney(subtotal + addonTotal);
  const normalizedCode = input.discountCode?.trim().toUpperCase() || null;
  const { promotion, discount } = await resolvePromotion(normalizedCode, merchandiseSubtotal, transaction);

  return {
    currency: STOREFRONT_CURRENCY,
    subtotal,
    addonTotal,
    discountTotal: discount,
    total: roundMoney(merchandiseSubtotal - discount),
    discountCode: promotion?.code ?? null,
    promotionId: promotion?.id ?? null,
    items: quoteItems,
  };
};
