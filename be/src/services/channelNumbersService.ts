import dayjs from 'dayjs';
import { Op, fn, col } from 'sequelize';

import CounterChannelMetric from '../models/CounterChannelMetric.js';
import Counter from '../models/Counter.js';
import CounterProduct from '../models/CounterProduct.js';
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
const LEGACY_COUNTER_START = dayjs('2025-10-01');

type LegacyCounterProductRow = {
  counterId: number;
  productId: number;
  quantity: number;
  total: number;
  productName: string | null;
};

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

export type ChannelNumbersDetailMetric = 'normal' | 'nonShow' | 'addon' | 'addonNonShow' | 'total';

export type ChannelNumbersDetailEntry = {
  counterId: number;
  counterDate: string;
  channelId: number;
  channelName: string;
  productId: number | null;
  productName: string | null;
  addonKey: string | null;
  addonName: string | null;
  bookedBefore: number;
  bookedAfter: number;
  attended: number;
  nonShow: number;
  value: number;
  note: string | null;
};

type ChannelNumbersDetailTotals = {
  bookedBefore: number;
  bookedAfter: number;
  attended: number;
  nonShow: number;
  value: number;
};

export type ChannelNumbersDetailResponse = {
  startDate: string;
  endDate: string;
  metric: ChannelNumbersDetailMetric;
  channelId: number | null;
  productId: number | null;
  addonKey: string | null;
  entries: ChannelNumbersDetailEntry[];
  totals: ChannelNumbersDetailTotals;
};

const isCashCurrency = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const sanitizeCurrency = (value: string | null | undefined): string =>
  (value ?? 'PLN').trim().toUpperCase().slice(0, 3) || 'PLN';

const toChannelSlug = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, '');

const isLegacyCounterDate = (value: string): boolean =>
  dayjs(value).isBefore(LEGACY_COUNTER_START, 'day');

const isLegacyCocktailProduct = (name: string): boolean =>
  name.toLowerCase().includes('cocktail');

const isLegacyCashProduct = (name: string): boolean =>
  name.toLowerCase().includes('cash');

const resolveLegacyChannelSlug = (productName: string): string => {
  const normalized = productName.toLowerCase();
  if (normalized.includes('fareharbor')) return toChannelSlug('Fareharbor');
  if (normalized.includes('viator')) return toChannelSlug('Viator');
  if (normalized.includes('getyourguide')) return toChannelSlug('GetYourGuide');
  if (normalized.includes('ecwid')) return toChannelSlug('Ecwid');
  if (normalized.includes('topdeck')) return toChannelSlug('TopDeck');
  if (normalized.includes('atlantis')) return toChannelSlug('Hostel Atlantis');
  if (normalized.includes('xperience')) return toChannelSlug('XperiencePoland');
  if (normalized.includes('free tour')) return toChannelSlug('FreeTour');
  if (normalized.includes('airbnb')) return toChannelSlug('Airbnb');
  if (normalized.includes('walk-in') || normalized.includes('walk in')) return toChannelSlug('Walk-In');
  return toChannelSlug('Walk-In');
};

const buildLegacyTicketSummaryMap = (params: {
  rows: LegacyCounterProductRow[];
  channelIdBySlug: Map<string, number>;
}): Map<string, string> => {
  const { rows, channelIdBySlug } = params;
  const grouped = new Map<string, string[]>();

  rows.forEach((row) => {
    const productName = row.productName ?? '';
    if (!isLegacyCashProduct(productName)) {
      return;
    }
    const total = Number(row.total) || 0;
    if (total <= 0) {
      return;
    }
    const channelSlug = resolveLegacyChannelSlug(productName);
    const channelId = channelIdBySlug.get(channelSlug) ?? channelIdBySlug.get(toChannelSlug('Walk-In'));
    if (!channelId) {
      return;
    }
    const key = `${row.counterId}|${channelId}`;
    const qty = Math.max(0, Number(row.quantity) || 0);
    const formattedAmount = total.toFixed(2);
    const labelBase = productName.trim() || 'Walk-In';
    const entry =
      qty > 0
        ? `${labelBase}: ${qty} (PLN ${formattedAmount})`
        : `${labelBase}: PLN ${formattedAmount}`;
    const bucket = grouped.get(key) ?? [];
    bucket.push(entry);
    grouped.set(key, bucket);
  });

  const summary = new Map<string, string>();
  grouped.forEach((entries, key) => {
    summary.set(key, entries.join(' | '));
  });

  return summary;
};

