import type { Request, Response } from 'express';
import dayjs from 'dayjs';
import { Op, type Includeable } from 'sequelize';
import Addon from '../models/Addon.js';
import Channel from '../models/Channel.js';
import ChannelProductPrice from '../models/ChannelProductPrice.js';
import Product from '../models/Product.js';
import ProductAddon from '../models/ProductAddon.js';
import ProductPrice from '../models/ProductPrice.js';
import ProductType from '../models/ProductType.js';

const STOREFRONT_CURRENCY = 'PLN';
const STOREFRONT_PRICE_CHANNEL = process.env.STOREFRONT_PRICE_CHANNEL?.trim() || 'Ecwid';

type StorefrontProduct = {
  id: number;
  slug: string;
  name: string;
  productType: {
    id: number;
    name: string;
  } | null;
  price: {
    amount: number;
    currency: typeof STOREFRONT_CURRENCY;
  };
  addons: Array<{
    id: number;
    name: string;
    price: {
      amount: number;
      currency: typeof STOREFRONT_CURRENCY;
    } | null;
    maxPerAttendee: number | null;
    sortOrder: number;
  }>;
};

const productIncludes: Includeable[] = [
  {
    model: ProductType,
    attributes: ['id', 'name'],
    required: false,
  },
  {
    model: ProductAddon,
    as: 'productAddons',
    attributes: ['addonId', 'maxPerAttendee', 'priceOverride', 'sortOrder'],
    required: false,
    include: [
      {
        model: Addon,
        as: 'addon',
        attributes: ['id', 'name', 'basePrice', 'isActive'],
        required: true,
        where: { isActive: true },
      },
    ],
  },
];

const slugify = (value: string): string =>
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const createProductSlug = (product: Pick<Product, 'id' | 'name'>): string =>
  `${slugify(product.name) || 'experience'}-${product.id}`;

const toMoneyAmount = (value: number | string | null | undefined): number =>
  Number(Number(value ?? 0).toFixed(2));

const loadEffectiveProductPrices = async (productIds: number[]): Promise<Map<number, number>> => {
  if (productIds.length === 0) {
    return new Map();
  }

  const today = dayjs().format('YYYY-MM-DD');
  const prices = await ProductPrice.findAll({
    where: {
      productId: { [Op.in]: productIds },
      validFrom: { [Op.lte]: today },
      [Op.or]: [{ validTo: null }, { validTo: { [Op.gte]: today } }],
    },
    attributes: ['id', 'productId', 'price', 'validFrom'],
    order: [
      ['productId', 'ASC'],
      ['validFrom', 'DESC'],
      ['id', 'DESC'],
    ],
  });

  const effectivePrices = new Map<number, number>();
  for (const price of prices) {
    if (!effectivePrices.has(price.productId)) {
      effectivePrices.set(price.productId, toMoneyAmount(price.price));
    }
  }

  return effectivePrices;
};

const loadStorefrontChannelPrices = async (
  productIds: number[],
): Promise<Map<number, number>> => {
  if (productIds.length === 0) {
    return new Map();
  }

  const channel = await Channel.findOne({
    where: { name: STOREFRONT_PRICE_CHANNEL },
    attributes: ['id'],
  });
  if (!channel) {
    return new Map();
  }

  const today = dayjs().format('YYYY-MM-DD');
  const prices = await ChannelProductPrice.findAll({
    where: {
      channelId: channel.id,
      productId: { [Op.in]: productIds },
      ticketType: 'normal',
      currencyCode: STOREFRONT_CURRENCY,
      validFrom: { [Op.lte]: today },
      [Op.or]: [{ validTo: null }, { validTo: { [Op.gte]: today } }],
    },
    attributes: ['id', 'productId', 'price', 'validFrom'],
    order: [
      ['productId', 'ASC'],
      ['validFrom', 'DESC'],
      ['id', 'DESC'],
    ],
  });

  const channelPrices = new Map<number, number>();
  for (const price of prices) {
    if (!channelPrices.has(price.productId)) {
      channelPrices.set(price.productId, toMoneyAmount(price.price));
    }
  }

  return channelPrices;
};

