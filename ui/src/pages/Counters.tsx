import type { ChangeEvent, KeyboardEvent, MouseEvent, SyntheticEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState, startTransition } from 'react';
import dayjs, { Dayjs } from 'dayjs';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import Autocomplete from '@mui/material/Autocomplete';
import Grid from '@mui/material/Grid';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  Chip,
  CircularProgress,
  Collapse,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  InputAdornment,
  LinearProgress,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Skeleton,
  Step,
  StepButton,
  Stepper,
  Stack,
  TextField,
  Typography,
  Tooltip,
} from '@mui/material';
import { Add, Check, Close, Delete, Edit, Visibility, Map as MapIcon, KeyboardArrowRight, Remove } from '@mui/icons-material';
import { useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import { Link } from 'react-router-dom';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { deleteCounter, fetchCounters } from '../actions/counterActions';
import { createNightReport, fetchNightReports, updateNightReport } from '../actions/nightReportActions';
import { navigateToPage } from '../actions/navigationActions';
import { GenericPageProps } from '../types/general/GenericPageProps';
import { loadCatalog, selectCatalog } from '../store/catalogSlice';
import {
  clearDirtyMetrics,
  clearCounter,
  ensureCounterForDate,
  fetchCounterByDate,
  flushDirtyMetrics,
  selectCounterRegistry,
  setMetric,
  updateCounterStaff,
  updateCounterProduct,
  updateCounterManager,
  updateCounterStatus,
  updateCounterNotes,
} from '../store/counterRegistrySlice';
import {
  AddonConfig,
  CatalogProduct,
  ChannelConfig,
  CounterStatus,
  CounterSummary,
  CounterSummaryAddonBucket,
  CounterSummaryBucket,
  CounterSummaryChannel,
  MetricCell,
  MetricKind,
  MetricPeriod,
  MetricTallyType,
  StaffOption,
} from '../types/counters/CounterRegistry';
import { buildMetricKey } from '../utils/counterMetrics';
import type { Counter } from '../types/counters/Counter';
import axiosInstance from '../utils/axiosInstance';
import type { ServerResponse } from '../types/general/ServerResponse';
import type { NightReport, NightReportSummary } from '../types/nightReports/NightReport';

const COUNTER_DATE_FORMAT = 'YYYY-MM-DD';
const WALK_IN_CHANNEL_SLUG = 'walk-in';
const AFTER_CUTOFF_ALLOWED = new Set(['ecwid', WALK_IN_CHANNEL_SLUG]);
const DEFAULT_PRODUCT_NAME = 'Pub Crawl';
const bucketLabels: Record<string, string> = {
  attended: 'Attended (Tonight)',
  before_cutoff: 'Booked BEFORE cut-off',
  after_cutoff: 'Booked AFTER cut-off',
};

type BucketDescriptor = {
  tallyType: MetricTallyType;
  period: MetricPeriod;
  label: string;
};
type CashCurrency = 'PLN' | 'EUR';

const BUCKETS: BucketDescriptor[] = [
  { tallyType: 'attended', period: null, label: bucketLabels.attended },
  { tallyType: 'booked', period: 'before_cutoff', label: bucketLabels.before_cutoff },
  { tallyType: 'booked', period: 'after_cutoff', label: bucketLabels.after_cutoff },
];

const WALK_IN_DISCOUNT_OPTIONS = [
  'Normal',
  'Custom',
  'Second Timers',
  'Third Timers',
  'Half Price',
  'Students',
  'Group',
];
const WALK_IN_DISCOUNT_NOTE_PREFIX = 'Walk-In Tickets:';
const WALK_IN_CASH_NOTE_PREFIX = 'Cash Collected:';
const CASH_SNAPSHOT_START = '-- CASH-SNAPSHOT START --';
const CASH_SNAPSHOT_END = '-- CASH-SNAPSHOT END --';
const CASH_SNAPSHOT_VERSION = 2;
const FREE_SNAPSHOT_START = '-- FREE-SNAPSHOT START --';
const FREE_SNAPSHOT_END = '-- FREE-SNAPSHOT END --';
const FREE_SNAPSHOT_VERSION = 1;
const CUSTOM_TICKET_LABEL = 'Custom';
const WALK_IN_TICKET_UNIT_PRICES: Record<string, Partial<Record<CashCurrency, number>>> = {
  Normal: { EUR: 25 },
  'Second Timers': { PLN: 85, EUR: 20 },
  'Third Timers': { PLN: 75, EUR: 17 },
  'Half Price': { PLN: 50, EUR: 12 },
  Students: { PLN: 80, EUR: 19 },
  Group: { PLN: 85, EUR: 20 },
};
const WALK_IN_ADDON_UNIT_PRICES: Record<string, Partial<Record<CashCurrency, number>>> = {
  cocktails: { EUR: 7 },
  tshirts: { EUR: 10 },
  photos: { EUR: 3 },
};
type WalkInSnapshotCurrency = {
  currency: CashCurrency;
  people: number;
  cash: number;
  addons: Record<string, number>;
};

type WalkInSnapshotTicket = {
  name: string;
  currencies: WalkInSnapshotCurrency[];
};

type CashSnapshotEntry = {
  currency: CashCurrency;
  amount: number;
  qty: number;
  tickets?: WalkInSnapshotTicket[];
};

type FreeSnapshotAddonEntry = {
  qty: number;
  note: string;
};

type FreeSnapshotPeopleEntry = {
  qty: number;
  note: string;
};

type FreeSnapshotChannelEntry = {
  people?: FreeSnapshotPeopleEntry;
  addons?: Record<string, FreeSnapshotAddonEntry>;
};

type FreeSnapshotPayload = {
  version: number;
  channels: Record<string, FreeSnapshotChannelEntry>;
};

type WalkInCurrencyEntryState = {
  people: number;
  cash: string;
  addons: Record<number, number>;
};

type WalkInTicketEntryState = {
  name: string;
  currencyOrder: CashCurrency[];
  currencies: Partial<Record<CashCurrency, WalkInCurrencyEntryState>>;
};

type WalkInChannelTicketState = {
  ticketOrder: string[];
  tickets: Record<string, WalkInTicketEntryState>;
};
const CASH_CURRENCY_PRICE_OVERRIDES: Record<string, Partial<Record<CashCurrency, number>>> = {
  topdeck: {
    EUR: 17,
  },
};
const WALK_IN_DISCOUNT_LOOKUP = new Map(
  WALK_IN_DISCOUNT_OPTIONS.map((label) => [label.toLowerCase(), label] as const),
);

const WALK_IN_CASH_FORMATTER = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

type IdleHandle = number | ReturnType<typeof setTimeout>;

const formatCashAmount = (amount: number): string => {
  if (!Number.isFinite(amount)) {
    return WALK_IN_CASH_FORMATTER.format(0);
  }
  return WALK_IN_CASH_FORMATTER.format(amount);
};

const normalizeCashValue = (value: number): string => {
  if (!Number.isFinite(value)) {
    return '0.00';
  }
  return (Math.round(value * 100) / 100).toFixed(2);
};

type IdleRequestCallback = (deadline: IdleDeadline) => void;
interface IdleDeadline {
  readonly didTimeout: boolean;
  timeRemaining(): number;
}

const scheduleIdle = (callback: () => void): IdleHandle => {
  const g = globalThis as typeof globalThis & {
    requestIdleCallback?: (cb: IdleRequestCallback) => number;
  };
  if (typeof g.requestIdleCallback === 'function') {
    return g.requestIdleCallback(() => callback());
  }
  return setTimeout(callback, 0);
};

const cancelIdle = (handle: IdleHandle) => {
  const g = globalThis as typeof globalThis & {
    cancelIdleCallback?: (id: number) => void;
  };
  if (typeof g.cancelIdleCallback === 'function' && typeof handle === 'number') {
    g.cancelIdleCallback(handle);
    return;
  }
  clearTimeout(handle as ReturnType<typeof setTimeout>);
};

const parseCashInput = (value: string): number | null => {
  if (value == null) {
    return null;
  }
  const sanitized = value.replace(/[^0-9.,-]/g, '').replace(/,/g, '');
  if (sanitized.trim() === '') {
    return null;
  }
  const numeric = Number(sanitized);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return Math.max(0, Math.round(numeric * 100) / 100);
};

const valuesAreClose = (a: number | null, b: number | null, epsilon = 0.01): boolean => {
  if (a == null && b == null) {
    return true;
  }
  if (a == null || b == null) {
    return false;
  }
  return Math.abs(a - b) <= epsilon;
};

const isCashPaymentChannel = (channel: ChannelConfig): boolean => {
  const explicitFlag = channel.cashPaymentEligible ?? false;
  const paymentName = channel.paymentMethodName?.toLowerCase() ?? '';
  return explicitFlag || paymentName === 'cash';
};

const normalizeDiscountSelection = (values: string[]): string[] => {
  const normalized = new Set<string>();
  values.forEach((value) => {
    const canonical = WALK_IN_DISCOUNT_LOOKUP.get(value.toLowerCase());
    if (canonical) {
      normalized.add(canonical);
    }
  });
  return WALK_IN_DISCOUNT_OPTIONS.filter((option) => normalized.has(option));
};

const parseDiscountsFromNote = (note: string | null | undefined): string[] => {
  if (!note) {
    return [];
  }
  const lines = note.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.toLowerCase().startsWith(WALK_IN_DISCOUNT_NOTE_PREFIX.toLowerCase())) {
      const remainder = trimmed.slice(WALK_IN_DISCOUNT_NOTE_PREFIX.length).trim();
      if (!remainder) {
        return [];
      }
      const discountSectionRaw = remainder.split('|')[0]?.trim() ?? '';
      const discountSection = discountSectionRaw
        .split(WALK_IN_CASH_NOTE_PREFIX)[0]
        ?.trim() ?? '';
      if (!discountSection) {
        return [];
      }
      const tokens = discountSection
        .split(',')
        .map((token) => token.trim())
        .filter((token) => token.length > 0);
      return normalizeDiscountSelection(tokens);
    }
  }
  return [];
};

