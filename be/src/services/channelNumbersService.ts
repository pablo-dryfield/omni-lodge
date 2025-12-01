import dayjs from 'dayjs';
import { Op } from 'sequelize';

import CounterChannelMetric from '../models/CounterChannelMetric.js';
import Counter from '../models/Counter.js';
import Channel from '../models/Channel.js';
import PaymentMethod from '../models/PaymentMethod.js';
import Addon from '../models/Addon.js';
import ProductAddon from '../models/ProductAddon.js';
import Product from '../models/Product.js';
import ProductType from '../models/ProductType.js';
import HttpError from '../errors/HttpError.js';
import {
  computeSummary,
  type AddonConfig,
  type ChannelConfig,
  type MetricCell,
  type MetricKind,
  type MetricPeriod,
  type MetricTallyType,
  toAddonConfig,
} from './counterMetricUtils.js';

const CHANNEL_ORDER = [
  'Fareharbor',
  'Viator',
  'GetYourGuide',
  'FreeTour',
  'Walk-In',
  'Ecwid',
  'Email',
  'Hostel Atlantis',
  'XperiencePoland',
  'TopDeck',
];

function normalizeDateInput(value: string | undefined, fallback: dayjs.Dayjs): dayjs.Dayjs {
  if (!value) {
    return fallback;
  }

  const parsed = dayjs(value, 'YYYY-MM-DD', true);
  if (!parsed.isValid()) {
    throw new HttpError(400, 'Dates must be provided in YYYY-MM-DD format');
  }

  return parsed;
}

