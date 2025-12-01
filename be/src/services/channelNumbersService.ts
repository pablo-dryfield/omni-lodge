import dayjs from 'dayjs';
import { Op, fn, col } from 'sequelize';

import CounterChannelMetric from '../models/CounterChannelMetric.js';
import Counter from '../models/Counter.js';
import Channel from '../models/Channel.js';
import PaymentMethod from '../models/PaymentMethod.js';
import Addon from '../models/Addon.js';
import ProductAddon from '../models/ProductAddon.js';
import Product from '../models/Product.js';
import ProductType from '../models/ProductType.js';
import HttpError from '../errors/HttpError.js';
import ChannelCashCollectionLog from '../models/ChannelCashCollectionLog.js';
import FinanceTransaction from '../finance/models/FinanceTransaction.js';
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

const CASH_SNAPSHOT_START = '-- CASH-SNAPSHOT START --';
const CASH_SNAPSHOT_END = '-- CASH-SNAPSHOT END --';
const FREE_SNAPSHOT_START = '-- FREE-SNAPSHOT START --';
const FREE_SNAPSHOT_END = '-- FREE-SNAPSHOT END --';
const WALK_IN_CHANNEL_SLUG = 'walk-in';

type CashSnapshotTicketCurrency = {
  currency: string;
  people: number;
  cash: number;
  addons: Record<string, number>;
};

type CashSnapshotTicket = {
  name: string;
  currencies: CashSnapshotTicketCurrency[];
};

type CashSnapshotEntry = {
  currency: string;
  amount: number;
  qty: number;
  tickets?: CashSnapshotTicket[];
};

type ChannelCashAmount = {
  currency: string;
  amount: number;
};

type ChannelCashEntry = {
  channelId: number;
  channelName: string;
  counterId: number;
  counterDate: string;
  ticketSummary: string | null;
  note: string | null;
  amounts: ChannelCashAmount[];
};

type ChannelCashRow = {
  channelId: number;
  channelName: string;
  currency: string;
  dueAmount: number;
  collectedAmount: number;
  outstandingAmount: number;
};

type ChannelCashSummary = {
  rangeIsCanonical: boolean;
  channels: ChannelCashRow[];
  entries: ChannelCashEntry[];
  totals: Array<{
    currency: string;
    dueAmount: number;
    collectedAmount: number;
    outstandingAmount: number;
  }>;
};

const isCashCurrency = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const sanitizeCurrency = (value: string | null | undefined): string =>
  (value ?? 'PLN').trim().toUpperCase().slice(0, 3) || 'PLN';