const normalizeChannelKey = (name: string | null | undefined): string =>
  (name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const getWalkInTicketUnitPrice = (
  channel: ChannelConfig | undefined,
  ticketLabel: string,
  currency: CashCurrency,
): number | null => {
  if (ticketLabel === CUSTOM_TICKET_LABEL) {
    return null;
  }
  if (ticketLabel === 'Normal' && currency === 'PLN') {
    return channel ? getCashPriceForChannel(channel, 'PLN') : null;
  }
  const price = WALK_IN_TICKET_UNIT_PRICES[ticketLabel]?.[currency];
  return price != null && Number.isFinite(price) ? price : null;
};

const normalizeAddonIdentifier = (addon: AddonConfig | null | undefined): string =>
  normalizeChannelKey(addon?.key ?? addon?.name ?? '');

const normalizeCurrencyValue = (value: unknown): number | null => {
  if (value === null || value === undefined) {
    return null;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  const normalized = Math.round(numeric * 100) / 100;
  return Math.max(0, normalized);
};

const getWalkInAddonUnitPrice = (
  channel: ChannelConfig | undefined,
  addon: AddonConfig | null | undefined,
  currency: CashCurrency,
  fallbackAddon?: AddonConfig | null,
): number | null => {
  if (!addon) {
    return null;
  }
  const normalizedKey = normalizeAddonIdentifier(addon);
  const mapped = WALK_IN_ADDON_UNIT_PRICES[normalizedKey]?.[currency];
  if (mapped != null && Number.isFinite(mapped)) {
    return Math.max(0, Math.round(Number(mapped) * 100) / 100);
  }
  const overridePrice = normalizeCurrencyValue(
    addon.priceOverride ?? fallbackAddon?.priceOverride,
  );
  const basePrice = normalizeCurrencyValue(addon.basePrice ?? fallbackAddon?.basePrice);
  if (currency === 'PLN') {
    if (overridePrice != null) {
      return overridePrice;
    }
    if (basePrice != null) {
      return basePrice;
    }
  }
  return overridePrice;
};

const getCashPriceForChannel = (channel: ChannelConfig, currency: CashCurrency): number | null => {
  const normalizedChannel = normalizeChannelKey(channel.name);
  const overrides = CASH_CURRENCY_PRICE_OVERRIDES[normalizedChannel];
  const overridePrice = overrides?.[currency];
  const resolved = overridePrice ?? (channel.cashPrice != null ? Number(channel.cashPrice) : null);
  if (resolved == null || !Number.isFinite(resolved)) {
    return null;
  }
  return Math.max(0, Math.round(Number(resolved) * 100) / 100);
};

const isCashCurrency = (value: unknown): value is CashCurrency => value === 'PLN' || value === 'EUR';

const extractCashSnapshotMap = (
  note: string | null | undefined,
): Map<number, CashSnapshotEntry> => {
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
      version?: number;
      channels?: Record<string, { currency?: unknown; amount?: unknown; qty?: unknown; tickets?: unknown }>;
    };
    const channels = parsed && typeof parsed === 'object' ? parsed.channels : null;
    if (!channels || typeof channels !== 'object') {
      return entries;
    }
    Object.entries(channels).forEach(([channelId, value]) => {
      if (!value || typeof value !== 'object') {
        return;
      }
      const currency = isCashCurrency((value as { currency?: unknown }).currency) ? (value as { currency?: CashCurrency }).currency! : 'PLN';
      const numericAmount = Number((value as { amount?: unknown }).amount);
      if (!Number.isFinite(numericAmount)) {
        return;
      }
      const normalizedAmount = Math.max(0, Math.round(numericAmount * 100) / 100);
      const numericQtyRaw = Number((value as { qty?: unknown }).qty);
      const normalizedQty =
        Number.isFinite(numericQtyRaw) && numericQtyRaw > 0 ? Math.round(numericQtyRaw) : 0;
      const numericChannelId = Number(channelId);
      if (!Number.isFinite(numericChannelId)) {
        return;
      }

      const ticketsRaw = Array.isArray((value as { tickets?: unknown }).tickets)
        ? ((value as { tickets?: unknown }).tickets as unknown[])
        : [];
      const tickets: WalkInSnapshotTicket[] = [];
      ticketsRaw.forEach((ticketCandidate) => {
        if (!ticketCandidate || typeof ticketCandidate !== 'object') {
          return;
        }
        const ticketNameRaw = (ticketCandidate as { name?: unknown }).name;
        if (typeof ticketNameRaw !== 'string' || ticketNameRaw.trim() === '') {
          return;
        }
        const currenciesRaw = Array.isArray((ticketCandidate as { currencies?: unknown }).currencies)
          ? ((ticketCandidate as { currencies?: unknown }).currencies as unknown[])
          : [];
        const currencies: WalkInSnapshotCurrency[] = [];
        currenciesRaw.forEach((currencyCandidate) => {
          if (!currencyCandidate || typeof currencyCandidate !== 'object') {
            return;
          }
          const currencyValue = (currencyCandidate as { currency?: unknown }).currency;
          if (!isCashCurrency(currencyValue)) {
            return;
          }
          const peopleValue = Number((currencyCandidate as { people?: unknown }).people);
          const normalizedPeople = Number.isFinite(peopleValue) ? Math.max(0, Math.round(peopleValue)) : 0;
          const cashValue = Number((currencyCandidate as { cash?: unknown }).cash);
          const normalizedCash = Number.isFinite(cashValue)
            ? Math.max(0, Math.round(cashValue * 100) / 100)
            : 0;
          const addonsRaw = (currencyCandidate as { addons?: unknown }).addons;
          const addons: Record<string, number> = {};
          if (addonsRaw && typeof addonsRaw === 'object') {
            Object.entries(addonsRaw as Record<string, unknown>).forEach(([addonId, qtyValue]) => {
              const numericQty = Number(qtyValue);
              if (!Number.isFinite(numericQty)) {
                return;
              }
              const normalizedAddonQty = Math.max(0, Math.round(numericQty));
              if (normalizedAddonQty > 0) {
                addons[addonId] = normalizedAddonQty;
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
          name: ticketNameRaw,
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
  } catch (_error) {
    return entries;
  }
  return entries;
};

const serializeCashSnapshot = (channels: Record<string, CashSnapshotEntry>): string => {
  const payload = {
    version: CASH_SNAPSHOT_VERSION,
    channels,
  };
  return `${CASH_SNAPSHOT_START}\n${JSON.stringify(payload)}\n${CASH_SNAPSHOT_END}`;
};

const extractFreeSnapshotMap = (
  note: string | null | undefined,
): Map<number, FreeSnapshotChannelEntry> => {
  const entries = new Map<number, FreeSnapshotChannelEntry>();
  if (!note) {
    return entries;
  }
  const startIndex = note.indexOf(FREE_SNAPSHOT_START);
  if (startIndex === -1) {
    return entries;
  }
  const endIndex = note.indexOf(FREE_SNAPSHOT_END, startIndex + FREE_SNAPSHOT_START.length);
  if (endIndex === -1) {
    return entries;
  }
  const snapshotRaw = note.slice(startIndex + FREE_SNAPSHOT_START.length, endIndex).trim();
  if (!snapshotRaw) {
    return entries;
  }
  try {
    const parsed = JSON.parse(snapshotRaw) as FreeSnapshotPayload | undefined;
    if (!parsed || typeof parsed !== 'object') {
      return entries;
    }
    const channels = parsed.channels ?? {};
    Object.entries(channels).forEach(([channelId, value]) => {
      const numericChannelId = Number(channelId);
      if (!Number.isFinite(numericChannelId) || !value || typeof value !== 'object') {
        return;
      }
      const peopleRaw = (value as FreeSnapshotChannelEntry).people;
      const addonsRaw = (value as FreeSnapshotChannelEntry).addons;
      const entry: FreeSnapshotChannelEntry = {};
      if (peopleRaw && typeof peopleRaw === 'object') {
        const qty = Math.max(0, Math.round(Number(peopleRaw.qty) || 0));
        const noteValue =
          typeof peopleRaw.note === 'string' ? peopleRaw.note.trim() : String(peopleRaw.note ?? '');
        if (qty > 0 || noteValue.length > 0) {
          entry.people = {
            qty,
            note: noteValue,
          };
        }
      }
      if (addonsRaw && typeof addonsRaw === 'object') {
        const normalizedAddons: Record<string, FreeSnapshotAddonEntry> = {};
        Object.entries(addonsRaw).forEach(([addonId, addonValue]) => {
          if (!addonValue || typeof addonValue !== 'object') {
            return;
          }
          const qty = Math.max(0, Math.round(Number((addonValue as FreeSnapshotAddonEntry).qty) || 0));
          const noteValue =
            typeof (addonValue as FreeSnapshotAddonEntry).note === 'string'
              ? (addonValue as FreeSnapshotAddonEntry).note.trim()
              : String((addonValue as FreeSnapshotAddonEntry).note ?? '');
          if (qty > 0 || noteValue.length > 0) {
            normalizedAddons[addonId] = {
              qty,
              note: noteValue,
            };
          }
        });
        if (Object.keys(normalizedAddons).length > 0) {
          entry.addons = normalizedAddons;
        }
      }
      if (entry.people || entry.addons) {
        entries.set(numericChannelId, entry);
      }
    });
  } catch (_error) {
    return entries;
  }
  return entries;
};

const serializeFreeSnapshot = (channels: Record<string, FreeSnapshotChannelEntry>): string => {
  const payload: FreeSnapshotPayload = {
    version: FREE_SNAPSHOT_VERSION,
    channels,
  };
  return `${FREE_SNAPSHOT_START}\n${JSON.stringify(payload)}\n${FREE_SNAPSHOT_END}`;
};

const stripSnapshotFromNote = (note: string): string => {
  if (!note) {
    return '';
  }
  const escapedStart = CASH_SNAPSHOT_START.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  const escapedEnd = CASH_SNAPSHOT_END.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  const escapedFreeStart = FREE_SNAPSHOT_START.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  const escapedFreeEnd = FREE_SNAPSHOT_END.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  const stripBlock = (input: string, start: string, end: string) => {
    const pattern = new RegExp(`${start}[\\s\\S]*?${end}`, 'g');
    return input.replace(pattern, '');
  };
  let sanitized = stripBlock(note, escapedStart, escapedEnd);
  sanitized = stripBlock(sanitized, escapedFreeStart, escapedFreeEnd);
  return sanitized.trim();
};

const aggregateCashTotals = (entry: CashSnapshotEntry): Map<string, number> => {
  const totals = new Map<string, number>();
  if (entry.tickets && entry.tickets.length > 0) {
    entry.tickets.forEach((ticket) => {
      ticket.currencies.forEach((currency) => {
        const amount = Number(currency.cash);
        if (Number.isFinite(amount) && amount > 0) {
          totals.set(currency.currency, (totals.get(currency.currency) ?? 0) + amount);
        }
      });
    });
  }
  const amount = Number(entry.amount);
  if ((!entry.tickets || entry.tickets.length === 0) && entry.currency && Number.isFinite(amount) && amount > 0) {
    totals.set(entry.currency, (totals.get(entry.currency) ?? 0) + amount);
  }
  return totals;
};

const formatWalkInSnapshotSummary = (
  note: string,
  channels: ChannelConfig[],
  addons: AddonConfig[],
): string => {
  if (!note) {
    return '';
  }
  const walkInChannel = channels.find((channel) => channel.name?.toLowerCase() === WALK_IN_CHANNEL_SLUG);
  if (!walkInChannel) {
    return '';
  }

  const walkInId = walkInChannel.id;
  const cashMap = extractCashSnapshotMap(note);
  const freeMap = extractFreeSnapshotMap(note);

  const cashEntry = cashMap.get(walkInId);
  const freeEntry = freeMap.get(walkInId);

  const ticketNames = new Set<string>();
  const currencyTotals = new Map<string, number>();

  if (cashEntry) {
    if (cashEntry.tickets && cashEntry.tickets.length > 0) {
      cashEntry.tickets.forEach((ticket) => {
        if (ticket.name) {
          ticketNames.add(ticket.name);
        }
        ticket.currencies.forEach((currency) => {
          const amount = Number(currency.cash);
          if (Number.isFinite(amount) && amount > 0) {
            currencyTotals.set(currency.currency, (currencyTotals.get(currency.currency) ?? 0) + amount);
          }
        });
      });
    }
    const fallbackTotals = aggregateCashTotals(cashEntry);
    fallbackTotals.forEach((amount, currency) => {
      currencyTotals.set(currency, (currencyTotals.get(currency) ?? 0) + amount);
    });
  }

  const addonNameById = new Map<number, string>();
  addons.forEach((addon) => addonNameById.set(addon.addonId, addon.name));

  const freeParts: string[] = [];
  if (freeEntry?.people) {
    const qty = Math.max(0, Math.round(Number(freeEntry.people.qty) || 0));
    const noteText = (freeEntry.people.note ?? '').toString().trim();
    if (qty > 0 || noteText.length > 0) {
      const detail = `${qty}${noteText ? ` - ${noteText}` : ''}`;
      freeParts.push(`People: ${detail}`);
    }
  }
  if (freeEntry?.addons) {
    Object.entries(freeEntry.addons).forEach(([addonIdKey, info]) => {
      const addonId = Number(addonIdKey);
      if (!Number.isFinite(addonId)) {
        return;
      }
      const qty = Math.max(0, Math.round(Number(info.qty) || 0));
      const noteText = (info.note ?? '').toString().trim();
      if (qty <= 0 && noteText.length === 0) {
        return;
      }
      const addonName = addonNameById.get(addonId) ?? `Addon ${addonId}`;
      const detail = `${qty}${noteText ? ` - ${noteText}` : ''}`;
      freeParts.push(`${addonName}: ${detail}`);
    });
  }

  if (ticketNames.size === 0 && freeParts.length === 0 && currencyTotals.size === 0) {
    return '';
  }

  const segments: string[] = [];
  if (ticketNames.size > 0) {
    segments.push(`Walk-In Tickets: ${Array.from(ticketNames).join(', ')}`);
  } else {
    segments.push('Walk-In Tickets');
  }

  if (freeParts.length > 0) {
    segments.push(`Free (${freeParts.join(', ')})`);
  }

  if (currencyTotals.size > 0) {
    const cashSummary = Array.from(currencyTotals.entries())
      .map(([currency, amount]) => `${currency} ${amount.toFixed(2)}`)
      .join(', ');
    segments.push(`Cash Collected: ${cashSummary}`);
  }

  return segments.join(' | ');
};

const formatCounterSnapshotDetails = (
  note: string,
  channels: ChannelConfig[],
  addons: AddonConfig[],
): string => {
  if (!note) {
    return '';
  }

  const lines: string[] = [];
  const walkInSummary = formatWalkInSnapshotSummary(note, channels, addons);
  if (walkInSummary) {
    lines.push(walkInSummary);
  }

  const manual = stripSnapshotFromNote(note);
  if (manual) {
    lines.push(manual);
  }

  const cashMap = extractCashSnapshotMap(note);
  const freeMap = extractFreeSnapshotMap(note);
  const addonNameById = new Map<number, string>();
  addons.forEach((addon) => addonNameById.set(addon.addonId, addon.name));
  const channelNameById = new Map<number, string>();
  channels.forEach((channel) => channelNameById.set(channel.id, channel.name ?? `Channel ${channel.id}`));

  cashMap.forEach((entry, channelId) => {
    const channelName = channelNameById.get(channelId) ?? `Channel ${channelId}`;
    const totals = aggregateCashTotals(entry);
    if (totals.size > 0) {
      const cashSummary = Array.from(totals.entries())
        .map(([currency, amount]) => `${currency} ${amount.toFixed(2)}`)
        .join(', ');
      lines.push(`Cash Collected (${channelName}): ${cashSummary}`);
    }
    if (entry.tickets && entry.tickets.length > 0) {
      const ticketNames = new Set<string>();
      entry.tickets.forEach((ticket) => {
        if (ticket.name) {
          ticketNames.add(ticket.name);
        }
      });
      if (ticketNames.size > 0) {
        lines.push(`Tickets (${channelName}): ${Array.from(ticketNames).join(', ')}`);
      }
    }
  });

  freeMap.forEach((entry, channelId) => {
    const channelName = channelNameById.get(channelId) ?? `Channel ${channelId}`;
    if (entry.people) {
      const qty = Math.max(0, Math.round(Number(entry.people.qty) || 0));
      const noteText = (entry.people.note ?? '').toString().trim();
      if (qty > 0 || noteText.length > 0) {
        const detail = `${qty}${noteText ? ` - ${noteText}` : ''}`;
        lines.push(`Free People (${channelName}): ${detail}`);
      }
    }
    if (entry.addons) {
      Object.entries(entry.addons).forEach(([addonIdKey, info]) => {
        const addonId = Number(addonIdKey);
        if (!Number.isFinite(addonId)) {
          return;
        }
        const qty = Math.max(0, Math.round(Number(info.qty) || 0));
        const noteText = (info.note ?? '').toString().trim();
        if (qty <= 0 && noteText.length === 0) {
          return;
        }
        const addonName = addonNameById.get(addonId) ?? `Addon ${addonId}`;
        const detail = `${qty}${noteText ? ` - ${noteText}` : ''}`;
        lines.push(`Free ${addonName} (${channelName}): ${detail}`);
      });
    }
  });

  return lines.join('\n').trim();
};

const formatCounterNotePreview = (
  note: string,
  channels: ChannelConfig[],
  addons: AddonConfig[],
): string => {
  const summary = formatWalkInSnapshotSummary(note, channels, addons);
  const manual = stripSnapshotFromNote(note);
  if (summary && manual) {
    return `${summary}\n${manual}`;
  }
  return summary || manual;
};
type RegistryStep = 'details' | 'platforms' | 'reservations' | 'summary';

const STEP_CONFIGS: Array<{ key: RegistryStep; label: string; description: string }> = [
  {
    key: 'details',
    label: 'Counter Setup',
    description: 'Choose the date, manager, product, and staff for this counter.',
  },
  {
    key: 'platforms',
    label: 'Platform Check',
    description: '',
  },
  {
    key: 'reservations',
    label: 'Reservations Check',
    description: "",
  },
  {
    key: 'summary',
    label: 'Summary',
    description: 'Review totals and save your counter metrics.',
  },
];

const PLATFORM_BUCKETS = BUCKETS.filter(
  (bucket) => bucket.tallyType === 'booked' && bucket.period === 'before_cutoff',
);
const RESERVATION_BUCKETS = BUCKETS.filter((bucket) => bucket.tallyType === 'attended');
const AFTER_CUTOFF_BUCKET = BUCKETS.find(
  (bucket) => bucket.tallyType === 'booked' && bucket.period === 'after_cutoff',
) as BucketDescriptor;

const normalizeMetric = (metric: MetricCell): MetricCell => {
  const numericQty = Number(metric.qty);
  const qty = Number.isFinite(numericQty) ? numericQty : 0;
  if (metric.tallyType === 'booked') {
    return { ...metric, qty, period: metric.period ?? 'before_cutoff' };
  }
  if (metric.tallyType === 'attended') {
    return { ...metric, qty, period: null };
  }
  return { ...metric, qty };
};


const buildDisplayName = (option: StaffOption) => {
  if (option.fullName && option.fullName.trim().length > 0) {
    return option.fullName;
  }
  const first = option.firstName ?? '';
  const last = option.lastName ?? '';
  const combined = (first + ' ' + last).trim();
  return combined.length > 0 ? combined : 'Unknown';
};

const extractNameParts = (fullName?: string | null): { firstName: string | null; lastName: string | null } => {
  if (!fullName) {
    return { firstName: null, lastName: null };
  }
  const segments = fullName.trim().split(/\s+/);
  if (segments.length === 0) {
    return { firstName: null, lastName: null };
  }
  const firstName = segments[0] ?? null;
  const lastName = segments.length > 1 ? segments.slice(1).join(' ') : null;
  return { firstName, lastName };
};

const composeName = (firstName?: string | null, lastName?: string | null): string => {
  return [firstName ?? '', lastName ?? ''].join(' ').trim();
};

const normalizeIdList = (ids: number[]): number[] => [...ids].sort((a, b) => a - b);

const idListsEqual = (a: number[], b: number[]): boolean => {
  if (a.length !== b.length) {
    return false;
  }
  const normalizedA = normalizeIdList(a);
  const normalizedB = normalizeIdList(b);
  return normalizedA.every((value, index) => value === normalizedB[index]);
};

const mapStatusToStep = (status: CounterStatus | null | undefined): RegistryStep => {
  switch (status) {
    case 'platforms':
      return 'platforms';
    case 'reservations':
      return 'reservations';
    case 'final':
      return 'summary';
    case 'draft':
    default:
      return 'details';
  }
};

const Counters = (props: GenericPageProps) => {
  const dispatch = useAppDispatch();
  const theme = useTheme();
  const isMobileScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const catalog = useAppSelector(selectCatalog);
  const registry = useAppSelector(selectCounterRegistry);
  const combinedAddonList = useMemo(() => {
    const map = new Map<number, AddonConfig>();
    registry.addons.forEach((addon) => map.set(addon.addonId, addon));
    catalog.addons.forEach((addon) => {
      if (!map.has(addon.addonId)) {
        map.set(addon.addonId, addon);
      }
    });
    return Array.from(map.values());
  }, [catalog.addons, registry.addons]);
  const nightReportListState = useAppSelector((state) => state.nightReports.list[0]);
  const session = useAppSelector((state) => state.session);
  const [selectedDate, setSelectedDate] = useState<Dayjs>(dayjs());
  const [selectedManagerId, setSelectedManagerId] = useState<number | null>(session.loggedUserId ?? null);
  const [counterList, setCounterList] = useState<Partial<Counter>[]>([]);
  const [counterListLoading, setCounterListLoading] = useState(false);
  const [counterListError, setCounterListError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'create' | 'update' | null>(null);
  const [activeRegistryStep, setActiveRegistryStep] = useState<RegistryStep>('details');
  const [confirmingMetrics, setConfirmingMetrics] = useState(false);
  const [ensuringCounter, setEnsuringCounter] = useState(false);
  const [pendingProductId, setPendingProductId] = useState<number | null>(null);
  const [pendingStaffIds, setPendingStaffIds] = useState<number[]>([]);
  const [pendingStaffDirty, setPendingStaffDirty] = useState(false);
  const [selectedCounterId, setSelectedCounterId] = useState<number | null>(
    registry.counter?.counter.id ?? null,
  );
  const fetchCounterRequestRef = useRef<string | null>(null);
  const lastPersistedStaffIdsRef = useRef<number[]>([]);
  const lastInitializedCounterRef = useRef<string | null>(null);
  const lastWalkInInitRef = useRef<string | null>(null);
  const [walkInCashByChannel, setWalkInCashByChannel] = useState<Record<number, string>>({});
  const [walkInDiscountsByChannel, setWalkInDiscountsByChannel] = useState<Record<number, string[]>>({});
  const [walkInTicketDataByChannel, setWalkInTicketDataByChannel] = useState<Record<number, WalkInChannelTicketState>>({});
  const [editingCustomTicket, setEditingCustomTicket] = useState<{
    channelId: number;
    ticketLabel: string;
    value: string;
  } | null>(null);
  const [walkInNoteDirty, setWalkInNoteDirty] = useState(false);
  const [freePeopleByChannel, setFreePeopleByChannel] = useState<Record<number, FreeSnapshotPeopleEntry>>({});
  const [freeAddonsByChannel, setFreeAddonsByChannel] = useState<
    Record<number, Record<number, FreeSnapshotAddonEntry>>
  >({});
  const [cashOverridesByChannel, setCashOverridesByChannel] = useState<Record<number, string>>({});
  const [cashEditingChannelId, setCashEditingChannelId] = useState<number | null>(null);
  const [cashEditingValue, setCashEditingValue] = useState<string>('');
  const [cashCurrencyByChannel, setCashCurrencyByChannel] = useState<Record<number, CashCurrency>>({});
  const [shouldRefreshCounterList, setShouldRefreshCounterList] = useState(false);
  const [expandedCounterId, setExpandedCounterId] = useState<number | null>(null);
  const [summaryPreviewOpen, setSummaryPreviewOpen] = useState(false);
  const [summaryPreviewLoading, setSummaryPreviewLoading] = useState(false);
  const [summaryPreviewTitle, setSummaryPreviewTitle] = useState<string>('');

  const formatAutoCashString = useCallback((value: number) => {
    const normalized = Math.max(0, Math.round(value * 100) / 100);
    if (!Number.isFinite(normalized) || normalized === 0) {
      return '0';
    }
    return Number.isInteger(normalized) ? String(normalized) : normalized.toFixed(2);
  }, []);

  const recalcWalkInChannelAutoCash = useCallback(
    (channelId: number, channelState: WalkInChannelTicketState): WalkInChannelTicketState => {
      const channel = registry.channels.find((item) => item.id === channelId);
      if (!channel) {
        return channelState;
      }

      let channelMutated = false;
      const nextTickets: Record<string, WalkInTicketEntryState> = {};

      channelState.ticketOrder.forEach((ticketLabel) => {
        const ticketEntry = channelState.tickets[ticketLabel];
        if (!ticketEntry) {
          return;
        }

        if (ticketLabel === CUSTOM_TICKET_LABEL) {
          nextTickets[ticketLabel] = ticketEntry;
          return;
        }

        let ticketMutated = false;
        const nextCurrencies: Partial<Record<CashCurrency, WalkInCurrencyEntryState>> = { ...ticketEntry.currencies };

        ticketEntry.currencyOrder.forEach((currency) => {
          const currencyEntry = nextCurrencies[currency];
          if (!currencyEntry) {
            return;
          }

          const unitPrice = getWalkInTicketUnitPrice(channel, ticketLabel, currency);
          if (unitPrice == null) {
            if (currencyEntry.cash !== '0') {
              nextCurrencies[currency] = { ...currencyEntry, cash: '0' };
              ticketMutated = true;
            }
            return;
          }

          let total = unitPrice * (currencyEntry.people ?? 0);

          Object.entries(currencyEntry.addons).forEach(([addonIdKey, qtyValue]) => {
            const qty = Number(qtyValue);
            if (!Number.isFinite(qty) || qty <= 0) {
              return;
            }
            const addonId = Number(addonIdKey);
            const registryAddon =
              registry.addons.find((addon) => addon.addonId === addonId) ?? null;
            const catalogAddon =
              catalog.addons.find((addon) => addon.addonId === addonId) ?? null;
            const addonConfig = registryAddon ?? catalogAddon;
            const addonUnitPrice = getWalkInAddonUnitPrice(
              channel,
              addonConfig,
              currency,
              catalogAddon,
            );
            if (addonUnitPrice != null) {
              total += addonUnitPrice * qty;
            }
          });

          const formattedCash = formatAutoCashString(total);
          if (currencyEntry.cash !== formattedCash) {
            nextCurrencies[currency] = { ...currencyEntry, cash: formattedCash };
            ticketMutated = true;
          }
        });

        if (ticketMutated) {
          nextTickets[ticketLabel] = {
            ...ticketEntry,
            currencies: nextCurrencies,
          };
          channelMutated = true;
        } else {
          nextTickets[ticketLabel] = ticketEntry;
        }
      });

      if (!channelMutated) {
        return channelState;
      }

      return {
        ticketOrder: channelState.ticketOrder,
        tickets: nextTickets,
      };
    },
    [catalog.addons, formatAutoCashString, registry.addons, registry.channels],
  );

  const recalcWalkInTicketDataMap = useCallback(
    (map: Record<number, WalkInChannelTicketState>): Record<number, WalkInChannelTicketState> => {
      let mutated = false;
      const nextMap: Record<number, WalkInChannelTicketState> = {};
      Object.entries(map).forEach(([id, state]) => {
        const channelId = Number(id);
        const recalculated = recalcWalkInChannelAutoCash(channelId, state);
        if (recalculated !== state) {
          mutated = true;
        }
        nextMap[channelId] = recalculated;
      });
      return mutated ? nextMap : map;
    },
    [recalcWalkInChannelAutoCash],
  );

  const applyAutoCashToChannelMap = useCallback(
    (map: Record<number, WalkInChannelTicketState>, channelId: number) => {
      const channelState = map[channelId];
      if (!channelState) {
        return map;
      }
      const recalculated = recalcWalkInChannelAutoCash(channelId, channelState);
      if (recalculated === channelState) {
        return map;
      }
      return { ...map, [channelId]: recalculated };
    },
    [recalcWalkInChannelAutoCash],
  );

  const counterId = registry.counter?.counter.id ?? null;
  const counterStatus = (registry.counter?.counter.status as CounterStatus | undefined) ?? 'draft';
  const counterProductId = registry.counter?.counter.productId ?? null;
  const counterNotes = registry.counter?.counter.notes ?? '';
  const nightReportSummaries = useMemo(
    () => (nightReportListState.data[0]?.data as NightReportSummary[] | undefined) ?? [],
    [nightReportListState.data],
  );
  const venueStatusForCounter = useCallback(
    (counterIdValue: number | null) => {
      if (counterIdValue == null) {
        return { label: 'Numbers (No Report)', color: 'primary' as const };
      }
      const summary = nightReportSummaries.find((report) => report.counterId === counterIdValue);
      if (!summary) {
        return { label: 'Venue Numbers (No Report)', color: 'primary' as const };
      }
      if (summary.status === 'submitted') {
        return { label: 'Venue Numbers (Submitted)', color: 'success' as const };
      }
      if (summary.status === 'draft') {
        return { label: 'Venue Numbers (Draft)', color: 'warning' as const };
      }
      return { label: 'Venue Numbers (No Report)', color: 'primary' as const };
    },
    [nightReportSummaries],
  );
  const toggleCounterExpansion = useCallback((counterIdValue: number | null) => {
    setExpandedCounterId((prev) => (counterIdValue == null ? null : prev === counterIdValue ? null : counterIdValue));
  }, []);

  const currentProductId = pendingProductId ?? counterProductId ?? null;

  const isFinal = counterStatus === 'final';
  const updateCounterStatusSafe = useCallback(
    async (nextStatus: CounterStatus) => {
      if (!counterId) {
        return;
      }
      if (counterStatus === 'final' && nextStatus !== 'final') {
        return;
      }
      if (counterStatus === nextStatus) {
        return;
      }
      await dispatch(updateCounterStatus({ counterId, status: nextStatus })).unwrap();
    },
    [counterId, counterStatus, dispatch],
  );
  const managerOptions = useMemo(() => {
    const map = new Map<number, StaffOption>();
    catalog.managers.forEach((manager) => map.set(manager.id, manager));
    const counterManager = registry.counter?.counter.manager;
    if (counterManager && !map.has(counterManager.id)) {
      const derivedFullName =
        counterManager.fullName ??
        [counterManager.firstName ?? '', counterManager.lastName ?? ''].join(' ').trim();
      const { firstName, lastName } = extractNameParts(derivedFullName);
      map.set(counterManager.id, {
        id: counterManager.id,
        firstName,
        lastName,
        fullName: derivedFullName || `Manager #${counterManager.id}`,
        userTypeSlug: null,
        userTypeName: null,
      });
    }
    return Array.from(map.values());
  }, [catalog.managers, registry.counter]);

  const counterStaffIds = useMemo(
    () => (registry.counter ? registry.counter.staff.map((member) => member.userId) : []),
    [registry.counter],
  );

  const lastCounterSyncRef = useRef<string | null>(null);

  useEffect(() => {
    const counterRecord = registry.counter?.counter;
    if (!counterRecord) {
      return;
    }

    const syncKey = `${counterRecord.id}-${counterRecord.updatedAt}`;
    const shouldSync = lastCounterSyncRef.current !== syncKey;

    if (shouldSync) {
      lastCounterSyncRef.current = syncKey;

      const managerId = counterRecord.userId ?? null;
      setSelectedManagerId(managerId);

      const parsedDate = dayjs(counterRecord.date);
      if (parsedDate.isValid()) {
        setSelectedDate(parsedDate);
      }

      setPendingProductId(counterRecord.productId ?? null);
      const normalizedStaff = normalizeIdList(counterStaffIds);
      setPendingStaffIds(normalizedStaff);
      lastPersistedStaffIdsRef.current = normalizedStaff;
      setPendingStaffDirty(false);
      return;
    }

    if (!pendingStaffDirty && pendingStaffIds.length === 0 && counterStaffIds.length > 0) {
      const normalizedStaff = normalizeIdList(counterStaffIds);
      setPendingStaffIds(normalizedStaff);
      lastPersistedStaffIdsRef.current = normalizedStaff;
    }
  }, [counterStaffIds, pendingStaffDirty, pendingStaffIds.length, registry.counter]);

  useEffect(() => {
    if (!isModalOpen || modalMode !== 'update') {
      return;
    }
    const counterRecord = registry.counter?.counter;
    if (!counterRecord) {
      return;
    }
    const key = `${counterRecord.id}:${counterRecord.status}`;
    if (lastInitializedCounterRef.current === key) {
      return;
    }
    lastInitializedCounterRef.current = key;
    setActiveRegistryStep(mapStatusToStep(counterRecord.status as CounterStatus | null | undefined));
  }, [isModalOpen, modalMode, registry.counter]);

  useEffect(() => {
    if (!isModalOpen) {
      lastInitializedCounterRef.current = null;
    }
  }, [isModalOpen]);

const loadCounterForDate = useCallback(
  async (formattedDate: string, productId: number | null | undefined) => {
    if (!formattedDate) {
      return;
    }
    const resolvedProductId = productId ?? null;
    const requestKey = `${formattedDate}|${resolvedProductId ?? 'null'}`;
    if (fetchCounterRequestRef.current === requestKey) {
      return;
    }
    fetchCounterRequestRef.current = requestKey;
    try {
      await dispatch(fetchCounterByDate({ date: formattedDate, productId: resolvedProductId })).unwrap();
    } catch (error) {
      const notFound =
        error != null &&
        typeof error === 'object' &&
        'notFound' in error &&
        Boolean((error as { notFound?: boolean }).notFound);
      if (!notFound) {
        const message =
          typeof error === 'string'
            ? error
            : error instanceof Error
              ? error.message
              : 'Failed to load counter';
        setCounterListError(message);
      } else {
        setCounterListError(null);
      }
      fetchCounterRequestRef.current = null;
    }
  },
  [dispatch],
);

  const metricsMap = registry.metricsByKey;
  const mergedMetrics = useMemo<MetricCell[]>(() => {
    const map = new Map<string, MetricCell>();
    const baseMetrics = registry.counter?.metrics ?? [];
    baseMetrics.forEach((metric) => {
      const normalized = normalizeMetric(metric);
      map.set(buildMetricKey(normalized), normalized);
    });
    Object.values(metricsMap).forEach((metric) => {
      const normalized = normalizeMetric(metric);
      map.set(buildMetricKey(normalized), normalized);
    });
    return Array.from(map.values());
  }, [metricsMap, registry.counter]);

  const walkInChannelIds = useMemo(
    () =>
      registry.channels
        .filter((channel) => channel.name?.toLowerCase() === WALK_IN_CHANNEL_SLUG)
        .map((channel) => channel.id),
    [registry.channels],
  );

  const cashEligibleChannelIds = useMemo(
    () =>
      registry.channels
        .filter((channel) => {
          if (channel.name?.toLowerCase() === WALK_IN_CHANNEL_SLUG) {
            return false;
          }
          return isCashPaymentChannel(channel);
        })
        .map((channel) => channel.id),
    [registry.channels],
  );
  const cashSnapshotEntries = useMemo(
    () => extractCashSnapshotMap(counterNotes),
    [counterNotes],
  );
  const freeSnapshotEntries = useMemo(
    () => extractFreeSnapshotMap(counterNotes),
    [counterNotes],
  );
  useEffect(() => {
    if (!editingCustomTicket) {
      return;
    }
    const activeTickets = walkInDiscountsByChannel[editingCustomTicket.channelId] ?? [];
    if (!activeTickets.includes(editingCustomTicket.ticketLabel)) {
      setEditingCustomTicket(null);
    }
  }, [editingCustomTicket, walkInDiscountsByChannel]);
  const handleCashCurrencyChange = useCallback(
    (channelId: number, currency: CashCurrency) => {
      let didChange = false;
      setCashCurrencyByChannel((prev) => {
        const current = prev[channelId] ?? 'PLN';
        if (current === currency) {
          return prev;
        }
        didChange = true;
        const next = { ...prev, [channelId]: currency };
        if (currency === 'PLN') {
          delete next[channelId];
        }
        return next;
      });
      if (didChange) {
        setWalkInNoteDirty(true);
      }
    },
    [setWalkInNoteDirty],
  );

  const setFreePeopleQty = useCallback(
    (channelId: number, qty: number) => {
      const normalizedQty = Math.max(0, Math.round(qty));
      let mutated = false;
      setFreePeopleByChannel((prev) => {
        const existing = prev[channelId];
        const existingNote = existing?.note ?? '';
        if (existing && existing.qty === normalizedQty) {
          return prev;
        }
        if (normalizedQty === 0 && existingNote.trim().length === 0) {
          if (!existing) {
            return prev;
          }
          const { [channelId]: _removed, ...rest } = prev;
          mutated = true;
          return rest;
        }
        mutated = true;
        return { ...prev, [channelId]: { qty: normalizedQty, note: existingNote } };
      });
      if (mutated) {
        setWalkInNoteDirty(true);
      }
    },
    [setWalkInNoteDirty],
  );

  const setFreePeopleNote = useCallback(
    (channelId: number, note: string) => {
      const sanitizedNote = note.trim();
      let mutated = false;
      setFreePeopleByChannel((prev) => {
        const existing = prev[channelId];
        const currentQty = existing?.qty ?? 0;
        if (existing && existing.note === sanitizedNote) {
          return prev;
        }
        if (currentQty === 0 && sanitizedNote.length === 0) {
          if (!existing) {
            return prev;
          }
          const { [channelId]: _removed, ...rest } = prev;
          mutated = true;
          return rest;
        }
        mutated = true;
        return { ...prev, [channelId]: { qty: currentQty, note: sanitizedNote } };
      });
      if (mutated) {
        setWalkInNoteDirty(true);
      }
    },
    [setWalkInNoteDirty],
  );

  const ensureFreePeopleEntry = useCallback(
    (channelId: number) => {
      let mutated = false;
      setFreePeopleByChannel((prev) => {
        if (prev[channelId]) {
          return prev;
        }
        mutated = true;
        return { ...prev, [channelId]: { qty: 0, note: '' } };
      });
      if (mutated) {
        setWalkInNoteDirty(true);
      }
    },
    [setWalkInNoteDirty],
  );

  const setFreeAddonQty = useCallback(
    (channelId: number, addonId: number, qty: number) => {
      const normalizedQty = Math.max(0, Math.round(qty));
      let mutated = false;
      setFreeAddonsByChannel((prev) => {
        const currentForChannel = prev[channelId] ?? {};
        const existing = currentForChannel[addonId];
        const existingNote = existing?.note ?? '';
        if (existing && existing.qty === normalizedQty) {
          return prev;
        }
        const nextChannelEntries = { ...currentForChannel };
        if (normalizedQty === 0 && existingNote.trim().length === 0) {
          if (!existing) {
            return prev;
          }
          delete nextChannelEntries[addonId];
          mutated = true;
        } else {
          nextChannelEntries[addonId] = { qty: normalizedQty, note: existingNote };
          mutated = true;
        }
        if (Object.keys(nextChannelEntries).length === 0) {
          if (!(channelId in prev)) {
            return prev;
          }
          const { [channelId]: _removed, ...rest } = prev;
          return mutated ? rest : prev;
        }
        return { ...prev, [channelId]: nextChannelEntries };
      });
      if (mutated) {
        setWalkInNoteDirty(true);
      }
    },
    [setWalkInNoteDirty],
  );

  const ensureFreeAddonEntry = useCallback(
    (channelId: number, addonId: number) => {
      let mutated = false;
      setFreeAddonsByChannel((prev) => {
        const currentForChannel = prev[channelId] ?? {};
        if (currentForChannel[addonId]) {
          return prev;
        }
        mutated = true;
        return {
          ...prev,
          [channelId]: {
            ...currentForChannel,
            [addonId]: { qty: 0, note: '' },
          },
        };
      });
      if (mutated) {
        setWalkInNoteDirty(true);
      }
    },
    [setWalkInNoteDirty],
  );

  const setFreeAddonNote = useCallback(
    (channelId: number, addonId: number, note: string) => {
      const sanitizedNote = note.trim();
      let mutated = false;
      setFreeAddonsByChannel((prev) => {
        const currentForChannel = prev[channelId] ?? {};
        const existing = currentForChannel[addonId];
        const currentQty = existing?.qty ?? 0;
        if (existing && existing.note === sanitizedNote) {
          return prev;
        }
        const nextChannelEntries = { ...currentForChannel };
        if (currentQty === 0 && sanitizedNote.length === 0) {
          if (!existing) {
            return prev;
          }
          delete nextChannelEntries[addonId];
          mutated = true;
        } else {
          nextChannelEntries[addonId] = { qty: currentQty, note: sanitizedNote };
          mutated = true;
        }
        if (Object.keys(nextChannelEntries).length === 0) {
          if (!(channelId in prev)) {
            return prev;
          }
          const { [channelId]: _removed, ...rest } = prev;
          return mutated ? rest : prev;
        }
        return { ...prev, [channelId]: nextChannelEntries };
      });
      if (mutated) {
        setWalkInNoteDirty(true);
      }
    },
    [setWalkInNoteDirty],
  );

  useEffect(() => {
    if (!registry.counter) {
      setWalkInCashByChannel({});
      setWalkInDiscountsByChannel({});
      setWalkInTicketDataByChannel({});
      setCashOverridesByChannel({});
      setCashEditingChannelId(null);
      setCashEditingValue('');
      setCashCurrencyByChannel({});
      setWalkInNoteDirty(false);
      setFreePeopleByChannel({});
      setFreeAddonsByChannel({});
      lastWalkInInitRef.current = null;
      return;
    }

    const counterRecord = registry.counter.counter;
    const note = counterRecord.notes ?? null;
    const initKey = [
      counterRecord.id,
      counterRecord.updatedAt,
      note ?? '',
      walkInChannelIds.join(','),
      cashEligibleChannelIds.join(','),
    ].join('|');

    if (lastWalkInInitRef.current === initKey) {
      return;
    }

    lastWalkInInitRef.current = initKey;

    const metricsList = registry.counter.metrics ?? [];
    const attendedPeopleMetrics = new Map<number, number>();
    const nextWalkInCash: Record<number, string> = {};
    const nextWalkInDiscounts: Record<number, string[]> = {};
    const nextWalkInTickets: Record<number, WalkInChannelTicketState> = {};
    const nextOverrides: Record<number, string> = {};
    const nextCurrencyByChannel: Record<number, CashCurrency> = {};
    const parsedDiscounts = parseDiscountsFromNote(note);
    const eligibleSet = new Set(cashEligibleChannelIds);

    metricsList.forEach((metric) => {
      if (
        metric.kind === 'people' &&
        metric.tallyType === 'attended' &&
        (metric.period == null || metric.period === 'before_cutoff')
      ) {
        const qty = Math.max(0, Number(metric.qty) || 0);
        attendedPeopleMetrics.set(metric.channelId, qty);
      }
    });

    metricsList.forEach((metric) => {
      if (metric.kind !== 'cash_payment' || metric.tallyType !== 'attended') {
        return;
      }
      const numericQty = Math.max(0, Number(metric.qty) || 0);
      if (walkInChannelIds.includes(metric.channelId)) {
        nextWalkInCash[metric.channelId] = numericQty > 0 ? String(numericQty) : '';
        return;
      }
      if (!cashEligibleChannelIds.includes(metric.channelId)) {
        return;
      }
      const channelConfig = registry.channels.find((item) => item.id === metric.channelId);
      if (!channelConfig) {
        return;
      }
      const snapshotEntry = cashSnapshotEntries.get(metric.channelId);
      const currency = (snapshotEntry?.currency ?? 'PLN') as CashCurrency;
      if (currency !== 'PLN') {
        nextCurrencyByChannel[metric.channelId] = currency;
      }
      const peopleQty = attendedPeopleMetrics.get(metric.channelId) ?? 0;
      const price = getCashPriceForChannel(channelConfig, currency);
      const expectedAmount =
        price != null ? Math.max(0, Math.round(price * peopleQty * 100) / 100) : null;
      const shouldFlagOverride =
        expectedAmount != null ? !valuesAreClose(expectedAmount, numericQty) : numericQty > 0;
      if (shouldFlagOverride) {
        nextOverrides[metric.channelId] = normalizeCashValue(numericQty);
      }
    });

    cashSnapshotEntries.forEach((entry, channelId) => {
      if (!eligibleSet.has(channelId)) {
        return;
      }
      const channelConfig = registry.channels.find((item) => item.id === channelId);
      if (!channelConfig) {
        return;
      }
      const currency = (entry.currency ?? 'PLN') as CashCurrency;
      if (currency !== 'PLN') {
        nextCurrencyByChannel[channelId] = currency;
      }
      if (channelId in nextOverrides) {
        return;
      }
      const peopleQty = attendedPeopleMetrics.get(channelId) ?? 0;
      const price = getCashPriceForChannel(channelConfig, currency);
      const expectedAmount =
        price != null ? Math.max(0, Math.round(price * peopleQty * 100) / 100) : null;
      const normalizedAmount = Math.max(0, Math.round((entry.amount ?? 0) * 100) / 100);
      const shouldFlagOverride =
        expectedAmount != null
          ? !valuesAreClose(expectedAmount, normalizedAmount)
          : normalizedAmount > 0;
      if (shouldFlagOverride) {
        nextOverrides[channelId] = normalizeCashValue(normalizedAmount);
      }
    });

    walkInChannelIds.forEach((channelId) => {
      const snapshotEntry = cashSnapshotEntries.get(channelId);
      const snapshotTickets = snapshotEntry?.tickets ?? [];
      const ticketOrder: string[] = [];
      const ticketEntries: Record<string, WalkInTicketEntryState> = {};

      snapshotTickets.forEach((ticketSnapshot) => {
        if (!ticketSnapshot || typeof ticketSnapshot.name !== 'string') {
          return;
        }
        const ticketName = ticketSnapshot.name;
        if (!ticketName) {
          return;
        }
        if (!ticketOrder.includes(ticketName)) {
          ticketOrder.push(ticketName);
        }
        const currencyOrder: CashCurrency[] = [];
        const currencies: Partial<Record<CashCurrency, WalkInCurrencyEntryState>> = {};
        ticketSnapshot.currencies.forEach((currencySnapshot) => {
          const { currency, people, cash, addons } = currencySnapshot;
          if (!currency) {
            return;
          }
          if (!currencyOrder.includes(currency)) {
            currencyOrder.push(currency);
          }
          const parsedAddons: Record<number, number> = {};
          Object.entries(addons).forEach(([addonId, qty]) => {
            const numericAddonId = Number(addonId);
            const numericQty = Number(qty);
            if (!Number.isFinite(numericAddonId) || !Number.isFinite(numericQty)) {
              return;
            }
            const normalizedQty = Math.max(0, Math.round(numericQty));
            if (normalizedQty > 0) {
              parsedAddons[numericAddonId] = normalizedQty;
            }
          });
          currencies[currency] = {
            people: Number.isFinite(people) ? Math.max(0, Math.round(people)) : 0,
            cash: Number.isFinite(cash) ? String(Math.max(0, Math.round(cash * 100) / 100)) : '',
            addons: parsedAddons,
          };
        });
        ticketEntries[ticketName] = {
          name: ticketName,
          currencyOrder,
          currencies,
        };
      });

      const initialSelection = new Set<string>(parsedDiscounts);
      ticketOrder.forEach((ticketName) => initialSelection.add(ticketName));
      const orderedSelection: string[] = [];
      ticketOrder.forEach((ticketName) => {
        if (initialSelection.has(ticketName)) {
          orderedSelection.push(ticketName);
          initialSelection.delete(ticketName);
        }
      });
      initialSelection.forEach((ticketName) => {
        orderedSelection.push(ticketName);
        if (!ticketOrder.includes(ticketName)) {
          ticketOrder.push(ticketName);
        }
        if (!ticketEntries[ticketName]) {
          ticketEntries[ticketName] = {
            name: ticketName,
            currencyOrder: [],
            currencies: {},
          };
        }
      });

      let finalTicketOrder = ticketOrder;
      let finalTicketEntries = ticketEntries;
      let finalSelection = orderedSelection;

      if (finalTicketOrder.length === 0) {
        const afterCutoffPeopleMetric = metricsList.find(
          (metric) =>
            metric.channelId === channelId &&
            metric.kind === 'people' &&
            metric.tallyType === 'booked' &&
            metric.period === 'after_cutoff',
        );
        const afterCutoffPeople = Math.max(
          0,
          Math.round(Number(afterCutoffPeopleMetric?.qty) || 0),
        );
        const addonMetricsForChannel = metricsList.filter(
          (metric) =>
            metric.channelId === channelId &&
            metric.kind === 'addon' &&
            metric.tallyType === 'booked' &&
            metric.period === 'after_cutoff' &&
            metric.addonId != null,
        );
        const addonMap: Record<number, number> = {};
        addonMetricsForChannel.forEach((metric) => {
          const addonId = Number(metric.addonId);
          const qty = Math.max(0, Math.round(Number(metric.qty) || 0));
          if (Number.isFinite(addonId) && qty > 0) {
            addonMap[addonId] = qty;
          }
        });
        if (afterCutoffPeople > 0 || Object.keys(addonMap).length > 0) {
          const defaultTicketLabel = WALK_IN_DISCOUNT_OPTIONS[0] ?? 'Normal';
          const existingCashValue = Number(nextWalkInCash[channelId] ?? 0);
          const normalizedCashValue =
            Number.isFinite(existingCashValue) && existingCashValue > 0
              ? String(Math.max(0, Math.round(existingCashValue)))
              : '';
          finalTicketOrder = [defaultTicketLabel];
          finalTicketEntries = {
            ...finalTicketEntries,
            [defaultTicketLabel]: {
              name: defaultTicketLabel,
              currencyOrder: ['PLN'],
              currencies: {
                PLN: {
                  people: afterCutoffPeople,
                  cash: normalizedCashValue,
                  addons: addonMap,
                },
              },
            },
          };
          finalSelection = [defaultTicketLabel];
        }
      }

      nextWalkInDiscounts[channelId] = finalSelection;
      nextWalkInTickets[channelId] = {
        ticketOrder: finalTicketOrder,
        tickets: finalTicketEntries,
      };

      if (!(channelId in nextWalkInCash)) {
        let aggregatedCash = 0;
        ticketOrder.forEach((ticketName) => {
          const ticketEntry = ticketEntries[ticketName];
          if (!ticketEntry) {
            return;
          }
          ticketEntry.currencyOrder.forEach((currency) => {
            const currencyEntry = ticketEntry.currencies[currency];
            if (!currencyEntry) {
              return;
            }
            const numeric = Number(currencyEntry.cash);
            if (Number.isFinite(numeric) && numeric > 0) {
              aggregatedCash += Math.max(0, Math.round(numeric * 100) / 100);
            }
          });
        });
        nextWalkInCash[channelId] = aggregatedCash > 0 ? String(Math.max(0, Math.round(aggregatedCash))) : '';
      }
    });

    for (const channelId of walkInChannelIds) {
      if (!(channelId in nextWalkInCash)) {
        nextWalkInCash[channelId] = '';
      }
      if (!(channelId in nextWalkInTickets)) {
        nextWalkInTickets[channelId] = {
          ticketOrder: [],
          tickets: {},
        };
      }
    }

    const nextFreePeople: Record<number, FreeSnapshotPeopleEntry> = {};
    const nextFreeAddons: Record<number, Record<number, FreeSnapshotAddonEntry>> = {};
    freeSnapshotEntries.forEach((entry, channelId) => {
      if (entry.people) {
        const qty = Math.max(0, Math.round(Number(entry.people.qty) || 0));
        const note = (entry.people.note ?? '').toString().trim();
        if (qty > 0 || note.length > 0) {
          nextFreePeople[channelId] = { qty, note };
        }
      }
      if (entry.addons) {
        Object.entries(entry.addons).forEach(([addonIdKey, addonEntry]) => {
          const addonId = Number(addonIdKey);
          if (!Number.isFinite(addonId) || !addonEntry) {
            return;
          }
          const qty = Math.max(0, Math.round(Number(addonEntry.qty) || 0));
          const note = (addonEntry.note ?? '').toString().trim();
          if (qty <= 0 && note.length === 0) {
            return;
          }
          if (!nextFreeAddons[channelId]) {
            nextFreeAddons[channelId] = {};
          }
          nextFreeAddons[channelId][addonId] = { qty, note };
        });
      }
    });

    setFreePeopleByChannel(nextFreePeople);
    setFreeAddonsByChannel(nextFreeAddons);
    setWalkInCashByChannel(nextWalkInCash);
    setWalkInDiscountsByChannel(nextWalkInDiscounts);
    setWalkInTicketDataByChannel(recalcWalkInTicketDataMap(nextWalkInTickets));
    setCashOverridesByChannel(nextOverrides);
    setCashCurrencyByChannel(nextCurrencyByChannel);
    setCashEditingChannelId(null);
    setCashEditingValue('');
    setWalkInNoteDirty(false);
  }, [
    cashEligibleChannelIds,
    cashSnapshotEntries,
    freeSnapshotEntries,
    recalcWalkInTicketDataMap,
    registry.channels,
    registry.counter,
  walkInChannelIds,
]);

  const appliedPlatformSelectionRef = useRef<number | null>(null);
  const appliedAfterCutoffSelectionRef = useRef<number | null>(null);
  const [selectedChannelIds, setSelectedChannelIds] = useState<number[]>([]);
  const [selectedAfterCutoffChannelIds, setSelectedAfterCutoffChannelIds] = useState<number[]>([]);

  const channelHasAnyQty = useCallback(
    (channelId: number) => {
      const hasMetricQty = mergedMetrics.some((metric) => metric.channelId === channelId && metric.qty > 0);
      if (hasMetricQty) {
        return true;
      }

      const ticketState = walkInTicketDataByChannel[channelId];
      if (ticketState) {
        for (const ticket of Object.values(ticketState.tickets)) {
          if (!ticket) {
            continue;
          }
          for (const currency of Object.values(ticket.currencies)) {
            if (!currency) {
              continue;
            }
            if (currency.people > 0) {
              return true;
            }
            if (currency.cash && Number(currency.cash) > 0) {
              return true;
            }
            if (Object.values(currency.addons).some((qty) => Number(qty) > 0)) {
              return true;
            }
          }
        }
      }

      const rawWalkInCash = walkInCashByChannel[channelId];
      if (rawWalkInCash != null && rawWalkInCash !== '' && Number(rawWalkInCash) > 0) {
        return true;
      }

      const freePeopleEntry = freePeopleByChannel[channelId];
      if (freePeopleEntry && Math.max(0, Math.round(freePeopleEntry.qty ?? 0)) > 0) {
        return true;
      }

      const freeAddonEntries = freeAddonsByChannel[channelId];
      if (freeAddonEntries) {
        const hasFreeAddonQty = Object.values(freeAddonEntries).some(
          (entry) => entry && Math.max(0, Math.round(entry.qty ?? 0)) > 0,
        );
      if (hasFreeAddonQty) {
        return true;
      }
    }

      if (selectedChannelIds.includes(channelId) || selectedAfterCutoffChannelIds.includes(channelId)) {
        return true;
      }

      return false;
    },
    [
      freeAddonsByChannel,
      freePeopleByChannel,
      mergedMetrics,
      selectedAfterCutoffChannelIds,
      selectedChannelIds,
      walkInCashByChannel,
      walkInTicketDataByChannel,
    ],
  );

  const channelIdsWithAnyData = useMemo(() => {
    return registry.channels
      .filter((channel) => channelHasAnyQty(channel.id))
      .map((channel) => channel.id);
  }, [channelHasAnyQty, registry.channels]);

  const [editingChannelIds, setEditingChannelIds] = useState<Set<number>>(() => new Set());

  const markChannelEditing = useCallback((channelId: number) => {
    setEditingChannelIds((prev) => {
      if (prev.has(channelId)) {
        return prev;
      }
      const next = new Set(prev);
      next.add(channelId);
      return next;
    });
  }, []);

  const unmarkChannelEditing = useCallback((channelId: number) => {
    setEditingChannelIds((prev) => {
      if (!prev.has(channelId)) {
        return prev;
      }
      const next = new Set(prev);
      next.delete(channelId);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!isModalOpen) {
      setEditingChannelIds((prev) => {
        if (prev.size === 0) {
          return prev;
        }
        return new Set<number>();
      });
    }
  }, [isModalOpen]);


  const allowedAfterCutoffChannelIds = useMemo(
    () =>
      registry.channels
        .filter((channel) => AFTER_CUTOFF_ALLOWED.has(channel.name?.toLowerCase() ?? ''))
        .map((channel) => channel.id),
    [registry.channels],
  );

  const afterCutoffChannels = useMemo(
    () => registry.channels.filter((channel) => allowedAfterCutoffChannelIds.includes(channel.id)),
    [allowedAfterCutoffChannelIds, registry.channels],
  );

  const savedPlatformChannelIds = useMemo(() => {
    const ids = new Set<number>();
    mergedMetrics.forEach((metric) => {
      if (
        metric.kind === 'people' &&
        metric.tallyType === 'booked' &&
        metric.period === 'before_cutoff' &&
        metric.qty > 0
      ) {
        ids.add(metric.channelId);
      }
    });
    return Array.from(ids);
  }, [mergedMetrics]);

  const savedAfterCutoffChannelIds = useMemo(() => {
    const ids = new Set<number>();
    mergedMetrics.forEach((metric) => {
      if (
        metric.kind === 'people' &&
        metric.tallyType === 'booked' &&
        metric.period === 'after_cutoff' &&
        metric.qty > 0
      ) {
        ids.add(metric.channelId);
      }
    });
    return Array.from(ids);
  }, [mergedMetrics]);

  const channelsWithAfterCutoffMetrics = useMemo(() => {
    const results = new Set<number>();
    mergedMetrics.forEach((metric) => {
      if (
        (metric.kind === 'people' || metric.kind === 'addon') &&
        metric.tallyType === 'booked' &&
        metric.period === 'after_cutoff' &&
        metric.qty > 0
      ) {
        const channel = registry.channels.find((item) => item.id === metric.channelId);
        if (channel && allowedAfterCutoffChannelIds.includes(channel.id)) {
          results.add(metric.channelId);
        }
      }
    });
    return results;
  }, [allowedAfterCutoffChannelIds, mergedMetrics, registry.channels]);

  useEffect(() => {
    if (!counterId) {
      appliedPlatformSelectionRef.current = null;
      appliedAfterCutoffSelectionRef.current = null;
      setSelectedChannelIds([]);
      setSelectedAfterCutoffChannelIds([]);
      return;
    }
    if (appliedPlatformSelectionRef.current !== counterId) {
      appliedPlatformSelectionRef.current = counterId;
      setSelectedChannelIds(savedPlatformChannelIds.length > 0 ? Array.from(new Set(savedPlatformChannelIds)) : []);
    }

    if (appliedAfterCutoffSelectionRef.current !== counterId) {
      appliedAfterCutoffSelectionRef.current = counterId;
      setSelectedAfterCutoffChannelIds(
        savedAfterCutoffChannelIds.filter((id) => allowedAfterCutoffChannelIds.includes(id)),
      );
    }
  }, [allowedAfterCutoffChannelIds, counterId, savedAfterCutoffChannelIds, savedPlatformChannelIds]);

  useEffect(() => {
    if (channelsWithAfterCutoffMetrics.size === 0) {
      return;
    }
    setSelectedAfterCutoffChannelIds((prev) => {
      const merged = new Set<number>(prev);
      channelsWithAfterCutoffMetrics.forEach((id) => {
        if (allowedAfterCutoffChannelIds.includes(id)) {
          merged.add(id);
        }
      });
      const next = Array.from(merged).filter((id) => allowedAfterCutoffChannelIds.includes(id));
      if (next.length === prev.length && next.every((id, index) => prev[index] === id)) {
        return prev;
      }
      return next;
    });
  }, [allowedAfterCutoffChannelIds, channelsWithAfterCutoffMetrics]);
  const getMetric = useCallback(
    (
      channelId: number,
      tallyType: MetricTallyType,
      period: MetricPeriod,
      kind: MetricKind,
      addonId: number | null,
    ): MetricCell | null => {
      if (!counterId) {
        return null;
      }
      const key = buildMetricKey({ channelId, kind, addonId, tallyType, period });
      const existing = metricsMap[key];
      if (existing) {
        return existing;
      }
      const metricsList = registry.counter?.metrics ?? [];
      const desiredPeriod =
        tallyType === 'booked'
          ? period ?? 'before_cutoff'
          : tallyType === 'attended'
            ? null
            : period ?? null;
      const fallback = metricsList.find((metric) => {
        if (metric.channelId !== channelId) {
          return false;
        }
        if (metric.kind !== kind) {
          return false;
        }
        if ((metric.addonId ?? null) !== (addonId ?? null)) {
          return false;
        }
        if (metric.tallyType !== tallyType) {
          return false;
        }
        const normalizedPeriod =
          metric.tallyType === 'booked'
            ? metric.period ?? 'before_cutoff'
            : metric.tallyType === 'attended'
              ? null
              : metric.period ?? null;
        return normalizedPeriod === desiredPeriod;
      });
      return fallback ? { ...fallback } : null;
    },
    [counterId, metricsMap, registry.counter],
  );

  const syncAfterCutoffAttendance = useCallback(
    (channelId: number) => {
      const channel = registry.channels.find((item) => item.id === channelId);
      const normalizedChannelName = channel?.name?.toLowerCase() ?? '';
      if (!AFTER_CUTOFF_ALLOWED.has(normalizedChannelName)) {
        return;
      }

      const beforeMetric = getMetric(channelId, 'booked', 'before_cutoff', 'people', null);
      const afterMetric = getMetric(channelId, 'booked', 'after_cutoff', 'people', null);
      const attendedMetric = getMetric(channelId, 'attended', null, 'people', null);

      const beforeQty = beforeMetric?.qty ?? 0;
      const attendedQty = attendedMetric?.qty ?? 0;
      const diff = Math.max(0, attendedQty - beforeQty);

      if (afterMetric && afterMetric.qty !== diff) {
        dispatch(setMetric({ ...afterMetric, qty: diff }));
      }

      registry.addons.forEach((addon) => {
        const beforeAddonMetric = getMetric(
          channelId,
          'booked',
          'before_cutoff',
          'addon',
          addon.addonId,
        );
        const afterAddonMetric = getMetric(
          channelId,
          'booked',
          'after_cutoff',
          'addon',
          addon.addonId,
        );
        const attendedAddonMetric = getMetric(
          channelId,
          'attended',
          null,
          'addon',
          addon.addonId,
        );

        const beforeAddonQty = beforeAddonMetric?.qty ?? 0;
        const attendedAddonQty = attendedAddonMetric?.qty ?? 0;
        const addonDiff = Math.max(0, attendedAddonQty - beforeAddonQty);

        if (afterAddonMetric && afterAddonMetric.qty !== addonDiff) {
          dispatch(setMetric({ ...afterAddonMetric, qty: addonDiff }));
        }
      });
    },
    [dispatch, getMetric, registry.addons, registry.channels],
  );

  const handleMetricChange = useCallback(
    (
      channelId: number,
      tallyType: MetricTallyType,
      period: MetricPeriod,
      kind: MetricKind,
      addonId: number | null,
      qty: number,
    ) => {
      const normalizedPeriod =
        tallyType === 'booked'
          ? period ?? 'before_cutoff'
          : tallyType === 'attended'
            ? null
            : period ?? null;
      const nextQty = Math.max(0, qty);
      const baseMetric = getMetric(channelId, tallyType, period, kind, addonId);
      const previousQty = baseMetric?.qty ?? 0;
      const targetCounterId = baseMetric?.counterId ?? counterId ?? null;
      if (!baseMetric) {
        if (nextQty <= 0 || targetCounterId == null) {
          return;
        }
      }
      if (baseMetric && baseMetric.qty === nextQty) {
        return;
      }
      let metricToPersist: MetricCell;
      if (baseMetric != null) {
        metricToPersist = { ...baseMetric, qty: nextQty };
      } else {
        if (targetCounterId == null) {
          return;
        }
        metricToPersist = {
          counterId: targetCounterId,
          channelId,
          kind,
          addonId,
          tallyType,
          period: normalizedPeriod,
          qty: nextQty,
        };
      }
      startTransition(() => {
        dispatch(setMetric(metricToPersist));

        const channel = registry.channels.find((item) => item.id === channelId) ?? null;

        if (
          kind === 'people' &&
          tallyType === 'attended' &&
          normalizedPeriod === null &&
          channel &&
          isCashPaymentChannel(channel) &&
          channel.name?.toLowerCase() !== WALK_IN_CHANNEL_SLUG
        ) {
          const overrideRaw = cashOverridesByChannel[channelId];
          const overrideAmount = overrideRaw != null ? parseCashInput(overrideRaw) : null;
          const currency = cashCurrencyByChannel[channelId] ?? 'PLN';
          const price = getCashPriceForChannel(channel, currency);
          const defaultAmount =
            price != null ? Math.max(0, Math.round(price * nextQty * 100) / 100) : 0;
          const desiredAmount =
            overrideAmount != null && Number.isFinite(overrideAmount)
              ? overrideAmount
              : defaultAmount;
          const cashMetric = getMetric(channelId, 'attended', null, 'cash_payment', null);
          const existingAmount = cashMetric?.qty ?? 0;
          if (desiredAmount > 0 || cashMetric) {
            const amountsDiffer = !valuesAreClose(existingAmount, desiredAmount);
            if (amountsDiffer) {
              handleMetricChange(channelId, 'attended', null, 'cash_payment', null, desiredAmount);
            }
          }
        }

        if (kind === 'cash_payment') {
          return;
        }

        const normalizedChannelName = channel?.name?.toLowerCase() ?? '';
        const isAfterCutoffChannel = AFTER_CUTOFF_ALLOWED.has(normalizedChannelName);

        if (
          isAfterCutoffChannel &&
          (kind === 'people' || kind === 'addon') &&
          ((tallyType === 'attended' && normalizedPeriod === null) ||
            (tallyType === 'booked' && normalizedPeriod === 'before_cutoff'))
        ) {
          syncAfterCutoffAttendance(channelId);
        }

        if (kind === 'addon' && addonId != null) {
          const addonConfig =
            registry.addons.find((addon) => addon.addonId === addonId) ??
            catalog.addons.find((addon) => addon.addonId === addonId);
          const addonKeyLower = addonConfig?.key?.toLowerCase() ?? '';
          const addonNameLower = addonConfig?.name?.toLowerCase() ?? '';
          const isCocktails = addonKeyLower.includes('cocktail') || addonNameLower.includes('cocktail');
          if (isCocktails) {
            const peopleMetric = getMetric(channelId, tallyType, period, 'people', null);
            if (peopleMetric) {
              const delta = nextQty - previousQty;
              if (delta !== 0) {
                const currentQty = peopleMetric.qty ?? 0;
                const nextPeopleQty = Math.max(0, currentQty + delta);
                dispatch(setMetric({ ...peopleMetric, qty: nextPeopleQty }));
                if (normalizedPeriod === 'after_cutoff') {
                  const attendedPeopleMetric = getMetric(channelId, 'attended', null, 'people', null);
                  if (attendedPeopleMetric && attendedPeopleMetric.qty !== nextPeopleQty) {
                    dispatch(setMetric({ ...attendedPeopleMetric, qty: nextPeopleQty }));
                  }
                }
              }
            }
          }
        }

        if (normalizedPeriod === 'after_cutoff' && tallyType === 'booked') {
          const attendedMetric = getMetric(channelId, 'attended', null, kind, addonId);
          if (attendedMetric) {
            if (attendedMetric.qty !== nextQty) {
              dispatch(setMetric({ ...attendedMetric, qty: nextQty }));
            }
          } else if (counterId && nextQty > 0) {
            dispatch(
              setMetric({
                counterId,
                channelId,
                kind,
                addonId,
                tallyType: 'attended',
                period: null,
                qty: nextQty,
              }),
            );
          }
        }
      });
    },
    [
      cashCurrencyByChannel,
      cashOverridesByChannel,
      catalog.addons,
      counterId,
      dispatch,
      getMetric,
      registry.addons,
      registry.channels,
      syncAfterCutoffAttendance,
    ],
  );

  const cashDetailsByChannel = useMemo(() => {
    const details = new Map<
      number,
      {
        defaultAmount: number | null;
        overrideAmount: number | null;
        displayAmount: number | null;
        formattedDisplay: string | null;
        price: number | null;
        peopleQty: number;
        hasManualOverride: boolean;
      }
    >();

    registry.channels.forEach((channel) => {
      if (!isCashPaymentChannel(channel) || channel.name?.toLowerCase() === WALK_IN_CHANNEL_SLUG) {
        return;
      }

      const currency = cashCurrencyByChannel[channel.id] ?? 'PLN';
      const price = getCashPriceForChannel(channel, currency);
      const peopleMetric = getMetric(channel.id, 'attended', null, 'people', null);
      const peopleQty = peopleMetric?.qty ?? 0;
      const defaultAmount =
        price != null ? Math.max(0, Math.round(price * peopleQty * 100) / 100) : null;
      const overrideRaw = cashOverridesByChannel[channel.id];
      const overrideAmount = overrideRaw != null ? parseCashInput(overrideRaw) : null;
      const displayAmount =
        overrideAmount != null && Number.isFinite(overrideAmount) ? overrideAmount : defaultAmount;
      const formattedDisplay =
        displayAmount != null && Number.isFinite(displayAmount)
          ? formatCashAmount(displayAmount)
          : null;

      details.set(channel.id, {
        defaultAmount,
        overrideAmount:
          overrideAmount != null && Number.isFinite(overrideAmount) ? overrideAmount : null,
        displayAmount: displayAmount != null && Number.isFinite(displayAmount) ? displayAmount : null,
        formattedDisplay,
        price,
        peopleQty,
        hasManualOverride: overrideAmount != null && Number.isFinite(overrideAmount),
      });
    });

    return details;
  }, [cashCurrencyByChannel, cashOverridesByChannel, getMetric, registry.channels]);

  const cashCollectionSummary = useMemo(() => {
    type CashSummaryEntry = { amount: number; currency: CashCurrency; formatted: string };
    let total = 0;
    const perChannel = new Map<number, CashSummaryEntry[]>();
    const totalsByCurrency = new Map<CashCurrency, number>();

    const registerAmount = (
      channelId: number,
      rawAmount: number | null | undefined,
      currency: CashCurrency,
    ) => {
      if (rawAmount == null || !Number.isFinite(rawAmount)) {
        return;
      }
      const normalized = Math.max(0, Math.round(rawAmount * 100) / 100);
      if (normalized <= 0) {
        return;
      }
      total += normalized;
      totalsByCurrency.set(currency, (totalsByCurrency.get(currency) ?? 0) + normalized);
      const entry: CashSummaryEntry = {
        amount: normalized,
        currency,
        formatted: formatCashAmount(normalized),
      };
      const currentEntries = perChannel.get(channelId) ?? [];
      perChannel.set(channelId, [...currentEntries, entry]);
    };

    walkInChannelIds.forEach((channelId) => {
      const ticketState = walkInTicketDataByChannel[channelId];
      const currencyTotals = new Map<CashCurrency, number>();
      if (ticketState) {
        ticketState.ticketOrder.forEach((ticketLabel) => {
          const ticketEntry = ticketState.tickets[ticketLabel];
          if (!ticketEntry) {
            return;
          }
          ticketEntry.currencyOrder.forEach((currency) => {
            const currencyEntry = ticketEntry.currencies[currency];
            if (!currencyEntry) {
              return;
            }
            const numericCash = Number(currencyEntry.cash);
            if (!Number.isFinite(numericCash) || numericCash <= 0) {
              return;
            }
            const normalizedCash = Math.max(0, Math.round(numericCash * 100) / 100);
            currencyTotals.set(
              currency,
              (currencyTotals.get(currency) ?? 0) + normalizedCash,
            );
          });
        });
      }

      if (currencyTotals.size > 0) {
        currencyTotals.forEach((amount, currency) => {
          registerAmount(channelId, amount, currency);
        });
        return;
      }

      const inputValue = Number(walkInCashByChannel[channelId] ?? 0);
      const snapshotEntry = cashSnapshotEntries.get(channelId);
      const normalizedInput = Number.isFinite(inputValue) ? inputValue : null;
      const fallbackAmount =
        normalizedInput != null && normalizedInput > 0
          ? normalizedInput
          : snapshotEntry?.amount ?? normalizedInput;
      const currency = (snapshotEntry?.currency ?? 'PLN') as CashCurrency;
      registerAmount(channelId, fallbackAmount, currency);
    });

    registry.channels.forEach((channel) => {
      if (!isCashPaymentChannel(channel) || walkInChannelIds.includes(channel.id)) {
        return;
      }
      const details = cashDetailsByChannel.get(channel.id);
      const snapshotEntry = cashSnapshotEntries.get(channel.id);
      const preferredAmount = details?.displayAmount ?? null;
      const amountToUse =
        preferredAmount != null && Number.isFinite(preferredAmount) && preferredAmount > 0
          ? preferredAmount
          : snapshotEntry?.amount ?? preferredAmount;
      const currency =
        cashCurrencyByChannel[channel.id] ?? snapshotEntry?.currency ?? 'PLN';
      registerAmount(channel.id, amountToUse, currency as CashCurrency);
    });

    const formattedTotals = Array.from(totalsByCurrency.entries()).map(([currency, amount]) => ({
      currency,
      amount,
      formatted: formatCashAmount(amount),
    }));

    return {
      perChannel,
      total,
      totalsByCurrency,
      formattedTotals,
    };
  }, [
    cashCurrencyByChannel,
    cashDetailsByChannel,
    cashSnapshotEntries,
    registry.channels,
    walkInCashByChannel,
    walkInChannelIds,
    walkInTicketDataByChannel,
  ]);

  const handleCustomTicketEditStart = useCallback(
    (channelId: number, ticketLabel: string, currentName: string) => {
      setEditingCustomTicket({
        channelId,
        ticketLabel,
        value: currentName,
      });
    },
    [],
  );

  const handleCustomTicketEditChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const nextValue = event.target.value;
    setEditingCustomTicket((prev) => (prev ? { ...prev, value: nextValue } : prev));
  }, []);

  const handleCustomTicketEditCancel = useCallback(() => {
    setEditingCustomTicket(null);
  }, []);

  const handleCustomTicketEditSave = useCallback(() => {
    if (!editingCustomTicket) {
      return;
    }
    const { channelId, ticketLabel, value } = editingCustomTicket;
    const trimmed = value.trim();
    const nextName = trimmed.length > 0 ? trimmed : CUSTOM_TICKET_LABEL;

    setWalkInTicketDataByChannel((prev) => {
      const channelState = prev[channelId];
      if (!channelState) {
        return prev;
      }
      const ticketEntry = channelState.tickets[ticketLabel];
      if (!ticketEntry) {
        return prev;
      }
      const currentName =
        ticketEntry.name && ticketEntry.name.trim().length > 0 ? ticketEntry.name.trim() : ticketLabel;
      if (currentName === nextName) {
        return prev;
      }
      const nextTickets = {
        ...channelState.tickets,
        [ticketLabel]: {
          ...ticketEntry,
          name: nextName,
        },
      };
      return {
        ...prev,
        [channelId]: {
          ...channelState,
          tickets: nextTickets,
        },
      };
    });
    setWalkInNoteDirty(true);
    setEditingCustomTicket(null);
  }, [editingCustomTicket, setWalkInNoteDirty, setWalkInTicketDataByChannel]);

  const handleWalkInDiscountToggle = useCallback(
    (channelId: number, option: string) => {
      let nextSelection: string[] | null = null;
      setWalkInDiscountsByChannel((prev) => {
        const current = prev[channelId] ?? [];
        const alreadySelected = current.includes(option);
        const updated = alreadySelected
          ? current.filter((item) => item !== option)
          : normalizeDiscountSelection([...current, option]);
        if (current.length === updated.length && current.every((item, index) => item === updated[index])) {
          return prev;
        }
        nextSelection = updated;
        return { ...prev, [channelId]: updated };
      });

      if (nextSelection === null) {
        return;
      }

      setWalkInTicketDataByChannel((prev) => {
        const current = prev[channelId] ?? { ticketOrder: [], tickets: {} };
        const nextTickets: Record<string, WalkInTicketEntryState> = {};
        const nextOrder: string[] = [];

        nextSelection!.forEach((ticketLabel) => {
          if (!nextOrder.includes(ticketLabel)) {
            nextOrder.push(ticketLabel);
          }
          const existing = current.tickets[ticketLabel];
          nextTickets[ticketLabel] = existing ?? {
            name: ticketLabel,
            currencyOrder: [],
            currencies: {},
          };
        });

        const nextState: WalkInChannelTicketState = {
          ticketOrder: nextOrder,
          tickets: nextTickets,
        };

        if (nextSelection!.length === 0) {
          const mapWithout = { ...prev };
          delete mapWithout[channelId];
          return mapWithout;
        }

        const nextMap = { ...prev, [channelId]: nextState };
        return applyAutoCashToChannelMap(nextMap, channelId);
      });

      setWalkInNoteDirty(true);
    },
    [applyAutoCashToChannelMap],
  );
  const handleWalkInTicketCurrencyToggle = useCallback(
    (channelId: number, ticketLabel: string, currency: CashCurrency) => {
      setWalkInTicketDataByChannel((prev) => {
        const currentChannel = prev[channelId] ?? { ticketOrder: [], tickets: {} };
        const ticketEntry =
          currentChannel.tickets[ticketLabel] ?? {
            name: ticketLabel,
            currencyOrder: [],
            currencies: {},
          };
        const isSelected = ticketEntry.currencyOrder.includes(currency);
        const nextCurrencyOrder = isSelected
          ? ticketEntry.currencyOrder.filter((item) => item !== currency)
          : [...ticketEntry.currencyOrder, currency];
        const nextCurrencies = { ...ticketEntry.currencies };
        if (isSelected) {
          delete nextCurrencies[currency];
        } else {
          const allowManualCash = ticketLabel === CUSTOM_TICKET_LABEL;
          nextCurrencies[currency] = nextCurrencies[currency] ?? {
            people: 0,
            cash: allowManualCash ? '' : '0',
            addons: {},
          };
        }
        const nextTicket: WalkInTicketEntryState = {
          ...ticketEntry,
          currencyOrder: nextCurrencyOrder,
          currencies: nextCurrencies,
        };
        const nextTickets = {
          ...currentChannel.tickets,
          [ticketLabel]: nextTicket,
        };
        const nextOrder = currentChannel.ticketOrder.includes(ticketLabel)
          ? currentChannel.ticketOrder
          : [...currentChannel.ticketOrder, ticketLabel];
        const nextChannelState: WalkInChannelTicketState = {
          ticketOrder: nextOrder,
          tickets: nextTickets,
        };
        const nextMap = { ...prev, [channelId]: nextChannelState };
        return applyAutoCashToChannelMap(nextMap, channelId);
      });
      setWalkInNoteDirty(true);
    },
    [applyAutoCashToChannelMap],
  );

  const handleWalkInTicketPeopleChange = useCallback(
    (channelId: number, ticketLabel: string, currency: CashCurrency, nextValue: number) => {
      setWalkInTicketDataByChannel((prev) => {
        const currentChannel = prev[channelId] ?? { ticketOrder: [], tickets: {} };
        const ticketEntry =
          currentChannel.tickets[ticketLabel] ?? {
            name: ticketLabel,
            currencyOrder: [],
            currencies: {},
          };
        const existingCurrency = ticketEntry.currencies[currency] ?? {
          people: 0,
          cash: '',
          addons: {},
        };
        const normalized = Math.max(0, Math.round(nextValue));
        if (
          existingCurrency.people === normalized &&
          ticketEntry.currencyOrder.includes(currency)
        ) {
          return prev;
        }
        const nextCurrencyEntry: WalkInCurrencyEntryState = {
          ...existingCurrency,
          people: normalized,
        };
        const nextCurrencies = {
          ...ticketEntry.currencies,
          [currency]: nextCurrencyEntry,
        };
        const nextCurrencyOrder = ticketEntry.currencyOrder.includes(currency)
          ? ticketEntry.currencyOrder
          : [...ticketEntry.currencyOrder, currency];
        const nextTicket: WalkInTicketEntryState = {
          ...ticketEntry,
          currencyOrder: nextCurrencyOrder,
          currencies: nextCurrencies,
        };
        const nextTickets = {
          ...currentChannel.tickets,
          [ticketLabel]: nextTicket,
        };
        const nextOrder = currentChannel.ticketOrder.includes(ticketLabel)
          ? currentChannel.ticketOrder
          : [...currentChannel.ticketOrder, ticketLabel];
        const nextChannelState: WalkInChannelTicketState = {
          ticketOrder: nextOrder,
          tickets: nextTickets,
        };
        const nextMap = { ...prev, [channelId]: nextChannelState };
        return applyAutoCashToChannelMap(nextMap, channelId);
      });
      setWalkInNoteDirty(true);
    },
    [applyAutoCashToChannelMap],
  );

  const handleWalkInTicketAddonChange = useCallback(
    (
      channelId: number,
      ticketLabel: string,
      currency: CashCurrency,
      addonId: number,
      nextValue: number,
    ) => {
      setWalkInTicketDataByChannel((prev) => {
        const currentChannel = prev[channelId] ?? { ticketOrder: [], tickets: {} };
        const ticketEntry =
          currentChannel.tickets[ticketLabel] ?? {
            name: ticketLabel,
            currencyOrder: [],
            currencies: {},
          };
        const existingCurrency = ticketEntry.currencies[currency] ?? {
          people: 0,
          cash: '',
          addons: {},
        };
        const normalized = Math.max(0, Math.round(nextValue));
        const nextAddons = { ...existingCurrency.addons };
        if (normalized > 0) {
          nextAddons[addonId] = normalized;
        } else {
          delete nextAddons[addonId];
        }
        const nextCurrencyEntry: WalkInCurrencyEntryState = {
          ...existingCurrency,
          addons: nextAddons,
        };
        const nextCurrencies = {
          ...ticketEntry.currencies,
          [currency]: nextCurrencyEntry,
        };
        const nextCurrencyOrder = ticketEntry.currencyOrder.includes(currency)
          ? ticketEntry.currencyOrder
          : [...ticketEntry.currencyOrder, currency];
        const nextTicket: WalkInTicketEntryState = {
          ...ticketEntry,
          currencyOrder: nextCurrencyOrder,
          currencies: nextCurrencies,
        };
        const nextTickets = {
          ...currentChannel.tickets,
          [ticketLabel]: nextTicket,
        };
        const nextOrder = currentChannel.ticketOrder.includes(ticketLabel)
          ? currentChannel.ticketOrder
          : [...currentChannel.ticketOrder, ticketLabel];
        const nextChannelState: WalkInChannelTicketState = {
          ticketOrder: nextOrder,
          tickets: nextTickets,
        };
        const nextMap = { ...prev, [channelId]: nextChannelState };
        return applyAutoCashToChannelMap(nextMap, channelId);
      });
      setWalkInNoteDirty(true);
    },
    [applyAutoCashToChannelMap],
  );

  const handleWalkInTicketCashChange = useCallback(
    (channelId: number, ticketLabel: string, currency: CashCurrency, rawValue: string) => {
      if (ticketLabel !== CUSTOM_TICKET_LABEL) {
        return;
      }

      const sanitized = rawValue.replace(/[^0-9.]/g, '');
      const firstDotIndex = sanitized.indexOf('.');
      let cleaned = sanitized;
      if (firstDotIndex !== -1) {
        const before = sanitized.slice(0, firstDotIndex + 1);
        const after = sanitized.slice(firstDotIndex + 1).replace(/\./g, '');
        cleaned = before + after;
      }
      const displayValue = cleaned === '' || cleaned === '.' ? '' : cleaned;
      setWalkInTicketDataByChannel((prev) => {
        const currentChannel = prev[channelId] ?? { ticketOrder: [], tickets: {} };
        const ticketEntry =
          currentChannel.tickets[ticketLabel] ?? {
            name: ticketLabel,
            currencyOrder: [],
            currencies: {},
          };
        const existingCurrency = ticketEntry.currencies[currency] ?? {
          people: 0,
          cash: '',
          addons: {},
        };
        if (existingCurrency.cash === displayValue && ticketEntry.currencyOrder.includes(currency)) {
          return prev;
        }
        const nextCurrencyEntry: WalkInCurrencyEntryState = {
          ...existingCurrency,
          cash: displayValue,
        };
        const nextCurrencies = {
          ...ticketEntry.currencies,
          [currency]: nextCurrencyEntry,
        };
        const nextCurrencyOrder = ticketEntry.currencyOrder.includes(currency)
          ? ticketEntry.currencyOrder
          : [...ticketEntry.currencyOrder, currency];
        const nextTicket: WalkInTicketEntryState = {
          ...ticketEntry,
          currencyOrder: nextCurrencyOrder,
          currencies: nextCurrencies,
        };
        const nextTickets = {
          ...currentChannel.tickets,
          [ticketLabel]: nextTicket,
        };
        const nextOrder = currentChannel.ticketOrder.includes(ticketLabel)
          ? currentChannel.ticketOrder
          : [...currentChannel.ticketOrder, ticketLabel];
        const nextChannelState: WalkInChannelTicketState = {
          ticketOrder: nextOrder,
          tickets: nextTickets,
        };
        const nextMap = { ...prev, [channelId]: nextChannelState };
        return nextMap;
      });
      setWalkInNoteDirty(true);
    },
    [setWalkInNoteDirty],
  );

  useEffect(() => {
    if (walkInChannelIds.length === 0) {
      return;
    }
    const aggregatedCash: Record<number, string> = {};

    walkInChannelIds.forEach((channelId) => {
      const ticketState = walkInTicketDataByChannel[channelId];
      let totalPeople = 0;
      let totalCash = 0;
      const addonTotals = new Map<number, number>();

      if (ticketState) {
        ticketState.ticketOrder.forEach((ticketLabel) => {
          const ticketEntry = ticketState.tickets[ticketLabel];
          if (!ticketEntry) {
            return;
          }
          ticketEntry.currencyOrder.forEach((currency) => {
            const currencyEntry = ticketEntry.currencies[currency];
            if (!currencyEntry) {
              return;
            }
            totalPeople += Math.max(0, currencyEntry.people);
            const numericCash = Number(currencyEntry.cash);
            if (Number.isFinite(numericCash) && numericCash > 0) {
              totalCash += Math.max(0, Math.round(numericCash * 100) / 100);
            }
            Object.entries(currencyEntry.addons).forEach(([addonId, qty]) => {
              const numericAddonId = Number(addonId);
              const numericQty = Number(qty);
              if (!Number.isFinite(numericAddonId) || !Number.isFinite(numericQty)) {
                return;
              }
              addonTotals.set(
                numericAddonId,
                (addonTotals.get(numericAddonId) ?? 0) + Math.max(0, Math.round(numericQty)),
              );
            });
          });
        });
      }

      const peopleMetric = getMetric(channelId, 'booked', 'after_cutoff', 'people', null);
      if (peopleMetric || totalPeople > 0) {
        handleMetricChange(channelId, 'booked', 'after_cutoff', 'people', null, totalPeople);
      }

      registry.addons.forEach((addon) => {
        const numericAddonId =
          typeof addon.addonId === 'number' ? addon.addonId : Number(addon.addonId);
        if (!Number.isFinite(numericAddonId)) {
          return;
        }
        const addonTotal = Math.max(0, addonTotals.get(numericAddonId) ?? 0);
        const addonMetric = getMetric(channelId, 'booked', 'after_cutoff', 'addon', numericAddonId);
        if (addonMetric || addonTotal > 0) {
          handleMetricChange(channelId, 'booked', 'after_cutoff', 'addon', numericAddonId, addonTotal);
        }
      });

      const cashMetric = getMetric(channelId, 'attended', null, 'cash_payment', null);
      if (cashMetric || totalCash > 0) {
        handleMetricChange(channelId, 'attended', null, 'cash_payment', null, totalCash);
      }

      aggregatedCash[channelId] = totalCash > 0 ? formatAutoCashString(totalCash) : '0';
    });

    setWalkInCashByChannel((prev) => {
      const next = { ...prev };
      let changed = false;
      walkInChannelIds.forEach((channelId) => {
        const desired = aggregatedCash[channelId] ?? '';
        if (desired === '' && channelId in next) {
          delete next[channelId];
          changed = true;
          return;
        }
        if (desired !== '' && next[channelId] !== desired) {
          next[channelId] = desired;
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [
    formatAutoCashString,
    getMetric,
    handleMetricChange,
    registry.addons,
    walkInChannelIds,
    walkInTicketDataByChannel,
  ]);

  const handleWalkInCashChange = useCallback(
    (channelId: number, rawValue: string) => {
      const digitsOnly = rawValue.replace(/[^\d]/g, '');
      const displayValue = digitsOnly === '' ? '' : String(Math.max(0, Number(digitsOnly)));
      let didChange = false;
      setWalkInCashByChannel((prev) => {
        if (prev[channelId] === displayValue) {
          return prev;
        }
        didChange = true;
        return { ...prev, [channelId]: displayValue };
      });
      if (didChange) {
        setWalkInNoteDirty(true);
      }

      const numericQty = displayValue === '' ? 0 : Math.max(0, Number(displayValue));
      const metric = getMetric(channelId, 'attended', null, 'cash_payment', null);
      if (!metric) {
        if (numericQty > 0) {
          handleMetricChange(channelId, 'attended', null, 'cash_payment', null, numericQty);
        }
        return;
      }
      if (metric.qty !== numericQty) {
        handleMetricChange(channelId, 'attended', null, 'cash_payment', null, numericQty);
      }
    },
    [getMetric, handleMetricChange],
  );

  const handleCashOverrideEdit = useCallback(
    (channelId: number) => {
      const details = cashDetailsByChannel.get(channelId);
      const currentOverride = cashOverridesByChannel[channelId] ?? '';
      let initialValue = currentOverride;
      if (!initialValue) {
        const defaultAmount = details?.defaultAmount ?? null;
        if (defaultAmount != null && Number.isFinite(defaultAmount)) {
          initialValue = normalizeCashValue(defaultAmount);
        }
      }
      setCashEditingChannelId(channelId);
      setCashEditingValue(initialValue);
    },
    [cashDetailsByChannel, cashOverridesByChannel],
  );

  const handleCashOverrideChange = useCallback((value: string) => {
    setCashEditingValue(value);
  }, []);

  const handleCashOverrideCancel = useCallback(() => {
    setCashEditingChannelId(null);
    setCashEditingValue('');
  }, []);

  const handleCashOverrideSave = useCallback(() => {
    if (cashEditingChannelId == null) {
      return;
    }
    const channelId = cashEditingChannelId;
    const details = cashDetailsByChannel.get(channelId);
    const parsedValue = parseCashInput(cashEditingValue);
    const overrideAmount =
      parsedValue != null && Number.isFinite(parsedValue) ? Math.max(0, parsedValue) : null;
    const defaultAmount = details?.defaultAmount ?? null;
    const baseMetric = getMetric(channelId, 'attended', null, 'cash_payment', null);

    const hasOverride =
      overrideAmount != null &&
      (defaultAmount == null ? overrideAmount > 0 : !valuesAreClose(overrideAmount, defaultAmount));

    let overridesChanged = false;
    setCashOverridesByChannel((prev) => {
      const next = { ...prev };
      if (hasOverride && overrideAmount != null) {
        const normalizedOverride = normalizeCashValue(overrideAmount);
        if (prev[channelId] === normalizedOverride) {
          return prev;
        }
        overridesChanged = true;
        next[channelId] = normalizedOverride;
        return next;
      }
      if (prev[channelId] != null) {
        overridesChanged = true;
        delete next[channelId];
        return next;
      }
      return prev;
    });

    if (overridesChanged) {
      setWalkInNoteDirty(true);
    }

    const nextQty = hasOverride && overrideAmount != null ? overrideAmount : 0;
    const currentQty = baseMetric?.qty ?? 0;
    if (currentQty !== nextQty) {
      handleMetricChange(channelId, 'attended', null, 'cash_payment', null, nextQty);
    }

    setCashEditingChannelId(null);
    setCashEditingValue('');
  }, [
    cashDetailsByChannel,
    cashEditingChannelId,
    cashEditingValue,
    getMetric,
    handleMetricChange,
    setWalkInNoteDirty,
  ]);

  const handleStaffChange = useCallback(
    (userIds: number[]) => {
      const uniqueIds = Array.from(new Set(userIds));
      const normalized = normalizeIdList(uniqueIds);
      if (idListsEqual(normalized, pendingStaffIds)) {
        return;
      }
      setPendingStaffIds(normalized);
      setPendingStaffDirty(true);
    },
    [pendingStaffIds],
  );

  const loadCountersList = useCallback(async () => {
    setCounterListLoading(true);
    setCounterListError(null);
    try {
      const payload = await dispatch(fetchCounters()).unwrap();
      const firstEntry = payload?.[0];
      const counters = Array.isArray(firstEntry?.data) ? firstEntry.data : [];
      setCounterList(counters as Partial<Counter>[]);
    } catch (error) {
      const message =
        typeof error === 'string'
          ? error
          : error instanceof Error
            ? error.message
            : 'Failed to load counters';
      setCounterListError(message);
      setCounterList([]);
    } finally {
      setCounterListLoading(false);
    }
  }, [dispatch]);

  const ensureSetupPersisted = useCallback(async (): Promise<boolean> => {
    if (!registry.counter) {
      return true;
    }

    const counterRecord = registry.counter.counter;
    const updates: Array<Promise<unknown>> = [];

    if (selectedManagerId != null && selectedManagerId !== counterRecord.userId) {
      updates.push(dispatch(updateCounterManager({ counterId: counterRecord.id, userId: selectedManagerId })).unwrap());
    }

    const desiredProductId = pendingProductId ?? null;
    const currentServerProductId = counterRecord.productId ?? null;
    if (desiredProductId !== currentServerProductId) {
      updates.push(
        dispatch(updateCounterProduct({ counterId: counterRecord.id, productId: desiredProductId })).unwrap(),
      );
    }

    const lastPersistedStaffIds = lastPersistedStaffIdsRef.current;
    const staffDiffers = !idListsEqual(pendingStaffIds, lastPersistedStaffIds);
    if (pendingStaffDirty && staffDiffers) {
      updates.push(dispatch(updateCounterStaff({ counterId: counterRecord.id, userIds: pendingStaffIds })).unwrap());
    }
    if (pendingStaffDirty && !staffDiffers) {
      setPendingStaffDirty(false);
    }

    if (updates.length === 0) {
      setPendingStaffDirty(false);
      return true;
    }

    try {
      setEnsuringCounter(true);
      await Promise.all(updates);
      setPendingStaffDirty(false);
      if (staffDiffers && pendingStaffIds.length > 0) {
        lastPersistedStaffIdsRef.current = normalizeIdList(pendingStaffIds);
      }
      return true;
    } catch (_error) {
      return false;
    } finally {
      setEnsuringCounter(false);
    }
  }, [dispatch, pendingProductId, pendingStaffDirty, pendingStaffIds, registry.counter, selectedManagerId]);

  useEffect(() => {
    const handle = scheduleIdle(() => {
      void loadCountersList();
    });
    return () => cancelIdle(handle);
  }, [loadCountersList]);

  const handleOpenModal = useCallback(
    (mode: 'create' | 'update') => {
      if (mode === 'update' && selectedCounterId == null) {
        return;
      }
      setModalMode(mode);
      if (mode === 'create') {
        setActiveRegistryStep('details');
      } else if (mode === 'update') {
        const formatted = selectedDate.format(COUNTER_DATE_FORMAT);
        const currentDate = registry.counter?.counter.date ?? null;
        const currentUserId = registry.counter?.counter.userId ?? null;
        const currentCounterProductId = registry.counter?.counter.productId ?? null;
        const shouldFetch =
          formatted !== currentDate ||
          (selectedManagerId != null && selectedManagerId !== currentUserId) ||
          (currentProductId ?? null) !== currentCounterProductId;
        if (shouldFetch) {
          fetchCounterRequestRef.current = null;
          void loadCounterForDate(formatted, currentProductId ?? null);
        }
      }
      setIsModalOpen(true);
    },
    [
      currentProductId,
      loadCounterForDate,
      registry.counter,
      selectedCounterId,
      selectedDate,
      selectedManagerId,
      setActiveRegistryStep,
    ],
  );

  const handleCloseModal = useCallback(() => {
    setIsModalOpen(false);
    setModalMode(null);
    setActiveRegistryStep('details');
    void loadCountersList();
  }, [loadCountersList, setActiveRegistryStep]);

  useEffect(() => {
    if (isModalOpen && !catalog.loaded && !catalog.loading) {
      const handle = scheduleIdle(() => {
        dispatch(loadCatalog());
      });
      return () => cancelIdle(handle);
    }
    return undefined;
  }, [catalog.loaded, catalog.loading, dispatch, isModalOpen]);

const handleCounterSelect = useCallback((counterSummary: Partial<Counter>) => {
  const nextCounterId = counterSummary.id ?? null;

  window.setTimeout(() => {
    startTransition(() => {
      setCounterListError(null);
      fetchCounterRequestRef.current = null;

      const nextUserId = counterSummary.userId ?? null;
      if (nextUserId) {
        setSelectedManagerId(nextUserId);
      }

      if (counterSummary.date) {
        const parsed = dayjs(counterSummary.date);
        if (parsed.isValid()) {
          setSelectedDate(parsed);
        }
      }

      setSelectedCounterId(nextCounterId);
    });
  }, 0);
}, []);

const handleViewSummary = useCallback(
  async (counterSummary: Partial<Counter>) => {
    const counterIdValue = counterSummary.id ?? null;
    const counterDateValue = counterSummary.date ? dayjs(counterSummary.date) : null;
    if (!counterIdValue || !counterDateValue || !counterDateValue.isValid()) {
      return;
    }
    handleCounterSelect(counterSummary);
    setSummaryPreviewTitle(counterDateValue.format('MMM D, YYYY'));
    setSummaryPreviewOpen(true);
    setSummaryPreviewLoading(true);
    try {
      const productIdForSummary = counterSummary.product?.id ?? counterProductId ?? null;
      await loadCounterForDate(counterDateValue.format(COUNTER_DATE_FORMAT), productIdForSummary);
    } catch (error) {
      console.warn('Failed to load counter summary', error);
    } finally {
      setSummaryPreviewLoading(false);
    }
  },
  [counterProductId, handleCounterSelect, loadCounterForDate],
);

useEffect(() => {
  dispatch(fetchNightReports());
}, [dispatch]);

  const handleDeleteCounter = useCallback(() => {
    const targetCounterId = counterId ?? selectedCounterId;
    if (!targetCounterId) {
      return;
    }
    const confirmed = window.confirm('Delete this counter?');
    if (!confirmed) {
      return;
    }
    dispatch(deleteCounter(targetCounterId))
      .unwrap()
      .then(() => {
        setSelectedCounterId(null);
        handleCloseModal();
      })
      .catch((error) => {
        const message = typeof error === 'string' ? error : 'Failed to delete counter';
        setCounterListError(message);
      });
  }, [counterId, dispatch, handleCloseModal, selectedCounterId]);

  const handleAddNewCounter = useCallback(() => {
    const managerId = selectedManagerId ?? session.loggedUserId;
    if (!managerId) {
      setCounterListError('Select a manager before continuing.');
      return;
    }
    if (!catalog.loaded && !catalog.loading) {
      dispatch(loadCatalog());
    }

    const today = dayjs();

    setCounterListError(null);
    setSelectedManagerId(managerId);
    setSelectedDate(today);
    setPendingProductId(null);
    setPendingStaffIds([]);
    setSelectedChannelIds([]);
    fetchCounterRequestRef.current = null;
    setSelectedCounterId(null);

    dispatch(clearCounter());
    dispatch(clearDirtyMetrics());

    handleOpenModal('create');
  }, [
    selectedManagerId,
    session.loggedUserId,
    catalog.loaded,
    catalog.loading,
    dispatch,
    handleOpenModal,
  ]);

  const handleChannelSelection = useCallback((_event: MouseEvent<HTMLElement>, values: number[]) => {
    const next = Array.isArray(values) ? values.map((value) => Number(value)).filter(Number.isFinite) : [];
    setSelectedChannelIds(Array.from(new Set(next)));
  }, []);

  const handleAfterCutoffChannelSelection = useCallback(
    (_event: MouseEvent<HTMLElement>, values: number[]) => {
      const next = Array.isArray(values)
        ? values
            .map((value) => Number(value))
            .filter((value) => Number.isFinite(value) && allowedAfterCutoffChannelIds.includes(value))
        : [];
      setSelectedAfterCutoffChannelIds(Array.from(new Set(next)));
    },
    [allowedAfterCutoffChannelIds],
  );


  const dirtyMetricCount = registry.dirtyMetricKeys.length;
  const hasDirtyMetrics = dirtyMetricCount > 0;
  const walkInChannelIdSet = useMemo(() => new Set(walkInChannelIds), [walkInChannelIds]);

  const effectiveSelectedChannelIds = useMemo<number[]>(() => {
    const base =
      selectedChannelIds.length > 0 ? selectedChannelIds : savedPlatformChannelIds;
    const combined = new Set<number>(base);
    channelIdsWithAnyData.forEach((id) => {
      if (!walkInChannelIdSet.has(id)) {
        combined.add(id);
      }
    });
    return Array.from(combined);
  }, [channelIdsWithAnyData, savedPlatformChannelIds, selectedChannelIds, walkInChannelIdSet]);

  useEffect(() => {
    setSelectedChannelIds((prev) => {
      const filtered = prev.filter((id) => channelHasAnyQty(id) || editingChannelIds.has(id));
      return filtered.length === prev.length ? prev : filtered;
    });
  }, [channelHasAnyQty, editingChannelIds]);

  const effectiveAfterCutoffIds = useMemo<number[]>(() => {
    const base =
      selectedAfterCutoffChannelIds.length > 0
        ? selectedAfterCutoffChannelIds
        : savedAfterCutoffChannelIds.filter((id: number) => allowedAfterCutoffChannelIds.includes(id));
    const combined = new Set<number>(base);
    channelIdsWithAnyData.forEach((id) => {
      if (allowedAfterCutoffChannelIds.includes(id)) {
        combined.add(id);
      }
    });
    return Array.from(combined);
  }, [
    allowedAfterCutoffChannelIds,
    channelIdsWithAnyData,
    savedAfterCutoffChannelIds,
    selectedAfterCutoffChannelIds,
  ]);

  useEffect(() => {
    setSelectedAfterCutoffChannelIds((prev) => {
      const filtered = prev.filter((id) => channelHasAnyQty(id) || editingChannelIds.has(id));
      return filtered.length === prev.length ? prev : filtered;
    });
  }, [channelHasAnyQty, editingChannelIds]);
  const autoAfterCutoffChannelIds = useMemo(() => {
    const autoIds = new Set<number>();
    channelsWithAfterCutoffMetrics.forEach((id) => {
      if (effectiveSelectedChannelIds.includes(id)) {
        autoIds.add(id);
      }
    });
    return autoIds;
  }, [channelsWithAfterCutoffMetrics, effectiveSelectedChannelIds]);
  const ecwidChannelId = useMemo(() => {
    const ecwid = registry.channels.find((channel) => channel.name?.toLowerCase() === 'ecwid');
    return ecwid ? ecwid.id : null;
  }, [registry.channels]);
  const isEcwidSelected = useMemo(
    () => (ecwidChannelId != null ? effectiveSelectedChannelIds.includes(ecwidChannelId) : false),
    [effectiveSelectedChannelIds, ecwidChannelId],
  );
  useEffect(() => {
    if (autoAfterCutoffChannelIds.size === 0) {
      return;
    }
    setSelectedAfterCutoffChannelIds((prev) => {
      const merged = new Set<number>(prev);
      let changed = false;
      autoAfterCutoffChannelIds.forEach((id) => {
        if (!merged.has(id)) {
          merged.add(id);
          changed = true;
        }
      });
      return changed ? Array.from(merged) : prev;
    });
  }, [autoAfterCutoffChannelIds]);
  const shouldHideAfterCutoffChannel = useCallback(
    (channel: ChannelConfig | undefined) => {
      if (!channel) {
        return false;
      }
      const normalizedName = channel.name?.toLowerCase() ?? '';
      if (normalizedName === 'ecwid') {
        return isEcwidSelected;
      }
      return false;
    },
    [isEcwidSelected],
  );


  const summaryChannelOrder = useMemo<number[]>(() => {
    const order: number[] = [];
    effectiveSelectedChannelIds.forEach((id) => {
      if (!order.includes(id)) {
        order.push(id);
      }
    });
    effectiveAfterCutoffIds.forEach((id) => {
      if (!order.includes(id)) {
        order.push(id);
      }
    });
    return order;
  }, [effectiveAfterCutoffIds, effectiveSelectedChannelIds]);

  const summaryChannelIds = useMemo(() => new Set(summaryChannelOrder), [summaryChannelOrder]);

  const attendedPeopleByChannel = useMemo(() => {
    const map = new Map<number, number>();
    mergedMetrics.forEach((metric) => {
      if (metric.kind === 'people' && metric.tallyType === 'attended' && metric.period === null) {
        map.set(metric.channelId, metric.qty ?? 0);
      }
    });
    return map;
  }, [mergedMetrics]);

  const buildCounterNotes = useCallback((): string => {
    const currentNote = counterNotes;
    const existingLines = currentNote ? currentNote.split(/\r?\n/) : [];
    const filteredLines: string[] = [];
    let skippingSnapshot = false;

    existingLines.forEach((line) => {
      const trimmed = line.trim();
      if (trimmed === CASH_SNAPSHOT_START || trimmed === FREE_SNAPSHOT_START) {
        skippingSnapshot = true;
        return;
      }
      if (trimmed === CASH_SNAPSHOT_END || trimmed === FREE_SNAPSHOT_END) {
        skippingSnapshot = false;
        return;
      }
      if (skippingSnapshot) {
        return;
      }
      if (!trimmed) {
        return;
      }
      const lower = trimmed.toLowerCase();
      if (lower.startsWith(WALK_IN_DISCOUNT_NOTE_PREFIX.toLowerCase())) {
        return;
      }
      if (lower.startsWith(WALK_IN_CASH_NOTE_PREFIX.toLowerCase())) {
        return;
      }
      filteredLines.push(line.trimEnd());
    });

    const sections: string[] = [];
    if (filteredLines.length > 0) {
      sections.push(filteredLines.join('\n'));
    }

    const snapshotChannels: Record<string, CashSnapshotEntry> = {};
    const activeCashChannelIds = new Set<number>();
    summaryChannelIds.forEach((channelId) => activeCashChannelIds.add(channelId));
    walkInChannelIds.forEach((channelId) => activeCashChannelIds.add(channelId));

    registry.channels.forEach((channel) => {
      if (!isCashPaymentChannel(channel) || !activeCashChannelIds.has(channel.id)) {
        return;
      }
      const normalizedName = channel.name?.toLowerCase() ?? '';
      const isWalkIn = normalizedName === WALK_IN_CHANNEL_SLUG;
      const peopleQty = attendedPeopleByChannel.get(channel.id) ?? 0;
      const normalizedQty = Math.max(0, Math.round(peopleQty));
      if (isWalkIn) {
        const ticketState = walkInTicketDataByChannel[channel.id];
        let totalAmount = 0;
        let totalPeople = 0;
        const ticketSnapshots: WalkInSnapshotTicket[] = [];
        if (ticketState) {
          ticketState.ticketOrder.forEach((ticketLabel) => {
            const ticketEntry = ticketState.tickets[ticketLabel];
            if (!ticketEntry) {
              return;
            }
            const currencySnapshots: WalkInSnapshotCurrency[] = [];
            ticketEntry.currencyOrder.forEach((currency) => {
              const currencyEntry = ticketEntry.currencies[currency];
              if (!currencyEntry) {
                return;
              }
              const peopleTotal = Math.max(0, Math.round(currencyEntry.people));
              const cashValueRaw = Number(currencyEntry.cash);
              const normalizedCash =
                Number.isFinite(cashValueRaw) && cashValueRaw > 0
                  ? Math.max(0, Math.round(cashValueRaw * 100) / 100)
                  : 0;
              const addonsSnapshot: Record<string, number> = {};
              Object.entries(currencyEntry.addons).forEach(([addonId, qty]) => {
                const numericQty = Math.max(0, Math.round(Number(qty)));
                if (Number.isFinite(numericQty) && numericQty > 0) {
                  addonsSnapshot[addonId] = numericQty;
                }
              });
              currencySnapshots.push({
                currency,
                people: peopleTotal,
                cash: normalizedCash,
                addons: addonsSnapshot,
              });
              totalPeople += peopleTotal;
              totalAmount += normalizedCash;
            });
            if (currencySnapshots.length > 0) {
              const ticketDisplayName =
                ticketEntry?.name && ticketEntry.name.trim().length > 0 ? ticketEntry.name : ticketLabel;
              ticketSnapshots.push({
                name: ticketDisplayName,
                currencies: currencySnapshots,
              });
            }
          });
        }
        if (ticketSnapshots.length > 0) {
          snapshotChannels[channel.id.toString()] = {
            currency: 'PLN',
            amount: totalAmount,
            qty: totalPeople,
            tickets: ticketSnapshots,
          };
          return;
        }
        const fallbackValue = Number(walkInCashByChannel[channel.id] ?? 0);
        const rawAmount = Number.isFinite(fallbackValue) ? fallbackValue : null;
        const normalizedAmount =
          rawAmount != null && Number.isFinite(rawAmount) ? Math.max(0, Math.round(rawAmount * 100) / 100) : 0;
        if (normalizedAmount <= 0 && normalizedQty <= 0) {
          return;
        }
        snapshotChannels[channel.id.toString()] = {
          currency: 'PLN',
          amount: normalizedAmount,
          qty: normalizedQty,
        };
        return;
      }
      const currency = cashCurrencyByChannel[channel.id] ?? 'PLN';
      const details = cashDetailsByChannel.get(channel.id);
      const rawAmount = details?.displayAmount ?? null;
      const normalizedAmount =
        rawAmount != null && Number.isFinite(rawAmount) ? Math.max(0, Math.round(rawAmount * 100) / 100) : 0;
      if (normalizedAmount <= 0 && normalizedQty <= 0 && currency === 'PLN') {
        return;
      }
      snapshotChannels[channel.id.toString()] = { currency, amount: normalizedAmount, qty: normalizedQty };
    });

    const freeChannels: Record<string, FreeSnapshotChannelEntry> = {};
    Object.entries(freePeopleByChannel).forEach(([channelIdKey, entry]) => {
      const channelId = Number(channelIdKey);
      if (!Number.isFinite(channelId) || !entry) {
        return;
      }
      const qty = Math.max(0, Math.round(entry.qty ?? 0));
      const note = (entry.note ?? '').trim();
      if (qty <= 0 && note.length === 0) {
        return;
      }
      const key = channelId.toString();
      if (!freeChannels[key]) {
        freeChannels[key] = {};
      }
      freeChannels[key].people = { qty, note };
    });
    Object.entries(freeAddonsByChannel).forEach(([channelIdKey, addons]) => {
      const channelId = Number(channelIdKey);
      if (!Number.isFinite(channelId) || !addons) {
        return;
      }
      const addonEntries: Record<string, FreeSnapshotAddonEntry> = {};
      Object.entries(addons).forEach(([addonIdKey, addonEntry]) => {
        if (!addonEntry) {
          return;
        }
        const qty = Math.max(0, Math.round(addonEntry.qty ?? 0));
        const note = (addonEntry.note ?? '').trim();
        if (qty <= 0 && note.length === 0) {
          return;
        }
        addonEntries[addonIdKey] = { qty, note };
      });
      if (Object.keys(addonEntries).length === 0) {
        return;
      }
      const key = channelId.toString();
      if (!freeChannels[key]) {
        freeChannels[key] = {};
      }
      freeChannels[key].addons = {
        ...(freeChannels[key].addons ?? {}),
        ...addonEntries,
      };
    });

    const appendSnapshot = (block: string) => {
      if (sections.length > 0 && sections[sections.length - 1] !== '') {
        sections.push('');
      }
      sections.push(block);
    };

    if (Object.keys(snapshotChannels).length > 0) {
      appendSnapshot(serializeCashSnapshot(snapshotChannels));
    }

    if (Object.keys(freeChannels).length > 0) {
      appendSnapshot(serializeFreeSnapshot(freeChannels));
    }

    return sections.join('\n');
  }, [
    cashCurrencyByChannel,
    cashDetailsByChannel,
    counterNotes,
    registry.channels,
    summaryChannelIds,
    walkInCashByChannel,
    walkInChannelIds,
    attendedPeopleByChannel,
    walkInTicketDataByChannel,
    freePeopleByChannel,
    freeAddonsByChannel,
  ]);

  const computedCounterNotes = useMemo(() => buildCounterNotes(), [buildCounterNotes]);
  const currentCounterNotes = counterNotes;
  const noteNeedsUpdate = registry.counter ? computedCounterNotes !== currentCounterNotes : false;

  const platformRecordedTotal = useMemo(() => {
    if (effectiveSelectedChannelIds.length === 0) {
      return 0;
    }
    let total = 0;
    mergedMetrics.forEach((metric) => {
      if (
        metric.kind === 'people' &&
        metric.tallyType === 'booked' &&
        metric.period === 'before_cutoff' &&
        effectiveSelectedChannelIds.includes(metric.channelId)
      ) {
        total += metric.qty;
      }
    });
    return total;
  }, [effectiveSelectedChannelIds, mergedMetrics]);

  const reservationsRecordedTotal = useMemo(() => {
    if (effectiveSelectedChannelIds.length === 0 && effectiveAfterCutoffIds.length === 0) {
      return 0;
    }
    let total = 0;
    mergedMetrics.forEach((metric) => {
      if (
        metric.kind === 'people' &&
        metric.tallyType === 'attended' &&
        effectiveSelectedChannelIds.includes(metric.channelId)
      ) {
        total += metric.qty;
      }
      if (
        metric.kind === 'people' &&
        metric.tallyType === 'booked' &&
        metric.period === 'after_cutoff' &&
        effectiveAfterCutoffIds.includes(metric.channelId)
      ) {
        total += metric.qty;
      }
    });
    return total;
  }, [effectiveAfterCutoffIds, effectiveSelectedChannelIds, mergedMetrics]);

  const freePeopleTotalsByChannel = useMemo(() => {
    const map = new Map<number, number>();
    Object.entries(freePeopleByChannel).forEach(([channelIdKey, entry]) => {
      const channelId = Number(channelIdKey);
      if (!Number.isFinite(channelId) || !entry) {
        return;
      }
      const qty = Math.max(0, Math.round(entry.qty ?? 0));
      if (qty > 0) {
        map.set(channelId, qty);
      }
    });
    return map;
  }, [freePeopleByChannel]);

  const totalFreePeople = useMemo(() => {
    let total = 0;
    Object.values(freePeopleByChannel).forEach((entry) => {
      if (!entry) {
        return;
      }
      total += Math.max(0, Math.round(entry.qty ?? 0));
    });
    return total;
  }, [freePeopleByChannel]);

  const freeAddonsTotalsByChannel = useMemo(() => {
    const channelMap = new Map<number, Map<number, number>>();
    Object.entries(freeAddonsByChannel).forEach(([channelIdKey, addonMap]) => {
      const channelId = Number(channelIdKey);
      if (!Number.isFinite(channelId) || !addonMap) {
        return;
      }
      const perAddon = new Map<number, number>();
      Object.entries(addonMap).forEach(([addonIdKey, entry]) => {
        const addonId = Number(addonIdKey);
        if (!Number.isFinite(addonId) || !entry) {
          return;
        }
        const qty = Math.max(0, Math.round(entry.qty ?? 0));
        if (qty > 0) {
          perAddon.set(addonId, qty);
        }
      });
      if (perAddon.size > 0) {
        channelMap.set(channelId, perAddon);
      }
    });
    return channelMap;
  }, [freeAddonsByChannel]);

  const freeAddonTotalsByKey = useMemo(() => {
    const totals = new Map<string, number>();
    Object.entries(freeAddonsByChannel).forEach(([_, addonMap]) => {
      Object.entries(addonMap).forEach(([addonIdKey, entry]) => {
        const addonId = Number(addonIdKey);
        if (!Number.isFinite(addonId) || !entry) {
          return;
        }
        const qty = Math.max(0, Math.round(entry.qty ?? 0));
        if (qty <= 0) {
          return;
        }
        const addonConfig =
          registry.addons.find((addon) => addon.addonId === addonId) ??
          catalog.addons.find((addon) => addon.addonId === addonId);
        const key = addonConfig?.key ?? `addon-${addonId}`;
        totals.set(key, (totals.get(key) ?? 0) + qty);
      });
    });
    return totals;
  }, [catalog.addons, freeAddonsByChannel, registry.addons]);

  const freeCocktailTotal = useMemo(() => {
    let total = 0;
    Object.entries(freeAddonsByChannel).forEach(([_, addonMap]) => {
      Object.entries(addonMap).forEach(([addonIdKey, entry]) => {
        const addonId = Number(addonIdKey);
        if (!Number.isFinite(addonId) || !entry) {
          return;
        }
        const qty = Math.max(0, Math.round(entry.qty ?? 0));
        if (qty <= 0) {
          return;
        }
        const addonConfig =
          registry.addons.find((addon) => addon.addonId === addonId) ??
          catalog.addons.find((addon) => addon.addonId === addonId);
        const keyLower = addonConfig?.key?.toLowerCase() ?? '';
        const nameLower = addonConfig?.name?.toLowerCase() ?? '';
        if (keyLower.includes('cocktail') || nameLower.includes('cocktail')) {
          total += qty;
        }
      });
    });
    return total;
  }, [catalog.addons, freeAddonsByChannel, registry.addons]);

  const freeBrunchTotal = useMemo(() => {
    let total = 0;
    Object.entries(freeAddonsByChannel).forEach(([_, addonMap]) => {
      Object.entries(addonMap).forEach(([addonIdKey, entry]) => {
        const addonId = Number(addonIdKey);
        if (!Number.isFinite(addonId) || !entry) {
          return;
        }
        const qty = Math.max(0, Math.round(entry.qty ?? 0));
        if (qty <= 0) {
          return;
        }
        const addonConfig =
          registry.addons.find((addon) => addon.addonId === addonId) ??
          catalog.addons.find((addon) => addon.addonId === addonId);
        const keyLower = addonConfig?.key?.toLowerCase() ?? '';
        const nameLower = addonConfig?.name?.toLowerCase() ?? '';
        if (keyLower.includes('brunch') || nameLower.includes('brunch')) {
          total += qty;
        }
      });
    });
    return total;
  }, [catalog.addons, freeAddonsByChannel, registry.addons]);

  const hasFreeNoteValidationError = useMemo(() => {
    const peopleInvalid = Object.values(freePeopleByChannel).some(
      (entry) => entry && entry.qty > 0 && entry.note.trim().length === 0,
    );
    if (peopleInvalid) {
      return true;
    }
    return Object.values(freeAddonsByChannel).some((addonMap) =>
      Object.values(addonMap).some((entry) => entry && entry.qty > 0 && entry.note.trim().length === 0),
    );
  }, [freeAddonsByChannel, freePeopleByChannel]);

  const flushMetrics = useCallback(async (): Promise<boolean> => {
    const activeCounterId = counterId;
    if (!activeCounterId) {
      return true;
    }
    const noteUpdateNeeded = noteNeedsUpdate || walkInNoteDirty;
    if (!hasDirtyMetrics && !noteUpdateNeeded) {
      return true;
    }
    setConfirmingMetrics(true);
    try {
      let shouldRefreshCounter = false;
      let shouldFlagList = false;
      const dirtyCashMetric =
        hasDirtyMetrics &&
        registry.dirtyMetricKeys.some((key) => {
          const parts = key.split('|');
          return parts.length > 1 && parts[1] === 'cash_payment';
        });
      if (hasDirtyMetrics) {
        await dispatch(flushDirtyMetrics()).unwrap();
        shouldRefreshCounter = true;
        if (dirtyCashMetric) {
          shouldFlagList = true;
        }
      }
      if (noteUpdateNeeded) {
        if (computedCounterNotes !== currentCounterNotes) {
          await dispatch(
            updateCounterNotes({
              counterId: activeCounterId,
              notes: computedCounterNotes,
            }),
          ).unwrap();
          shouldFlagList = true;
        }
        setWalkInNoteDirty(false);
      }
      if (shouldRefreshCounter) {
        const formatted = selectedDate.format(COUNTER_DATE_FORMAT);
        await dispatch(fetchCounterByDate({ date: formatted, productId: currentProductId ?? null })).unwrap();
      }
      if (shouldFlagList) {
        setShouldRefreshCounterList(true);
      }
      return true;
    } catch (_error) {
      return false;
    } finally {
      setConfirmingMetrics(false);
    }
  }, [
    computedCounterNotes,
    counterId,
    currentCounterNotes,
    currentProductId,
    dispatch,
    hasDirtyMetrics,
    registry.dirtyMetricKeys,
    noteNeedsUpdate,
    selectedDate,
    walkInNoteDirty,
  ]);

  const ensureNightReportFromSummary = useCallback(async () => {
    const counterRecord = registry.counter?.counter;
    const summary = registry.summary;
    if (!counterRecord || !summary) {
      return;
    }
    const leaderId = counterRecord.userId;
    if (!leaderId) {
      return;
    }

    const peopleAttended = Math.max(0, Math.round(summary.totals?.people?.attended ?? 0));
    const productNameNormalized = (counterRecord.product?.name ?? DEFAULT_PRODUCT_NAME).trim().toLowerCase();
    const isBottomlessBrunchProduct = productNameNormalized.includes('bottomless brunch');

    let cocktailsAttended = 0;
    let brunchAttended = 0;
    let hasBrunchData = false;

    if (isBottomlessBrunchProduct) {
      brunchAttended = peopleAttended;
      hasBrunchData = true;
    } else {
      const cocktailsAddonKey =
        registry.addons.find((addon) => {
          const nameLower = addon.name?.toLowerCase() ?? '';
          const keyLower = addon.key?.toLowerCase() ?? '';
          return nameLower.includes('cocktail') || keyLower.includes('cocktail');
        })?.key ?? 'cocktails';
      cocktailsAttended = Math.max(
        0,
        Math.round(summary.totals?.addons?.[cocktailsAddonKey]?.attended ?? 0),
      );

      const brunchAddonLookup = registry.addons.find((addon) => {
        const nameLower = addon.name?.toLowerCase() ?? '';
        const keyLower = addon.key?.toLowerCase() ?? '';
        return nameLower.includes('brunch') || keyLower.includes('brunch');
      });
      const brunchAddonKey = brunchAddonLookup?.key ?? 'brunch';
      const brunchBucket = summary.totals?.addons?.[brunchAddonKey];
      hasBrunchData = brunchBucket != null;
      brunchAttended = hasBrunchData ? Math.max(0, Math.round(brunchBucket.attended ?? 0)) : 0;
    }

    const cocktailsCountWithFree = Math.max(0, Math.round(cocktailsAttended + freeCocktailTotal));
    const brunchCountWithFree = Math.max(
      0,
      Math.round((hasBrunchData ? brunchAttended : 0) + freeBrunchTotal),
    );
    const totalPeopleWithFree = Math.max(0, Math.round(peopleAttended + totalFreePeople));
    const normalCount = Math.max(0, totalPeopleWithFree - cocktailsCountWithFree - brunchCountWithFree);
    const computedTotalPeople = normalCount + cocktailsCountWithFree + brunchCountWithFree;

    if (
      computedTotalPeople === 0 &&
      summary.totals?.people?.bookedBefore === 0 &&
      summary.totals?.people?.bookedAfter === 0
    ) {
      return;
    }

    const baseVenue = {
      orderIndex: 1,
      venueName: 'Select Open Bar',
      totalPeople: computedTotalPeople,
      isOpenBar: true,
      normalCount,
      cocktailsCount: cocktailsCountWithFree,
      brunchCount: brunchCountWithFree,
    };

    const creationPayload = {
      counterId: counterRecord.id,
      leaderId,
      activityDate: counterRecord.date,
      venues: [baseVenue],
    };

    const existingSummary =
      nightReportSummaries.find((report) => report.counterId === counterRecord.id) ?? null;
    let reportId = existingSummary?.id ?? null;
    let creationErrorMessage: string | null = null;

    if (!reportId) {
      try {
        await dispatch(createNightReport(creationPayload)).unwrap();
        return;
      } catch (error) {
        creationErrorMessage = typeof error === 'string' ? error : (error as Error)?.message ?? '';
        if (!(creationErrorMessage ?? '').toLowerCase().includes('night report already exists')) {
          // eslint-disable-next-line no-console
          console.warn('Failed to auto-create night report from counter summary:', creationErrorMessage || error);
          return;
        }
      }
    }

    try {
      if (!reportId) {
        const summariesResponse = await axiosInstance.get<ServerResponse<NightReportSummary>>('/nightReports', {
          params: { counterId: counterRecord.id },
          withCredentials: true,
        });
        reportId = summariesResponse.data?.[0]?.data?.[0]?.id ?? null;
      }
      if (!reportId) {
        return;
      }

      const detailResponse = await axiosInstance.get<NightReport[]>(`/nightReports/${reportId}`, {
        withCredentials: true,
      });
      const reportDetail = detailResponse.data?.[0];
      if (!reportDetail) {
        return;
      }

      const existingVenues = [...(reportDetail.venues ?? [])].sort(
        (a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0),
      );
      const existingOpenBar = existingVenues.find((venue) => venue.isOpenBar) ?? existingVenues[0];
      const existingBrunch = Math.max(existingOpenBar?.brunchCount ?? 0, 0);
      const brunchCount = brunchCountWithFree > 0 ? brunchCountWithFree : existingBrunch;
      const totalPeople = normalCount + cocktailsCountWithFree + brunchCount;

      const openBarVenue = {
        orderIndex: 1,
        venueName: existingOpenBar?.venueName ?? baseVenue.venueName,
        totalPeople,
        isOpenBar: true,
        normalCount,
        cocktailsCount: cocktailsCountWithFree,
        brunchCount,
      };

      const otherVenues = existingVenues
        .filter((venue) => !venue.isOpenBar)
        .map((venue, index) => ({
          orderIndex: index + 2,
          venueName: venue.venueName ?? '',
          totalPeople: Math.max(0, venue.totalPeople ?? 0),
          isOpenBar: false,
          normalCount: venue.normalCount ?? null,
          cocktailsCount: venue.cocktailsCount ?? null,
          brunchCount: venue.brunchCount ?? null,
        }));

      await dispatch(
        updateNightReport({
          reportId,
          payload: {
            leaderId,
            activityDate: counterRecord.date,
            venues: [openBarVenue, ...otherVenues],
          },
        }),
      ).unwrap();
    } catch (error) {
      const message = typeof error === 'string' ? error : (error as Error)?.message ?? '';
      // eslint-disable-next-line no-console
      console.warn('Failed to upsert night report from counter summary:', message || creationErrorMessage || error);
    }
  }, [
    dispatch,
    freeBrunchTotal,
    freeCocktailTotal,
    nightReportSummaries,
    registry.addons,
    registry.counter,
    registry.summary,
    totalFreePeople,
  ]);

  const handleSaveAndExit = useCallback(async () => {
    const saved = await flushMetrics();
    if (saved) {
      await ensureNightReportFromSummary();
      handleCloseModal();
    }
  }, [ensureNightReportFromSummary, flushMetrics, handleCloseModal]);
  const renderStepper = (
    label: string,
    metric: MetricCell | null,
    disabled: boolean,
    min = 0,
    max?: number,
    step = 1,
    options: { hideLabel?: boolean } = {},
  ) => {
    const qty = metric?.qty ?? 0;
    const decreaseDisabled = disabled || qty <= min;
    const increaseDisabled = disabled || (typeof max === 'number' && qty >= max);

    const adjust = (delta: number) => {
      const next = Math.max(min, Math.floor(qty + delta));
      const finalValue = typeof max === 'number' ? Math.min(next, max) : next;
      if (!metric || finalValue === qty) {
        return;
      }
      handleMetricChange(metric.channelId, metric.tallyType, metric.period, metric.kind, metric.addonId, finalValue);
    };

    const handleInputChange = (value: string) => {
      if (!metric) {
        return;
      }
      const parsed = Number(value);
      if (Number.isNaN(parsed)) {
        return;
      }
      const clamped = Math.max(min, typeof max === 'number' ? Math.min(parsed, max) : parsed);
      handleMetricChange(metric.channelId, metric.tallyType, metric.period, metric.kind, metric.addonId, clamped);
    };

    const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        adjust(step);
      }
      if (event.key === '-') {
        event.preventDefault();
        adjust(-step);
      }
      if (event.key === '0') {
        event.preventDefault();
        if (metric) {
          handleMetricChange(metric.channelId, metric.tallyType, metric.period, metric.kind, metric.addonId, 0);
        }
      }
    };

    const handleFocus = () => {
      if (metric) {
        markChannelEditing(metric.channelId);
      }
    };

    const handleBlur = () => {
      if (metric) {
        unmarkChannelEditing(metric.channelId);
      }
    };

    const displayLabel = label ?? '';
    const hideLabel = Boolean(options.hideLabel);
    const ariaLabel = displayLabel.trim().length > 0 ? displayLabel : 'value';
    const stackKey =
      metric
        ? `${metric.channelId}-${metric.kind}-${metric.addonId ?? 'people'}-${metric.tallyType}-${metric.period ?? 'none'}`
        : displayLabel;

    return (
      <Stack direction="row" spacing={1} alignItems="center" sx={{ width: '100%' }} key={stackKey}>
        {!hideLabel && (
          <Typography sx={{ flexGrow: 1 }}>{displayLabel}</Typography>
        )}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            width: '100%',
            maxWidth: 220,
          }}
        >
          <IconButton
            aria-label={`Decrease ${ariaLabel}`}
            size="small"
            onClick={() => adjust(-step)}
            disabled={decreaseDisabled}
            sx={{
              border: '1px solid',
              borderColor: decreaseDisabled ? 'divider' : 'primary.main',
              borderRadius: 1.5,
              width: 36,
              height: 36,
              backgroundColor: decreaseDisabled ? 'transparent' : 'primary.main',
              color: decreaseDisabled ? 'text.disabled' : 'common.white',
              transition: 'background-color 0.2s ease',
            }}
          >
            <Remove sx={{ fontSize: 18 }} />
          </IconButton>
          <TextField
            value={qty}
            type="number"
            size="small"
            disabled={disabled}
            onChange={(event) => handleInputChange(event.target.value)}
            onKeyDown={onKeyDown}
            onFocus={handleFocus}
            onBlur={handleBlur}
            inputProps={{
              min,
              max,
              style: { textAlign: 'center' as const },
            }}
            sx={{ flexGrow: 1, minWidth: 0 }}
          />
          <IconButton
            aria-label={`Increase ${ariaLabel}`}
            size="small"
            onClick={() => adjust(step)}
            disabled={increaseDisabled}
            sx={{
              border: '1px solid',
              borderColor: increaseDisabled ? 'divider' : 'primary.main',
              borderRadius: 1.5,
              width: 36,
              height: 36,
              backgroundColor: increaseDisabled ? 'transparent' : 'primary.main',
              color: increaseDisabled ? 'text.disabled' : 'common.white',
              transition: 'background-color 0.2s ease',
            }}
          >
            <Add sx={{ fontSize: 18 }} />
          </IconButton>
        </Box>
      </Stack>
    );
  };
  const selectedDateString = selectedDate.format(COUNTER_DATE_FORMAT);
  const stepIndex = useMemo(
    () => STEP_CONFIGS.findIndex((step) => step.key === activeRegistryStep),
    [activeRegistryStep],
  );
  const activeStepConfig = STEP_CONFIGS[stepIndex] ?? STEP_CONFIGS[0];

  const handleProceedToPlatforms = useCallback(async () => {
    if (catalog.loading || registry.loading || ensuringCounter) {
      return;
    }

    const managerId = selectedManagerId ?? session.loggedUserId;
    if (!managerId) {
      setCounterListError('Select a manager before continuing.');
      return;
    }

    setCounterListError(null);

    if (registry.counter) {
      const setupOk = await ensureSetupPersisted();
      if (!setupOk) {
        return;
      }

      await updateCounterStatusSafe('platforms');
      setActiveRegistryStep('platforms');
      return;
    }

    const formatted = selectedDate.format(COUNTER_DATE_FORMAT);

    try {
      setEnsuringCounter(true);
      const payload = await dispatch(
        ensureCounterForDate({
          date: formatted,
          userId: managerId,
          productId: currentProductId ?? undefined,
        }),
      ).unwrap();

      const ensuredCounterId = payload.counter.id;
      const ensuredProductId = payload.counter.productId ?? null;
      const ensuredStaffIds = normalizeIdList(payload.staff.map((member) => member.userId));

      const requestKey = `${formatted}|${(pendingProductId ?? ensuredProductId ?? null) ?? 'null'}`;
      fetchCounterRequestRef.current = requestKey;

      if (pendingProductId != null) {
        if (pendingProductId !== ensuredProductId) {
          await dispatch(updateCounterProduct({ counterId: ensuredCounterId, productId: pendingProductId })).unwrap();
        }
        setPendingProductId(null);
      }

      if (pendingStaffDirty && pendingStaffIds.length > 0) {
        await dispatch(updateCounterStaff({ counterId: ensuredCounterId, userIds: pendingStaffIds })).unwrap();
        lastPersistedStaffIdsRef.current = normalizeIdList(pendingStaffIds);
      } else {
        lastPersistedStaffIdsRef.current = ensuredStaffIds;
      }

      if (!pendingStaffDirty) {
        setPendingStaffIds(ensuredStaffIds);
        lastPersistedStaffIdsRef.current = ensuredStaffIds;
      }
      setPendingStaffDirty(false);

      if (payload.counter.status !== 'final') {
        await dispatch(updateCounterStatus({ counterId: ensuredCounterId, status: 'platforms' })).unwrap();
      }

      setActiveRegistryStep('platforms');
    } catch (_error) {
      fetchCounterRequestRef.current = null;
    } finally {
      setEnsuringCounter(false);
    }
  }, [
    catalog.loading,
    registry.loading,
    ensuringCounter,
    selectedManagerId,
    session.loggedUserId,
    registry.counter,
    selectedDate,
    dispatch,
    currentProductId,
    ensureSetupPersisted,
    pendingProductId,
    pendingStaffDirty,
    pendingStaffIds,
    updateCounterStatusSafe,
  ]);

  const handleProceedToReservations = useCallback(async () => {
    const saved = await flushMetrics();
    if (!saved) {
      return;
    }
    await updateCounterStatusSafe('reservations');
    setActiveRegistryStep('reservations');
  }, [flushMetrics, updateCounterStatusSafe]);
  const handleProceedToSummary = useCallback(async () => {
    const saved = await flushMetrics();
    if (!saved) {
      return;
    }
    await updateCounterStatusSafe('final');
    setActiveRegistryStep('summary');
  }, [flushMetrics, updateCounterStatusSafe]);
  const handleReturnToSetup = useCallback(async () => {
    const saved = await flushMetrics();
    if (!saved) {
      return;
    }
    await updateCounterStatusSafe('draft');
    setActiveRegistryStep('details');
  }, [flushMetrics, updateCounterStatusSafe]);
  const handleReturnToPlatforms = useCallback(async () => {
    const saved = await flushMetrics();
    if (!saved) {
      return;
    }
    setActiveRegistryStep('platforms');
  }, [flushMetrics, setActiveRegistryStep]);

  const hasCounter = Boolean(registry.counter);
  const isLoading =
    registry.loading ||
    catalog.loading ||
    ensuringCounter ||
    (activeRegistryStep !== 'details' && !hasCounter);

  const handleStepSelect = useCallback(
    (nextStep: RegistryStep) => {
      if (nextStep === activeRegistryStep) {
        return;
      }
      if (nextStep !== 'details' && !hasCounter) {
        return;
      }

      void (async () => {
        if (nextStep !== 'details') {
          const setupOk = await ensureSetupPersisted();
          if (!setupOk) {
            return;
          }
        }

        if (nextStep === 'reservations') {
          await handleProceedToReservations();
          return;
        }

        if (nextStep === 'summary') {
          await handleProceedToSummary();
          return;
        }

        setActiveRegistryStep(nextStep);
      })();
    },
    [
      activeRegistryStep,
      ensureSetupPersisted,
      handleProceedToReservations,
      handleProceedToSummary,
      hasCounter,
    ],
  );

  const staffOptions = useMemo(() => {
    const map = new Map<number, StaffOption>();
    catalog.staff.forEach((staff) => map.set(staff.id, staff));
    registry.counter?.staff.forEach((member) => {
      if (!map.has(member.userId)) {
        const { firstName, lastName } = extractNameParts(member.name);
        map.set(member.userId, {
          id: member.userId,
          firstName,
          lastName,
          fullName: member.name,
          userTypeSlug: member.userTypeSlug,
          userTypeName: member.userTypeName,
        });
      }
    });
    return Array.from(map.values());
  }, [catalog.staff, registry.counter]);
  const managerValue: StaffOption | null = useMemo(
    () => managerOptions.find((option) => option.id === selectedManagerId) ?? null,
    [managerOptions, selectedManagerId],
  );
  const effectiveStaffIds = pendingStaffIds;

  const productOptions = useMemo(() => {
    const map = new Map<number, CatalogProduct>();
    catalog.products
      .filter((product) => product.status !== false)
      .forEach((product) => map.set(product.id, product));

    const counterProduct = registry.counter?.counter.product;
    if (counterProduct && !map.has(counterProduct.id)) {
      map.set(counterProduct.id, {
        id: counterProduct.id,
        name: counterProduct.name,
        status: true,
        productTypeId: 0,
        price: 0,
        allowedAddOns: [],
      });
    }

    return Array.from(map.values()).sort((a, b) =>
      (a.name ?? '').localeCompare(b.name ?? '', undefined, { sensitivity: 'base' }),
    );
  }, [catalog.products, registry.counter]);

  const defaultProductId = useMemo(() => {
    if (productOptions.length === 0) {
      return null;
    }
    const normalizedDefault =
      productOptions.find((product) => product.name?.toLowerCase() === DEFAULT_PRODUCT_NAME.toLowerCase()) ??
      productOptions[0] ??
      null;
    return normalizedDefault ? normalizedDefault.id : null;
  }, [productOptions]);

  useEffect(() => {
    if (!registry.counter && pendingProductId === null && defaultProductId != null) {
      setPendingProductId(defaultProductId);
    }
  }, [registry.counter, pendingProductId, defaultProductId]);

  useEffect(() => {
    if (!counterId || counterProductId) {
      return;
    }
    if (productOptions.length === 0) {
      return;
    }
    const defaultProduct =
      productOptions.find((product) => product.name?.toLowerCase() === DEFAULT_PRODUCT_NAME.toLowerCase()) ??
      productOptions[0] ??
      null;
    if (!defaultProduct) {
      return;
    }
    dispatch(updateCounterProduct({ counterId, productId: defaultProduct.id }));
  }, [counterId, counterProductId, dispatch, productOptions]);

  const productValue = useMemo(
    () => productOptions.find((product) => product.id === currentProductId) ?? null,
    [currentProductId, productOptions],
  );
  const afterCutoffWarnings = useMemo(() => {
    const warnings = new Set<number>();
    const channelsById = new Map<number, ChannelConfig>();
    registry.channels.forEach((channel) => {
      channelsById.set(channel.id, channel);
    });
    Object.values(metricsMap).forEach((metric) => {
      if (
        metric.kind !== 'people' ||
        metric.tallyType !== 'booked' ||
        metric.period !== 'after_cutoff' ||
        metric.qty <= 0
      ) {
        return;
      }
      const channel = channelsById.get(metric.channelId);
      if (!channel) {
        return;
      }
      const normalizedName = channel.name.toLowerCase();
      if (!AFTER_CUTOFF_ALLOWED.has(normalizedName)) {
        warnings.add(metric.channelId);
      }
    });
    return warnings;
  }, [metricsMap, registry.channels]);
  const renderChannelCard = (
    channel: ChannelConfig,
    bucket: BucketDescriptor,
    addons: AddonConfig[],
  ) => {
    const peopleMetric = getMetric(channel.id, bucket.tallyType, bucket.period, 'people', null);
    const attendedPeople = getMetric(channel.id, 'attended', null, 'people', null)?.qty ?? 0;
    const disableInputs = registry.savingMetrics || confirmingMetrics;
    const warningActive = bucket.period === 'after_cutoff' && afterCutoffWarnings.has(channel.id);
    const normalizedChannelName = channel.name?.toLowerCase() ?? '';
    const isWalkInChannel = normalizedChannelName === WALK_IN_CHANNEL_SLUG;
    const isWalkInAfterCutoff = isWalkInChannel && bucket.period === 'after_cutoff';
    const isWalkInAttended = isWalkInChannel && bucket.tallyType === 'attended' && bucket.period === null;
    const walkInDiscountSelection = walkInDiscountsByChannel[channel.id] ?? [];
    const walkInTicketState =
      walkInTicketDataByChannel[channel.id] ?? ({ ticketOrder: [], tickets: {} } as WalkInChannelTicketState);
    const walkInCashValue = walkInCashByChannel[channel.id] ?? '';
    const isCashChannel = isCashPaymentChannel(channel);
    const cashDetails = cashDetailsByChannel.get(channel.id);
    const hasCashOverride = cashDetails?.hasManualOverride ?? false;
    const cashDisplayText = cashDetails?.formattedDisplay ?? null;
    const showCashSummary =
      isCashChannel && !isWalkInChannel && bucket.tallyType === 'attended' && bucket.period === null;
    const defaultCashText =
      cashDetails?.defaultAmount != null && Number.isFinite(cashDetails.defaultAmount)
        ? formatCashAmount(cashDetails.defaultAmount)
        : null;
    const defaultCashPriceText =
      cashDetails?.price != null && Number.isFinite(cashDetails.price)
        ? formatCashAmount(cashDetails.price)
        : null;
    const cashCurrency = (cashCurrencyByChannel[channel.id] ?? 'PLN') as CashCurrency;
    const showCurrencyToggle =
      isCashChannel && bucket.tallyType === 'attended' && bucket.period === null;
    const handleCurrencySelect = (_event: MouseEvent<HTMLElement>, value: CashCurrency | null) => {
      if (!value) {
        return;
      }
      handleCashCurrencyChange(channel.id, value);
    };
    const availableCurrencies: CashCurrency[] = ['PLN', 'EUR'];

    const renderTicketChips = (extra?: JSX.Element | JSX.Element[]) => (
      <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
        {WALK_IN_DISCOUNT_OPTIONS.map((option) => {
          const selected = walkInDiscountSelection.includes(option);
          return (
            <Chip
              key={option}
              label={option}
              size="small"
              variant={selected ? 'filled' : 'outlined'}
              color={selected ? 'primary' : 'default'}
              onClick={() => handleWalkInDiscountToggle(channel.id, option)}
              disabled={disableInputs}
            />
          );
        })}
        {extra}
      </Stack>
    );

    const renderLocalStepper = (
      key: string,
      label: string,
      value: number,
      onChange: (nextValue: number) => void,
      disabled: boolean,
      min = 0,
      max?: number,
    ) => {
      const step = 1;
      const decreaseDisabled = disabled || value <= min;
      const increaseDisabled = disabled || (typeof max === 'number' && value >= max);

      const adjust = (delta: number) => {
        const next = Math.max(min, value + delta);
        const finalValue = typeof max === 'number' ? Math.min(next, max) : next;
        if (finalValue === value) {
          return;
        }
        onChange(finalValue);
      };

      const handleInputChange = (raw: string) => {
        const parsed = Number(raw);
        if (Number.isNaN(parsed)) {
          return;
        }
        const clamped = Math.max(min, typeof max === 'number' ? Math.min(parsed, max) : parsed);
        if (clamped === value) {
          return;
        }
        onChange(clamped);
      };

      return (
        <Stack key={key} direction="row" spacing={1} alignItems="center" sx={{ width: '100%' }}>
          <Typography sx={{ flexGrow: 1 }}>{label}</Typography>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              width: '100%',
              maxWidth: 200,
            }}
          >
            <IconButton
              aria-label={`Decrease ${label}`}
              size="small"
              onClick={() => adjust(-step)}
              disabled={decreaseDisabled}
              sx={{
                border: '1px solid',
                borderColor: decreaseDisabled ? 'divider' : 'primary.main',
                borderRadius: 1.5,
                width: 36,
                height: 36,
                backgroundColor: decreaseDisabled ? 'transparent' : 'primary.main',
                color: decreaseDisabled ? 'text.disabled' : 'common.white',
                transition: 'background-color 0.2s ease',
              }}
            >
              <Remove sx={{ fontSize: 18 }} />
            </IconButton>
            <TextField
              value={value}
              type="number"
              size="small"
              disabled={disabled}
              onChange={(event) => handleInputChange(event.target.value)}
              inputProps={{
                min,
                max,
                style: { textAlign: 'center' as const },
              }}
              sx={{ flexGrow: 1, minWidth: 0 }}
            />
            <IconButton
              aria-label={`Increase ${label}`}
              size="small"
              onClick={() => adjust(step)}
              disabled={increaseDisabled}
              sx={{
                border: '1px solid',
                borderColor: increaseDisabled ? 'divider' : 'primary.main',
                borderRadius: 1.5,
                width: 36,
                height: 36,
                backgroundColor: increaseDisabled ? 'transparent' : 'primary.main',
                color: increaseDisabled ? 'text.disabled' : 'common.white',
                transition: 'background-color 0.2s ease',
              }}
            >
              <Add sx={{ fontSize: 18 }} />
            </IconButton>
          </Box>
        </Stack>
      );
    };

    const freePeopleEntry = freePeopleByChannel[channel.id];
    const freePeopleActive = freePeopleEntry != null;
    const freePeopleQty = Math.max(0, Math.round(freePeopleEntry?.qty ?? 0));
    const freePeopleNote = freePeopleEntry?.note ?? '';
    const freePeopleNoteError =
      freePeopleActive && freePeopleQty > 0 && freePeopleNote.trim().length === 0;
    const freeAddonEntries = freeAddonsByChannel[channel.id] ?? {};

    const handleFreePeopleToggle = () => {
      if (disableInputs) {
        return;
      }
    if (freePeopleActive) {
      setFreePeopleQty(channel.id, 0);
      setFreePeopleNote(channel.id, '');
    } else {
      ensureFreePeopleEntry(channel.id);
    }
  };

  const freePeopleChip = (
    <Chip
      key="free-walk-in"
      label="Free"
      size="small"
      variant={freePeopleActive ? 'filled' : 'outlined'}
      color={freePeopleActive ? 'info' : 'default'}
      onClick={handleFreePeopleToggle}
      disabled={disableInputs}
      />
    );

    return (
      <Card
        variant="outlined"
        sx={{
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Stack spacing={1.5}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" rowGap={1}>
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" rowGap={1}>
                <Typography variant="subtitle1" fontWeight={600}>
                  {channel.name}
                </Typography>
                {showCurrencyToggle && (
                  <ToggleButtonGroup
                    size="small"
                    exclusive
                    value={cashCurrency}
                    onChange={handleCurrencySelect}
                    aria-label={`${channel.name} cash currency`}
                    disabled={disableInputs}
                  >
                    <ToggleButton value="PLN">PLN</ToggleButton>
                    <ToggleButton value="EUR">EUR</ToggleButton>
                  </ToggleButtonGroup>
                )}
              </Stack>
              {warningActive && <Chip label="After cut-off" color="warning" size="small" />}
            </Stack>
            {isWalkInAfterCutoff ? (
              <Stack spacing={1.5}>
                <Stack spacing={0.75}>
                  <Typography variant="subtitle2">Tickets Type</Typography>
                  {renderTicketChips(freePeopleChip)}
                  {walkInDiscountSelection.length === 0 && (
                    <Typography variant="caption" color="text.secondary">
                      Select a ticket type to start recording.
                    </Typography>
                  )}
                </Stack>
                {walkInDiscountSelection.length > 0 && (
                  <Box
                    sx={{
                      display: 'grid',
                      gap: 1.5,
                      gridTemplateColumns: {
                        xs: '1fr',
                        sm: 'repeat(auto-fit, minmax(240px, 1fr))',
                        lg: 'repeat(auto-fit, minmax(280px, 1fr))',
                      },
                      alignItems: 'stretch',
                      justifyItems: 'stretch',
                    }}
                  >
                    {walkInDiscountSelection.map((ticketLabel) => {
                      const ticketEntry =
                        walkInTicketState.tickets[ticketLabel] ?? {
                          name: ticketLabel,
                          currencyOrder: [],
                          currencies: {},
                        };
                      const isCustomTicket = ticketLabel === CUSTOM_TICKET_LABEL;
                      const displayName =
                        ticketEntry.name && ticketEntry.name.trim().length > 0 ? ticketEntry.name : ticketLabel;
                      const isEditingThisCustom =
                        editingCustomTicket?.channelId === channel.id &&
                        editingCustomTicket.ticketLabel === ticketLabel;
                      return (
                        <Box
                          key={`${channel.id}-${ticketLabel}`}
                          sx={{
                            border: '1px solid',
                            borderColor: 'divider',
                            borderRadius: 1,
                            p: 1.25,
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 1,
                            minWidth: 0,
                          }}
                        >
                          <Stack spacing={1}>
                            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ flexWrap: 'wrap', rowGap: 0.75 }}>
                              {isEditingThisCustom ? (
                                <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
                                  <TextField
                                    size="small"
                                    value={editingCustomTicket?.value ?? ''}
                                    onChange={handleCustomTicketEditChange}
                                    autoFocus
                                    placeholder="Custom ticket name"
                                    onKeyDown={(event) => {
                                      if (event.key === 'Enter') {
                                        event.preventDefault();
                                        handleCustomTicketEditSave();
                                      }
                                      if (event.key === 'Escape') {
                                        event.preventDefault();
                                        handleCustomTicketEditCancel();
                                      }
                                    }}
                                  />
                                  <IconButton
                                    size="small"
                                    color="success"
                                    aria-label="Save ticket name"
                                    onClick={handleCustomTicketEditSave}
                                  >
                                    <Check fontSize="small" />
                                  </IconButton>
                                  <IconButton
                                    size="small"
                                    aria-label="Cancel ticket name edit"
                                    onClick={handleCustomTicketEditCancel}
                                  >
                                    <Close fontSize="small" />
                                  </IconButton>
                                </Stack>
                              ) : (
                                <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
                                  <Typography variant="subtitle2" fontWeight={600}>
                                    {displayName}
                                  </Typography>
                                  {isCustomTicket && (
                                    <Tooltip title="Rename ticket type">
                                      <span>
                                        <IconButton
                                          size="small"
                                          aria-label="Rename ticket type"
                                          onClick={() => handleCustomTicketEditStart(channel.id, ticketLabel, displayName)}
                                          disabled={disableInputs}
                                        >
                                          <Edit fontSize="small" />
                                        </IconButton>
                                      </span>
                                    </Tooltip>
                                  )}
                                </Stack>
                              )}
                            </Stack>
                            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
                              {availableCurrencies.map((currencyOption) => {
                                const selected = ticketEntry.currencyOrder.includes(currencyOption);
                                const buttonLabel = currencyOption === 'PLN' ? 'Add PLN' : 'Add EUR';
                                return (
                                  <Button
                                    key={`${ticketLabel}-${currencyOption}`}
                                    type="button"
                                    variant={selected ? 'contained' : 'outlined'}
                                    color="primary"
                                    size="small"
                                    onClick={() =>
                                      handleWalkInTicketCurrencyToggle(channel.id, ticketLabel, currencyOption)
                                    }
                                    disabled={disableInputs}
                                  >
                                    {buttonLabel}
                                  </Button>
                                );
                              })}
                            </Stack>
                            {ticketEntry.currencyOrder.length === 0 ? (
                              <Typography variant="caption" color="text.secondary">
                                Select a currency to enable counters.
                              </Typography>
                            ) : (
                              <Box
                                sx={{
                                  display: 'grid',
                                  gap: 1.25,
                                  gridTemplateColumns: {
                                    xs: '1fr',
                                    sm: 'repeat(auto-fit, minmax(180px, 1fr))',
                                    md: 'repeat(auto-fit, minmax(200px, 1fr))',
                                  },
                                  alignItems: 'stretch',
                                  justifyItems: 'stretch',
                                }}
                              >
                                {ticketEntry.currencyOrder.map((currencyOption) => {
                                  const currencyEntry =
                                    ticketEntry.currencies[currencyOption] ?? {
                                      people: 0,
                                      cash: '',
                                      addons: {},
                                    };
                                  const currencyKey = `${channel.id}-${ticketLabel}-${currencyOption}`;
                                  return (
                                    <Box
                                      key={currencyKey}
                                      sx={{
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: 1,
                                        border: '1px solid',
                                        borderColor: 'divider',
                                        borderRadius: 1,
                                        p: 1.25,
                                        minWidth: 0,
                                      }}
                                    >
                                      <Typography variant="subtitle2" fontWeight={500}>
                                        {currencyOption}
                                      </Typography>
                                      {renderLocalStepper(
                                        `${currencyKey}-people`,
                                        'People',
                                        currencyEntry.people,
                                        (next) =>
                                          handleWalkInTicketPeopleChange(
                                            channel.id,
                                            ticketLabel,
                                            currencyOption,
                                            next,
                                          ),
                                        disableInputs,
                                      )}
                                      {addons.map((addon) => {
                                        const numericAddonId =
                                          typeof addon.addonId === 'number'
                                            ? addon.addonId
                                            : Number(addon.addonId);
                                        if (!Number.isFinite(numericAddonId)) {
                                          return null;
                                        }
                                        const normalizedAddonId = numericAddonId;
                                        const isCocktail =
                                          addon.key?.toLowerCase() === 'cocktails' ||
                                          addon.name?.toLowerCase() === 'cocktails';
                                        const availableForAddons = currencyEntry.people;
                                        const calculatedMax =
                                          addon.maxPerAttendee != null && availableForAddons > 0
                                            ? addon.maxPerAttendee * availableForAddons
                                            : undefined;
                                        const stepperMax = isCocktail ? undefined : calculatedMax;
                                        return (
                                          <Stack
                                            key={`${currencyKey}-addon-${normalizedAddonId}`}
                                            spacing={0.5}
                                          >
                                            {renderLocalStepper(
                                              `${currencyKey}-addon-${normalizedAddonId}`,
                                              addon.name,
                                              currencyEntry.addons[normalizedAddonId] ?? 0,
                                              (next) =>
                                                handleWalkInTicketAddonChange(
                                                  channel.id,
                                                  ticketLabel,
                                                  currencyOption,
                                                  normalizedAddonId,
                                                  next,
                                                ),
                                              disableInputs,
                                              0,
                                              stepperMax,
                                            )}
                                            {addon.maxPerAttendee != null && !isCocktail && (
                                              <Typography variant="caption" color="text.secondary">
                                                Max {addon.maxPerAttendee} per attendee (cap {calculatedMax ?? 0})
                                              </Typography>
                                            )}
                                          </Stack>
                                        );
                                      })}
                                      <Stack spacing={0.5}>
                                        <Typography variant="subtitle2">Total Collected</Typography>
                                        <TextField
                                          value={currencyEntry.cash}
                                          onChange={
                                            isCustomTicket
                                              ? (event) =>
                                                  handleWalkInTicketCashChange(
                                                    channel.id,
                                                    ticketLabel,
                                                    currencyOption,
                                                    event.target.value,
                                                  )
                                              : undefined
                                          }
                                          size="small"
                                          disabled={disableInputs}
                                          type="number"
                                          placeholder="0"
                                          InputProps={{
                                            readOnly: !isCustomTicket,
                                            startAdornment: (
                                              <InputAdornment position="start">
                                                {currencyOption}
                                              </InputAdornment>
                                            ),
                                          }}
                                          inputProps={{ inputMode: 'decimal', min: 0 }}
                                        />
                                      </Stack>
                                    </Box>
                                  );
                                })}
                              </Box>
                            )}
                          </Stack>
                        </Box>
                      );
                    })}
                  </Box>
                )}
                {freePeopleActive && (
                  <Stack spacing={0.75}>
                    <Typography variant="subtitle2">Free Guests</Typography>
                    {renderLocalStepper(
                      `${channel.id}-after-cutoff-free`,
                      'Free guests',
                      freePeopleQty,
                      (nextValue) => setFreePeopleQty(channel.id, nextValue),
                      disableInputs,
                      0,
                    )}
                    <TextField
                      value={freePeopleNote}
                      onChange={(event) => setFreePeopleNote(channel.id, event.target.value)}
                      size="small"
                      disabled={disableInputs}
                      required={freePeopleQty > 0}
                      error={freePeopleNoteError}
                      helperText={freePeopleNoteError ? 'Add a short reason for the free entry' : ' '}
                      label="Free guest reason"
                      placeholder="e.g., Birthday guest"
                      multiline
                      minRows={1}
                    />
                  </Stack>
                )}
                {freePeopleActive && addons.length > 0 && (
                  <Stack spacing={0.75}>
                    <Typography variant="subtitle2">Free Add-ons</Typography>
                    {addons.map((addon) => {
                      const numericAddonId =
                        typeof addon.addonId === 'number' ? addon.addonId : Number(addon.addonId);
                      if (!Number.isFinite(numericAddonId)) {
                        return null;
                      }
                      const normalizedAddonId = numericAddonId;
                      const freeAddonEntry = freeAddonEntries[normalizedAddonId] ?? { qty: 0, note: '' };
                      const freeAddonQty = Math.max(0, Math.round(freeAddonEntry.qty ?? 0));
                      const freeAddonNote = freeAddonEntry.note ?? '';
                      const freeAddonNoteError = freeAddonQty > 0 && freeAddonNote.trim().length === 0;
                      return (
                        <Stack key={`${channel.id}-after-free-addon-${normalizedAddonId}`} spacing={0.5}>
                          {renderLocalStepper(
                            `${channel.id}-after-free-addon-${normalizedAddonId}`,
                            `Free ${addon.name}`,
                            freeAddonQty,
                            (nextValue) => setFreeAddonQty(channel.id, normalizedAddonId, nextValue),
                            disableInputs,
                            0,
                          )}
                          <TextField
                            value={freeAddonNote}
                            onChange={(event) =>
                              setFreeAddonNote(channel.id, normalizedAddonId, event.target.value)
                            }
                            size="small"
                            disabled={disableInputs}
                            required={freeAddonQty > 0}
                            error={freeAddonNoteError}
                            helperText={
                              freeAddonNoteError ? `Add a reason for the free ${addon.name.toLowerCase()}` : ' '
                            }
                            label={`Free ${addon.name} reason`}
                            placeholder="e.g., Staff friend"
                            multiline
                            minRows={1}
                          />
                        </Stack>
                      );
                    })}
                  </Stack>
                )}
              </Stack>
            ) : (
              <>
                {isWalkInAttended && (
                  <Stack spacing={0.75}>
                    <Typography variant="subtitle2">Tickets Type</Typography>
                    {renderTicketChips(freePeopleChip)}
                  </Stack>
                )}
                {renderStepper('People', peopleMetric, disableInputs)}
                {isWalkInAttended && freePeopleActive && (
                  <Stack spacing={0.75}>
                    <Typography variant="subtitle2">Free Guests</Typography>
                    {renderLocalStepper(
                      `${channel.id}-free-people`,
                      'Free guests',
                      freePeopleQty,
                      (nextValue) => setFreePeopleQty(channel.id, nextValue),
                      disableInputs,
                      0,
                    )}
                    <TextField
                      value={freePeopleNote}
                      onChange={(event) => setFreePeopleNote(channel.id, event.target.value)}
                      size="small"
                      disabled={disableInputs}
                      required={freePeopleQty > 0}
                      error={freePeopleNoteError}
                      helperText={freePeopleNoteError ? 'Add a short reason for the free entry' : ' '}
                      label="Free guest reason"
                      placeholder="e.g., Birthday guest"
                      multiline
                      minRows={1}
                    />
                  </Stack>
                )}
                {isWalkInAttended && (
                  <Stack spacing={0.5}>
                    <Typography variant="subtitle2">Total Collected</Typography>
                    <TextField
                      value={walkInCashValue}
                      onChange={(event) => handleWalkInCashChange(channel.id, event.target.value)}
                      size="small"
                      disabled={disableInputs}
                      type="number"
                      placeholder="0"
                      InputProps={{
                        startAdornment: <InputAdornment position="start">PLN</InputAdornment>,
                      }}
                      inputProps={{ inputMode: 'numeric', min: 0 }}
                    />
                  </Stack>
                )}
                {showCashSummary && (
                  <Stack spacing={0.75}>
                    <Typography variant="subtitle2">Cash To Be Collected</Typography>
                    {cashEditingChannelId === channel.id ? (
                      <Stack direction="row" spacing={1} alignItems="center">
                        <TextField
                          value={cashEditingValue}
                          onChange={(event) => handleCashOverrideChange(event.target.value)}
                          size="small"
                          disabled={disableInputs}
                          placeholder={defaultCashText ?? '0.00'}
                          InputProps={{
                            startAdornment: <InputAdornment position="start">{cashCurrency}</InputAdornment>,
                            inputMode: 'decimal',
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault();
                              if (!disableInputs) {
                                handleCashOverrideSave();
                              }
                            }
                            if (event.key === 'Escape') {
                              event.preventDefault();
                              handleCashOverrideCancel();
                            }
                          }}
                        />
                        <IconButton
                          size="small"
                          color="success"
                          aria-label="Save cash override"
                          onClick={handleCashOverrideSave}
                          disabled={disableInputs}
                        >
                          <Check fontSize="small" />
                        </IconButton>
                        <IconButton
                          size="small"
                          aria-label="Cancel cash override"
                          onClick={handleCashOverrideCancel}
                          disabled={disableInputs}
                        >
                          <Close fontSize="small" />
                        </IconButton>
                      </Stack>
                    ) : (
                      <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap">
                        <Typography variant="body2" sx={{ fontWeight: 500 }}>
                          {cashDisplayText ? `${cashCurrency} ${cashDisplayText}` : 'No price configured'}
                        </Typography>
                        <IconButton
                          size="small"
                          aria-label="Adjust cash collected"
                          onClick={() => handleCashOverrideEdit(channel.id)}
                          disabled={disableInputs}
                        >
                          <Edit fontSize="small" />
                        </IconButton>
                        {hasCashOverride && <Chip label="Override" size="small" color="info" variant="outlined" />}
                        {!hasCashOverride && defaultCashPriceText && (
                          <Typography variant="caption" color="text.secondary">{`Default: ${cashCurrency} ${defaultCashPriceText}`}</Typography>
                        )}
                      </Stack>
                    )}
                  </Stack>
                )}
                <Divider flexItem sx={{ mt: 1 }} />
                <Stack spacing={1}>
                  {addons.map((addon) => {
                    const numericAddonId =
                      typeof addon.addonId === 'number' ? addon.addonId : Number(addon.addonId);
                    if (!Number.isFinite(numericAddonId)) {
                      return null;
                    }
                    const normalizedAddonId = numericAddonId;
                    const metric = getMetric(channel.id, bucket.tallyType, bucket.period, 'addon', normalizedAddonId);
                    const isCocktail =
                      addon.key?.toLowerCase() === 'cocktails' || addon.name?.toLowerCase() === 'cocktails';
                    const availableForAddons =
                      bucket.tallyType === 'booked' ? (peopleMetric?.qty ?? attendedPeople) : attendedPeople;
                    const calculatedMax =
                      addon.maxPerAttendee != null && availableForAddons > 0
                        ? addon.maxPerAttendee * availableForAddons
                        : undefined;
                    const stepperMax = isCocktail ? undefined : calculatedMax;
                    const addonKey = `${channel.id}-${bucket.label}-addon-${normalizedAddonId}`;
                    const freeAddonEntry = freeAddonEntries[normalizedAddonId] ?? { qty: 0, note: '' };
                    const freeAddonQty = Math.max(0, Math.round(freeAddonEntry.qty ?? 0));
                    const freeAddonNote = freeAddonEntry.note ?? '';
                    const freeAddonActive = freeAddonQty > 0 || freeAddonNote.length > 0;
                    const freeAddonNoteError = freeAddonQty > 0 && freeAddonNote.trim().length === 0;
                    const handleFreeAddonToggle = () => {
                      if (disableInputs) {
                        return;
                      }
                      if (freeAddonActive) {
                        setFreeAddonQty(channel.id, normalizedAddonId, 0);
                        setFreeAddonNote(channel.id, normalizedAddonId, '');
                      } else {
                        ensureFreeAddonEntry(channel.id, normalizedAddonId);
                      }
                    };
                    return (
                      <Stack key={addonKey} spacing={0.75}>
                        <Stack direction="row" spacing={0.75} alignItems="flex-start">
                          <Box sx={{ flexGrow: 1 }}>
                            {renderStepper(addon.name, metric, disableInputs, 0, stepperMax, 1)}
                          </Box>
                          {isWalkInAttended && (
                            <Chip
                              label="Free"
                              size="small"
                              color={freeAddonActive ? 'info' : 'default'}
                              variant={freeAddonActive ? 'filled' : 'outlined'}
                              onClick={handleFreeAddonToggle}
                              disabled={disableInputs}
                            />
                          )}
                        </Stack>
                        {addon.maxPerAttendee != null && !isCocktail && (
                          <Typography variant="caption" color="text.secondary">
                            Max {addon.maxPerAttendee} per attendee (cap {calculatedMax ?? 0})
                          </Typography>
                        )}
                        {isWalkInAttended && freeAddonActive && (
                          <Stack spacing={0.5}>
                            {renderLocalStepper(
                              `${channel.id}-${normalizedAddonId}-free`,
                              `Free ${addon.name}`,
                              freeAddonQty,
                              (nextValue) => setFreeAddonQty(channel.id, normalizedAddonId, nextValue),
                              disableInputs,
                              0,
                            )}
                            <TextField
                              value={freeAddonNote}
                              onChange={(event) =>
                                setFreeAddonNote(channel.id, normalizedAddonId, event.target.value)
                              }
                              size="small"
                              disabled={disableInputs}
                              required={freeAddonQty > 0}
                              error={freeAddonNoteError}
                              helperText={
                                freeAddonNoteError ? `Add a reason for the free ${addon.name.toLowerCase()}` : ' '
                              }
                              label={`Free ${addon.name} reason`}
                              placeholder="e.g., Staff friend"
                              multiline
                              minRows={1}
                            />
                          </Stack>
                        )}
                      </Stack>
                    );
                  })}
                </Stack>
              </>
            )}
          </Stack>
        </CardContent>
      </Card>
    );
  };
  const renderDetailsStep = () => (
    <Stack spacing={3}>
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 4 }}>
          <DatePicker
            label="Counter Date"
            value={selectedDate}
            onChange={handleDateChange}
            format="dddd, MMM D, YYYY"
            slotProps={{ textField: { fullWidth: true } }}
          />
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          <Autocomplete
            options={managerOptions}
            value={managerValue}
            onChange={handleManagerSelection}
            getOptionLabel={buildDisplayName}
            loading={catalog.loading}
            renderInput={(params) => (
              <TextField {...params} label="Manager" placeholder="Select manager" />
            )}
            isOptionEqualToValue={(option, val) => option.id === val.id}
          />
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          <Autocomplete
            options={productOptions}
            value={productValue}
            onChange={handleProductSelection}
            getOptionLabel={(option) => option.name}
            loading={catalog.loading}
            disabled={(!counterId && modalMode !== 'create') || registry.savingProduct || isFinal}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Product"
                placeholder={productOptions.length === 0 ? 'No products available' : 'Select product'}
              />
            )}
            isOptionEqualToValue={(option, val) => option.id === val.id}
          />
        </Grid>
        <Grid size={{ xs: 12 }}>
          <Autocomplete
            multiple
            options={staffOptions}
            disabled={registry.savingStaff || ensuringCounter}
            value={staffOptions.filter((option) => effectiveStaffIds.includes(option.id))}
            getOptionLabel={buildDisplayName}
            onChange={handleStaffSelection}
            renderInput={(params) => <TextField {...params} label="Staff" placeholder="Add staff" />}
            isOptionEqualToValue={(option, val) => option.id === val.id}
          />
        </Grid>
      </Grid>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1.5}
        justifyContent={{ xs: 'flex-start', sm: 'flex-end' }}
      >
        <Button
          variant="contained"
          onClick={handleProceedToPlatforms}
          disabled={
            catalog.loading ||
            registry.loading ||
            ensuringCounter ||
            managerValue == null ||
            productValue == null ||
            effectiveStaffIds.length === 0
          }
        >
          Proceed with Platform Check
        </Button>
      </Stack>
    </Stack>
  );

  const renderPlatformStep = () => {
    const platformBucket = PLATFORM_BUCKETS[0];
    if (!platformBucket) {
      return <Alert severity="info">No platform buckets are configured.</Alert>;
    }
    return (
      <Stack spacing={3}>
        <Stack spacing={2}>
          <Typography variant="subtitle1">Select the platforms to include in this counter.</Typography>
          <ToggleButtonGroup
            value={effectiveSelectedChannelIds}
            onChange={handleChannelSelection}
            aria-label="Selected channels"
            size="small"
            sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 1, rowGap: 1 }}
          >
            {registry.channels
              .filter((channel) => (channel.name ?? '').toLowerCase() !== 'walk-in')
              .map((channel) => (
                <ToggleButton key={channel.id} value={channel.id} sx={{ flex: '0 0 auto' }}>
                  {channel.name}
                </ToggleButton>
              ))}
          </ToggleButtonGroup>
          {effectiveSelectedChannelIds.length === 0 ? (
            <Alert severity="info">
              Select platforms to enter the metrics or skip if not operating the experience.
            </Alert>
          ) : (
            <Box
              sx={{
                display: 'grid',
                gap: 2,
                gridTemplateColumns: {
                  xs: '1fr',
                  md: 'repeat(2, minmax(0, 1fr))',
                  lg: 'repeat(3, minmax(0, 1fr))',
                },
              }}
            >
              {effectiveSelectedChannelIds.map((channelId: number) => {
                const channel = registry.channels.find((item) => item.id === channelId);
                if (!channel) {
                  return null;
                }
                return (
                  <Box key={`${channel.id}-${platformBucket.label}`} sx={{ height: '100%' }}>
                    {renderChannelCard(channel, platformBucket, registry.addons)}
                  </Box>
                );
              })}
            </Box>
          )}
        </Stack>
      </Stack>
    );
  };

  const renderReservationsStep = () => {
    const selectedAfterCutoffChannels = effectiveAfterCutoffIds
      .map((channelId: number) => {
        const channel =
          afterCutoffChannels.find((item) => item.id === channelId) ??
          registry.channels.find((item) => item.id === channelId);
        return channel;
      })
      .filter(
        (channel): channel is ChannelConfig => Boolean(channel) && !shouldHideAfterCutoffChannel(channel),
      );

    return (
      <Stack spacing={3}>
        {effectiveSelectedChannelIds.length === 0 ? (
          <Alert severity="info">Select channels during the platform check to enter reservations.</Alert>
        ) : (
          RESERVATION_BUCKETS.map((bucket) => (
            <Box key={bucket.label} sx={{ width: '100%' }}>
              <Typography variant="h6" gutterBottom>
                {bucket.label}
              </Typography>
              <Box
                sx={{
                  display: 'grid',
                  gap: 2,
                  gridTemplateColumns: {
                    xs: '1fr',
                    md: 'repeat(2, minmax(0, 1fr))',
                    lg: 'repeat(3, minmax(0, 1fr))',
                  },
                }}
              >
                {effectiveSelectedChannelIds.map((channelId: number) => {
                  const channel = registry.channels.find((item) => item.id === channelId);
                  if (!channel) {
                    return null;
                  }
                  return (
                    <Box key={`${channel.id}-${bucket.label}`} sx={{ height: '100%' }}>
                      {renderChannelCard(channel, bucket, registry.addons)}
                    </Box>
                  );
                })}
              </Box>
            </Box>
          ))
        )}
        {afterCutoffChannels.length > 0 && (
          <Box sx={{ width: '100%' }}>
            <Typography variant="h6" gutterBottom>
              Booked After Cut-Off
            </Typography>
            <Stack spacing={2}>
              <ToggleButtonGroup
                value={effectiveAfterCutoffIds}
                onChange={handleAfterCutoffChannelSelection}
                size="small"
                aria-label="Channels allowing after cut-off bookings"
                sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 1, rowGap: 1 }}
              >
                {afterCutoffChannels
                  .filter((channel) => !shouldHideAfterCutoffChannel(channel))
                  .map((channel: ChannelConfig) => (
                    <ToggleButton
                      key={channel.id}
                      value={channel.id}
                      sx={{ flex: '0 0 auto' }}
                      disabled={registry.savingMetrics || confirmingMetrics}
                    >
                      {channel.name}
                    </ToggleButton>
                  ))}
              </ToggleButtonGroup>
              {selectedAfterCutoffChannels.length === 0 ? (
                <Alert severity="info">Select a channel to record bookings after the cut-off.</Alert>
              ) : (
                <Box
                  sx={{
                    display: 'grid',
                    gap: 2,
                    gridTemplateColumns: {
                      xs: '1fr',
                      md: 'repeat(2, minmax(0, 1fr))',
                      lg: 'repeat(3, minmax(0, 1fr))',
                    },
                  }}
                >
                  {selectedAfterCutoffChannels.map((channel: ChannelConfig) => (
                    <Box key={channel.id + '-after-cutoff'} sx={{ height: '100%' }}>
                      {renderChannelCard(channel, AFTER_CUTOFF_BUCKET, registry.addons)}
                    </Box>
                  ))}
                </Box>
              )}
            </Stack>
          </Box>
        )}
      </Stack>
    );
  };

  const renderModalNavigation = () => {
    const disableNav = registry.savingMetrics || confirmingMetrics;

    if (activeRegistryStep === 'platforms') {
      if (isMobileScreen) {
        return (
          <Stack direction="row" spacing={1} alignItems="center">
            <Button
              variant="outlined"
              size="small"
              onClick={() => {
                void handleReturnToSetup();
              }}
              disabled={disableNav}
              sx={{
                textTransform: 'none',
                minWidth: 'auto',
                px: 1,
              }}
            >
              &lt; Back
            </Button>
            <Button
              variant="contained"
              size="small"
              onClick={() => {
                void handleProceedToReservations();
              }}
              disabled={disableNav}
              sx={{
                textTransform: 'none',
                minWidth: 'auto',
                px: 1,
              }}
            >
              Next &gt;
            </Button>
          </Stack>
        );
      }

      return (
        <Stack direction="row" spacing={1}>
          <Button
            variant="outlined"
            size="small"
            onClick={() => {
              void handleReturnToSetup();
            }}
            disabled={disableNav}
          >
            Go to Setup
          </Button>
          <Button
            variant="contained"
            size="small"
            onClick={() => {
              void handleProceedToReservations();
            }}
            disabled={disableNav}
          >
            Go to Reservations Check
          </Button>
        </Stack>
      );
    }

    if (activeRegistryStep === 'reservations') {
      if (isMobileScreen) {
        return (
          <Stack direction="row" spacing={1} alignItems="center">
            <Button
              variant="outlined"
              size="small"
              onClick={() => {
                void handleReturnToPlatforms();
              }}
              disabled={disableNav}
              sx={{
                textTransform: 'none',
                minWidth: 'auto',
                px: 1,
              }}
            >
              &lt; Back
            </Button>
            <Button
              variant="contained"
              size="small"
              onClick={() => {
                void handleProceedToSummary();
              }}
              disabled={disableNav}
              sx={{
                textTransform: 'none',
                minWidth: 'auto',
                px: 1,
              }}
            >
              Next &gt;
            </Button>
          </Stack>
        );
      }

      return (
        <Stack direction="row" spacing={1}>
          <Button
            variant="outlined"
            size="small"
            onClick={() => {
              void handleReturnToPlatforms();
            }}
            disabled={disableNav}
          >
            Go to Platform Check
          </Button>
          <Button
            variant="contained"
            size="small"
            onClick={() => {
              void handleProceedToSummary();
            }}
            disabled={disableNav}
          >
            Proceed to Summary
          </Button>
        </Stack>
      );
    }

    if (activeRegistryStep === 'summary') {
      const backLabel = isMobileScreen ? '< Back' : 'Back to Reservations';
      const backButton = (
        <Button
          variant="outlined"
          size="small"
          onClick={() => setActiveRegistryStep('reservations')}
          disabled={disableNav}
          sx={{
            textTransform: 'none',
            minWidth: 'auto',
            px: 1,
          }}
        >
          {backLabel}
        </Button>
      );

      const saveButton = (
        <Button
          variant="contained"
          size="small"
          onClick={() => {
            void handleSaveAndExit();
          }}
          disabled={disableNav || hasFreeNoteValidationError}
          sx={{
            textTransform: 'none',
            minWidth: 'auto',
            px: 1,
          }}
        >
          Save
        </Button>
      );

      const saveControl = (
        <Stack spacing={0.5} alignItems="flex-start">
          {saveButton}
          {hasFreeNoteValidationError && (
            <Typography variant="caption" color="error">
              Add a reason for each free entry before saving.
            </Typography>
          )}
        </Stack>
      );

      if (isMobileScreen) {
        return (
          <Stack direction="row" spacing={1} alignItems="center">
            {backButton}
            {saveControl}
          </Stack>
        );
      }

      return (
        <Stack direction="row" spacing={1} alignItems="center">
          {backButton}
          {saveControl}
        </Stack>
      );
    }

    return null;
  };

  const isStepCompleted = useCallback(
    (stepKey: RegistryStep) => {
      switch (stepKey) {
        case 'details':
          return activeRegistryStep !== 'details';
        case 'platforms':
          return activeRegistryStep === 'reservations' || activeRegistryStep === 'summary';
        case 'reservations':
          return activeRegistryStep === 'summary';
        case 'summary':
        default:
          return false;
      }
    },
    [activeRegistryStep],
  );

  const renderStepContent = () => {
    if (activeRegistryStep === 'details') {
      return renderDetailsStep();
    }
    if (activeRegistryStep === 'platforms') {
      return renderPlatformStep();
    }
    if (activeRegistryStep === 'reservations') {
      return renderReservationsStep();
    }
    return renderSummaryStep();
  };


type SummaryRowOptions = {
  showBefore?: boolean;
  showAfter?: boolean;
  showNonShow?: boolean;
};

  const summaryRow = (
    label: string,
    bucket: CounterSummaryBucket,
    options: SummaryRowOptions = {},
    extras: { freeQty?: number; freeKey?: string } = {},
  ) => {
    const { showBefore = true, showAfter = true, showNonShow = true } = options;

    const chips: JSX.Element[] = [];
    if (showBefore && bucket.bookedBefore > 0) {
      chips.push(<Chip key="before" label={'Booked: ' + bucket.bookedBefore} size="small" />);
    }
    if (showAfter && bucket.bookedAfter > 0) {
      chips.push(
        <Chip
          key="after"
          label={'After Cut-Off: ' + bucket.bookedAfter}
          size="small"
          color="info"
        />,
      );
    }
    if (bucket.attended > 0) {
      chips.push(<Chip key="attended" label={'Attended: ' + bucket.attended} size="small" color="success" />);
    }
    if (showNonShow && bucket.nonShow > 0) {
      chips.push(<Chip key="non-show" label={'No-show: ' + bucket.nonShow} size="small" color="warning" />);
    }

    if (chips.length === 0) {
      chips.push(<Chip key="no-bookings" label="No Bookings" size="small" variant="outlined" />);
    }
    if ((extras.freeQty ?? 0) > 0) {
      const freeKey = extras.freeKey ?? `free-${label}`;
      chips.push(<Chip key={freeKey} label={`Free: ${extras.freeQty}`} size="small" color="info" />);
    }

    return (
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'flex-start', sm: 'center' }}>
        <Typography sx={{ minWidth: 120, fontWeight: 500 }}>{label}</Typography>
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
          {chips}
        </Stack>
      </Stack>
    );
  };

  const createEmptyPeopleBucket = (): CounterSummaryBucket => ({
    bookedBefore: 0,
    bookedAfter: 0,
    attended: 0,
    nonShow: 0,
  });

  const createEmptyAddonBucket = (addon: AddonConfig): CounterSummaryAddonBucket => ({
    addonId: addon.addonId,
    name: addon.name,
    key: addon.key,
    bookedBefore: 0,
    bookedAfter: 0,
    attended: 0,
    nonShow: 0,
  });

  const createEmptyAddonBucketFromSummary = (bucket: CounterSummaryAddonBucket): CounterSummaryAddonBucket => ({
    addonId: bucket.addonId,
    name: bucket.name,
    key: bucket.key,
    bookedBefore: 0,
    bookedAfter: 0,
    attended: 0,
    nonShow: 0,
  });

  const summaryData = useMemo(() => {
    if (!hasDirtyMetrics && registry.summary) {
      const channelMap = new Map<number, CounterSummaryChannel>();
      registry.summary.byChannel.forEach((channel) => channelMap.set(channel.channelId, channel));
      const orderedChannels = summaryChannelOrder
        .map((channelId) => channelMap.get(channelId))
        .filter((entry): entry is CounterSummaryChannel => Boolean(entry));
      return {
        byChannel: orderedChannels,
        totals: registry.summary.totals,
      };
    }
    const channelsById = new Map<number, ChannelConfig>();
    registry.channels.forEach((channel) => channelsById.set(channel.id, channel));

    const addonById = new Map<number, AddonConfig>();
    registry.addons.forEach((addon) => addonById.set(addon.addonId, addon));

    const channelEntries = new Map<number, CounterSummaryChannel>();
    summaryChannelOrder.forEach((channelId) => {
      const channel = channelsById.get(channelId);
      if (!channel) {
        return;
      }
      channelEntries.set(channelId, {
        channelId,
        channelName: channel.name,
        people: createEmptyPeopleBucket(),
        addons: {},
      });
    });

    const totalsPeople = createEmptyPeopleBucket();
    const totalsAddonMap = new Map<string, CounterSummaryAddonBucket>();

    mergedMetrics.forEach((metric) => {
      if (!summaryChannelIds.has(metric.channelId)) {
        return;
      }
      const entry = channelEntries.get(metric.channelId);
      if (!entry) {
        return;
      }

      if (metric.kind === 'people') {
        if (metric.tallyType === 'booked') {
          if (metric.period === 'before_cutoff') {
            entry.people.bookedBefore += metric.qty;
          }
          if (metric.period === 'after_cutoff') {
            entry.people.bookedAfter += metric.qty;
          }
        }
        if (metric.tallyType === 'attended') {
          entry.people.attended += metric.qty;
        }
      }

      if (metric.kind === 'addon' && metric.addonId != null) {
        const addon = addonById.get(metric.addonId);
        if (!addon) {
          return;
        }
        let addonBucket = entry.addons[addon.key];
        if (!addonBucket) {
          addonBucket = createEmptyAddonBucket(addon);
          entry.addons[addon.key] = addonBucket;
        }
        if (metric.tallyType === 'booked') {
          if (metric.period === 'before_cutoff') {
            addonBucket.bookedBefore += metric.qty;
          }
          if (metric.period === 'after_cutoff') {
            addonBucket.bookedAfter += metric.qty;
          }
        }
        if (metric.tallyType === 'attended') {
          addonBucket.attended += metric.qty;
        }
      }
    });

    channelEntries.forEach((entry) => {
      const channel = channelsById.get(entry.channelId);
      const isAfterCutoffChannel = AFTER_CUTOFF_ALLOWED.has(channel?.name?.toLowerCase() ?? '');

      if (isAfterCutoffChannel) {
        entry.people.bookedAfter = Math.max(entry.people.attended - entry.people.bookedBefore, 0);
      }

      entry.people.nonShow = Math.max(
        entry.people.bookedBefore + entry.people.bookedAfter - entry.people.attended,
        0,
      );

      totalsPeople.bookedBefore += entry.people.bookedBefore;
      totalsPeople.bookedAfter += entry.people.bookedAfter;
      totalsPeople.attended += entry.people.attended;

      Object.values(entry.addons).forEach((bucket) => {
        bucket.nonShow = Math.max(bucket.bookedBefore + bucket.bookedAfter - bucket.attended, 0);
        let totalsAddon = totalsAddonMap.get(bucket.key);
        if (!totalsAddon) {
          totalsAddon = createEmptyAddonBucketFromSummary(bucket);
          totalsAddonMap.set(bucket.key, totalsAddon);
        }
        totalsAddon.bookedBefore += bucket.bookedBefore;
        totalsAddon.bookedAfter += bucket.bookedAfter;
        totalsAddon.attended += bucket.attended;
      });
    });

    totalsPeople.nonShow = Math.max(
      totalsPeople.bookedBefore + totalsPeople.bookedAfter - totalsPeople.attended,
      0,
    );
    totalsAddonMap.forEach((bucket) => {
      bucket.nonShow = Math.max(bucket.bookedBefore + bucket.bookedAfter - bucket.attended, 0);
    });

    const byChannel = summaryChannelOrder
      .map((channelId) => channelEntries.get(channelId))
      .filter((entry): entry is CounterSummaryChannel => Boolean(entry));

    const totalsAddons: Record<string, CounterSummaryAddonBucket> = {};
    totalsAddonMap.forEach((bucket, key) => {
      totalsAddons[key] = bucket;
    });

    return {
      byChannel,
      totals: {
        people: totalsPeople,
        addons: totalsAddons,
      },
    };
  }, [hasDirtyMetrics, mergedMetrics, registry.addons, registry.channels, registry.summary, summaryChannelIds, summaryChannelOrder]);

  const renderSummaryStep = () => {
    const { byChannel: summaryChannels, totals: summaryTotals } = summaryData;
  const beautifiedNotes = formatCounterSnapshotDetails(counterNotes, registry.channels, combinedAddonList);

    if (summaryChannels.length === 0) {
      return (
        <Stack spacing={3} sx={{ mt: 4 }}>
          <Alert severity="info">Select channels in Platform and Reservations to review the summary.</Alert>
        </Stack>
      );
    }

    const addonTotalsToShow = Object.values(summaryTotals.addons).filter(
      (addon) => addon.bookedBefore > 0 || addon.bookedAfter > 0 || addon.attended > 0 || addon.nonShow > 0,
    );

    return (
      <Stack spacing={3}>
        {beautifiedNotes && (
          <Box>
            <Typography variant="subtitle1" fontWeight={600} gutterBottom>
              Notes
            </Typography>
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
            >
              {beautifiedNotes}
            </Typography>
            <Divider sx={{ my: 1.5 }} />
          </Box>
        )}
        <Box>
          <Grid container spacing={2}>
            {summaryChannels.map((item) => {
              const isAfterCutoffChannel = AFTER_CUTOFF_ALLOWED.has(item.channelName.toLowerCase());
              const addonBuckets = Object.values(item.addons);
              const showBeforeForChannel =
                !isAfterCutoffChannel || effectiveSelectedChannelIds.includes(item.channelId);
              const channelCashEntries = cashCollectionSummary.perChannel.get(item.channelId) ?? null;
              return (
                <Grid size={{ xs: 12, md: 6, lg: 4 }} key={item.channelId}>
                  <Card variant="outlined">
                    <CardContent>
                      <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                        {item.channelName}
                      </Typography>
                      {summaryRow(
                        'People',
                        item.people,
                        {
                          showBefore: showBeforeForChannel,
                          showAfter: true,
                          showNonShow: !isAfterCutoffChannel,
                        },
                        {
                          freeQty: freePeopleTotalsByChannel.get(item.channelId) ?? 0,
                          freeKey: `channel-${item.channelId}-people-free`,
                        },
                      )}
                      {channelCashEntries && channelCashEntries.length > 0 && (
                        <Typography
                          variant="body2"
                          sx={{ mt: 0.5, fontWeight: 500 }}
                          color="text.secondary"
                        >
                          Cash collected:{' '}
                          {channelCashEntries
                            .map((entry) => `${entry.currency} ${entry.formatted}`)
                            .join(' | ')}
                        </Typography>
                      )}
                      <Divider sx={{ my: 1 }} />
                      {addonBuckets.map((addon) => (
                        <Box key={addon.key} sx={{ mb: 1 }}>
                          {summaryRow(
                            addon.name,
                            addon,
                            {
                              showBefore: showBeforeForChannel,
                              showAfter: true,
                              showNonShow: !isAfterCutoffChannel,
                            },
                            {
                              freeQty:
                                freeAddonsTotalsByChannel.get(item.channelId)?.get(addon.addonId) ?? 0,
                              freeKey: `channel-${item.channelId}-addon-${addon.addonId}-free`,
                            },
                          )}
                        </Box>
                      ))}
                    </CardContent>
                  </Card>
                </Grid>
              );
            })}
            <Grid size={{ xs: 12 }}>
              <Card variant="outlined" sx={{ backgroundColor: theme.palette.action.hover }}>
                <CardContent>
                  <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                    Totals
                  </Typography>
                  {summaryRow(
                    'People',
                    summaryTotals.people,
                    { showBefore: false, showAfter: false, showNonShow: true },
                    { freeQty: totalFreePeople, freeKey: 'totals-people-free' },
                  )}
                  {cashCollectionSummary.formattedTotals.length > 0 && (
                    <Typography
                      variant="body2"
                      sx={{ mt: 0.5, fontWeight: 500 }}
                      color="text.secondary"
                    >
                      Cash collected:{' '}
                      {cashCollectionSummary.formattedTotals
                        .map((entry) => `${entry.currency} ${entry.formatted}`)
                        .join(' | ')}
                    </Typography>
                  )}
                  <Divider sx={{ my: 1 }} />
                  {addonTotalsToShow.map((addon) => (
                    <Box key={addon.key} sx={{ mb: 1 }}>
                      {summaryRow(
                        addon.name,
                        addon,
                        { showBefore: false, showAfter: false, showNonShow: true },
                        {
                          freeQty: freeAddonTotalsByKey.get(addon.key) ?? 0,
                          freeKey: `totals-addon-${addon.key}-free`,
                        },
                      )}
                    </Box>
                  ))}
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        </Box>
      </Stack>
    );
  };

  const isSaving =
    registry.savingMetrics ||
    registry.savingNotes ||
    registry.savingStaff ||
    registry.savingStatus ||
    registry.savingProduct;

  const renderCounterEditor = () => {
    if (isLoading) {
      return (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '40vh',
            width: '100%',
          }}
        >
          <CircularProgress />
        </Box>
      );
    }

    if (!registry.counter && modalMode !== 'create') {
      return (
        <Box sx={{ textAlign: 'center', py: 4, width: '100%' }}>
          <Typography variant="h6">Unable to load counter data.</Typography>
        </Box>
      );
    }

    return (
      <Box
        sx={{
          width: '100%',
          minHeight: { xs: '100%', md: 'auto' },
          display: 'flex',
          flexDirection: 'column',
          px: { xs: 2, sm: 0 },
          py: { xs: 2, sm: 0 },
          boxSizing: 'border-box',
          overflowX: 'hidden',
        }}
      >
        <Stack spacing={3} sx={{ pb: 2 }}>
          {isSaving && <LinearProgress />}
          {registry.error && <Alert severity="error">{registry.error}</Alert>}
          <Stack spacing={1}>
            <Stepper nonLinear activeStep={Math.max(stepIndex, 0)} alternativeLabel>
              {STEP_CONFIGS.map((step) => (
                <Step key={step.key} completed={isStepCompleted(step.key)}>
                  <StepButton
                    color="inherit"
                    onClick={() => handleStepSelect(step.key)}
                    disabled={
                      ensuringCounter ||
                      (!registry.counter && step.key !== 'details') ||
                      registry.savingMetrics ||
                      confirmingMetrics
                    }
                  >
                    {step.label}
                  </StepButton>
                </Step>
              ))}
            </Stepper>
            <Typography variant="body2" color="text.secondary">
              {activeStepConfig.description}
            </Typography>
          </Stack>

          {renderStepContent()}
        </Stack>
      </Box>
    );
  };

  const handleDateChange = (value: Dayjs | null) => {
    if (!value) {
      return;
    }
    setSelectedDate(value);
    setPendingProductId(null);
    setPendingStaffIds([]);
    fetchCounterRequestRef.current = null;
    dispatch(clearDirtyMetrics());
  };

  const handleManagerSelection = (_event: SyntheticEvent, option: StaffOption | null) => {
    if (!option) {
      return;
    }
    if (option.id === selectedManagerId) {
      return;
    }
    setCounterListError(null);
    setSelectedManagerId(option.id);
    fetchCounterRequestRef.current = null;
  };
  const handleStaffSelection = (_event: SyntheticEvent, values: StaffOption[]) => {
    const ids = values.map((option) => option.id);
    handleStaffChange(ids);
  };

  const handleProductSelection = useCallback(
    (_event: SyntheticEvent, option: CatalogProduct | null) => {
      const nextProductId = option?.id ?? null;
      setPendingProductId(nextProductId);
    },
    [setPendingProductId],
  );

  const canModifyCounter = Boolean(selectedCounterId ?? counterId);
  const modalTitle =
    modalMode === 'create' ? 'Create Counter' : modalMode === 'update' ? 'Update Counter' : 'Counter';
  const pageLayoutStyles = useMemo(() => {
    const verticalOffset = isMobileScreen ? theme.spacing(12) : theme.spacing(16);
    return {
      pb: theme.spacing(isMobileScreen ? 1 : 1.75),
      pt: theme.spacing(isMobileScreen ? 0.5 : 1),
      minHeight: `calc(100vh - ${verticalOffset})`,
      display: 'flex',
      flex: 1,
      alignItems: 'stretch',
      gap: theme.spacing(0.35),
    };
  }, [isMobileScreen, theme]);
  const panelMaxHeight = useMemo(() => {
    const offset = isMobileScreen ? theme.spacing(12) : theme.spacing(16);
    return `calc(100vh - ${offset})`;
  }, [isMobileScreen, theme]);

  const counterActions = isMobileScreen ? (
    <Tooltip title="Add Counter">
      <IconButton color="primary" size="small" onClick={handleAddNewCounter} aria-label="Add counter">
        <Add fontSize="small" />
      </IconButton>
    </Tooltip>
  ) : (
    <Button variant="contained" size="small" startIcon={<Add />} onClick={handleAddNewCounter}>
      Add New
    </Button>
  );

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <Stack spacing={2} sx={pageLayoutStyles}>
        <Card
          variant="outlined"
          sx={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            maxHeight: panelMaxHeight,
            overflow: 'hidden',
          }}
        >
          <CardHeader
            title={
              <Typography variant="h6" component="span">
                Counters
              </Typography>
            }
            action={counterActions}
            subheader={counterListLoading ? 'Loading counters...' : null}
            sx={{
              alignItems: 'center',
              '& .MuiCardHeader-action': {
                margin: 0,
              },
            }}
          />
          <CardContent
            sx={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0,
              gap: 1.5,
            }}
          >
            {counterListLoading ? (
              <Stack spacing={1.5} sx={{ flex: 1, justifyContent: 'center' }}>
                {[0, 1, 2].map((index) => (
                  <Skeleton key={'counter-skeleton-' + index} variant="rounded" height={48} />
                ))}
              </Stack>
            ) : counterListError ? (
              <Box
                sx={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Alert severity="error" sx={{ width: '100%' }}>
                  {counterListError}
                </Alert>
              </Box>
            ) : counterList.length === 0 ? (
              <Box
                sx={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Typography color="text.secondary">No counters found yet.</Typography>
              </Box>
            ) : (
              <List dense sx={{ flex: 1, overflowY: 'auto', pr: 1 }}>
                {counterList.map((counter) => {
                  const counterIdValue = counter.id ?? null;
                  const counterDate = counter.date ? dayjs(counter.date) : null;
                  const dateLabel = counterDate?.isValid()
                    ? counterDate.format('dddd, MMM D, YYYY')
                    : 'Unknown date';
                  const managerNameFromPayload = counter.manager
                    ? composeName(counter.manager.firstName, counter.manager.lastName)
                    : '';
                  const managerLookup = managerOptions.find((option) => option.id === counter.userId);
                  const managerDisplay =
                    managerNameFromPayload ||
                    (managerLookup ? buildDisplayName(managerLookup) : '');

                  const productDisplay =
                    counter.product && counter.product.name ? counter.product.name : '';
                  const productLabel = productDisplay || 'Old Product Version - Pub Crawl';
                  const isSelected =
                    selectedCounterId != null && counterIdValue != null && counterIdValue === selectedCounterId;
                  const rawNote = typeof counter.notes === 'string' ? counter.notes : '';
                  const notePreview = formatCounterNotePreview(rawNote, registry.channels, combinedAddonList);
                  const hasNote = notePreview.trim().length > 0;
                  const managerProductLine = (
                    <Typography
                      component="span"
                      variant="body2"
                      color={isSelected ? 'grey.300' : 'text.secondary'}
                    >
                      <Box
                        component="span"
                        sx={{
                          fontWeight: 600,
                          color: isSelected ? 'grey.100' : undefined,
                        }}
                      >
                        Manager:
                      </Box>{' '}
                      <Box
                        component="span"
                        sx={{ color: isSelected ? 'grey.200' : undefined }}
                      >
                        {managerDisplay || '-'}
                      </Box>
                      <Box
                        component="span"
                        sx={{
                          mx: 0.75,
                          color: isSelected ? 'grey.400' : undefined,
                        }}
                      >
                        |
                      </Box>
                      <Box
                        component="span"
                        sx={{ color: isSelected ? 'grey.200' : undefined }}
                      >
                        {productLabel}
                      </Box>
                    </Typography>
                  );
                  const secondaryContent = (
                    <Stack spacing={hasNote ? 0.5 : 0}>
                      {managerProductLine}
                      {hasNote && (
                        <Typography
                          variant="caption"
                          color={isSelected ? 'grey.300' : 'text.secondary'}
                          sx={{
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                          }}
                        >
                          Note: {notePreview}
                        </Typography>
                      )}
                    </Stack>
                  );
                  const venueNumbersLink =
                    counterIdValue != null ? `/venueNumbers?counterId=${counterIdValue}` : '/venueNumbers';
                  const { label: venueButtonLabel, color: venueButtonColor } = venueStatusForCounter(counterIdValue);
                  const isExpanded = counterIdValue != null && counterIdValue === expandedCounterId;
                  const handleRowClick = () => {
                    handleCounterSelect(counter);
                    if (counterIdValue != null) {
                      toggleCounterExpansion(counterIdValue);
                    }
                  };
                  const handleExpandClick = (event: MouseEvent<HTMLButtonElement>) => {
                    event.stopPropagation();
                    handleRowClick();
                  };

                  return (
                    <ListItem
                      key={(counter.id ?? 'counter') + '-' + dateLabel}
                      disablePadding
                      sx={{
                        borderBottom: (theme) => `1px dashed ${theme.palette.divider}`,
                        '&:last-of-type': { borderBottom: 'none' },
                        flexDirection: 'column',
                        alignItems: 'stretch',
                      }}
                    >
                      <ListItemButton
                        disableRipple
                        disableTouchRipple
                        onClick={handleRowClick}
                        selected={Boolean(isSelected)}
                        sx={(theme) => ({
                          width: '100%',
                          ...(isSelected
                            ? {
                                backgroundColor: '#000',
                                color: theme.palette.common.white,
                                '&:hover': {
                                  backgroundColor: '#111',
                                },
                                '& .MuiTypography-root': {
                                  color: theme.palette.common.white,
                                },
                              }
                            : {
                                '&:hover': {
                                  backgroundColor: theme.palette.action.hover,
                                },
                              }),
                          '&.Mui-selected': {
                            backgroundColor: '#000',
                            color: theme.palette.common.white,
                          },
                          '&.Mui-selected:hover': {
                            backgroundColor: '#111',
                          },
                        })}
                      >
                        <Stack direction="row" alignItems="center" spacing={1} sx={{ width: '100%' }}>
                          <ListItemText
                            primary={
                              <Typography
                                variant="body1"
                                fontWeight={600}
                                color={isSelected ? 'common.white' : 'text.primary'}
                              >
                                {dateLabel}
                              </Typography>
                            }
                            secondary={secondaryContent}
                            secondaryTypographyProps={{ component: 'div' }}
                            sx={{ flexGrow: 1, minWidth: 0 }}
                          />
                          <IconButton
                            size="small"
                            edge="end"
                            onClick={handleExpandClick}
                            disabled={counterIdValue == null}
                            sx={{
                              transition: 'transform 150ms ease',
                              transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                              color: isSelected ? 'inherit' : 'text.secondary',
                              ml: 0.5,
                            }}
                          >
                            <KeyboardArrowRight fontSize="small" />
                          </IconButton>
                        </Stack>
                      </ListItemButton>
                      <Collapse in={isExpanded} timeout="auto" unmountOnExit>
                        <Box
                          sx={{
                            px: { xs: 2, sm: 3 },
                            py: 1.5,
                            bgcolor: (theme) =>
                              theme.palette.mode === 'dark'
                                ? 'rgba(255,255,255,0.04)'
                                : 'rgba(0,0,0,0.02)',
                          }}
                        >
                          <Stack
                            direction="row"
                            spacing={1}
                            alignItems="center"
                            sx={{
                              flexWrap: 'wrap',
                              rowGap: 1,
                              columnGap: 1,
                              '& > *': { flexShrink: 0 },
                            }}
                          >
                            <Button
                              variant="outlined"
                              size="small"
                              onClick={(event) => {
                                event.stopPropagation();
                                void handleViewSummary(counter);
                              }}
                              disabled={counterIdValue == null}
                          >
                            <Visibility fontSize="small" sx={{ mr: 0.5 }} />
                            View
                          </Button>
                          <Button
                            variant="outlined"
                            size="small"
                            startIcon={<Edit />}
                            onClick={() => handleOpenModal('update')}
                              disabled={!canModifyCounter}
                            >
                              Edit
                            </Button>
                            <Button
                              variant="outlined"
                              color="error"
                              size="small"
                              startIcon={<Delete />}
                              onClick={handleDeleteCounter}
                            disabled={!canModifyCounter}
                          >
                            DEL
                          </Button>
                          <Button
                            variant="outlined"
                            size="small"
                            component={Link}
                            to={venueNumbersLink}
                            onClick={(event) => event.stopPropagation()}
                            color={venueButtonColor}
                            disabled={counterIdValue == null}
                          >
                            <MapIcon fontSize="small" sx={{ mr: 0.5 }} />
                            {venueButtonLabel}
                          </Button>
                        </Stack>
                      </Box>
                    </Collapse>
                    </ListItem>
                  );
                })}
              </List>
            )}
          </CardContent>
        </Card>
      </Stack>

      <Dialog
        open={isModalOpen}
        onClose={handleCloseModal}
        fullWidth
        maxWidth="lg"
        fullScreen={isMobileScreen}
        aria-labelledby="counter-dialog-title"
      >
        <DialogTitle
          id="counter-dialog-title"
          sx={{ m: 0, p: 2, pb: 2, display: 'flex', flexDirection: 'column', gap: 1 }}
        >
          <Stack direction="row" alignItems="center" spacing={1.5} sx={{ width: '100%', flexWrap: 'wrap' }}>
            <Typography variant="h6" component="span">
              {modalTitle}
            </Typography>
            <Box sx={{ flexGrow: 1 }} />
            {renderModalNavigation()}
            <IconButton aria-label="close" onClick={handleCloseModal} sx={{ ml: isMobileScreen ? 0 : 0.5 }}>
              <Close />
            </IconButton>
          </Stack>
        </DialogTitle>
        <DialogContent
          dividers
          sx={{
            p: { xs: 2, sm: 3 },
            overflowX: 'hidden',
          }}
        >
          {renderCounterEditor()}
        </DialogContent>
      </Dialog>
      <Dialog
        open={summaryPreviewOpen}
        onClose={() => setSummaryPreviewOpen(false)}
        fullWidth
        maxWidth="lg"
        aria-labelledby="counter-summary-preview"
      >
        <DialogTitle
          id="counter-summary-preview"
          sx={{ m: 0, p: 2, pb: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
        >
          <Typography variant="h6" component="span">
            Counter Summary {summaryPreviewTitle ? `- ${summaryPreviewTitle}` : ""}
          </Typography>
          <IconButton onClick={() => setSummaryPreviewOpen(false)}>
            <Close />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers sx={{ p: { xs: 2, sm: 3 } }}>
          {summaryPreviewLoading ? (
            <Stack alignItems="center" justifyContent="center" minHeight={240}>
              <CircularProgress />
            </Stack>
          ) : (
            renderSummaryStep()
          )}
        </DialogContent>
      </Dialog>
    </LocalizationProvider>
  );
};

export default Counters;