const serializeProduct = (
  product: Product,
  effectivePrices: ReadonlyMap<number, number>,
  channelPrices: ReadonlyMap<number, number>,
): StorefrontProduct => {
  const productType = product.get('ProductType') as ProductType | undefined;
  const productAddons = product.productAddons ?? [];
  const scheduledPrice = effectivePrices.get(product.id);
  const basePrice = toMoneyAmount(product.price);
  const effectivePrice =
    scheduledPrice ?? (basePrice > 0 ? basePrice : channelPrices.get(product.id) ?? basePrice);

  return {
    id: product.id,
    slug: createProductSlug(product),
    name: product.name,
    productType: productType
      ? {
          id: productType.id,
          name: productType.name,
        }
      : null,
    price: {
      amount: toMoneyAmount(effectivePrice),
      currency: STOREFRONT_CURRENCY,
    },
    addons: productAddons
      .map((record) => {
        const addon = record.addon as Addon | undefined;
        if (!addon) {
          return null;
        }

        const effectivePrice = record.priceOverride ?? addon.basePrice;
        return {
          id: addon.id,
          name: addon.name,
          price:
            effectivePrice == null
              ? null
              : {
                  amount: toMoneyAmount(effectivePrice),
                  currency: STOREFRONT_CURRENCY as typeof STOREFRONT_CURRENCY,
                },
          maxPerAttendee: record.maxPerAttendee ?? null,
          sortOrder: record.sortOrder ?? 0,
        };
      })
      .filter((addon): addon is NonNullable<typeof addon> => addon !== null)
      .sort((left, right) => left.sortOrder - right.sortOrder),
  };
};

const parseProductId = (slug: string): number | null => {
  const match = slug.match(/-(\d+)$/);
  if (!match) {
    return null;
  }

  const id = Number(match[1]);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};

export const listStorefrontProducts = async (_req: Request, res: Response): Promise<void> => {
  try {
    const products = await Product.findAll({
      where: { status: { [Op.ne]: false } },
      attributes: ['id', 'name', 'price', 'productTypeId'],
      include: productIncludes,
      order: [['name', 'ASC']],
    });
    const productIds = products.map((product) => product.id);
    const [effectivePrices, channelPrices] = await Promise.all([
      loadEffectiveProductPrices(productIds),
      loadStorefrontChannelPrices(productIds),
    ]);

    res.status(200).json({
      version: 1,
      products: products.map((product) =>
        serializeProduct(product, effectivePrices, channelPrices),
      ),
    });
  } catch (error) {
    console.error('Unable to load storefront products:', error);
    res.status(500).json({ message: 'Unable to load the storefront catalog.' });
  }
};

export const getStorefrontProduct = async (req: Request, res: Response): Promise<void> => {
  const requestedSlug = String(req.params.slug ?? '').trim().toLowerCase();
  const productId = parseProductId(requestedSlug);

  if (!productId) {
    res.status(404).json({ message: 'Product not found.' });
    return;
  }

  try {
    const product = await Product.findOne({
      where: {
        id: productId,
        status: { [Op.ne]: false },
      },
      attributes: ['id', 'name', 'price', 'productTypeId'],
      include: productIncludes,
    });

    if (!product || createProductSlug(product) !== requestedSlug) {
      res.status(404).json({ message: 'Product not found.' });
      return;
    }
    const [effectivePrices, channelPrices] = await Promise.all([
      loadEffectiveProductPrices([product.id]),
      loadStorefrontChannelPrices([product.id]),
    ]);

    res.status(200).json({
      version: 1,
      product: serializeProduct(product, effectivePrices, channelPrices),
    });
  } catch (error) {
    console.error(`Unable to load storefront product ${requestedSlug}:`, error);
    res.status(500).json({ message: 'Unable to load this storefront product.' });
  }
};