function buildChannelConfigs(
  rows: Array<Channel & { paymentMethod?: PaymentMethod | null }>,
): ChannelConfig[] {
  const explicitOrder = new Map<string, number>();
  CHANNEL_ORDER.forEach((name, index) => explicitOrder.set(name.toLowerCase(), index));

  return rows
    .map((channel) => {
      const paymentMethodName = channel.paymentMethod?.name ?? null;
      const normalizedPayment = paymentMethodName?.toLowerCase() ?? '';
      const normalizedChannel = channel.name?.toLowerCase() ?? '';

      return {
        id: channel.id,
        name: channel.name,
        sortOrder: explicitOrder.get(normalizedChannel) ?? CHANNEL_ORDER.length + channel.id,
        paymentMethodId: channel.paymentMethodId ?? null,
        paymentMethodName,
        cashPrice: null,
        cashPaymentEligible: normalizedPayment === 'cash',
      };
    })
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

type AddonMeta = {
  addonId: number;
  name: string;
  key: string;
  productId: number | null;
  productName: string | null;
  productTypeId: number | null;
  productTypeName: string | null;
};

type ChannelNumbersProductType = {
  id: number;
  name: string;
};

type ChannelNumbersProduct = {
  id: number;
  name: string;
  productTypeId: number | null;
  productTypeName: string | null;
  addonKeys: string[];
};

type ChannelProductMetrics = {
  productId: number | null;
  normal: number;
  nonShow: number;
  addons: Record<string, number>;
  addonNonShow: Record<string, number>;
  total: number;
};

function buildAddonConfigs(
  addons: Addon[],
  productAddons: Array<ProductAddon & { product?: (Product & { ProductType?: ProductType | null }) | null }>,
  defaultProductId: number | null,
): { configs: AddonConfig[]; meta: AddonMeta[] } {
  const byAddon = new Map<
    number,
    Array<ProductAddon & { product?: (Product & { ProductType?: ProductType | null }) | null }>
  >();

  for (const record of productAddons) {
    const bucket = byAddon.get(record.addonId) ?? [];
    bucket.push(record);
    byAddon.set(record.addonId, bucket);
  }

  const resolved: { configs: AddonConfig[]; meta: AddonMeta[] } = { configs: [], meta: [] };

  addons.forEach((addon, index) => {
    const entries = byAddon.get(addon.id) ?? [];
    const preferred =
      (defaultProductId != null && entries.find((entry) => entry.productId === defaultProductId)) ||
      entries.sort((a, b) => a.sortOrder - b.sortOrder)[0];

    const config = toAddonConfig({
      addonId: addon.id,
      name: addon.name,
      maxPerAttendee: preferred?.maxPerAttendee ?? null,
      sortOrder: preferred?.sortOrder ?? index,
    });

    resolved.configs.push(config);
    const productTypeId = preferred?.product?.productTypeId ?? null;
    const productTypeName =
      preferred?.product?.ProductType?.name ??
      preferred?.product?.name ??
      addon.name;

    resolved.meta.push({
      addonId: addon.id,
      name: addon.name,
      key: config.key,
      productId: preferred?.productId ?? null,
      productName: preferred?.product?.name ?? null,
      productTypeId,
      productTypeName,
    });
  });

  resolved.configs.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  resolved.meta.sort((a, b) => a.name.localeCompare(b.name));

  return resolved;
}

export type ChannelNumbersSummary = {
  startDate: string;
  endDate: string;
  channels: Array<{
    channelId: number;
    channelName: string;
    normal: number;
    normalNonShow: number;
    addons: Record<string, number>;
    addonNonShow: Record<string, number>;
    total: number;
    products: Record<string, ChannelProductMetrics>;
  }>;
  addons: AddonMeta[];
  productTypes: ChannelNumbersProductType[];
  products: ChannelNumbersProduct[];
  productTotals: Record<string, ChannelProductMetrics>;
  totals: {
    normal: number;
    normalNonShow: number;
    addons: Record<string, number>;
    addonNonShow: Record<string, number>;
    total: number;
  };
};

async function loadActiveProducts(
  end: dayjs.Dayjs,
  addonMeta: AddonMeta[],
): Promise<{ productTypes: ChannelNumbersProductType[]; products: ChannelNumbersProduct[] }> {
  const productRows = (await Product.findAll({
    where: {
      status: true,
      createdAt: { [Op.lte]: end.toDate() },
    },
    attributes: ['id', 'name', 'productTypeId'],
    order: [['name', 'ASC']],
    raw: true,
  })) as Array<{ id: number; name: string; productTypeId: number | null }>;

  const productTypeIds = new Set<number>();
  productRows.forEach((row) => {
    if (row.productTypeId != null) {
      productTypeIds.add(row.productTypeId);
    }
  });
  addonMeta.forEach((meta) => {
    if (meta.productTypeId != null) {
      productTypeIds.add(meta.productTypeId);
    }
  });

  const typeRecords =
    productTypeIds.size > 0
      ? await ProductType.findAll({
          where: { id: { [Op.in]: [...productTypeIds] } },
          order: [['name', 'ASC']],
        })
      : [];

  const productTypeLookup = new Map<number, string>();
  typeRecords.forEach((record) => {
    productTypeLookup.set(record.id, record.name);
  });

  const addonKeysByProduct = new Map<number, string[]>();
  addonMeta.forEach((meta) => {
    if (meta.productId == null) return;
    const bucket = addonKeysByProduct.get(meta.productId) ?? [];
    bucket.push(meta.key);
    addonKeysByProduct.set(meta.productId, bucket);
  });

  const products = new Map<number, ChannelNumbersProduct>();

  productRows.forEach((row) => {
    products.set(row.id, {
      id: row.id,
      name: row.name,
      productTypeId: row.productTypeId ?? null,
      productTypeName: row.productTypeId != null ? productTypeLookup.get(row.productTypeId) ?? null : null,
      addonKeys: addonKeysByProduct.get(row.id) ?? [],
    });
  });

  addonKeysByProduct.forEach((keys, productId) => {
    if (products.has(productId)) {
      const existing = products.get(productId);
      if (existing) {
        existing.addonKeys = keys;
      }
      return;
    }
    const meta = addonMeta.find((addon) => addon.productId === productId);
    products.set(productId, {
      id: productId,
      name: meta?.productName ?? `Product ${productId}`,
      productTypeId: meta?.productTypeId ?? null,
      productTypeName: meta?.productTypeName ?? null,
      addonKeys: keys,
    });
    if (meta?.productTypeId != null && !productTypeLookup.has(meta.productTypeId)) {
      productTypeLookup.set(meta.productTypeId, meta.productTypeName ?? 'Other');
    }
  });

  const productList = Array.from(products.values()).sort((a, b) => a.name.localeCompare(b.name));
  const productTypes =
    productTypeLookup.size > 0
      ? Array.from(productTypeLookup.entries())
          .map(([id, name]) => ({ id, name: name ?? 'Other' }))
          .sort((a, b) => a.name.localeCompare(b.name))
      : [];

  return { productTypes, products: productList };
}

export async function getChannelNumbersSummary(params: {
  startDate?: string;
  endDate?: string;
}): Promise<ChannelNumbersSummary> {
  const today = dayjs().startOf('day');
  const defaultStart = today.startOf('month');
  const defaultEnd = today.endOf('month');

  const start = normalizeDateInput(params.startDate, defaultStart);
  const end = normalizeDateInput(params.endDate, defaultEnd);

  if (end.isBefore(start)) {
    throw new HttpError(400, 'endDate must be on or after startDate');
  }

  const counters = await Counter.findAll({
    where: { date: { [Op.between]: [start.format('YYYY-MM-DD'), end.format('YYYY-MM-DD')] } },
    attributes: ['id', 'productId'],
  });

  const counterProductLookup = new Map<number, number | null>();
  const counterIds = counters.map((counter) => {
    counterProductLookup.set(counter.id, counter.productId ?? null);
    return counter.id;
  });

  const [channelRows, addonRows, rawProductAddons] = await Promise.all([
    Channel.findAll({
      include: [{ model: PaymentMethod, as: 'paymentMethod' }],
    }),
    Addon.findAll({
      where: { isActive: true },
    }),
    ProductAddon.findAll({
      include: [
        {
          model: Product,
          as: 'product',
          include: [{ model: ProductType, as: 'ProductType' }],
        },
      ],
    }),
  ]);

  const productAddonRows = rawProductAddons as Array<
    ProductAddon & { product?: (Product & { ProductType?: ProductType | null }) | null }
  >;

  const channelConfigs: ChannelConfig[] = buildChannelConfigs(channelRows);
  const { configs: addonConfigs, meta: addonMeta } = buildAddonConfigs(addonRows, productAddonRows, null);
  const { productTypes, products } = await loadActiveProducts(end, addonMeta);
  const productMap = new Map<number, ChannelNumbersProduct>();
  products.forEach((product) => productMap.set(product.id, product));
  const buildProductList = () =>
    Array.from(productMap.values()).sort((a, b) => a.name.localeCompare(b.name));

  if (counterIds.length === 0) {
    const productList = buildProductList();
    const buildEmptyProductMetrics = (): Record<string, ChannelProductMetrics> =>
      Object.fromEntries(
        productList.map((product) => [
          product.id.toString(),
          { productId: product.id, normal: 0, nonShow: 0, addons: {}, addonNonShow: {}, total: 0 },
        ]),
      );
    return {
      startDate: start.format('YYYY-MM-DD'),
      endDate: end.format('YYYY-MM-DD'),
      channels: channelConfigs.map((channel) => ({
        channelId: channel.id,
        channelName: channel.name,
        normal: 0,
        normalNonShow: 0,
        addons: Object.fromEntries(addonConfigs.map((addon) => [addon.key, 0])),
        addonNonShow: Object.fromEntries(addonConfigs.map((addon) => [addon.key, 0])),
        total: 0,
        products: buildEmptyProductMetrics(),
      })),
      addons: addonMeta,
      products: productList,
      productTypes,
      productTotals: buildEmptyProductMetrics(),
      totals: {
        normal: 0,
        normalNonShow: 0,
        addons: Object.fromEntries(addonConfigs.map((addon) => [addon.key, 0])),
        addonNonShow: Object.fromEntries(addonConfigs.map((addon) => [addon.key, 0])),
        total: 0,
      },
    };
  }

  const metricRows = await CounterChannelMetric.findAll({
    where: { counterId: { [Op.in]: counterIds } },
    attributes: ['id', 'counterId', 'channelId', 'kind', 'addonId', 'tallyType', 'period', 'qty'],
  });

  const metricsByProduct = new Map<number | null, MetricCell[]>();
  const metrics: MetricCell[] = metricRows.map((metric) => {
    const normalized: MetricCell = {
      id: metric.id,
      counterId: metric.counterId,
      channelId: metric.channelId,
      kind: metric.kind as MetricKind,
      addonId: metric.addonId ?? null,
      tallyType: metric.tallyType as MetricTallyType,
      period:
        metric.tallyType === 'attended'
          ? null
          : ((metric.period as MetricPeriod | null) ?? 'before_cutoff'),
      qty: Number(metric.qty ?? 0),
    };
    const productId = counterProductLookup.get(metric.counterId) ?? null;
    const bucket = metricsByProduct.get(productId) ?? [];
    bucket.push(normalized);
    metricsByProduct.set(productId, bucket);
    return normalized;
  });

  metricsByProduct.forEach((_, productId) => {
    if (productId == null || productMap.has(productId)) {
      return;
    }
    productMap.set(productId, {
      id: productId,
      name: `Product ${productId}`,
      productTypeId: null,
      productTypeName: null,
      addonKeys: [],
    });
  });
  const productList = buildProductList();

  const summary = computeSummary({
    metrics,
    channels: channelConfigs,
    addons: addonConfigs,
  });

  const productSummaries = new Map<number | null, ReturnType<typeof computeSummary>>();
  metricsByProduct.forEach((productMetrics, productId) => {
    if (productMetrics.length === 0) return;
    productSummaries.set(
      productId,
      computeSummary({
        metrics: productMetrics,
        channels: channelConfigs,
        addons: addonConfigs,
      }),
    );
  });

  const productChannelMaps = new Map<
    number | null,
    Map<number, ReturnType<typeof computeSummary>['byChannel'][number]>
  >();
  productSummaries.forEach((productSummary, productId) => {
    const channelMap = new Map<number, ReturnType<typeof computeSummary>['byChannel'][number]>();
    productSummary.byChannel.forEach((channel) => channelMap.set(channel.channelId, channel));
    productChannelMaps.set(productId, channelMap);
  });

  const channelData = summary.byChannel.map((channel) => {
    const addonValues = Object.fromEntries(
      Object.entries(channel.addons).map(([key, bucket]) => [key, bucket.attended]),
    );
    const addonNonShow = Object.fromEntries(
      Object.entries(channel.addons).map(([key, bucket]) => [key, bucket.nonShow]),
    );
    const total = channel.people.attended + channel.people.nonShow;

    const productMetrics: Record<string, ChannelProductMetrics> = {};
    productList.forEach((product) => {
      const channelSummaryForProduct = productChannelMaps.get(product.id)?.get(channel.channelId);
      const productAddonValues = channelSummaryForProduct
        ? Object.fromEntries(
            Object.entries(channelSummaryForProduct.addons).map(([key, bucket]) => [key, bucket.attended]),
          )
        : {};
      const productAddonNonShow = channelSummaryForProduct
        ? Object.fromEntries(
            Object.entries(channelSummaryForProduct.addons).map(([key, bucket]) => [key, bucket.nonShow]),
          )
        : {};
      const productNormal = channelSummaryForProduct?.people.attended ?? 0;
      const productNonShow = channelSummaryForProduct?.people.nonShow ?? 0;
      const productTotal =
        productNormal + Object.values(productAddonValues).reduce((sum, value) => sum + value, 0);
      productMetrics[product.id.toString()] = {
        productId: product.id,
        normal: productNormal,
        nonShow: productNonShow,
        addons: productAddonValues,
        addonNonShow: productAddonNonShow,
        total: productTotal,
      };
    });

    return {
      channelId: channel.channelId,
      channelName: channel.channelName,
      normal: channel.people.attended,
      normalNonShow: channel.people.nonShow,
      addons: addonValues,
      addonNonShow,
      total,
      products: productMetrics,
    };
  });

  const totalAddonValues = Object.fromEntries(
    Object.entries(summary.totals.addons).map(([key, bucket]) => [key, bucket.attended]),
  );
  const totalAddonNonShow = Object.fromEntries(
    Object.entries(summary.totals.addons).map(([key, bucket]) => [key, bucket.nonShow]),
  );
  const totals = {
    normal: summary.totals.people.attended,
    normalNonShow: summary.totals.people.nonShow,
    addons: totalAddonValues,
    addonNonShow: totalAddonNonShow,
    total: summary.totals.people.attended + summary.totals.people.nonShow,
  };

  const productTotals: Record<string, ChannelProductMetrics> = {};
  productList.forEach((product) => {
    const productSummary = productSummaries.get(product.id);
    if (!productSummary) {
      productTotals[product.id.toString()] = {
        productId: product.id,
        normal: 0,
        nonShow: 0,
        addons: {},
        addonNonShow: {},
        total: 0,
      };
      return;
    }
    const productAddonValues = Object.fromEntries(
      Object.entries(productSummary.totals.addons).map(([key, bucket]) => [key, bucket.attended]),
    );
    const productAddonNonShow = Object.fromEntries(
      Object.entries(productSummary.totals.addons).map(([key, bucket]) => [key, bucket.nonShow]),
    );
    const productNormal = productSummary.totals.people.attended;
    const productNonShow = productSummary.totals.people.nonShow;
    const productTotal =
      productNormal + Object.values(productAddonValues).reduce((sum, value) => sum + value, 0);
    productTotals[product.id.toString()] = {
      productId: product.id,
      normal: productNormal,
      nonShow: productNonShow,
      addons: productAddonValues,
      addonNonShow: productAddonNonShow,
      total: productTotal,
    };
  });

  return {
    startDate: start.format('YYYY-MM-DD'),
    endDate: end.format('YYYY-MM-DD'),
    channels: channelData,
    addons: addonMeta,
    products: productList,
    productTypes,
    productTotals,
    totals,
  };
}