const extractCashSnapshotMap = (note: string | null | undefined): Map<number, CashSnapshotEntry> => {
  const entries = new Map<number, CashSnapshotEntry>();
  if (!note) {
    return entries;
  }
  const startIndex = note.indexOf(CASH_SNAPSHOT_START);
  if (startIndex === -1) {
    return entries;
  }
  const endIndex = note.indexOf(CASH_SNAPSHOT_END, startIndex + CASH_SNAPSHOT_START.length);
  if (endIndex === -1) {
    return entries;
  }
  const snapshotRaw = note.slice(startIndex + CASH_SNAPSHOT_START.length, endIndex).trim();
  if (!snapshotRaw) {
    return entries;
  }
  try {
    const parsed = JSON.parse(snapshotRaw) as {
      channels?: Record<
        string,
        {
          currency?: unknown;
          amount?: unknown;
          qty?: unknown;
          tickets?: unknown;
        }
      >;
    };
    const channels = parsed && typeof parsed === 'object' ? parsed.channels : null;
    if (!channels || typeof channels !== 'object') {
      return entries;
    }
    Object.entries(channels).forEach(([channelId, value]) => {
      if (!value || typeof value !== 'object') {
        return;
      }
      const numericChannelId = Number(channelId);
      if (!Number.isFinite(numericChannelId)) {
        return;
      }
      const currency = sanitizeCurrency(
        isCashCurrency((value as { currency?: unknown }).currency)
          ? ((value as { currency?: string }).currency as string)
          : null,
      );
      const numericAmount = Number((value as { amount?: unknown }).amount);
      const normalizedAmount = Number.isFinite(numericAmount) ? Math.max(0, Number(numericAmount)) : 0;
      const numericQty = Number((value as { qty?: unknown }).qty);
      const normalizedQty = Number.isFinite(numericQty) && numericQty > 0 ? Math.round(numericQty) : 0;

      const ticketsRaw = Array.isArray((value as { tickets?: unknown }).tickets)
        ? ((value as { tickets?: unknown }).tickets as unknown[])
        : [];
      const tickets: CashSnapshotTicket[] = [];
      ticketsRaw.forEach((ticketCandidate) => {
        if (!ticketCandidate || typeof ticketCandidate !== 'object') {
          return;
        }
        const ticketNameRaw = (ticketCandidate as { name?: unknown }).name;
        if (typeof ticketNameRaw !== 'string' || ticketNameRaw.trim().length === 0) {
          return;
        }
        const currenciesRaw = Array.isArray((ticketCandidate as { currencies?: unknown }).currencies)
          ? ((ticketCandidate as { currencies?: unknown }).currencies as unknown[])
          : [];
        const currencies: CashSnapshotTicketCurrency[] = [];
        currenciesRaw.forEach((currencyCandidate) => {
          if (!currencyCandidate || typeof currencyCandidate !== 'object') {
            return;
          }
          const currencyValue = sanitizeCurrency(
            isCashCurrency((currencyCandidate as { currency?: unknown }).currency)
              ? ((currencyCandidate as { currency?: string }).currency as string)
              : null,
          );
          const peopleValue = Number((currencyCandidate as { people?: unknown }).people);
          const normalizedPeople = Number.isFinite(peopleValue) ? Math.max(0, Math.round(peopleValue)) : 0;
          const cashValue = Number((currencyCandidate as { cash?: unknown }).cash);
          const normalizedCash = Number.isFinite(cashValue) ? Math.max(0, Number(cashValue)) : 0;
          const addonsValue = (currencyCandidate as { addons?: unknown }).addons;
          const addons: Record<string, number> = {};
          if (addonsValue && typeof addonsValue === 'object') {
            Object.entries(addonsValue as Record<string, unknown>).forEach(([addonKey, qty]) => {
              const numericQty = Number(qty);
              if (!Number.isFinite(numericQty)) {
                return;
              }
              const normalizedAddonQty = Math.max(0, Math.round(numericQty));
              if (normalizedAddonQty > 0) {
                addons[addonKey] = normalizedAddonQty;
              }
            });
          }
          currencies.push({
            currency: currencyValue,
            people: normalizedPeople,
            cash: normalizedCash,
            addons,
          });
        });
        if (currencies.length === 0) {
          return;
        }
        tickets.push({
          name: ticketNameRaw.trim(),
          currencies,
        });
      });

      entries.set(numericChannelId, {
        currency,
        amount: normalizedAmount,
        qty: normalizedQty,
        tickets: tickets.length > 0 ? tickets : undefined,
      });
    });
  } catch {
    return entries;
  }

  return entries;
};

const stripSnapshotFromNote = (note: string | null | undefined): string => {
  if (!note) {
    return '';
  }
  const escapedCashStart = CASH_SNAPSHOT_START.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  const escapedCashEnd = CASH_SNAPSHOT_END.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  const escapedFreeStart = FREE_SNAPSHOT_START.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  const escapedFreeEnd = FREE_SNAPSHOT_END.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  const stripBlock = (input: string, start: string, end: string) => {
    const pattern = new RegExp(`${start}[\\s\\S]*?${end}`, 'g');
    return input.replace(pattern, '');
  };
  const filteredLines: string[] = [];
  let skippingSnapshot = false;
  note.split('\n').forEach((line) => {
    const trimmed = line.trim();
    if (trimmed === CASH_SNAPSHOT_START || trimmed === FREE_SNAPSHOT_START) {
      skippingSnapshot = true;
      return;
    }
    if (trimmed === CASH_SNAPSHOT_END || trimmed === FREE_SNAPSHOT_END) {
      skippingSnapshot = false;
      return;
    }
    if (skippingSnapshot || !trimmed) {
      return;
    }
    const lower = trimmed.toLowerCase();
    if (lower.startsWith('walk-in tickets:') || lower.startsWith('cash collected:')) {
      return;
    }
    filteredLines.push(line.trimEnd());
  });

  let sanitized = filteredLines.join('\n').trim();
  sanitized = stripBlock(sanitized, escapedCashStart, escapedCashEnd);
  sanitized = stripBlock(sanitized, escapedFreeStart, escapedFreeEnd);
  return sanitized.trim();
};