const buildLegacyMetrics = (params: {
  rows: LegacyCounterProductRow[];
  channelIdBySlug: Map<string, number>;
  cocktailsAddonId: number | null;
}): MetricCell[] => {
  const { rows, channelIdBySlug, cocktailsAddonId } = params;
  const buckets = new Map<
    string,
    {
      counterId: number;
      channelId: number;
      peopleQty: number;
      cocktailsQty: number;
      cashAmount: number;
    }
  >();

  rows.forEach((row) => {
    const qty = Math.max(0, Number(row.quantity) || 0);
    if (qty === 0) {
      return;
    }
    const productName = row.productName ?? '';
    const channelSlug = resolveLegacyChannelSlug(productName);
    const channelId = channelIdBySlug.get(channelSlug) ?? channelIdBySlug.get(toChannelSlug('Walk-In'));
    if (!channelId) {
      return;
    }
    const key = `${row.counterId}|${channelId}`;
    const bucket =
      buckets.get(key) ??
      {
        counterId: row.counterId,
        channelId,
        peopleQty: 0,
        cocktailsQty: 0,
        cashAmount: 0,
      };
    if (!buckets.has(key)) {
      buckets.set(key, bucket);
    }

    if (isLegacyCocktailProduct(productName)) {
      bucket.cocktailsQty += qty;
    } else {
      bucket.peopleQty += qty;
    }

    const total = Number(row.total) || 0;
    if (total > 0 && isLegacyCashProduct(productName)) {
      bucket.cashAmount += total;
    }
  });

  const metrics: MetricCell[] = [];
  const pushMetricPair = (entry: {
    counterId: number;
    channelId: number;
    kind: MetricKind;
    addonId: number | null;
    qty: number;
  }) => {
    const qty = Math.max(0, Number(entry.qty) || 0);
    if (qty === 0) {
      return;
    }
    metrics.push({
      counterId: entry.counterId,
      channelId: entry.channelId,
      kind: entry.kind,
      addonId: entry.addonId,
      tallyType: 'booked',
      period: 'before_cutoff',
      qty,
    });
    metrics.push({
      counterId: entry.counterId,
      channelId: entry.channelId,
      kind: entry.kind,
      addonId: entry.addonId,
      tallyType: 'attended',
      period: null,
      qty,
    });
  };

  buckets.forEach((bucket) => {
    let peopleQty = bucket.peopleQty;
    if (bucket.cocktailsQty > 0 && peopleQty === 0) {
      peopleQty = bucket.cocktailsQty;
    }
    if (peopleQty > 0) {
      pushMetricPair({
        counterId: bucket.counterId,
        channelId: bucket.channelId,
        kind: 'people',
        addonId: null,
        qty: peopleQty,
      });
    }
    if (bucket.cocktailsQty > 0 && cocktailsAddonId != null) {
      pushMetricPair({
        counterId: bucket.counterId,
        channelId: bucket.channelId,
        kind: 'addon',
        addonId: cocktailsAddonId,
        qty: bucket.cocktailsQty,
      });
    }
    if (bucket.cashAmount > 0) {
      metrics.push({
        counterId: bucket.counterId,
        channelId: bucket.channelId,
        kind: 'cash_payment',
        addonId: null,
        tallyType: 'attended',
        period: null,
        qty: Math.max(0, bucket.cashAmount),
      });
    }
  });

  return metrics;
};

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
  legacyTicketSummaries?: Map<string, string>;
  startIso: string;
  endIso: string;
  rangeIsCanonical: boolean;
}): Promise<ChannelCashSummary> {
  const { counters, metrics, channels, legacyTicketSummaries, startIso, endIso, rangeIsCanonical } = params;

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
      ticketSummary: legacyTicketSummaries?.get(key) ?? null,
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

const SNAPSHOT_BLOCKS = [
  { start: CASH_SNAPSHOT_START, end: CASH_SNAPSHOT_END },
  { start: FREE_SNAPSHOT_START, end: FREE_SNAPSHOT_END },
];

function stripSnapshotBlocks(note: string | null | undefined): string | null {
  if (!note) {
    return note ?? null;
  }
  let sanitized = note;
  SNAPSHOT_BLOCKS.forEach(({ start, end }) => {
    let startIndex = sanitized.indexOf(start);
    while (startIndex !== -1) {
      const endIndex = sanitized.indexOf(end, startIndex + start.length);
      if (endIndex === -1) {
        sanitized = sanitized.slice(0, startIndex);
        break;
      }
      sanitized =
        sanitized.slice(0, startIndex).trimEnd() +
        (sanitized.length > endIndex + end.length ? '\n' : '') +
        sanitized.slice(endIndex + end.length).trimStart();
      startIndex = sanitized.indexOf(start);
    }
  });
  sanitized = sanitized.trim();
  return sanitized.length === 0 ? null : sanitized;
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

  const [channelRows, addonRows, rawProductAddons, productNameRows] = await Promise.all([
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
    Product.findAll({
      attributes: ['id', 'name'],
      raw: true,
    }),
  ]);

  const productAddonRows = rawProductAddons as Array<
    ProductAddon & { product?: (Product & { ProductType?: ProductType | null }) | null }
  >;
  const productNameById = new Map<number, string>();
  (productNameRows as Array<{ id: number; name: string }>).forEach((row) => {
    productNameById.set(row.id, row.name);
  });

  const channelConfigs: ChannelConfig[] = buildChannelConfigs(channelRows);
  const { configs: addonConfigs, meta: addonMeta } = buildAddonConfigs(addonRows, productAddonRows, null);
  const channelIdBySlug = new Map<string, number>();
  channelConfigs.forEach((channel) => channelIdBySlug.set(toChannelSlug(channel.name), channel.id));
  const cocktailsAddonId =
    addonRows.find((addon) => addon.name.toLowerCase() === 'cocktails')?.id ?? null;
  const { productTypes, products } = await loadActiveProducts(end, addonMeta);
  const legacyProductId =
    products.find((product) => product.name.toLowerCase() === 'pub crawl')?.id ?? null;
  const productMap = new Map<number, ChannelNumbersProduct>();
  products.forEach((product) => productMap.set(product.id, product));
  const buildProductList = () =>
    Array.from(productMap.values()).sort((a, b) => a.name.localeCompare(b.name));

  if (legacyProductId != null) {
    counterMeta.forEach((entry) => {
      if (!isLegacyCounterDate(entry.date)) {
        return;
      }
      const current = counterProductLookup.get(entry.id) ?? null;
      if (current == null) {
        counterProductLookup.set(entry.id, legacyProductId);
      }
    });
  }

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

  const legacyCounterIds = counterMeta.filter((row) => isLegacyCounterDate(row.date)).map((row) => row.id);
  const legacyCounterSet = new Set(legacyCounterIds);
  const newCounterIds = counterIds.filter((id) => !legacyCounterSet.has(id));

  const metricRows =
    newCounterIds.length > 0
      ? await CounterChannelMetric.findAll({
          where: { counterId: { [Op.in]: newCounterIds } },
          attributes: ['id', 'counterId', 'channelId', 'kind', 'addonId', 'tallyType', 'period', 'qty'],
        })
      : [];

  const legacyRows =
    legacyCounterIds.length > 0
      ? ((await CounterProduct.findAll({
          where: { counterId: { [Op.in]: legacyCounterIds } },
          attributes: ['counterId', 'productId', 'quantity', 'total'],
          raw: true,
        })) as Array<{ counterId: number; productId: number; quantity: number; total: number }>).map((row) => ({
          counterId: row.counterId,
          productId: row.productId,
          quantity: row.quantity,
          total: row.total,
          productName: productNameById.get(row.productId) ?? null,
        }))
      : [];

  const legacyMetrics =
    legacyRows.length > 0
      ? buildLegacyMetrics({
          rows: legacyRows,
          channelIdBySlug,
          cocktailsAddonId,
        })
      : [];
  const legacyTicketSummaries =
    legacyRows.length > 0 ? buildLegacyTicketSummaryMap({ rows: legacyRows, channelIdBySlug }) : undefined;

  const metricsByProduct = new Map<number | null, MetricCell[]>();
  const metrics: MetricCell[] = [];
  const pushMetric = (metric: MetricCell) => {
    const productId = counterProductLookup.get(metric.counterId) ?? null;
    const bucket = metricsByProduct.get(productId) ?? [];
    bucket.push(metric);
    metricsByProduct.set(productId, bucket);
    metrics.push(metric);
  };

  metricRows.forEach((metric) => {
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
    pushMetric(normalized);
  });

  legacyMetrics.forEach((metric) => {
    pushMetric(metric);
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
    legacyTicketSummaries,
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

type ChannelNumbersDetailParams = {
  startDate?: string;
  endDate?: string;
  channelId?: number | null;
  productId?: number | null;
  addonKey?: string | null;
  metric: ChannelNumbersDetailMetric;
};

const DETAIL_METRICS: Set<ChannelNumbersDetailMetric> = new Set([
  'normal',
  'nonShow',
  'addon',
  'addonNonShow',
  'total',
]);

export async function getChannelNumbersDetails(
  params: ChannelNumbersDetailParams,
): Promise<ChannelNumbersDetailResponse> {
  const { metric } = params;
  if (!DETAIL_METRICS.has(metric)) {
    throw new HttpError(400, 'Unsupported metric requested');
  }

  const channelId =
    params.channelId === undefined || params.channelId === null ? null : Number(params.channelId);
  if (channelId != null && (!Number.isInteger(channelId) || channelId <= 0)) {
    throw new HttpError(400, 'channelId must be a positive integer when provided');
  }

  const productId =
    params.productId === undefined
      ? undefined
      : params.productId === null
        ? null
        : Number(params.productId);
  if (productId !== undefined && productId !== null && (!Number.isInteger(productId) || productId <= 0)) {
    throw new HttpError(400, 'productId must be a positive integer when provided');
  }

  const requiresAddon = metric === 'addon' || metric === 'addonNonShow';
  const addonKey = requiresAddon ? params.addonKey ?? null : null;
  if (requiresAddon && (!addonKey || addonKey.trim().length === 0)) {
    throw new HttpError(400, 'addonKey is required for addon metrics');
  }

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

  const [channelRows, addonRows, productNameRows] = await Promise.all([
    Channel.findAll({ attributes: ['id', 'name'] }),
    Addon.findAll({ where: { isActive: true } }),
    Product.findAll({ attributes: ['id', 'name'], raw: true }),
  ]);
  const channelLookup = new Map<number, string>();
  const channelIdBySlug = new Map<string, number>();
  channelRows.forEach((row) => channelLookup.set(row.id, row.name));
  channelRows.forEach((row) => channelIdBySlug.set(toChannelSlug(row.name), row.id));

  const productNameById = new Map<number, string>();
  (productNameRows as Array<{ id: number; name: string }>).forEach((row) => {
    productNameById.set(row.id, row.name);
  });

  const cocktailsAddonId =
    addonRows.find((addon) => addon.name.toLowerCase() === 'cocktails')?.id ?? null;

  let addonLookup = new Map<
    number,
    {
      key: string;
      name: string;
    }
  >();
  let targetAddonId: number | null = null;

  if (requiresAddon) {
    const productAddons = await ProductAddon.findAll({
      include: [
        {
          model: Product,
          as: 'product',
          include: [{ model: ProductType, as: 'ProductType' }],
        },
      ],
    });
    const { configs } = buildAddonConfigs(
      addonRows,
      productAddons as Array<ProductAddon & { product?: (Product & { ProductType?: ProductType | null }) | null }>,
      null,
    );
    addonLookup = new Map(configs.map((config) => [config.addonId, { key: config.key, name: config.name }]));
    const matched = configs.find((config) => config.key === addonKey);
    if (!matched) {
      throw new HttpError(404, 'Addon not found');
    }
    targetAddonId = matched.addonId;
  }

  const counters = await Counter.findAll({
    where: { date: { [Op.between]: [startIso, endIso] } },
    attributes: ['id', 'date', 'productId', 'notes'],
    include: [{ model: Product, as: 'product', attributes: ['id', 'name'] }],
  });

  const legacyProductId =
    (productNameRows as Array<{ id: number; name: string }>).find(
      (row) => row.name.toLowerCase() === 'pub crawl',
    )?.id ?? null;

  const filteredCounters = counters.filter((counter) => {
    if (productId === undefined) {
      return true;
    }
    if (productId === null) {
      return counter.productId == null;
    }
    if (counter.productId === productId) {
      return true;
    }
    if (
      legacyProductId != null &&
      productId === legacyProductId &&
      counter.productId == null &&
      isLegacyCounterDate(counter.date)
    ) {
      return true;
    }
    return false;
  });

  const counterLookup = new Map<
    number,
    {
      date: string;
      productId: number | null;
      productName: string | null;
      notes: string | null;
    }
  >();

  filteredCounters.forEach((counter) => {
    const isLegacy = isLegacyCounterDate(counter.date);
    const resolvedProductId =
      isLegacy && legacyProductId != null && counter.productId == null ? legacyProductId : counter.productId ?? null;
    const fallbackName =
      resolvedProductId != null ? productNameById.get(resolvedProductId) ?? `Product ${resolvedProductId}` : null;
    counterLookup.set(counter.id, {
      date: counter.date,
      productId: resolvedProductId,
      productName: counter.product?.name ?? fallbackName,
      notes: counter.notes ?? null,
    });
  });

  const counterIds = Array.from(counterLookup.keys());
  if (counterIds.length === 0) {
    return {
      startDate: startIso,
      endDate: endIso,
      metric,
      channelId,
      productId: productId ?? null,
      addonKey: addonKey ?? null,
      entries: [],
      totals: {
        bookedBefore: 0,
        bookedAfter: 0,
        attended: 0,
        nonShow: 0,
        value: 0,
      },
    };
  }

  const metricWhere: Record<string, unknown> = {
    counterId: { [Op.in]: counterIds },
    kind: requiresAddon ? 'addon' : 'people',
  };
  if (channelId != null) {
    metricWhere.channelId = channelId;
  }
  if (requiresAddon) {
    metricWhere.addonId = targetAddonId;
  }

  const legacyCounterIds = counterIds.filter((id) => {
    const counter = counterLookup.get(id);
    return counter ? isLegacyCounterDate(counter.date) : false;
  });
  const legacyCounterSet = new Set(legacyCounterIds);
  const newCounterIds = counterIds.filter((id) => !legacyCounterSet.has(id));

  const metricRows =
    newCounterIds.length > 0
      ? await CounterChannelMetric.findAll({
          where: { ...metricWhere, counterId: { [Op.in]: newCounterIds } },
          attributes: ['counterId', 'channelId', 'addonId', 'tallyType', 'period', 'qty'],
        })
      : [];

  const legacyRows =
    legacyCounterIds.length > 0
      ? ((await CounterProduct.findAll({
          where: { counterId: { [Op.in]: legacyCounterIds } },
          attributes: ['counterId', 'productId', 'quantity', 'total'],
          raw: true,
        })) as Array<{ counterId: number; productId: number; quantity: number; total: number }>).map((row) => ({
          counterId: row.counterId,
          productId: row.productId,
          quantity: row.quantity,
          total: row.total,
          productName: productNameById.get(row.productId) ?? null,
        }))
      : [];

  const legacyMetrics =
    legacyRows.length > 0
      ? buildLegacyMetrics({
          rows: legacyRows,
          channelIdBySlug,
          cocktailsAddonId,
        })
      : [];

  const filteredLegacyMetrics = legacyMetrics.filter((metric) => {
    if (metric.kind !== (requiresAddon ? 'addon' : 'people')) {
      return false;
    }
    if (channelId != null && metric.channelId !== channelId) {
      return false;
    }
    if (requiresAddon && metric.addonId !== targetAddonId) {
      return false;
    }
    return true;
  });

  type Bucket = {
    counterId: number;
    channelId: number;
    addonId: number | null;
    bookedBefore: number;
    bookedAfter: number;
    attended: number;
  };

  const buckets = new Map<string, Bucket>();
  const combinedMetrics: MetricCell[] = [
    ...metricRows.map((row) => ({
      counterId: row.counterId,
      channelId: row.channelId,
      addonId: row.addonId ?? null,
      kind: (requiresAddon ? 'addon' : 'people') as MetricKind,
      tallyType: row.tallyType as MetricTallyType,
      period:
        row.tallyType === 'attended'
          ? null
          : ((row.period as MetricPeriod | null) ?? 'before_cutoff'),
      qty: Number(row.qty ?? 0),
    })),
    ...filteredLegacyMetrics,
  ];

  combinedMetrics.forEach((metric) => {
    const addonId = metric.addonId ?? null;
    const key = [metric.counterId, metric.channelId, addonId ?? 'null'].join('|');
    const existing =
      buckets.get(key) ??
      {
        counterId: metric.counterId,
        channelId: metric.channelId,
        addonId,
        bookedBefore: 0,
        bookedAfter: 0,
        attended: 0,
      };

    if (!buckets.has(key)) {
      buckets.set(key, existing);
    }

    const qty = Number(metric.qty ?? 0);
    if (metric.tallyType === 'booked') {
      if (metric.period === 'before_cutoff') {
        existing.bookedBefore += qty;
      } else {
        existing.bookedAfter += qty;
      }
    } else if (metric.tallyType === 'attended') {
      existing.attended += qty;
    }
  });

  const entries: ChannelNumbersDetailEntry[] = [];

  buckets.forEach((bucket) => {
    const counter = counterLookup.get(bucket.counterId);
    if (!counter) {
      return;
    }
    const sanitizedNote = stripSnapshotBlocks(counter.notes);
    const nonShow = Math.max(bucket.bookedBefore + bucket.bookedAfter - bucket.attended, 0);
    const channelName = channelLookup.get(bucket.channelId) ?? `Channel ${bucket.channelId}`;
    const addonMeta = bucket.addonId != null ? addonLookup.get(bucket.addonId) ?? null : null;
    let value = 0;
    switch (metric) {
      case 'normal':
      case 'addon':
        value = bucket.attended;
        break;
      case 'nonShow':
      case 'addonNonShow':
        value = nonShow;
        break;
      case 'total':
        value = bucket.attended + nonShow;
        break;
      default:
        value = bucket.attended;
    }

    entries.push({
      counterId: bucket.counterId,
      counterDate: counter.date,
      channelId: bucket.channelId,
      channelName,
      productId: counter.productId,
      productName: counter.productName,
      addonKey: addonMeta?.key ?? null,
      addonName: addonMeta?.name ?? null,
      bookedBefore: bucket.bookedBefore,
      bookedAfter: bucket.bookedAfter,
      attended: bucket.attended,
      nonShow,
      value,
      note: sanitizedNote,
    });
  });

  entries.sort((a, b) => {
    if (a.counterDate === b.counterDate) {
      if (a.channelName === b.channelName) {
        if (a.channelId === b.channelId) {
          return (a.counterId ?? 0) - (b.counterId ?? 0);
        }
        return a.channelId - b.channelId;
      }
      return a.channelName.localeCompare(b.channelName);
    }
    return a.counterDate.localeCompare(b.counterDate);
  });

  const totals = entries.reduce<ChannelNumbersDetailTotals>(
    (acc, entry) => {
      acc.bookedBefore += entry.bookedBefore;
      acc.bookedAfter += entry.bookedAfter;
      acc.attended += entry.attended;
      acc.nonShow += entry.nonShow;
      acc.value += entry.value;
      return acc;
    },
    { bookedBefore: 0, bookedAfter: 0, attended: 0, nonShow: 0, value: 0 },
  );

  return {
    startDate: startIso,
    endDate: endIso,
    metric,
    channelId,
    productId: productId ?? null,
    addonKey: addonKey ?? null,
    entries,
    totals,
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