const aggregateCashTotals = (entry: CashSnapshotEntry): Map<string, number> => {
  const totals = new Map<string, number>();
  if (entry.tickets && entry.tickets.length > 0) {
    entry.tickets.forEach((ticket) => {
      ticket.currencies.forEach((currencyEntry) => {
        const amount = Number(currencyEntry.cash);
        if (!Number.isFinite(amount) || amount <= 0) {
          return;
        }
        const currency = sanitizeCurrency(currencyEntry.currency);
        totals.set(currency, (totals.get(currency) ?? 0) + amount);
      });
    });
  }
  if ((!entry.tickets || entry.tickets.length === 0) && entry.amount > 0) {
    const currency = sanitizeCurrency(entry.currency);
    totals.set(currency, (totals.get(currency) ?? 0) + entry.amount);
  }
  return totals;
};

const buildTicketSummary = (entry: CashSnapshotEntry, channelName: string): string | null => {
  if (!entry.tickets || entry.tickets.length === 0) {
    return null;
  }
  const parts = entry.tickets
    .map((ticket) => {
      const name = ticket.name?.trim() || channelName;
      const currencyParts = ticket.currencies
        .map((currencyEntry) => {
          const amount = Number(currencyEntry.cash);
          const people = Number(currencyEntry.people);
          if (!Number.isFinite(amount) || amount <= 0) {
            return null;
          }
          const formattedAmount = amount.toFixed(2);
          if (Number.isFinite(people) && people > 0) {
            return `${currencyEntry.currency} ${formattedAmount} (${Math.round(people)} ppl)`;
          }
          return `${currencyEntry.currency} ${formattedAmount}`;
        })
        .filter((value): value is string => Boolean(value));
      if (currencyParts.length === 0) {
        return null;
      }
      return `${name}: ${currencyParts.join(', ')}`;
    })
    .filter((value): value is string => Boolean(value));

  if (parts.length === 0) {
    return null;
  }
  return parts.join(' | ');
};

const roundCurrencyValue = (value: number): number => Math.round(Number(value ?? 0) * 100) / 100;

async function buildChannelCashSummary(params: {
  counters: Array<{ id: number; date: string; notes: string | null }>;
  metrics: MetricCell[];
  channels: ChannelConfig[];
  startIso: string;
  endIso: string;
  rangeIsCanonical: boolean;
}): Promise<ChannelCashSummary> {
  const { counters, metrics, channels, startIso, endIso, rangeIsCanonical } = params;

  const channelLookup = new Map<number, ChannelConfig>();
  channels.forEach((channel) => channelLookup.set(channel.id, channel));
  const cashEligibleChannels = new Set(
    channels.filter((channel) => channel.cashPaymentEligible).map((channel) => channel.id),
  );

  const cashMetricsByCounterChannel = new Map<string, number>();
  metrics.forEach((metric) => {
    if (metric.kind !== 'cash_payment' || metric.tallyType !== 'attended') {
      return;
    }
    const key = `${metric.counterId}|${metric.channelId}`;
    const normalizedQty = Number(metric.qty);
    if (!Number.isFinite(normalizedQty) || normalizedQty <= 0) {
      return;
    }
    cashMetricsByCounterChannel.set(key, roundCurrencyValue(normalizedQty));
  });

  const processedPairs = new Set<string>();
  const entries: ChannelCashEntry[] = [];
  const channelTotals = new Map<string, ChannelCashRow>();

  counters.forEach((counter) => {
    const snapshotMap = extractCashSnapshotMap(counter.notes);
    const noteText = stripSnapshotFromNote(counter.notes);

    snapshotMap.forEach((snapshotEntry, channelId) => {
      if (!cashEligibleChannels.has(channelId)) {
        return;
      }
      const channel = channelLookup.get(channelId);
      if (!channel) {
        return;
      }
      const amountsMap = aggregateCashTotals(snapshotEntry);
      const amounts: ChannelCashAmount[] = [];
      amountsMap.forEach((amount, currency) => {
        if (!Number.isFinite(amount) || amount <= 0) {
          return;
        }
        amounts.push({
          currency,
          amount: roundCurrencyValue(amount),
        });
      });

      if (amounts.length === 0) {
        const metricKey = `${counter.id}|${channelId}`;
        const fallback = cashMetricsByCounterChannel.get(metricKey);
        if (fallback && fallback > 0) {
          amounts.push({
            currency: sanitizeCurrency(snapshotEntry.currency),
            amount: roundCurrencyValue(fallback),
          });
          processedPairs.add(metricKey);
        } else {
          return;
        }
      }

      const ticketSummary = buildTicketSummary(snapshotEntry, channel.name);
      entries.push({
        channelId,
        channelName: channel.name,
        counterId: counter.id,
        counterDate: counter.date,
        ticketSummary,
        note: noteText || null,
        amounts,
      });

      const metricKey = `${counter.id}|${channelId}`;
      processedPairs.add(metricKey);

      amounts.forEach((amount) => {
        const currency = sanitizeCurrency(amount.currency);
        const key = `${channelId}|${currency}`;
        const existing =
          channelTotals.get(key) ??
          ({
            channelId,
            channelName: channel.name,
            currency,
            dueAmount: 0,
            collectedAmount: 0,
            outstandingAmount: 0,
          } as ChannelCashRow);
        existing.dueAmount = roundCurrencyValue(existing.dueAmount + amount.amount);
        channelTotals.set(key, existing);
      });
    });
  });

  cashMetricsByCounterChannel.forEach((amount, key) => {
    if (processedPairs.has(key)) {
      return;
    }
    const [counterIdRaw, channelIdRaw] = key.split('|');
    const channelId = Number(channelIdRaw);
    if (!cashEligibleChannels.has(channelId)) {
      return;
    }
    const channel = channelLookup.get(channelId);
    const counter = counters.find((row) => row.id === Number(counterIdRaw));
    if (!channel || !counter) {
      return;
    }
    const normalizedAmount = roundCurrencyValue(amount);
    if (normalizedAmount <= 0) {
      return;
    }
    entries.push({
      channelId,
      channelName: channel.name,
      counterId: counter.id,
      counterDate: counter.date,
      ticketSummary: null,
      note: stripSnapshotFromNote(counter.notes),
      amounts: [{ currency: 'PLN', amount: normalizedAmount }],
    });
    const currency = 'PLN';
    const totalsKey = `${channelId}|${currency}`;
    const existing =
      channelTotals.get(totalsKey) ??
      ({
        channelId,
        channelName: channel.name,
        currency,
        dueAmount: 0,
        collectedAmount: 0,
        outstandingAmount: 0,
      } as ChannelCashRow);
    existing.dueAmount = roundCurrencyValue(existing.dueAmount + normalizedAmount);
    channelTotals.set(totalsKey, existing);
  });

  const collectionRows = (await ChannelCashCollectionLog.findAll({
    attributes: [
      'channelId',
      'currencyCode',
      [fn('COALESCE', fn('SUM', col('amount_minor')), 0), 'totalAmountMinor'],
    ],
    where: {
      rangeStart: startIso,
      rangeEnd: endIso,
    },
    group: ['channel_id', 'currency_code'],
    raw: true,
  })) as unknown as Array<{ channelId: number; currencyCode: string; totalAmountMinor: number }>;

  collectionRows.forEach((row) => {
    const currency = sanitizeCurrency(row.currencyCode);
    const key = `${row.channelId}|${currency}`;
    const entry =
      channelTotals.get(key) ??
      ({
        channelId: row.channelId,
        channelName: channelLookup.get(row.channelId)?.name ?? `Channel ${row.channelId}`,
        currency,
        dueAmount: 0,
        collectedAmount: 0,
        outstandingAmount: 0,
      } as ChannelCashRow);
    const collected = roundCurrencyValue((Number(row.totalAmountMinor ?? 0) || 0) / 100);
    entry.collectedAmount = roundCurrencyValue(entry.collectedAmount + collected);
    channelTotals.set(key, entry);
  });

  channelTotals.forEach((row) => {
    row.outstandingAmount = roundCurrencyValue(Math.max(0, row.dueAmount - row.collectedAmount));
  });

  entries.sort((a, b) => {
    if (a.counterDate === b.counterDate) {
      if (a.channelName === b.channelName) {
        return a.counterId - b.counterId;
      }
      return a.channelName.localeCompare(b.channelName);
    }
    return dayjs(a.counterDate).diff(dayjs(b.counterDate));
  });

  const totalsByCurrency = new Map<string, { due: number; collected: number }>();
  channelTotals.forEach((row) => {
    const entry = totalsByCurrency.get(row.currency) ?? { due: 0, collected: 0 };
    entry.due = roundCurrencyValue(entry.due + row.dueAmount);
    entry.collected = roundCurrencyValue(entry.collected + row.collectedAmount);
    totalsByCurrency.set(row.currency, entry);
  });

  const totals = Array.from(totalsByCurrency.entries()).map(([currency, sums]) => ({
    currency,
    dueAmount: roundCurrencyValue(sums.due),
    collectedAmount: roundCurrencyValue(sums.collected),
    outstandingAmount: roundCurrencyValue(Math.max(0, sums.due - sums.collected)),
  }));

  const rows = Array.from(channelTotals.values()).sort((a, b) => {
    if (a.channelName === b.channelName) {
      return a.currency.localeCompare(b.currency);
    }
    return a.channelName.localeCompare(b.channelName);
  });

  return {
    rangeIsCanonical,
    channels: rows,
    entries,
    totals,
  };
}

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
  cashSummary: ChannelCashSummary;
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

  const startIso = start.format('YYYY-MM-DD');
  const endIso = end.format('YYYY-MM-DD');
  const rangeIsCanonical =
    start.isSame(start.startOf('month'), 'day') &&
    end.isSame(start.endOf('month'), 'day') &&
    start.isSame(end, 'month') &&
    start.year() === end.year();

  const counters = await Counter.findAll({
    where: { date: { [Op.between]: [startIso, endIso] } },
    attributes: ['id', 'productId', 'date', 'notes'],
  });

  const counterProductLookup = new Map<number, number | null>();
  const counterMeta: Array<{ id: number; date: string; notes: string | null }> = [];
  const counterIds = counters.map((counter) => {
    counterProductLookup.set(counter.id, counter.productId ?? null);
    counterMeta.push({
      id: counter.id,
      date: counter.date,
      notes: counter.notes ?? null,
    });
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
    const emptyCashSummary: ChannelCashSummary = {
      rangeIsCanonical,
      channels: [],
      entries: [],
      totals: [],
    };
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
      cashSummary: emptyCashSummary,
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

  const cashSummary = await buildChannelCashSummary({
    counters: counterMeta,
    metrics,
    channels: channelConfigs,
    startIso,
    endIso,
    rangeIsCanonical,
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
    cashSummary,
  };
}

export async function recordChannelCashCollection(params: {
  channelId: number;
  currency: string;
  amount: number;
  rangeStart: string;
  rangeEnd: string;
  financeTransactionId?: number | null;
  note?: string | null;
  actorId: number;
}): Promise<ChannelCashCollectionLog> {
  const { channelId, currency, amount, rangeStart, rangeEnd, financeTransactionId, note, actorId } = params;

  if (!Number.isInteger(channelId) || channelId <= 0) {
    throw new HttpError(400, 'channelId must be a positive integer');
  }

  const channelRecord = await Channel.findByPk(channelId, {
    include: [{ model: PaymentMethod, as: 'paymentMethod' }],
  });
  if (!channelRecord) {
    throw new HttpError(404, 'Channel not found');
  }
  const paymentName = channelRecord.paymentMethod?.name?.toLowerCase() ?? '';
  if (paymentName !== 'cash') {
    throw new HttpError(400, 'This channel is not configured for cash payments');
  }

  const normalizedCurrency = sanitizeCurrency(currency);
  const normalizedAmount = Number(amount);
  if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
    throw new HttpError(400, 'Amount must be greater than zero');
  }
  const amountMinor = Math.round(normalizedAmount * 100);

  const start = dayjs(rangeStart, 'YYYY-MM-DD', true);
  const end = dayjs(rangeEnd, 'YYYY-MM-DD', true);
  if (!start.isValid() || !end.isValid() || end.isBefore(start)) {
    throw new HttpError(400, 'Invalid date range supplied');
  }
  const rangeIsCanonical =
    start.isSame(start.startOf('month'), 'day') &&
    end.isSame(start.endOf('month'), 'day') &&
    start.isSame(end, 'month') &&
    start.year() === end.year();
  if (!rangeIsCanonical) {
    throw new HttpError(400, 'Collections can only be recorded for full calendar months');
  }

  let financeTransactionIdValue: number | null = null;
  if (financeTransactionId != null) {
    if (!Number.isInteger(financeTransactionId) || financeTransactionId <= 0) {
      throw new HttpError(400, 'financeTransactionId must be a positive integer');
    }
    const transactionExists = await FinanceTransaction.count({ where: { id: financeTransactionId } });
    if (!transactionExists) {
      throw new HttpError(400, 'Finance transaction not found');
    }
    financeTransactionIdValue = financeTransactionId;
  }

  const record = await ChannelCashCollectionLog.create({
    channelId,
    currencyCode: normalizedCurrency,
    amountMinor,
    rangeStart: start.format('YYYY-MM-DD'),
    rangeEnd: end.format('YYYY-MM-DD'),
    financeTransactionId: financeTransactionIdValue,
    note: note?.trim() ? note.trim() : null,
    createdBy: actorId,
  });

  return record;
}
