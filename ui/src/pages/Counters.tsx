import type { ChangeEvent, KeyboardEvent, MouseEvent, SyntheticEvent } from 'react';
import { memo, useCallback, useEffect, useMemo, useRef, useState, startTransition } from 'react';
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
  MenuItem,
  Pagination,
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
import type { BrowserMultiFormatReader, IScannerControls } from '@zxing/browser';
import type { Exception as ZXingException, Result as ZXingResult } from '@zxing/library';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { deleteCounter, fetchCounters } from '../actions/counterActions';
import { createNightReport, fetchNightReports, submitNightReport, updateNightReport } from '../actions/nightReportActions';
import { navigateToPage } from '../actions/navigationActions';
import { GenericPageProps } from '../types/general/GenericPageProps';
import { loadCatalog, selectCatalog } from '../store/catalogSlice';
import { fetchScheduledStaffForProduct } from '../api/scheduling';
import {
  clearDirtyMetrics,
  clearCounter,
  fetchCounterByDate,
  fetchCounterById,
  commitCounterRegistry,
  selectCounterRegistry,
  setMetric,
  submitCounterSetup,
  updateCounterProduct,
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
import { DID_NOT_OPERATE_NOTE } from '../constants/nightReports';
import type { Counter } from '../types/counters/Counter';
import axiosInstance from '../utils/axiosInstance';
import type { ServerResponse } from '../types/general/ServerResponse';
import type { NightReport, NightReportSummary } from '../types/nightReports/NightReport';
import type {
  BookingStatus,
  ManifestGroup,
  ManifestSummary,
  OrderExtras,
  UnifiedOrder,
} from '../store/bookingPlatformsTypes';
import { WALK_IN_TICKET_LABEL_TO_KEY, WALK_IN_TICKET_TYPE_LABELS } from '../constants/walkInTicketTypes';

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

type ManifestResponse = {
  date: string;
  manifest: ManifestGroup[];
  orders: UnifiedOrder[];
  summary?: ManifestSummary;
};

type PlatformManifestTotals = {
  people: number;
  extras: OrderExtras;
};

type ScannerResultKind = 'qr' | 'barcode' | 'text';
type ScannerSource = 'live' | 'ocr';

type ScannerResultRecord = {
  kind: ScannerResultKind;
  source: ScannerSource;
  rawValue: string;
  bookingId: string | null;
  format?: string;
  confidence?: number;
  scannedAt: string;
};

type ScannerBookingMatch = {
  order: UnifiedOrder;
  shouldLetIn: number;
  matchedCount: number;
  searchedValue: string;
};

type NativeDetectedBarcode = {
  rawValue?: string;
  format?: string;
};

type NativeBarcodeDetectorInstance = {
  detect: (source: HTMLVideoElement | HTMLCanvasElement | ImageBitmap) => Promise<NativeDetectedBarcode[]>;
};

type NativeBarcodeDetectorCtor = {
  new (options?: { formats?: string[] }): NativeBarcodeDetectorInstance;
  getSupportedFormats?: () => Promise<string[]>;
};

const MANIFEST_ACTIVE_STATUSES = new Set<BookingStatus>([
  'pending',
  'confirmed',
  'rebooked',
  'completed',
]);
const MANIFEST_INCLUDED_STATUSES = new Set<BookingStatus>([...MANIFEST_ACTIVE_STATUSES, 'amended']);
const NATIVE_BARCODE_FORMATS = [
  'qr_code',
  'code_128',
  'code_39',
  'code_93',
  'codabar',
  'ean_13',
  'ean_8',
  'itf',
  'upc_a',
  'upc_e',
  'pdf417',
  'data_matrix',
  'aztec',
];
const SCANNER_RESULT_COOLDOWN_MS = 2_500;
const BOOKING_ID_QUERY_KEYS = [
  'bookingid',
  'booking_id',
  'reservationid',
  'reservation_id',
  'orderid',
  'order_id',
  'platformbookingid',
  'platform_booking_id',
  'reference',
  'ref',
  'id',
];
const BOOKING_ID_HINT_REGEX =
  /\b(?:booking|reservation|platform)\s*(?:id|number|no\.?|#)?\s*[:#-]?\s*([a-z0-9-]{4,})\b/i;
const BOOKING_ID_GENERIC_REGEX = /\b([a-z0-9][a-z0-9-]{5,})\b/gi;
const ECWID_ORDER_PREFIX_REGEX = /^order[-_\s:]*([a-z0-9-]+)$/i;
const ECWID_ORDER_EMBEDDED_REGEX = /\border[-_\s:]*([a-z0-9-]{3,})\b/i;
const ECWID_ORDER_WORD_BLACKLIST = new Set([
  'confirmation',
  'confirmed',
  'number',
  'booking',
  'reservation',
  'platform',
]);

const normalizeScannerText = (value: string): string => value.replace(/\s+/g, ' ').trim();

const isLikelyToken = (value: string): boolean => {
  if (!value || value.length < 4) {
    return false;
  }
  if (/^(https?|www)$/i.test(value)) {
    return false;
  }
  return /[a-z]/i.test(value) || /\d/.test(value);
};

const extractBookingIdFromUrl = (rawValue: string): string | null => {
  const input = rawValue.trim();
  const hasProtocol = /^https?:\/\//i.test(input);
  if (!hasProtocol) {
    return null;
  }

  try {
    const parsed = new URL(input);
    for (const key of BOOKING_ID_QUERY_KEYS) {
      const candidate = parsed.searchParams.get(key);
      if (candidate) {
        const normalized = normalizeScannerText(candidate);
        if (isLikelyToken(normalized)) {
          return normalized;
        }
      }
    }

    const pathSegments = parsed.pathname
      .split('/')
      .map((segment) => normalizeScannerText(segment))
      .filter((segment) => segment.length > 0);
    for (let index = pathSegments.length - 1; index >= 0; index -= 1) {
      const candidate = pathSegments[index];
      if (isLikelyToken(candidate)) {
        return candidate;
      }
    }
  } catch (_error) {
    return null;
  }

  return null;
};

const extractEcwidOrderCandidate = (rawValue: string): string | null => {
  const normalized = normalizeScannerText(rawValue);
  if (!normalized) {
    return null;
  }

  const directMatch = normalized.match(ECWID_ORDER_PREFIX_REGEX);
  if (directMatch?.[1]) {
    return `ORDER-${directMatch[1].toUpperCase()}`;
  }

  const embeddedMatches = Array.from(
    normalized.matchAll(new RegExp(ECWID_ORDER_EMBEDDED_REGEX.source, 'gi')),
  )
    .map((entry) => normalizeScannerText(entry[1] ?? '').replace(/[^a-z0-9-]/gi, ''))
    .filter((entry) => entry.length >= 3);
  if (embeddedMatches.length === 0) {
    return null;
  }

  const ranked = embeddedMatches
    .map((entry) => {
      const lowered = entry.toLowerCase();
      let score = 0;
      if (/\d/.test(entry)) {
        score += 4;
      }
      if (/[a-z]/i.test(entry)) {
        score += 2;
      }
      if (entry.includes('-')) {
        score += 1;
      }
      if (entry.length >= 6) {
        score += 1;
      }
      if (ECWID_ORDER_WORD_BLACKLIST.has(lowered)) {
        score -= 6;
      }
      return { entry, score };
    })
    .sort((left, right) => right.score - left.score || right.entry.length - left.entry.length);

  const best = ranked[0];
  if (!best || best.score <= 0) {
    return null;
  }
  return `ORDER-${best.entry.toUpperCase()}`;
};

const extractBookingId = (rawValue: string): string | null => {
  const normalized = normalizeScannerText(rawValue);
  if (!normalized) {
    return null;
  }

  const urlValue = extractBookingIdFromUrl(normalized);
  if (urlValue) {
    return urlValue;
  }

  const hinted = normalized.match(BOOKING_ID_HINT_REGEX);
  if (hinted?.[1]) {
    return hinted[1];
  }

  const ecwidOrder = extractEcwidOrderCandidate(normalized);
  if (ecwidOrder) {
    return ecwidOrder;
  }

  const genericCandidates = Array.from(normalized.matchAll(BOOKING_ID_GENERIC_REGEX))
    .map((entry) => entry[1] ?? '')
    .filter((entry) => isLikelyToken(entry));
  if (genericCandidates.length === 0) {
    return null;
  }

  genericCandidates.sort((left, right) => right.length - left.length);
  return genericCandidates[0];
};

const buildScannerOcrCandidates = (rawText: string): string[] => {
  const normalized = normalizeScannerText(rawText);
  if (!normalized) {
    return [];
  }

  const byKey = new Map<string, string>();
  const pushCandidate = (value: string | null | undefined) => {
    if (!value) {
      return;
    }
    const candidate = normalizeScannerText(value);
    if (candidate.length < 3) {
      return;
    }
    const key = candidate.toLowerCase();
    if (!byKey.has(key)) {
      byKey.set(key, candidate);
    }
  };

  pushCandidate(extractBookingId(normalized));
  pushCandidate(extractEcwidOrderCandidate(normalized));
  const hyphenated = normalized.replace(/\s+/g, '-');
  pushCandidate(extractBookingId(hyphenated));
  pushCandidate(extractEcwidOrderCandidate(hyphenated));

  const embeddedOrderMatches = Array.from(
    normalized.matchAll(new RegExp(ECWID_ORDER_EMBEDDED_REGEX.source, 'gi')),
  )
    .map((entry) => normalizeScannerText(entry[1] ?? '').replace(/[^a-z0-9-]/gi, ''))
    .filter((entry) => entry.length >= 3);
  embeddedOrderMatches.forEach((entry) => {
    const upper = entry.toUpperCase();
    pushCandidate(`ORDER-${upper}`);
    if (upper.includes('O')) {
      pushCandidate(`ORDER-${upper.replace(/O/g, '0')}`);
    }
    if (upper.includes('0')) {
      pushCandidate(`ORDER-${upper.replace(/0/g, 'O')}`);
    }
  });

  pushCandidate(normalized);
  pushCandidate(hyphenated);

  return Array.from(byKey.values());
};

const buildScannerSearchCandidates = (result: ScannerResultRecord): string[] => {
  const byKey = new Map<string, string>();

  const pushCandidate = (value: string | null | undefined) => {
    if (!value) {
      return;
    }
    const normalized = normalizeScannerText(value);
    if (normalized.length < 3) {
      return;
    }
    const key = normalized.toLowerCase();
    if (!byKey.has(key)) {
      byKey.set(key, normalized);
    }
  };

  const rawCandidates = [result.bookingId, result.rawValue].filter((value): value is string => Boolean(value));
  rawCandidates.forEach((candidate) => {
    pushCandidate(candidate);
    const ecwidMatch = candidate.match(ECWID_ORDER_PREFIX_REGEX);
    if (!ecwidMatch?.[1]) {
      return;
    }
    const orderNumber = ecwidMatch[1];
    pushCandidate(orderNumber);
    if (/^\d+$/.test(orderNumber)) {
      const trimmedLeadingZeros = orderNumber.replace(/^0+(?=\d)/, '');
      pushCandidate(trimmedLeadingZeros);
    }
  });

  return Array.from(byKey.values());
};

const normalizeScannerBookingKey = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]/g, '');

const formatBookingStatusLabel = (status: string): string =>
  status
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

const resolveScannerStatusColor = (
  status: BookingStatus,
): 'default' | 'success' | 'warning' | 'error' | 'info' => {
  if (MANIFEST_INCLUDED_STATUSES.has(status)) {
    return 'success';
  }
  if (status === 'unknown') {
    return 'warning';
  }
  return 'error';
};

const getOrderEntryAllowance = (order: UnifiedOrder): number => {
  const qty = Math.max(0, Math.round(Number(order.quantity) || 0));
  if (!MANIFEST_INCLUDED_STATUSES.has(order.status)) {
    return 0;
  }
  return qty;
};

const pickBestScannerOrderMatch = (
  orders: UnifiedOrder[],
  scannedValue: string,
  targetDate: string,
  targetProductId: number | null,
): { order: UnifiedOrder | null; matchedCount: number } => {
  const normalizedScanned = normalizeScannerBookingKey(scannedValue);
  const valueLower = scannedValue.toLowerCase();
  if (!normalizedScanned && !valueLower) {
    return { order: null, matchedCount: 0 };
  }

  const matched = orders.filter((order) => {
    const bookingIdRaw = (order.platformBookingId ?? '').toString();
    if (!bookingIdRaw) {
      return false;
    }
    const normalizedOrderId = normalizeScannerBookingKey(bookingIdRaw);
    const orderLower = bookingIdRaw.toLowerCase();
    if (normalizedScanned && normalizedOrderId) {
      if (normalizedOrderId.includes(normalizedScanned) || normalizedScanned.includes(normalizedOrderId)) {
        return true;
      }
    }
    return valueLower.length > 0 && orderLower.includes(valueLower);
  });

  if (matched.length === 0) {
    return { order: null, matchedCount: 0 };
  }

  const sorted = [...matched].sort((left, right) => {
    const leftId = normalizeScannerBookingKey(left.platformBookingId ?? '');
    const rightId = normalizeScannerBookingKey(right.platformBookingId ?? '');
    const leftExact = leftId === normalizedScanned ? 1 : 0;
    const rightExact = rightId === normalizedScanned ? 1 : 0;
    if (leftExact !== rightExact) {
      return rightExact - leftExact;
    }

    const leftDate = left.date === targetDate ? 1 : 0;
    const rightDate = right.date === targetDate ? 1 : 0;
    if (leftDate !== rightDate) {
      return rightDate - leftDate;
    }

    const leftProduct = targetProductId != null && String(left.productId) === String(targetProductId) ? 1 : 0;
    const rightProduct = targetProductId != null && String(right.productId) === String(targetProductId) ? 1 : 0;
    if (leftProduct !== rightProduct) {
      return rightProduct - leftProduct;
    }

    const leftStatus = MANIFEST_INCLUDED_STATUSES.has(left.status) ? 1 : 0;
    const rightStatus = MANIFEST_INCLUDED_STATUSES.has(right.status) ? 1 : 0;
    if (leftStatus !== rightStatus) {
      return rightStatus - leftStatus;
    }

    const leftPickup = left.pickupDateTime ? dayjs(left.pickupDateTime).valueOf() : 0;
    const rightPickup = right.pickupDateTime ? dayjs(right.pickupDateTime).valueOf() : 0;
    return rightPickup - leftPickup;
  });

  return { order: sorted[0] ?? null, matchedCount: matched.length };
};

const normalizePlatformLookupKey = (value?: string | null): string => {
  if (!value) {
    return '';
  }
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
};

const buildPlatformTotalsFromOrders = (orders: UnifiedOrder[]): Map<string, PlatformManifestTotals> => {
  const totals = new Map<string, PlatformManifestTotals>();
  orders.forEach((order) => {
    const status = order.status ?? 'unknown';
    if (!MANIFEST_INCLUDED_STATUSES.has(status)) {
      return;
    }
    const platformKey = normalizePlatformLookupKey(order.platform);
    if (!platformKey) {
      return;
    }
    const people = Number(order.quantity) || 0;
    if (people <= 0 && !order.extras) {
      return;
    }
    const entry = totals.get(platformKey) ?? {
      people: 0,
      extras: { cocktails: 0, tshirts: 0, photos: 0 },
    };
    entry.people += Math.max(0, people);
    const extras = order.extras ?? { cocktails: 0, tshirts: 0, photos: 0 };
    entry.extras.cocktails += Math.max(0, Number(extras.cocktails) || 0);
    entry.extras.tshirts += Math.max(0, Number(extras.tshirts) || 0);
    entry.extras.photos += Math.max(0, Number(extras.photos) || 0);
    totals.set(platformKey, entry);
  });
  return totals;
};

const resolveAddonExtraKey = (addon: AddonConfig): keyof OrderExtras | null => {
  const raw = (addon.key ?? addon.name ?? '').toLowerCase();
  if (!raw) {
    return null;
  }
  if (raw.includes('non-show') || raw.includes('noshow') || raw.includes('no show')) {
    return null;
  }
  if (raw.includes('cocktail')) {
    return 'cocktails';
  }
  if (raw.includes('t-shirt') || raw.includes('tshirt')) {
    return 'tshirts';
  }
  if (raw.includes('photo')) {
    return 'photos';
  }
  return null;
};

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
const WALK_IN_TICKET_TYPE_LABELS_BY_KEY: Record<string, string> = Object.entries(
  WALK_IN_TICKET_TYPE_LABELS,
).reduce<Record<string, string>>((acc, [ticketType, label]) => {
  acc[ticketType.toLowerCase()] = label;
  return acc;
}, {});
const resolveWalkInTicketLabelFromType = (ticketTypeRaw: string | null | undefined): string | null => {
  const key = (ticketTypeRaw ?? '').toString().trim().toLowerCase();
  if (!key) {
    return null;
  }
  return WALK_IN_TICKET_TYPE_LABELS_BY_KEY[key] ?? null;
};
const WALK_IN_TICKET_UNIT_PRICES: Record<string, Partial<Record<CashCurrency, number>>> = {
  Normal: { EUR: 25 },
  'Second Timers': { PLN: 85, EUR: 20 },
  'Third Timers': { PLN: 75, EUR: 17 },
  'Half Price': { PLN: 50, EUR: 12 },
  Students: { PLN: 80, EUR: 19 },
  Group: { PLN: 85, EUR: 20 },
};
const formatListWithAmpersand = (items: string[]): string => {
  if (items.length === 0) {
    return '';
  }
  if (items.length === 1) {
    return items[0];
  }
  if (items.length === 2) {
    return `${items[0]} & ${items[1]}`;
  }

  const head = items.slice(0, -1).join(', ');
  const tail = items[items.length - 1];
  return `${head} & ${tail}`;
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

type CounterSnapshotFreeEntry = {
  label: string;
  quantity: number | null;
  reason: string | null;
};

type CounterSnapshotFreeSection = {
  channelLabel: string | null;
  entries: CounterSnapshotFreeEntry[];
};

type CounterSnapshotDetails = {
  freeSections: CounterSnapshotFreeSection[];
  manualNote: string;
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
  const mappedTicketType = WALK_IN_TICKET_LABEL_TO_KEY[ticketLabel];
  if (mappedTicketType && channel?.walkInTicketPrices?.length) {
    const configured = channel.walkInTicketPrices.find(
      (entry) =>
        String(entry.ticketType).toLowerCase() === mappedTicketType &&
        String(entry.currencyCode).toUpperCase() === currency,
    );
    if (configured) {
      const configuredPrice = Number(configured.price);
      if (Number.isFinite(configuredPrice)) {
        return Math.max(0, Math.round(configuredPrice * 100) / 100);
      }
    }
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
  _addons: AddonConfig[],
): string => {
  if (!note) {
    return '';
  }
  const cashMap = extractCashSnapshotMap(note);
  const freeMap = extractFreeSnapshotMap(note);

  const walkInChannel = channels.find((channel) => channel.name?.toLowerCase() === WALK_IN_CHANNEL_SLUG);
  let targetChannelId: number | null = walkInChannel?.id ?? null;

  if (targetChannelId == null) {
    for (const [channelId, entry] of cashMap.entries()) {
      if (entry.tickets && entry.tickets.length > 0) {
        targetChannelId = channelId;
        break;
      }
    }
  }

  if (targetChannelId == null && cashMap.size === 1) {
    const first = cashMap.keys().next();
    if (!first.done) {
      targetChannelId = first.value;
    }
  }

  if (targetChannelId == null && freeMap.size === 1) {
    const first = freeMap.keys().next();
    if (!first.done) {
      targetChannelId = first.value;
    }
  }

  const cashEntry = targetChannelId != null ? cashMap.get(targetChannelId) : undefined;

  const ticketNames = new Set<string>();

  if (cashEntry?.tickets && cashEntry.tickets.length > 0) {
    cashEntry.tickets.forEach((ticket) => {
      const ticketName = (ticket.name ?? '').toString().trim();
      if (ticketName.length > 0) {
        ticketNames.add(ticketName);
      }
    });
  }

  const currencyTotals = new Map<string, number>();
  cashMap.forEach((entry) => {
    const totals = aggregateCashTotals(entry);
    totals.forEach((amount, currency) => {
      currencyTotals.set(currency, (currencyTotals.get(currency) ?? 0) + amount);
    });
  });

  let hasFreeSnapshot = false;
  freeMap.forEach((entry) => {
    if (entry.people) {
      const qty = Math.max(0, Math.round(Number(entry.people.qty) || 0));
      const noteText = (entry.people.note ?? '').toString().trim();
      if (qty > 0 || noteText.length > 0) {
        hasFreeSnapshot = true;
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
        hasFreeSnapshot = true;
      });
    }
  });

  if (hasFreeSnapshot) {
    ticketNames.add('Free');
  }

  if (ticketNames.size === 0 && currencyTotals.size === 0) {
    return '';
  }

  const segments: string[] = [];
  const formattedTicketNames = formatListWithAmpersand(
    Array.from(ticketNames)
      .map((name) => name.trim())
      .filter((name) => name.length > 0),
  );
  segments.push(`Walk-In Tickets: ${formattedTicketNames || '-'}`);

  if (currencyTotals.size > 0) {
    const cashSummary = Array.from(currencyTotals.entries())
      .map(([currency, amount]) => `${currency} ${amount.toFixed(2)}`)
      .join(', ');
    segments.push(`Cash Collected: ${cashSummary}`);
  } else {
    segments.push('Cash Collected: -');
  }

  return segments.join(' || ');
};

const formatCounterSnapshotDetails = (
  note: string,
  channels: ChannelConfig[],
  addons: AddonConfig[],
): CounterSnapshotDetails => {
  if (!note) {
    return { freeSections: [], manualNote: '' };
  }

  const freeMap = extractFreeSnapshotMap(note);
  const addonNameById = new Map<number, string>();
  addons.forEach((addon) => addonNameById.set(addon.addonId, addon.name));
  const channelNameById = new Map<number, string>();
  channels.forEach((channel) => channelNameById.set(channel.id, channel.name ?? `Channel ${channel.id}`));

  const freeSections: CounterSnapshotFreeSection[] = [];

  freeMap.forEach((entry, channelId) => {
    const channelName = channelNameById.get(channelId) ?? `Channel ${channelId}`;
    const sectionEntries: CounterSnapshotFreeEntry[] = [];

    if (entry.people) {
      const qty = Math.max(0, Math.round(Number(entry.people.qty) || 0));
      const noteText = (entry.people.note ?? '').toString().trim();
      if (qty > 0 || noteText.length > 0) {
        sectionEntries.push({
          label: 'People',
          quantity: qty > 0 ? qty : null,
          reason: noteText.length > 0 ? noteText : null,
        });
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
        sectionEntries.push({
          label: addonName,
          quantity: qty > 0 ? qty : null,
          reason: noteText.length > 0 ? noteText : null,
        });
      });
    }

    if (sectionEntries.length > 0) {
      freeSections.push({
        channelLabel: channelName,
        entries: sectionEntries,
      });
    }
  });

  const manual = stripSnapshotFromNote(note);

  return {
    freeSections,
    manualNote: manual,
  };
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

type CounterListItemDisplay = {
  counter: Partial<Counter>;
  counterIdValue: number | null;
  dateLabel: string;
  managerDisplay: string;
  productLabel: string;
  rawNote: string;
  notePreview?: string;
  hasNote?: boolean;
};

type CounterListRowProps = {
  item: CounterListItemDisplay;
  isSelected: boolean;
  isExpanded: boolean;
  canModifyCounter: boolean;
  onSelect: (counter: Partial<Counter>) => void;
  onToggleExpand: (counterId: number | null) => void;
  onViewSummary: (counter: Partial<Counter>) => void;
  onOpenModal: (mode: 'create' | 'update') => void;
  onDeleteCounter: () => void;
  venueStatusForCounter: (counterId: number | null) => {
    label: string;
    color: 'primary' | 'success' | 'warning';
    mode: 'edit' | 'view';
  };
};

const CounterListRow = memo((props: CounterListRowProps) => {
  const {
    item,
    isSelected,
    isExpanded,
    canModifyCounter,
    onSelect,
    onToggleExpand,
    onViewSummary,
    onOpenModal,
    onDeleteCounter,
    venueStatusForCounter,
  } = props;
  const { counter, counterIdValue, dateLabel, managerDisplay, productLabel } = item;
  const notePreview = item.notePreview ?? '';
  const hasNote = item.hasNote ?? false;
  const venueStatus = venueStatusForCounter(counterIdValue);
  const { label: venueButtonLabel, color: venueButtonColor, mode: venueButtonMode } = venueStatus;
  const venueNumbersLink = (() => {
    if (counterIdValue == null) {
      return '/venueNumbers';
    }
    const params = new URLSearchParams();
    params.set('counterId', String(counterIdValue));
    if (venueButtonMode) {
      params.set('mode', venueButtonMode);
    }
    const query = params.toString();
    return `/venueNumbers${query ? `?${query}` : ''}`;
  })();
  const handleRowClick = () => {
    onSelect(counter);
    if (counterIdValue != null) {
      onToggleExpand(counterIdValue);
    }
  };
  const handleExpandClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    handleRowClick();
  };

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
                void onViewSummary(counter);
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
              onClick={() => onOpenModal('update')}
              disabled={!canModifyCounter}
            >
              Edit
            </Button>
            <Button
              variant="outlined"
              color="error"
              size="small"
              startIcon={<Delete />}
              onClick={onDeleteCounter}
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
});

const Counters = (props: GenericPageProps) => {
  const dispatch = useAppDispatch();
  const theme = useTheme();
  const isMobileScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const catalog = useAppSelector(selectCatalog);
  const registry = useAppSelector(selectCounterRegistry);
  const session = useAppSelector((state) => state.session);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const shiftRoleRecords = useMemo(() => catalog.shiftRoles ?? [], [catalog.shiftRoles]);
  const shiftRoleAssignments = useMemo(
    () => catalog.shiftRoleAssignments ?? [],
    [catalog.shiftRoleAssignments],
  );
  const scheduledStaffSnapshot = useMemo(() => catalog.scheduledStaff ?? null, [catalog.scheduledStaff]);
  const managerRoleIdSet = useMemo(() => {
    const managerIds = new Set<number>();
    shiftRoleRecords.forEach((role) => {
      const slug = role.slug?.toLowerCase();
      const name = role.name?.toLowerCase();
      if (slug === 'manager' || name === 'manager') {
        managerIds.add(role.id);
      }
    });
    return managerIds;
  }, [shiftRoleRecords]);
  const staffRoleIdSet = useMemo(() => {
    const staffIds = new Set<number>();
    shiftRoleRecords.forEach((role) => {
      const slug = role.slug?.toLowerCase();
      const name = role.name?.toLowerCase();
      if (slug === 'guide' || name === 'guide' || slug === 'manager' || name === 'manager') {
        staffIds.add(role.id);
      }
    });
    return staffIds;
  }, [shiftRoleRecords]);
  const managerUserIdSet = useMemo(() => {
    if (managerRoleIdSet.size === 0) {
      return new Set<number>();
    }
    const users = new Set<number>();
    shiftRoleAssignments.forEach((assignment) => {
      if (assignment.roleIds?.some((roleId) => managerRoleIdSet.has(roleId))) {
        users.add(assignment.userId);
      }
    });
    return users;
  }, [managerRoleIdSet, shiftRoleAssignments]);
  const staffUserIdSet = useMemo(() => {
    if (staffRoleIdSet.size === 0) {
      return new Set<number>();
    }
    const users = new Set<number>();
    shiftRoleAssignments.forEach((assignment) => {
      if (assignment.roleIds?.some((roleId) => staffRoleIdSet.has(roleId))) {
        users.add(assignment.userId);
      }
    });
    return users;
  }, [shiftRoleAssignments, staffRoleIdSet]);
  const loggedUserId = session.loggedUserId ?? null;
  const loggedUserIsManager = useMemo(() => {
    if (loggedUserId == null) {
      return false;
    }
    if (managerUserIdSet.size > 0) {
      return managerUserIdSet.has(loggedUserId);
    }
    if (catalog.loaded) {
      return catalog.managers.some((manager) => manager.id === loggedUserId);
    }
    return false;
  }, [catalog.loaded, catalog.managers, loggedUserId, managerUserIdSet]);
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
  const [selectedDate, setSelectedDate] = useState<Dayjs>(dayjs());
  const [selectedManagerId, setSelectedManagerId] = useState<number | null>(null);
  const resolvedManagerId = useMemo(
    () => selectedManagerId ?? (loggedUserIsManager ? loggedUserId : null),
    [loggedUserId, loggedUserIsManager, selectedManagerId],
  );
  const [counterList, setCounterList] = useState<Partial<Counter>[]>([]);
  const [counterListLoading, setCounterListLoading] = useState(false);
  const [counterListError, setCounterListError] = useState<string | null>(null);
  const [counterPage, setCounterPage] = useState(1);
  const [counterPageSize, setCounterPageSize] = useState(10);
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
  const scheduledStaffRequestRef = useRef<string | null>(null);
  const nightReportsRequestedRef = useRef(false);
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
  const [scheduledStaffLoading, setScheduledStaffLoading] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerReady, setScannerReady] = useState(false);
  const [scannerTextLoading, setScannerTextLoading] = useState(false);
  const [scannerCaptureLoading, setScannerCaptureLoading] = useState(false);
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [scannerResult, setScannerResult] = useState<ScannerResultRecord | null>(null);
  const [scannerLookupLoading, setScannerLookupLoading] = useState(false);
  const [scannerLookupError, setScannerLookupError] = useState<string | null>(null);
  const [scannerBookingMatch, setScannerBookingMatch] = useState<ScannerBookingMatch | null>(null);
  const [scannerCheckInNotice, setScannerCheckInNotice] = useState<string | null>(null);
  const scannerVideoRef = useRef<HTMLVideoElement | null>(null);
  const scannerStreamRef = useRef<MediaStream | null>(null);
  const scannerControlsRef = useRef<IScannerControls | null>(null);
  const scannerReaderRef = useRef<BrowserMultiFormatReader | null>(null);
  const scannerCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const scannerLastSignatureRef = useRef<string>('');
  const scannerLastScanAtRef = useRef<number>(0);
  const scannerLookupRequestRef = useRef<string | null>(null);
  const scannerFallbackTimerRef = useRef<number | null>(null);
  const scannerFallbackBusyRef = useRef(false);
  const scannerNativeDetectorRef = useRef<NativeBarcodeDetectorInstance | null>(null);
  const scannerNativeTimerRef = useRef<number | null>(null);
  const scannerNativeBusyRef = useRef(false);
  const blurActiveElement = useCallback(() => {
    if (typeof document === 'undefined') {
      return;
    }
    const active = document.activeElement;
    if (active instanceof HTMLElement) {
      active.blur();
    }
  }, []);
  const stopScannerDecoding = useCallback(() => {
    if (scannerNativeTimerRef.current != null && typeof window !== 'undefined') {
      window.clearInterval(scannerNativeTimerRef.current);
      scannerNativeTimerRef.current = null;
    }
    scannerNativeBusyRef.current = false;
    scannerNativeDetectorRef.current = null;
    if (scannerFallbackTimerRef.current != null && typeof window !== 'undefined') {
      window.clearInterval(scannerFallbackTimerRef.current);
      scannerFallbackTimerRef.current = null;
    }
    scannerFallbackBusyRef.current = false;
    if (scannerControlsRef.current) {
      scannerControlsRef.current.stop();
      scannerControlsRef.current = null;
    }
    if (scannerReaderRef.current) {
      scannerReaderRef.current = null;
    }
  }, []);
  const registerScannerResult = useCallback(
    (
      rawValue: string,
      options: {
        source: ScannerSource;
        format?: string;
        confidence?: number;
      },
    ) => {
      const normalized = normalizeScannerText(rawValue);
      if (!normalized) {
        return;
      }

      const now = Date.now();
      const signature = `${options.source}|${(options.format ?? '').toLowerCase()}|${normalized.toLowerCase()}`;
      if (
        scannerLastSignatureRef.current === signature &&
        now - scannerLastScanAtRef.current < SCANNER_RESULT_COOLDOWN_MS
      ) {
        return;
      }

      scannerLastSignatureRef.current = signature;
      scannerLastScanAtRef.current = now;

      const formatLower = (options.format ?? '').toLowerCase();
      const isQrFormat = formatLower.includes('qr');
      const kind: ScannerResultKind =
        options.source === 'ocr' ? 'text' : isQrFormat || /^https?:\/\//i.test(normalized) ? 'qr' : 'barcode';

      setScannerCheckInNotice(null);
      setScannerLookupError(null);
      setScannerBookingMatch(null);
      setScannerResult({
        kind,
        source: options.source,
        rawValue: normalized,
        bookingId: extractBookingId(normalized),
        format: options.format,
        confidence: options.confidence,
        scannedAt: dayjs().format('YYYY-MM-DD HH:mm:ss'),
      });
    },
    [],
  );
  const stopScannerStream = useCallback(() => {
    stopScannerDecoding();
    const currentStream = scannerStreamRef.current;
    if (currentStream) {
      currentStream.getTracks().forEach((track) => track.stop());
      scannerStreamRef.current = null;
    }
    if (scannerVideoRef.current) {
      scannerVideoRef.current.srcObject = null;
    }
    setScannerReady(false);
  }, [stopScannerDecoding]);
  const handleScanTextCapture = useCallback(async () => {
    if (scannerTextLoading) {
      return;
    }

    const videoElement = scannerVideoRef.current;
    if (!videoElement || videoElement.videoWidth <= 0 || videoElement.videoHeight <= 0) {
      setScannerError('Camera frame is not ready yet.');
      return;
    }

    let captureCanvas = scannerCanvasRef.current;
    if (!captureCanvas) {
      captureCanvas = document.createElement('canvas');
      scannerCanvasRef.current = captureCanvas;
    }
    const maxWidth = 1400;
    const scale = videoElement.videoWidth > maxWidth ? maxWidth / videoElement.videoWidth : 1;
    const targetWidth = Math.max(1, Math.round(videoElement.videoWidth * scale));
    const targetHeight = Math.max(1, Math.round(videoElement.videoHeight * scale));
    captureCanvas.width = targetWidth;
    captureCanvas.height = targetHeight;
    const context = captureCanvas.getContext('2d');
    if (!context) {
      setScannerError('Unable to capture a frame for OCR.');
      return;
    }
    context.drawImage(videoElement, 0, 0, targetWidth, targetHeight);

    setScannerError(null);
    setScannerTextLoading(true);
    try {
      const tesseractModule = await import('tesseract.js');
      const recognizeFn =
        (tesseractModule as unknown as { recognize?: (image: unknown, lang?: string) => Promise<unknown> })
          .recognize ??
        (
          tesseractModule as unknown as {
            default?: { recognize?: (image: unknown, lang?: string) => Promise<unknown> };
          }
        ).default?.recognize;
      if (!recognizeFn) {
        throw new Error('Text recognizer is unavailable.');
      }

      const recognition = (await recognizeFn(captureCanvas, 'eng')) as {
        data?: { text?: string; confidence?: number };
      };
      const ocrText = normalizeScannerText(recognition?.data?.text ?? '');
      if (!ocrText) {
        setScannerError('No readable text detected. Try moving closer and improving lighting.');
        return;
      }
      registerScannerResult(ocrText, {
        source: 'ocr',
        confidence: recognition?.data?.confidence,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Text scan failed. Check camera focus and try again.';
      setScannerError(message);
    } finally {
      setScannerTextLoading(false);
    }
  }, [registerScannerResult, scannerTextLoading]);
  const handleCaptureFrameScan = useCallback(async () => {
    if (scannerCaptureLoading || scannerTextLoading) {
      return;
    }

    const videoElement = scannerVideoRef.current;
    if (!videoElement || videoElement.videoWidth <= 0 || videoElement.videoHeight <= 0) {
      setScannerError('Camera frame is not ready yet.');
      return;
    }

    const createCanvas = (width: number, height: number): HTMLCanvasElement => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(width));
      canvas.height = Math.max(1, Math.round(height));
      return canvas;
    };

    setScannerCaptureLoading(true);
    setScannerError(null);
    setScannerLookupError(null);
    setScannerCheckInNotice(null);

    try {
      // Yield one frame so loading UI renders before heavy decode work starts.
      await new Promise<void>((resolve) => {
        if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
          window.requestAnimationFrame(() => resolve());
          return;
        }
        setTimeout(() => resolve(), 0);
      });

      const [{ BrowserMultiFormatReader }, zxingLibrary] = await Promise.all([
        import('@zxing/browser'),
        import('@zxing/library'),
      ]);
      const {
        BarcodeFormat,
        ChecksumException,
        DecodeHintType,
        FormatException,
        NotFoundException,
      } = zxingLibrary;

      const targetMaxWidth = 1920;
      const scale = videoElement.videoWidth > targetMaxWidth ? targetMaxWidth / videoElement.videoWidth : 1;
      const sourceWidth = Math.max(1, Math.round(videoElement.videoWidth * scale));
      const sourceHeight = Math.max(1, Math.round(videoElement.videoHeight * scale));
      const sourceCanvas = createCanvas(sourceWidth, sourceHeight);
      const sourceContext = sourceCanvas.getContext('2d');
      if (!sourceContext) {
        setScannerError('Unable to capture frame.');
        return;
      }
      sourceContext.drawImage(videoElement, 0, 0, sourceWidth, sourceHeight);

      const buildGrayVariant = (base: HTMLCanvasElement, thresholdMode: boolean): HTMLCanvasElement => {
        const variant = createCanvas(base.width, base.height);
        const variantContext = variant.getContext('2d');
        if (!variantContext) {
          return base;
        }
        variantContext.drawImage(base, 0, 0);
        const image = variantContext.getImageData(0, 0, variant.width, variant.height);
        const data = image.data;
        const threshold = 145;
        for (let index = 0; index < data.length; index += 4) {
          const gray = 0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2];
          const contrast = Math.max(0, Math.min(255, (gray - 128) * 2.25 + 128));
          const finalValue = thresholdMode ? (contrast > threshold ? 255 : 0) : contrast;
          data[index] = finalValue;
          data[index + 1] = finalValue;
          data[index + 2] = finalValue;
        }
        variantContext.putImageData(image, 0, 0);
        return variant;
      };

      const variants: HTMLCanvasElement[] = [
        sourceCanvas,
        buildGrayVariant(sourceCanvas, false),
        buildGrayVariant(sourceCanvas, true),
      ];

      const cropFactorList = [1, 0.85, 0.65];
      const cropRects = cropFactorList.map((factor) => {
        const width = Math.max(1, Math.round(sourceWidth * factor));
        const height = Math.max(1, Math.round(sourceHeight * factor));
        return {
          x: Math.max(0, Math.round((sourceWidth - width) / 2)),
          y: Math.max(0, Math.round((sourceHeight - height) / 2)),
          width,
          height,
        };
      });

      const hints = new Map();
      hints.set(DecodeHintType.TRY_HARDER, true);
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [
        BarcodeFormat.QR_CODE,
        BarcodeFormat.CODE_128,
        BarcodeFormat.CODE_39,
        BarcodeFormat.CODE_93,
        BarcodeFormat.CODABAR,
        BarcodeFormat.EAN_13,
        BarcodeFormat.EAN_8,
        BarcodeFormat.ITF,
        BarcodeFormat.UPC_A,
        BarcodeFormat.UPC_E,
        BarcodeFormat.PDF_417,
        BarcodeFormat.DATA_MATRIX,
        BarcodeFormat.AZTEC,
      ]);
      const manualReader = new BrowserMultiFormatReader(hints, {
        delayBetweenScanAttempts: 0,
        delayBetweenScanSuccess: 0,
      });

      const nativeBarcodeDetectorCtor = (
        globalThis as unknown as {
          BarcodeDetector?: NativeBarcodeDetectorCtor;
        }
      ).BarcodeDetector;
      let nativeDetector = scannerNativeDetectorRef.current;
      if (!nativeDetector && nativeBarcodeDetectorCtor) {
        try {
          let candidateFormats = NATIVE_BARCODE_FORMATS;
          if (typeof nativeBarcodeDetectorCtor.getSupportedFormats === 'function') {
            const supported = await nativeBarcodeDetectorCtor.getSupportedFormats();
            if (Array.isArray(supported) && supported.length > 0) {
              const supportedSet = new Set(supported.map((entry) => entry.toLowerCase()));
              const filtered = NATIVE_BARCODE_FORMATS.filter((format) => supportedSet.has(format));
              candidateFormats = filtered.length > 0 ? filtered : supported;
            }
          }
          nativeDetector = new nativeBarcodeDetectorCtor({ formats: candidateFormats });
          scannerNativeDetectorRef.current = nativeDetector;
        } catch {
          nativeDetector = null;
        }
      }

      const isExpectedDecodeError = (error: unknown): boolean =>
        error instanceof NotFoundException ||
        error instanceof ChecksumException ||
        error instanceof FormatException;

      const workCanvas = createCanvas(sourceWidth, sourceHeight);
      const workContext = workCanvas.getContext('2d');
      if (!workContext) {
        setScannerError('Unable to prepare frame processing.');
        return;
      }

      const tryRegister = (
        rawValue: string,
        format?: string,
        source: ScannerSource = 'live',
        confidence?: number,
      ): boolean => {
        const normalized = normalizeScannerText(rawValue);
        if (!normalized) {
          return false;
        }
        registerScannerResult(normalized, { source, format, confidence });
        return true;
      };

      const rotations = [0, 90, 180, 270];
      let iterationCounter = 0;
      for (const variant of variants) {
        for (const crop of cropRects) {
          for (const angle of rotations) {
            iterationCounter += 1;
            if (iterationCounter % 4 === 0) {
              // Periodically yield so spinner/progress can repaint.
              await new Promise<void>((resolve) => setTimeout(() => resolve(), 0));
            }
            const targetWidth = angle % 180 === 0 ? crop.width : crop.height;
            const targetHeight = angle % 180 === 0 ? crop.height : crop.width;
            workCanvas.width = targetWidth;
            workCanvas.height = targetHeight;
            workContext.save();
            workContext.clearRect(0, 0, targetWidth, targetHeight);
            workContext.translate(targetWidth / 2, targetHeight / 2);
            workContext.rotate((angle * Math.PI) / 180);
            workContext.drawImage(
              variant,
              crop.x,
              crop.y,
              crop.width,
              crop.height,
              -crop.width / 2,
              -crop.height / 2,
              crop.width,
              crop.height,
            );
            workContext.restore();

            if (nativeDetector) {
              try {
                const detected = await nativeDetector.detect(workCanvas);
                const nativeHit = detected.find(
                  (entry) => typeof entry?.rawValue === 'string' && entry.rawValue.trim().length > 0,
                );
                if (nativeHit?.rawValue && tryRegister(nativeHit.rawValue, nativeHit.format ?? 'native-capture')) {
                  return;
                }
              } catch {
                // Continue with ZXing fallback path.
              }
            }

            try {
              const result = manualReader.decodeFromCanvas(workCanvas);
              if (result && tryRegister(result.getText(), result.getBarcodeFormat().toString())) {
                return;
              }
            } catch (decodeError) {
              if (!isExpectedDecodeError(decodeError)) {
                const message =
                  decodeError instanceof Error
                    ? decodeError.message
                    : 'Capture frame decode failed.';
                setScannerError(message);
              }
            }
          }
        }
      }

      const runOcrFallback = async (): Promise<boolean> => {
        const tesseractModule = await import('tesseract.js');
        const recognizeFn =
          (tesseractModule as unknown as { recognize?: (image: unknown, lang?: string) => Promise<unknown> })
            .recognize ??
          (
            tesseractModule as unknown as {
              default?: { recognize?: (image: unknown, lang?: string) => Promise<unknown> };
            }
          ).default?.recognize;
        if (!recognizeFn) {
          return false;
        }

        const labelRects = [
          {
            x: Math.max(0, Math.round(sourceWidth * 0.05)),
            y: Math.max(0, Math.round(sourceHeight * 0.50)),
            width: Math.max(1, Math.round(sourceWidth * 0.90)),
            height: Math.max(1, Math.round(sourceHeight * 0.45)),
          },
          {
            x: 0,
            y: Math.max(0, Math.round(sourceHeight * 0.58)),
            width: sourceWidth,
            height: Math.max(1, Math.round(sourceHeight * 0.40)),
          },
          {
            x: 0,
            y: 0,
            width: sourceWidth,
            height: sourceHeight,
          },
        ];

        let ocrIteration = 0;
        for (const rect of labelRects) {
          const cropped = createCanvas(rect.width, rect.height);
          const croppedContext = cropped.getContext('2d');
          if (!croppedContext) {
            continue;
          }
          croppedContext.drawImage(
            sourceCanvas,
            rect.x,
            rect.y,
            rect.width,
            rect.height,
            0,
            0,
            rect.width,
            rect.height,
          );

          const ocrVariants = [cropped, buildGrayVariant(cropped, false), buildGrayVariant(cropped, true)];
          for (const ocrVariant of ocrVariants) {
            ocrIteration += 1;
            if (ocrIteration % 2 === 0) {
              await new Promise<void>((resolve) => setTimeout(() => resolve(), 0));
            }
            const recognition = (await recognizeFn(ocrVariant, 'eng')) as {
              data?: { text?: string; confidence?: number };
            };
            const ocrText = normalizeScannerText(recognition?.data?.text ?? '');
            if (!ocrText) {
              continue;
            }
            const candidates = buildScannerOcrCandidates(ocrText);
            for (const candidate of candidates) {
              if (tryRegister(candidate, 'ocr-capture', 'ocr', recognition?.data?.confidence)) {
                return true;
              }
            }
          }
        }

        return false;
      };

      try {
        const matchedByOcr = await runOcrFallback();
        if (matchedByOcr) {
          return;
        }
      } catch {
        // OCR fallback is best-effort; keep final decode error message if it also fails.
      }

      setScannerError(
        'Could not decode this frame. Try moving closer, improving light, and tapping Capture Frame again.',
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unable to run capture frame scanner.';
      setScannerError(message);
    } finally {
      setScannerCaptureLoading(false);
    }
  }, [registerScannerResult, scannerCaptureLoading, scannerTextLoading]);
  const handleScannerCheckIn = useCallback(() => {
    if (!scannerBookingMatch) {
      return;
    }
    setScannerCheckInNotice(
      `Checked in ${scannerBookingMatch.order.customerName} (${scannerBookingMatch.order.platformBookingId}).`,
    );
    setScannerLookupError(null);
    setScannerBookingMatch(null);
    setScannerResult(null);
    scannerLookupRequestRef.current = null;
  }, [scannerBookingMatch]);
  const computeReservationHoldActive = useCallback(() => {
    const now = dayjs();
    const holdStart = now.set('hour', 21).set('minute', 0).set('second', 0).set('millisecond', 0);
    const holdEnd = holdStart.add(15, 'minute');
    return !now.isBefore(holdStart) && now.isBefore(holdEnd);
  }, []);
  const [reservationHoldActive, setReservationHoldActive] = useState<boolean>(() => computeReservationHoldActive());

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const intervalId = window.setInterval(() => {
      setReservationHoldActive(computeReservationHoldActive());
    }, 15_000);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [computeReservationHoldActive]);

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
        return { label: 'Numbers (No Report)', color: 'primary' as const, mode: 'edit' as const };
      }
      const summary = nightReportSummaries.find((report) => report.counterId === counterIdValue);
      if (!summary) {
        return { label: 'Venue Numbers (No Report)', color: 'primary' as const, mode: 'edit' as const };
      }
      if (summary.status === 'submitted') {
        return {
          label: 'Venue Numbers (Submitted)',
          color: 'success' as const,
          mode: 'view' as const,
        };
      }
      if (summary.status === 'draft') {
        return {
          label: 'Venue Numbers (Draft)',
          color: 'warning' as const,
          mode: 'edit' as const,
        };
      }
      return { label: 'Venue Numbers (No Report)', color: 'primary' as const, mode: 'edit' as const };
    },
    [nightReportSummaries],
  );
  const toggleCounterExpansion = useCallback((counterIdValue: number | null) => {
    setExpandedCounterId((prev) => (counterIdValue == null ? null : prev === counterIdValue ? null : counterIdValue));
  }, []);

  const currentProductId = pendingProductId ?? counterProductId ?? null;
  const selectedDateString = selectedDate.format(COUNTER_DATE_FORMAT);

  const isFinal = counterStatus === 'final';
  const allCatalogUsers = useMemo(() => {
    if (catalog.users && catalog.users.length > 0) {
      return catalog.users;
    }
    const map = new Map<number, StaffOption>();
    catalog.managers.forEach((user) => map.set(user.id, user));
    catalog.staff.forEach((user) => map.set(user.id, user));
    return Array.from(map.values());
  }, [catalog.managers, catalog.staff, catalog.users]);
  const managerOptions = useMemo(() => {
    const map = new Map<number, StaffOption>();
    const canFilterByShiftRole = shiftRoleAssignments.length > 0 && managerRoleIdSet.size > 0;
    if (canFilterByShiftRole) {
      shiftRoleAssignments.forEach((assignment) => {
        if (!assignment.roleIds?.some((roleId) => managerRoleIdSet.has(roleId))) {
          return;
        }
        const fullName = composeName(assignment.firstName, assignment.lastName);
        map.set(assignment.userId, {
          id: assignment.userId,
          firstName: assignment.firstName ?? null,
          lastName: assignment.lastName ?? null,
          fullName: fullName || `Manager #${assignment.userId}`,
          userTypeSlug: null,
          userTypeName: null,
        });
      });
      allCatalogUsers.forEach((user) => {
        if (managerUserIdSet.has(user.id)) {
          map.set(user.id, user);
        }
      });
    } else {
      catalog.managers.forEach((manager) => map.set(manager.id, manager));
    }
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
  }, [
    allCatalogUsers,
    catalog.managers,
    registry.counter,
    managerRoleIdSet,
    managerUserIdSet,
    shiftRoleAssignments,
  ]);
  const managerOptionById = useMemo(() => {
    const map = new Map<number, StaffOption>();
    managerOptions.forEach((option) => {
      map.set(option.id, option);
    });
    return map;
  }, [managerOptions]);
  const counterListDisplayData = useMemo(
    () =>
      counterList.map((counter) => {
        const counterIdValue = counter.id ?? null;
        const counterDate = counter.date ? dayjs(counter.date) : null;
        const dateLabel = counterDate?.isValid()
          ? counterDate.format('dddd, MMM D, YYYY')
          : 'Unknown date';
        const managerNameFromPayload = counter.manager
          ? composeName(counter.manager.firstName, counter.manager.lastName)
          : '';
        const managerLookup = counter.userId ? managerOptionById.get(counter.userId) : undefined;
        const managerDisplay =
          managerNameFromPayload ||
          (managerLookup ? buildDisplayName(managerLookup) : '');

        const productDisplay =
          counter.product && counter.product.name ? counter.product.name : '';
        const productLabel = productDisplay || 'Old Product Version - Pub Crawl';
        const rawNote = typeof counter.notes === 'string' ? counter.notes : '';

        return {
          counter,
          counterIdValue,
          dateLabel,
          managerDisplay,
          productLabel,
          rawNote,
        };
      }),
    [counterList, managerOptionById],
  );
  const totalCounters = counterListDisplayData.length;
  const totalPages = Math.max(1, Math.ceil(totalCounters / counterPageSize));
  const pagedCounterList = useMemo(() => {
    const startIndex = (counterPage - 1) * counterPageSize;
    return counterListDisplayData.slice(startIndex, startIndex + counterPageSize);
  }, [counterListDisplayData, counterPage, counterPageSize]);
  const pagedCounterDisplayData = useMemo(
    () =>
      pagedCounterList.map((item) => {
        const notePreview = formatCounterNotePreview(item.rawNote, registry.channels, combinedAddonList);
        return {
          ...item,
          notePreview,
          hasNote: notePreview.trim().length > 0,
        };
      }),
    [combinedAddonList, pagedCounterList, registry.channels],
  );

  useEffect(() => {
    if (counterPage > totalPages) {
      setCounterPage(totalPages);
    }
  }, [counterPage, totalPages]);

  useEffect(() => {
    if (selectedCounterId == null) {
      return;
    }
    const selectedIndex = counterListDisplayData.findIndex(
      (item) => item.counterIdValue === selectedCounterId,
    );
    if (selectedIndex < 0) {
      return;
    }
    const desiredPage = Math.floor(selectedIndex / counterPageSize) + 1;
    if (desiredPage !== counterPage) {
      setCounterPage(desiredPage);
    }
  }, [counterListDisplayData, counterPage, counterPageSize, selectedCounterId]);

  useEffect(() => {
    if (registry.counter) {
      return;
    }
    if (selectedManagerId != null) {
      return;
    }
    if (shouldPrefillManagerRef.current) {
      return;
    }
    if (!loggedUserIsManager || loggedUserId == null) {
      return;
    }
    setSelectedManagerId(loggedUserId);
  }, [loggedUserId, loggedUserIsManager, registry.counter, selectedManagerId]);

  const counterStaffIds = useMemo(
    () => (registry.counter ? registry.counter.staff.map((member) => member.userId) : []),
    [registry.counter],
  );

  const applyScheduledStaffPayload = useCallback(
    (payload: { userIds?: number[]; managerIds?: number[] }) => {
      const userIds = Array.isArray(payload.userIds) ? payload.userIds : [];
      const managerIds = Array.isArray(payload.managerIds) ? payload.managerIds : [];
      const shouldPrefill =
        !pendingStaffDirty &&
        pendingStaffIds.length === 0 &&
        counterStaffIds.length === 0 &&
        userIds.length > 0;
      if (shouldPrefill) {
        setPendingStaffIds(userIds);
        setPendingStaffDirty(true);
      }
      if (shouldPrefillManagerRef.current) {
        if (managerIds.length > 0) {
          setSelectedManagerId(managerIds[0]);
        } else if (userIds.length > 0) {
          setSelectedManagerId(userIds[0]);
        } else {
          setSelectedManagerId(null);
        }
        shouldPrefillManagerRef.current = false;
      }
    },
    [counterStaffIds.length, pendingStaffDirty, pendingStaffIds.length],
  );

  useEffect(() => {
    if (!isModalOpen || activeRegistryStep !== 'details') {
      return;
    }
    if (!currentProductId) {
      return;
    }
    if (pendingStaffDirty || pendingStaffIds.length > 0 || counterStaffIds.length > 0) {
      return;
    }
    const dateString = selectedDate.format(COUNTER_DATE_FORMAT);
    const requestKey = `${dateString}|${currentProductId}`;
    if (scheduledStaffRequestRef.current === requestKey) {
      return;
    }
    if (
      scheduledStaffSnapshot &&
      scheduledStaffSnapshot.date === dateString &&
      scheduledStaffSnapshot.productId === currentProductId
    ) {
      scheduledStaffRequestRef.current = requestKey;
      applyScheduledStaffPayload(scheduledStaffSnapshot);
      return;
    }
    scheduledStaffRequestRef.current = requestKey;
    setScheduledStaffLoading(true);
    fetchScheduledStaffForProduct({ date: dateString, productId: currentProductId })
      .then((payload) => {
        applyScheduledStaffPayload(payload);
      })
      .finally(() => {
        setScheduledStaffLoading(false);
      });
  }, [
    applyScheduledStaffPayload,
    counterStaffIds.length,
    currentProductId,
    isModalOpen,
    activeRegistryStep,
    pendingStaffDirty,
    pendingStaffIds.length,
    scheduledStaffSnapshot,
    selectedDate,
  ]);

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

  useEffect(() => {
    if (!isModalOpen) {
      manifestAppliedRef.current = null;
      manifestRequestRef.current = null;
    }
  }, [isModalOpen]);

  useEffect(() => {
    if (!isModalOpen || activeRegistryStep !== 'reservations') {
      setScannerOpen(false);
    }
  }, [activeRegistryStep, isModalOpen]);

  useEffect(() => {
    if (!scannerOpen) {
      setScannerError(null);
      setScannerTextLoading(false);
      setScannerCaptureLoading(false);
      setScannerLookupLoading(false);
      setScannerLookupError(null);
      setScannerBookingMatch(null);
      setScannerCheckInNotice(null);
      scannerLookupRequestRef.current = null;
      stopScannerStream();
      return;
    }

    if (scannerBookingMatch) {
      stopScannerStream();
      return;
    }

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setScannerError('Camera access is not supported in this browser.');
      return;
    }

    let isActive = true;
    const initializeScanner = async () => {
      setScannerError(null);
      setScannerResult(null);
      setScannerLookupError(null);
      setScannerBookingMatch(null);
      scannerLookupRequestRef.current = null;
      scannerLastSignatureRef.current = '';
      scannerLastScanAtRef.current = 0;
      const enhanceVideoTrack = async (stream: MediaStream) => {
        const track = stream.getVideoTracks()[0];
        if (!track || typeof track.applyConstraints !== 'function') {
          return;
        }
        const capabilities = (
          track as MediaStreamTrack & {
            getCapabilities?: () => Record<string, unknown>;
          }
        ).getCapabilities?.();
        if (!capabilities) {
          return;
        }
        const rawCapabilities = capabilities as unknown as Record<string, unknown>;

        const advancedConstraints: Record<string, unknown>[] = [];
        const focusModes = Array.isArray(rawCapabilities.focusMode)
          ? (rawCapabilities.focusMode as string[])
          : [];
        if (focusModes.includes('continuous')) {
          advancedConstraints.push({ focusMode: 'continuous' });
        }

        const exposureModes = Array.isArray(rawCapabilities.exposureMode)
          ? (rawCapabilities.exposureMode as string[])
          : [];
        if (exposureModes.includes('continuous')) {
          advancedConstraints.push({ exposureMode: 'continuous' });
        }

        const zoomCapabilities = rawCapabilities.zoom as { min?: number; max?: number } | undefined;
        if (
          zoomCapabilities &&
          typeof zoomCapabilities.max === 'number' &&
          Number.isFinite(zoomCapabilities.max) &&
          zoomCapabilities.max > 1
        ) {
          const zoomTarget = Math.min(zoomCapabilities.max, 2);
          advancedConstraints.push({ zoom: zoomTarget });
        }

        if (advancedConstraints.length === 0) {
          return;
        }
        try {
          await track.applyConstraints({ advanced: advancedConstraints as MediaTrackConstraintSet[] });
        } catch {
          // Ignore capabilities that are not fully supported by the current browser/device.
        }
      };
      try {
        const preferredStream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            frameRate: { ideal: 60, min: 24 },
          },
          audio: false,
        });
        if (!isActive) {
          preferredStream.getTracks().forEach((track) => track.stop());
          return;
        }
        await enhanceVideoTrack(preferredStream);
        scannerStreamRef.current = preferredStream;
      } catch (_error) {
        try {
          const fallbackStream = await navigator.mediaDevices.getUserMedia({
            video: {
              width: { ideal: 1280 },
              height: { ideal: 720 },
              frameRate: { ideal: 30, min: 20 },
            },
            audio: false,
          });
          if (!isActive) {
            fallbackStream.getTracks().forEach((track) => track.stop());
            return;
          }
          await enhanceVideoTrack(fallbackStream);
          scannerStreamRef.current = fallbackStream;
        } catch (innerError) {
          setScannerError(
            innerError instanceof Error
              ? innerError.message
              : 'Unable to access the camera. Check permissions and try again.',
          );
          return;
        }
      }

      if (!scannerVideoRef.current || !scannerStreamRef.current) {
        return;
      }

      scannerVideoRef.current.srcObject = scannerStreamRef.current;
      try {
        await scannerVideoRef.current.play();
      } catch (_error) {
        // Some browsers defer playback until user interaction.
      }
      setScannerReady(true);
    };

    void initializeScanner();

    return () => {
      isActive = false;
      stopScannerStream();
    };
  }, [scannerBookingMatch, scannerOpen, stopScannerStream]);

  useEffect(() => {
    if (!scannerOpen || scannerBookingMatch != null || !scannerReady || !scannerVideoRef.current) {
      stopScannerDecoding();
      return;
    }

    let cancelled = false;

    const startBarcodeDecode = async () => {
      try {
        const [{ BrowserMultiFormatReader }, zxingLibrary] = await Promise.all([
          import('@zxing/browser'),
          import('@zxing/library'),
        ]);
        if (cancelled || !scannerVideoRef.current) {
          return;
        }

        const {
          BarcodeFormat,
          ChecksumException,
          DecodeHintType,
          FormatException,
          NotFoundException,
        } = zxingLibrary;
        const hints = new Map();
        hints.set(DecodeHintType.TRY_HARDER, true);
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [
          BarcodeFormat.QR_CODE,
          BarcodeFormat.CODE_128,
          BarcodeFormat.CODE_39,
          BarcodeFormat.CODE_93,
          BarcodeFormat.CODABAR,
          BarcodeFormat.EAN_13,
          BarcodeFormat.EAN_8,
          BarcodeFormat.ITF,
          BarcodeFormat.UPC_A,
          BarcodeFormat.UPC_E,
          BarcodeFormat.PDF_417,
          BarcodeFormat.DATA_MATRIX,
          BarcodeFormat.AZTEC,
        ]);
        const reader = new BrowserMultiFormatReader(hints, {
          delayBetweenScanAttempts: 30,
          delayBetweenScanSuccess: 180,
        });
        scannerReaderRef.current = reader;

        const isExpectedDecodeError = (error: unknown): boolean =>
          error instanceof NotFoundException ||
          error instanceof ChecksumException ||
          error instanceof FormatException;

        const controls = await reader.decodeFromVideoElement(
          scannerVideoRef.current,
          (result: ZXingResult | undefined, error: ZXingException | undefined) => {
            if (cancelled) {
              return;
            }
            if (result) {
              const formatName = result.getBarcodeFormat().toString();
              registerScannerResult(result.getText(), {
                source: 'live',
                format: formatName,
              });
              return;
            }
            if (!error) {
              return;
            }
            if (isExpectedDecodeError(error)) {
              return;
            }
            const message = error instanceof Error ? error.message : 'Scanner decode failed.';
            setScannerError(message);
          },
        );

        if (cancelled) {
          controls.stop();
          return;
        }
        scannerControlsRef.current = controls;

        const nativeBarcodeDetectorCtor = (
          globalThis as unknown as {
            BarcodeDetector?: NativeBarcodeDetectorCtor;
          }
        ).BarcodeDetector;

        if (typeof window !== 'undefined' && nativeBarcodeDetectorCtor) {
          try {
            let candidateFormats = NATIVE_BARCODE_FORMATS;
            if (typeof nativeBarcodeDetectorCtor.getSupportedFormats === 'function') {
              const supported = await nativeBarcodeDetectorCtor.getSupportedFormats();
              if (Array.isArray(supported) && supported.length > 0) {
                const supportedSet = new Set(supported.map((entry) => entry.toLowerCase()));
                const filtered = NATIVE_BARCODE_FORMATS.filter((format) => supportedSet.has(format));
                candidateFormats = filtered.length > 0 ? filtered : supported;
              }
            }

            const nativeDetector = new nativeBarcodeDetectorCtor({ formats: candidateFormats });
            scannerNativeDetectorRef.current = nativeDetector;

            scannerNativeTimerRef.current = window.setInterval(async () => {
              if (
                scannerNativeBusyRef.current ||
                cancelled ||
                scannerBookingMatch != null ||
                scannerTextLoading ||
                scannerCaptureLoading
              ) {
                return;
              }
              const videoElement = scannerVideoRef.current;
              if (!videoElement || videoElement.videoWidth <= 0 || videoElement.videoHeight <= 0) {
                return;
              }
              scannerNativeBusyRef.current = true;
              try {
                const detected = await nativeDetector.detect(videoElement);
                if (!detected || detected.length === 0) {
                  return;
                }
                const firstValid = detected.find(
                  (entry) => typeof entry?.rawValue === 'string' && entry.rawValue.trim().length > 0,
                );
                if (!firstValid?.rawValue) {
                  return;
                }
                registerScannerResult(firstValid.rawValue, {
                  source: 'live',
                  format: firstValid.format ?? 'native',
                });
              } catch {
                // Ignore detector-level errors and keep ZXing/fallback active.
              } finally {
                scannerNativeBusyRef.current = false;
              }
            }, 90);
          } catch {
            scannerNativeDetectorRef.current = null;
          }
        }

        if (typeof window !== 'undefined') {
          scannerFallbackTimerRef.current = window.setInterval(() => {
            if (
              scannerFallbackBusyRef.current ||
              cancelled ||
              scannerBookingMatch != null ||
              scannerTextLoading ||
              scannerCaptureLoading
            ) {
              return;
            }
            const videoElement = scannerVideoRef.current;
            if (!videoElement || videoElement.videoWidth <= 0 || videoElement.videoHeight <= 0) {
              return;
            }
            scannerFallbackBusyRef.current = true;
            try {
              const sourceCanvas = document.createElement('canvas');
              const targetMaxWidth = 1280;
              const scale = videoElement.videoWidth > targetMaxWidth ? targetMaxWidth / videoElement.videoWidth : 1;
              const sourceWidth = Math.max(1, Math.round(videoElement.videoWidth * scale));
              const sourceHeight = Math.max(1, Math.round(videoElement.videoHeight * scale));
              sourceCanvas.width = sourceWidth;
              sourceCanvas.height = sourceHeight;
              const sourceContext = sourceCanvas.getContext('2d');
              if (!sourceContext) {
                return;
              }
              sourceContext.drawImage(videoElement, 0, 0, sourceWidth, sourceHeight);

              let workCanvas = scannerCanvasRef.current;
              if (!workCanvas) {
                workCanvas = document.createElement('canvas');
                scannerCanvasRef.current = workCanvas;
              }
              if (!workCanvas) {
                return;
              }

              const attempts: Array<{
                angle: number;
                width: number;
                height: number;
              }> = [
                { angle: 0, width: sourceWidth, height: sourceHeight },
                { angle: 90, width: sourceHeight, height: sourceWidth },
                { angle: 180, width: sourceWidth, height: sourceHeight },
                { angle: 270, width: sourceHeight, height: sourceWidth },
              ];

              for (const attempt of attempts) {
                if (cancelled) {
                  return;
                }
                workCanvas.width = attempt.width;
                workCanvas.height = attempt.height;
                const workContext = workCanvas.getContext('2d');
                if (!workContext) {
                  continue;
                }
                workContext.save();
                workContext.clearRect(0, 0, attempt.width, attempt.height);
                workContext.translate(attempt.width / 2, attempt.height / 2);
                workContext.rotate((attempt.angle * Math.PI) / 180);
                workContext.drawImage(sourceCanvas, -sourceWidth / 2, -sourceHeight / 2, sourceWidth, sourceHeight);
                workContext.restore();

                try {
                  const fallbackResult = reader.decodeFromCanvas(workCanvas);
                  if (fallbackResult) {
                    registerScannerResult(fallbackResult.getText(), {
                      source: 'live',
                      format: fallbackResult.getBarcodeFormat().toString(),
                    });
                    return;
                  }
                } catch (decodeError) {
                  if (!isExpectedDecodeError(decodeError)) {
                    const message =
                      decodeError instanceof Error
                        ? decodeError.message
                        : 'Scanner fallback decode failed.';
                    setScannerError(message);
                  }
                }
              }
            } finally {
              scannerFallbackBusyRef.current = false;
            }
          }, 140);
        }
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : 'Unable to start QR/barcode scanner.';
        setScannerError(message);
      }
    };

    void startBarcodeDecode();

    return () => {
      cancelled = true;
      stopScannerDecoding();
    };
  }, [
    registerScannerResult,
    scannerBookingMatch,
    scannerCaptureLoading,
    scannerOpen,
    scannerReady,
    scannerTextLoading,
    stopScannerDecoding,
  ]);

  useEffect(() => {
    if (!scannerOpen) {
      return;
    }
    if (scannerBookingMatch) {
      setScannerLookupLoading(false);
      return;
    }
    if (!scannerResult) {
      setScannerLookupLoading(false);
      setScannerLookupError(null);
      setScannerBookingMatch(null);
      scannerLookupRequestRef.current = null;
      return;
    }

    const searchCandidates = buildScannerSearchCandidates(scannerResult);
    if (searchCandidates.length === 0) {
      setScannerLookupLoading(false);
      setScannerLookupError('Scanned value is too short to search booking records.');
      setScannerBookingMatch(null);
      scannerLookupRequestRef.current = null;
      return;
    }

    const requestKey = `${selectedDateString}|${currentProductId ?? 'any'}|${searchCandidates
      .map((candidate) => candidate.toLowerCase())
      .join('|')}`;
    if (scannerLookupRequestRef.current === requestKey) {
      return;
    }

    scannerLookupRequestRef.current = requestKey;
    setScannerLookupLoading(true);
    setScannerLookupError(null);

    let cancelled = false;
    const lookupBooking = async () => {
      try {
        let resolvedMatch: ScannerBookingMatch | null = null;

        for (const searchCandidate of searchCandidates) {
          const response = await axiosInstance.get<ManifestResponse>('/bookings/manifest', {
            params: { search: searchCandidate },
            withCredentials: true,
          });
          if (cancelled) {
            return;
          }
          const orders = Array.isArray(response.data?.orders) ? response.data.orders : [];
          const { order, matchedCount } = pickBestScannerOrderMatch(
            orders,
            searchCandidate,
            selectedDateString,
            currentProductId,
          );
          if (!order) {
            continue;
          }

          resolvedMatch = {
            order,
            shouldLetIn: getOrderEntryAllowance(order),
            matchedCount,
            searchedValue: searchCandidate,
          };
          break;
        }

        if (!resolvedMatch) {
          setScannerBookingMatch(null);
          setScannerLookupError(`No booking found for "${searchCandidates[0]}".`);
          return;
        }

        setScannerBookingMatch(resolvedMatch);
        setScannerLookupError(null);
      } catch (error) {
        if (cancelled) {
          return;
        }
        const message =
          error instanceof Error
            ? error.message
            : 'Failed to fetch booking details for this scan.';
        setScannerBookingMatch(null);
        setScannerLookupError(message);
      } finally {
        if (cancelled) {
          return;
        }
        setScannerLookupLoading(false);
        if (scannerLookupRequestRef.current === requestKey) {
          scannerLookupRequestRef.current = null;
        }
      }
    };

    void lookupBooking();

    return () => {
      cancelled = true;
      if (scannerLookupRequestRef.current === requestKey) {
        scannerLookupRequestRef.current = null;
      }
    };
  }, [currentProductId, scannerBookingMatch, scannerOpen, scannerResult, selectedDateString]);

const loadCounterForDate = useCallback(
  async (formattedDate: string, productId: number | null | undefined) => {
    if (!formattedDate) {
      return;
    }
    const resolvedProductId = productId ?? null;
    const requestKey = `date:${formattedDate}|${resolvedProductId ?? 'null'}`;
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

const loadCounterById = useCallback(
  async (counterId: number | null | undefined) => {
    if (!counterId) {
      return;
    }
    const requestKey = `id:${counterId}`;
    if (fetchCounterRequestRef.current === requestKey) {
      return;
    }
    fetchCounterRequestRef.current = requestKey;
    try {
      await dispatch(fetchCounterById(counterId)).unwrap();
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
  const walkInConfiguredTicketOptionsByChannel = useMemo(() => {
    const displayOrder = new Map<string, number>();
    WALK_IN_DISCOUNT_OPTIONS.forEach((label, index) => {
      displayOrder.set(label, index);
    });

    const optionsByChannel: Record<number, string[]> = {};
    walkInChannelIds.forEach((channelId) => {
      const channel = registry.channels.find((entry) => entry.id === channelId);
      const configuredLabels = new Set<string>();
      (channel?.walkInTicketPrices ?? []).forEach((priceEntry) => {
        const label = resolveWalkInTicketLabelFromType(priceEntry.ticketType);
        if (label) {
          configuredLabels.add(label);
        }
      });
      configuredLabels.add(CUSTOM_TICKET_LABEL);
      optionsByChannel[channelId] = Array.from(configuredLabels).sort(
        (left, right) =>
          (displayOrder.get(left) ?? Number.MAX_SAFE_INTEGER) -
            (displayOrder.get(right) ?? Number.MAX_SAFE_INTEGER) ||
          left.localeCompare(right),
      );
    });

    return optionsByChannel;
  }, [registry.channels, walkInChannelIds]);

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
    const configuredWalkInOptionsKey = walkInChannelIds
      .map((channelId) => `${channelId}:${(walkInConfiguredTicketOptionsByChannel[channelId] ?? []).join(',')}`)
      .join('|');
    const initKey = [
      counterRecord.id,
      counterRecord.updatedAt,
      note ?? '',
      walkInChannelIds.join(','),
      cashEligibleChannelIds.join(','),
      configuredWalkInOptionsKey,
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
      const configuredTicketOptions = walkInConfiguredTicketOptionsByChannel[channelId] ?? [];
      const configuredTicketOptionSet = new Set<string>(configuredTicketOptions);
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
        if (!configuredTicketOptionSet.has(ticketName)) {
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

      const initialSelection = new Set<string>(
        parsedDiscounts.filter((ticketLabel) => configuredTicketOptionSet.has(ticketLabel)),
      );
      ticketOrder.forEach((ticketName) => initialSelection.add(ticketName));
      const orderedSelection: string[] = [];
      ticketOrder.forEach((ticketName) => {
        if (initialSelection.has(ticketName)) {
          orderedSelection.push(ticketName);
          initialSelection.delete(ticketName);
        }
      });
      initialSelection.forEach((ticketName) => {
        if (!configuredTicketOptionSet.has(ticketName)) {
          return;
        }
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
          const defaultTicketLabel = configuredTicketOptions[0] ?? null;
          if (defaultTicketLabel) {
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
      }

      nextWalkInDiscounts[channelId] = finalSelection;
      nextWalkInTickets[channelId] = {
        ticketOrder: finalTicketOrder,
        tickets: finalTicketEntries,
      };

      if (!(channelId in nextWalkInCash)) {
        let aggregatedCash = 0;
        finalTicketOrder.forEach((ticketName) => {
          const ticketEntry = finalTicketEntries[ticketName];
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
    walkInConfiguredTicketOptionsByChannel,
  ]);

  const appliedPlatformSelectionRef = useRef<number | null>(null);
  const appliedAfterCutoffSelectionRef = useRef<number | null>(null);
  const manifestRequestRef = useRef<string | null>(null);
  const manifestAppliedRef = useRef<string | null>(null);
  const manifestTriggerRef = useRef<string | null>(null);
  const shouldPrefillManagerRef = useRef<boolean>(false);
  const [manifestSearchRequested, setManifestSearchRequested] = useState(false);
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

  const hasBookedBeforeMetrics = useMemo(
    () =>
      mergedMetrics.some(
        (metric) =>
          (metric.kind === 'people' || metric.kind === 'addon') &&
          metric.tallyType === 'booked' &&
          metric.period === 'before_cutoff' &&
          metric.qty > 0,
      ),
    [mergedMetrics],
  );

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
    const desiredManagerId = selectedManagerId ?? counterRecord.userId;
    const desiredProductId = pendingProductId ?? (counterRecord.productId ?? null);
    const lastPersistedStaffIds = lastPersistedStaffIdsRef.current;
    const staffDiffers = pendingStaffDirty && !idListsEqual(pendingStaffIds, lastPersistedStaffIds);

    const shouldUpdateManager = desiredManagerId != null && desiredManagerId !== counterRecord.userId;
    const shouldUpdateProduct = desiredProductId !== (counterRecord.productId ?? null);
    const shouldUpdateStaff = staffDiffers;

    if (!shouldUpdateManager && !shouldUpdateProduct && !shouldUpdateStaff) {
      setPendingStaffDirty(false);
      return true;
    }

    try {
      setEnsuringCounter(true);
      await dispatch(
        submitCounterSetup({
          date: String(counterRecord.date),
          userId: desiredManagerId ?? counterRecord.userId,
          productId: desiredProductId,
          staffIds: shouldUpdateStaff ? pendingStaffIds : undefined,
        }),
      ).unwrap();
      setPendingStaffDirty(false);
      if (shouldUpdateStaff && pendingStaffIds.length > 0) {
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
      blurActiveElement();
      setModalMode(mode);
      if (mode === 'create') {
        setActiveRegistryStep('details');
      } else if (mode === 'update') {
        if (selectedCounterId != null) {
          const currentCounterId = registry.counter?.counter.id ?? null;
          if (currentCounterId !== selectedCounterId) {
            fetchCounterRequestRef.current = null;
            void loadCounterById(selectedCounterId);
          }
        }
      }
      setIsModalOpen(true);
    },
    [
      blurActiveElement,
      loadCounterById,
      registry.counter,
      selectedCounterId,
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
      const dateString = selectedDate.format(COUNTER_DATE_FORMAT);
      const handle = scheduleIdle(() => {
        dispatch(
          loadCatalog({
            includeScheduledStaff: true,
            date: dateString,
            productName: DEFAULT_PRODUCT_NAME,
          }),
        );
      });
      return () => cancelIdle(handle);
    }
    return undefined;
  }, [catalog.loaded, catalog.loading, dispatch, isModalOpen, selectedDate]);

const handleCounterListSelect = useCallback(
  (counterSummary: Partial<Counter>) => {
    const nextCounterId = counterSummary.id ?? null;
    startTransition(() => {
      setCounterListError(null);
      setSelectedCounterId(nextCounterId);
      setActiveRegistryStep('details');
    });
  },
  [setActiveRegistryStep],
);

const handleCounterSelect = useCallback(
  (counterSummary: Partial<Counter>) => {
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
        setActiveRegistryStep('details');

        if (nextCounterId) {
          void loadCounterById(nextCounterId);
        }
      });
    }, 0);
  },
  [loadCounterById, setActiveRegistryStep],
);

  const handleViewSummary = useCallback(
    async (counterSummary: Partial<Counter>) => {
      const counterIdValue = counterSummary.id ?? null;
      const counterDateValue = counterSummary.date ? dayjs(counterSummary.date) : null;
      if (!counterIdValue || !counterDateValue || !counterDateValue.isValid()) {
        return;
      }
      blurActiveElement();
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
  [blurActiveElement, counterProductId, handleCounterSelect, loadCounterForDate],
);

useEffect(() => {
  if (nightReportsRequestedRef.current) {
    return;
  }
  if (nightReportListState.loading || nightReportSummaries.length > 0) {
    nightReportsRequestedRef.current = true;
    return;
  }
  if (expandedCounterId == null) {
    return;
  }
  nightReportsRequestedRef.current = true;
  dispatch(fetchNightReports());
}, [dispatch, expandedCounterId, nightReportListState.loading, nightReportSummaries.length]);

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
    const managerId = resolvedManagerId;
    if (!managerId) {
      shouldPrefillManagerRef.current = true;
    }
    if (!catalog.loaded && !catalog.loading) {
      dispatch(
        loadCatalog({
          includeScheduledStaff: true,
          date: dayjs().format(COUNTER_DATE_FORMAT),
          productName: DEFAULT_PRODUCT_NAME,
        }),
      );
    }

    const today = dayjs();

    setCounterListError(null);
    setSelectedManagerId(managerId ?? null);
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
    resolvedManagerId,
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

  useEffect(() => {
    if (!manifestSearchRequested) {
      return;
    }
    if (!isModalOpen || activeRegistryStep !== 'platforms') {
      return;
    }
    if (!counterId || !currentProductId) {
      setManifestSearchRequested(false);
      return;
    }
    if (registry.channels.length === 0) {
      return;
    }
    const requestKey = `${counterId}|${selectedDateString}|${currentProductId}`;
    if (manifestRequestRef.current === requestKey || manifestTriggerRef.current === requestKey) {
      setManifestSearchRequested(false);
      return;
    }
    manifestTriggerRef.current = requestKey;
    setManifestSearchRequested(false);
    manifestRequestRef.current = requestKey;
    const fetchManifest = async () => {
      try {
        const response = await axiosInstance.get<ManifestResponse>('/bookings/manifest', {
          params: {
            date: selectedDateString,
            productId: currentProductId,
          },
          withCredentials: true,
        });
        const payload = response.data;
        const orders = Array.isArray(payload?.orders) ? payload.orders : [];
        const totalsByPlatform = buildPlatformTotalsFromOrders(orders);

        const channelIdByPlatform = new Map<string, number>();
        registry.channels.forEach((channel) => {
          const key = normalizePlatformLookupKey(channel.name);
          if (!key || key === WALK_IN_CHANNEL_SLUG) {
            return;
          }
          channelIdByPlatform.set(key, channel.id);
        });

        const addonByExtraKey = new Map<keyof OrderExtras, AddonConfig[]>();
        registry.addons.forEach((addon) => {
          const extraKey = resolveAddonExtraKey(addon);
          if (!extraKey) {
            return;
          }
          const list = addonByExtraKey.get(extraKey) ?? [];
          list.push(addon);
          addonByExtraKey.set(extraKey, list);
        });

        const metricsToApply: MetricCell[] = [];
        totalsByPlatform.forEach((totals, platformKey) => {
          const channelId = channelIdByPlatform.get(platformKey);
          if (!channelId) {
            return;
          }
          if (totals.people > 0) {
            metricsToApply.push({
              counterId,
              channelId,
              kind: 'people',
              addonId: null,
              tallyType: 'booked',
              period: 'before_cutoff',
              qty: Math.round(totals.people),
            });
          }

          (Object.keys(totals.extras) as Array<keyof OrderExtras>).forEach((extraKey) => {
            const extraQty = Math.max(0, Math.round(Number(totals.extras[extraKey]) || 0));
            if (extraQty <= 0) {
              return;
            }
            const addonsForKey = addonByExtraKey.get(extraKey) ?? [];
            addonsForKey.forEach((addon) => {
              metricsToApply.push({
                counterId,
                channelId,
                kind: 'addon',
                addonId: addon.addonId,
                tallyType: 'booked',
                period: 'before_cutoff',
                qty: extraQty,
              });
            });
          });
        });

        metricsToApply.forEach((metric) => {
          const existing = getMetric(
            metric.channelId,
            metric.tallyType,
            metric.period,
            metric.kind,
            metric.addonId,
          );
          if (existing && (existing.qty ?? 0) > 0) {
            return;
          }
          dispatch(setMetric(metric));
        });
      } catch (error) {
        const isCanceled =
          typeof error === 'object' &&
          error !== null &&
          ('code' in error || 'name' in error) &&
          (String((error as { code?: string }).code) === 'ERR_CANCELED' ||
            String((error as { name?: string }).name) === 'CanceledError');
        if (!isCanceled) {
          // eslint-disable-next-line no-console
          console.error('Failed to fetch manifest data', error);
        }
      } finally {
        if (manifestRequestRef.current === requestKey) {
          manifestRequestRef.current = null;
        }
        if (manifestTriggerRef.current === requestKey) {
          manifestTriggerRef.current = null;
        }
        setManifestSearchRequested(false);
      }
    };

    fetchManifest();
  }, [
    activeRegistryStep,
    counterId,
    currentProductId,
    dispatch,
    getMetric,
    isModalOpen,
    manifestSearchRequested,
    registry.addons,
    registry.channels,
    selectedDateString,
  ]);
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

  const flushMetrics = useCallback(
    async (options: { status?: CounterStatus } = {}): Promise<boolean> => {
      const activeCounterId = counterId;
      const noteUpdateNeeded = noteNeedsUpdate || walkInNoteDirty;
      if (!activeCounterId) {
        if (noteUpdateNeeded) {
          setWalkInNoteDirty(false);
        }
        return true;
      }

      const requestedStatus = options.status;
      const statusCandidate =
        requestedStatus && !(counterStatus === 'final' && requestedStatus !== 'final')
          ? requestedStatus
          : undefined;
      const statusToCommit =
        statusCandidate && statusCandidate !== counterStatus ? statusCandidate : undefined;

      const dirtyMetrics = hasDirtyMetrics
        ? registry.dirtyMetricKeys
            .map((key) => registry.metricsByKey[key])
            .filter((metric): metric is MetricCell => Boolean(metric))
            .filter((metric) => {
              const key = buildMetricKey(metric);
              const persisted = registry.persistedMetricsByKey[key];
              const nextQty = Math.max(0, Number(metric.qty) || 0);
              if (persisted) {
                const persistedQty = Math.max(0, Number(persisted.qty) || 0);
                return nextQty !== persistedQty;
              }
              return nextQty > 0;
            })
            .map((metric) => {
              const nextQty = Math.max(0, Number(metric.qty) || 0);
              return {
                channelId: metric.channelId,
                kind: metric.kind,
                addonId: metric.addonId,
                tallyType: metric.tallyType,
                period: metric.period,
                qty: nextQty,
              };
            })
        : [];

      const shouldSendNotes = noteUpdateNeeded && computedCounterNotes !== currentCounterNotes;
      const shouldCommit = dirtyMetrics.length > 0 || shouldSendNotes || Boolean(statusToCommit);
      if (!shouldCommit) {
        if (noteUpdateNeeded) {
          setWalkInNoteDirty(false);
        }
        return true;
      }

      setConfirmingMetrics(true);
      try {
        const dirtyCashMetric =
          hasDirtyMetrics &&
          registry.dirtyMetricKeys.some((key) => {
            const parts = key.split('|');
            return parts.length > 1 && parts[1] === 'cash_payment';
          });

        await dispatch(
          commitCounterRegistry({
            counterId: activeCounterId,
            metrics: dirtyMetrics.length > 0 ? dirtyMetrics : undefined,
            status: statusToCommit,
            notes: shouldSendNotes ? computedCounterNotes : undefined,
          }),
        ).unwrap();

        if (noteUpdateNeeded) {
          setWalkInNoteDirty(false);
        }

        if (dirtyCashMetric || shouldSendNotes) {
          setShouldRefreshCounterList(true);
        }

        return true;
      } catch (_error) {
        return false;
      } finally {
        setConfirmingMetrics(false);
      }
    },
    [
      computedCounterNotes,
      counterId,
      counterStatus,
      currentCounterNotes,
      dispatch,
      hasDirtyMetrics,
      noteNeedsUpdate,
      registry.dirtyMetricKeys,
      registry.metricsByKey,
      registry.persistedMetricsByKey,
      walkInNoteDirty,
    ],
  );

  const ensureNightReportFromSummary = useCallback(async () => {
    const counterRecord = registry.counter?.counter;
    const summary = registry.summary;
    if (!counterRecord) {
      return;
    }
    if (counterRecord.status !== 'final') {
      return;
    }
    const leaderId = counterRecord.userId;
    if (!leaderId) {
      return;
    }

    const existingSummary =
      nightReportSummaries.find((report) => report.counterId === counterRecord.id) ?? null;
    let reportId = existingSummary?.id ?? null;
    let creationErrorMessage: string | null = null;

    const ensureDidNotOperateNightReport = async (): Promise<void> => {
      try {
        if ((counterNotes ?? '').trim() !== DID_NOT_OPERATE_NOTE) {
          await dispatch(
            updateCounterNotes({
              counterId: counterRecord.id,
              notes: DID_NOT_OPERATE_NOTE,
            }),
          ).unwrap();
          setShouldRefreshCounterList(true);
        }

        if (!reportId) {
          const createdReport = await dispatch(
            createNightReport({
              counterId: counterRecord.id,
              leaderId,
              activityDate: counterRecord.date,
              notes: DID_NOT_OPERATE_NOTE,
              venues: [],
            }),
          ).unwrap();
          reportId = createdReport.id;
        } else {
          await dispatch(
            updateNightReport({
              reportId,
              payload: {
                leaderId,
                activityDate: counterRecord.date,
                notes: DID_NOT_OPERATE_NOTE,
                venues: [],
              },
            }),
          ).unwrap();
        }

        if (reportId) {
          await dispatch(submitNightReport(reportId)).unwrap();
        }
        await dispatch(fetchNightReports());
      } catch (error) {
        const message = typeof error === 'string' ? error : (error as Error)?.message ?? '';
        // eslint-disable-next-line no-console
        console.warn('Failed to auto-create did-not-operate night report:', message || error);
      }
    };

    if (!summary) {
      if ((counterNotes ?? '').trim() === DID_NOT_OPERATE_NOTE) {
        await ensureDidNotOperateNightReport();
      }
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

    if (computedTotalPeople === 0) {
      await ensureDidNotOperateNightReport();
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
    counterNotes,
    setShouldRefreshCounterList,
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
  const stepIndex = useMemo(
    () => STEP_CONFIGS.findIndex((step) => step.key === activeRegistryStep),
    [activeRegistryStep],
  );
  const activeStepConfig = STEP_CONFIGS[stepIndex] ?? STEP_CONFIGS[0];

  const handleProceedToPlatforms = useCallback(async () => {
    if (catalog.loading || registry.loading || ensuringCounter) {
      return;
    }

    const managerId = resolvedManagerId;
    if (!managerId) {
      setCounterListError('Select a manager before continuing.');
      return;
    }

    setCounterListError(null);

    const formatted = selectedDate.format(COUNTER_DATE_FORMAT);
    const counterRecord = registry.counter?.counter ?? null;
    const payloadDate = counterRecord ? String(counterRecord.date) : formatted;
    const shouldSendStaff = !counterRecord || pendingStaffDirty;

    try {
      setEnsuringCounter(true);
      const payload = await dispatch(
        submitCounterSetup({
          date: payloadDate,
          userId: managerId,
          productId: currentProductId ?? null,
          staffIds: shouldSendStaff ? pendingStaffIds : undefined,
          status: 'platforms',
        }),
      ).unwrap();

      const ensuredProductId = payload.counter.productId ?? null;
      const ensuredStaffIds = normalizeIdList(payload.staff.map((member) => member.userId));
      const requestKey = `${payloadDate}|${(ensuredProductId ?? null) ?? 'null'}`;
      fetchCounterRequestRef.current = requestKey;

      if (shouldSendStaff) {
        setPendingStaffIds(ensuredStaffIds);
        lastPersistedStaffIdsRef.current = ensuredStaffIds;
      }
      setPendingStaffDirty(false);
      setPendingProductId(null);
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
    resolvedManagerId,
    selectedDate,
    dispatch,
    currentProductId,
    pendingStaffDirty,
    pendingStaffIds,
    registry.counter,
  ]);

  const handleProceedToReservations = useCallback(async () => {
    const saved = await flushMetrics({ status: 'reservations' });
    if (!saved) {
      return;
    }
    setActiveRegistryStep('reservations');
  }, [flushMetrics]);
  const handleProceedToSummary = useCallback(async () => {
    const saved = await flushMetrics({ status: 'final' });
    if (!saved) {
      return;
    }
    setActiveRegistryStep('summary');
  }, [flushMetrics]);
  const handleReturnToSetup = useCallback(async () => {
    const saved = await flushMetrics({ status: 'draft' });
    if (!saved) {
      return;
    }
    setActiveRegistryStep('details');
  }, [flushMetrics]);
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
    const canFilterByShiftRole = shiftRoleAssignments.length > 0 && staffRoleIdSet.size > 0;
    if (canFilterByShiftRole) {
      shiftRoleAssignments.forEach((assignment) => {
        if (!assignment.roleIds?.some((roleId) => staffRoleIdSet.has(roleId))) {
          return;
        }
        const fullName = composeName(assignment.firstName, assignment.lastName);
        map.set(assignment.userId, {
          id: assignment.userId,
          firstName: assignment.firstName ?? null,
          lastName: assignment.lastName ?? null,
          fullName: fullName || `Staff #${assignment.userId}`,
          userTypeSlug: null,
          userTypeName: null,
        });
      });
      allCatalogUsers.forEach((user) => {
        if (staffUserIdSet.has(user.id)) {
          map.set(user.id, user);
        }
      });
    } else {
      catalog.staff.forEach((staff) => map.set(staff.id, staff));
    }
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
  }, [
    allCatalogUsers,
    catalog.staff,
    registry.counter,
    shiftRoleAssignments,
    staffRoleIdSet,
    staffUserIdSet,
  ]);
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
    const walkInConfiguredTicketOptions = walkInConfiguredTicketOptionsByChannel[channel.id] ?? [];
    const walkInDiscountSelection = (walkInDiscountsByChannel[channel.id] ?? []).filter((ticketLabel) =>
      walkInConfiguredTicketOptions.includes(ticketLabel),
    );
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
        {walkInConfiguredTicketOptions.map((option) => {
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
        setFreePeopleByChannel((prev) => {
          if (!(channel.id in prev)) {
            return prev;
          }
          const { [channel.id]: _removed, ...rest } = prev;
          return rest;
        });
        setFreeAddonsByChannel((prev) => {
          if (!(channel.id in prev)) {
            return prev;
          }
          const { [channel.id]: _removed, ...rest } = prev;
          return rest;
        });
        setWalkInNoteDirty(true);
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
                  {walkInConfiguredTicketOptions.length === 0 ? (
                    <Typography variant="caption" color="text.secondary">
                      No walk-in ticket types configured in Channel Product Prices.
                    </Typography>
                  ) : walkInDiscountSelection.length === 0 && !freePeopleActive && (
                    <Typography variant="caption" color="text.secondary">
                      Select a ticket type to start recording.
                    </Typography>
                  )}
                </Stack>
                {(walkInDiscountSelection.length > 0 || freePeopleActive) && (
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
                    {freePeopleActive && (
                      <Box
                        key={`${channel.id}-after-cutoff-free-section`}
                        sx={{
                          border: '1px solid',
                          borderColor: 'divider',
                          borderRadius: 1,
                          p: 1.25,
                          display: 'flex',
                          flexDirection: 'column',
                          minWidth: 0,
                        }}
                      >
                        <Stack spacing={2}>
                          <Typography variant="subtitle2" fontWeight={600}>
                            Free Guests
                          </Typography>
                          {renderLocalStepper(
                            `${channel.id}-after-cutoff-free`,
                            'People',
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
                            label="Free ticket reason"
                            placeholder="e.g., Birthday"
                            multiline
                            minRows={1}
                          />
                        </Stack>
                        {addons.length > 0 && (
                          <Stack>
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
                              const freeAddonNoteError =
                                freeAddonQty > 0 && freeAddonNote.trim().length === 0;
                              return (
                                <Stack
                                  key={`${channel.id}-after-free-addon-${normalizedAddonId}`}
                                  spacing={2}
                                >
                                  {renderLocalStepper(
                                    `${channel.id}-after-free-addon-${normalizedAddonId}`,
                                    `${addon.name}`,
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
                                      freeAddonNoteError
                                        ? `Add a reason for the free ${addon.name.toLowerCase()}`
                                        : ' '
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
                      </Box>
                    )}
                  </Box>
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
            loading={scheduledStaffLoading}
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
          <Stack direction="row" spacing={1} alignItems="center">
            <Button
              variant="outlined"
              size="small"
              onClick={() => setManifestSearchRequested(true)}
              disabled={registry.loading || registry.savingMetrics || confirmingMetrics || !currentProductId}
            >
              Automatic Search
            </Button>
            <Typography variant="caption" color="text.secondary">
              Pulls bookings manifest data to prefill platform quantities.
            </Typography>
          </Stack>
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
        {(modalMode === 'create' || modalMode === 'update') && (
          <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="flex-end">
            <Button
              variant="outlined"
              size="small"
              onClick={() => setScannerOpen(true)}
              disabled={registry.savingMetrics || confirmingMetrics}
            >
              Scanner
            </Button>
          </Stack>
        )}
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
      const summaryStepBlocked = reservationHoldActive && activeRegistryStep === 'reservations';
      const proceedDisabled = disableNav || summaryStepBlocked;
      const proceedButtonTitle = summaryStepBlocked
        ? 'Proceed to Summary is unavailable between 9:00 PM and 9:15 PM.'
        : undefined;
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
              disabled={proceedDisabled}
              title={proceedButtonTitle}
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
            disabled={proceedDisabled}
            title={proceedButtonTitle}
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
    const snapshotDetails = formatCounterSnapshotDetails(counterNotes, registry.channels, combinedAddonList);
    const hasFreeTicketNotes = snapshotDetails.freeSections.length > 0;
    const multipleFreeTicketChannels = snapshotDetails.freeSections.length > 1;
    const hasManualNotes = snapshotDetails.manualNote.length > 0;
    const hasNotes = hasFreeTicketNotes || hasManualNotes;

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
        {hasNotes && (
          <Box>
            <Divider sx={{ mb: 1.5 }} />
            <Typography variant="subtitle1" fontWeight={600} gutterBottom>
              Notes
            </Typography>
            <Stack spacing={1.25}>
              {hasFreeTicketNotes && (
                <Stack spacing={0.75}>
                  <Typography variant="body2" color="text.secondary">
                    <Box component="span" sx={{ fontWeight: 600, textDecoration: 'underline' }}>
                      Free Tickets:
                    </Box>
                  </Typography>
                  {snapshotDetails.freeSections.map((section, sectionIndex) => {
                    return (
                      <Stack
                        key={`${section.channelLabel ?? 'channel'}-${sectionIndex}`}
                        spacing={0.25}
                        sx={{ pl: multipleFreeTicketChannels ? 1.5 : 0 }}
                      >
                        {multipleFreeTicketChannels && (
                          <Typography
                            variant="body2"
                            color="text.secondary"
                            sx={{ fontWeight: 600 }}
                          >
                            {section.channelLabel ?? 'Channel'}
                          </Typography>
                        )}
                        {section.entries.map((entry, entryIndex) => (
                          <Typography
                            key={`${entry.label}-${entryIndex}`}
                            variant="body2"
                            color="text.secondary"
                          >
                            <Box component="span" sx={{ fontWeight: 600 }}>
                              {entry.label}:
                            </Box>
                            {entry.quantity != null && (
                              <>
                                {' '}
                                {entry.quantity}
                              </>
                            )}
                            {entry.reason && (
                              <>
                                {entry.quantity != null ? ' - ' : ' '}
                                <Box component="span" sx={{ fontWeight: 600, textDecoration: 'underline' }}>
                                  Reason:
                                </Box>{' '}
                                {entry.reason}
                              </>
                            )}
                          </Typography>
                        ))}
                      </Stack>
                    );
                  })}
                </Stack>
              )}
              {hasManualNotes && (
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
                >
                  {snapshotDetails.manualNote}
                </Typography>
              )}
            </Stack>
          </Box>
        )}
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
                      confirmingMetrics ||
                      (reservationHoldActive && activeRegistryStep === 'reservations' && step.key === 'summary')
                    }
                    title={
                      reservationHoldActive && activeRegistryStep === 'reservations' && step.key === 'summary'
                        ? 'Summary step is unavailable between 9:00 PM and 9:15 PM.'
                        : undefined
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
    shouldPrefillManagerRef.current = true;
    setSelectedDate(value);
    setSelectedManagerId(null);
    setPendingProductId(null);
    setPendingStaffIds([]);
    setPendingStaffDirty(false);
    manifestAppliedRef.current = null;
    manifestRequestRef.current = null;
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
    shouldPrefillManagerRef.current = false;
    fetchCounterRequestRef.current = null;
  };
  const handleStaffSelection = (_event: SyntheticEvent, values: StaffOption[]) => {
    const ids = values.map((option) => option.id);
    handleStaffChange(ids);
  };

  const handleProductSelection = useCallback(
    (_event: SyntheticEvent, option: CatalogProduct | null) => {
      const nextProductId = option?.id ?? null;
      shouldPrefillManagerRef.current = true;
      setPendingProductId(nextProductId);
      setSelectedManagerId(null);
      setPendingStaffIds([]);
      setPendingStaffDirty(false);
      manifestAppliedRef.current = null;
      manifestRequestRef.current = null;
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
              <Stack spacing={1} sx={{ flex: 1, minHeight: 0 }}>
                <List dense sx={{ flex: 1, overflowY: 'auto', pr: 1 }}>
                  {pagedCounterDisplayData.map((counterItem) => {
                    const isSelected =
                      selectedCounterId != null &&
                      counterItem.counterIdValue != null &&
                      counterItem.counterIdValue === selectedCounterId;
                    const isExpanded =
                      counterItem.counterIdValue != null &&
                      counterItem.counterIdValue === expandedCounterId;

                    return (
                      <CounterListRow
                        key={(counterItem.counter.id ?? 'counter') + '-' + counterItem.dateLabel}
                        item={counterItem}
                        isSelected={isSelected}
                        isExpanded={isExpanded}
                        canModifyCounter={canModifyCounter}
                        onSelect={handleCounterListSelect}
                        onToggleExpand={toggleCounterExpansion}
                        onViewSummary={handleViewSummary}
                        onOpenModal={handleOpenModal}
                        onDeleteCounter={handleDeleteCounter}
                        venueStatusForCounter={venueStatusForCounter}
                      />
                    );
                  })}
                </List>
                <Box
                  sx={{
                    borderTop: (theme) => `1px solid ${theme.palette.divider}`,
                    pt: 1,
                  }}
                >
                  <Box
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr 1fr' },
                      gap: 1.5,
                      alignItems: 'center',
                    }}
                  >
                    <Stack
                      direction="row"
                      justifyContent={{ xs: 'center', sm: 'flex-start' }}
                      sx={{ width: '100%' }}
                    >
                      <Chip
                        size="small"
                        variant="outlined"
                        sx={{ width: '100%', justifyContent: 'center' }}
                        label={
                          totalCounters === 0
                            ? '0 counters'
                            : (() => {
                                const start = (counterPage - 1) * counterPageSize + 1;
                                const end = Math.min(totalCounters, counterPage * counterPageSize);
                                return `Showing ${start}-${end} of ${totalCounters}`;
                              })()
                        }
                      />
                    </Stack>
                    <Stack direction="row" justifyContent="center" sx={{ width: '100%' }}>
                      <TextField
                        select
                        size="small"
                        fullWidth
                        label="Rows"
                        value={counterPageSize}
                        onChange={(event) => {
                          const nextSize = Number(event.target.value) || 10;
                          setCounterPageSize(nextSize);
                          setCounterPage(1);
                        }}
                        SelectProps={{
                          displayEmpty: true,
                          MenuProps: { PaperProps: { sx: { minWidth: 120 } } },
                        }}
                        sx={{
                          '& .MuiSelect-select': {
                            textAlign: 'center',
                          },
                        }}
                      >
                        {[5, 8, 10, 15, 20].map((size) => (
                          <MenuItem key={`counter-page-size-${size}`} value={size}>
                            <Box sx={{ width: '100%', textAlign: 'center' }}>{size}</Box>
                          </MenuItem>
                        ))}
                      </TextField>
                    </Stack>
                    <Stack
                      direction="row"
                      justifyContent={{ xs: 'center', sm: 'flex-end' }}
                    >
                      <Pagination
                        count={totalPages}
                        page={counterPage}
                        onChange={(_event, value) => setCounterPage(value)}
                        size="small"
                        color="primary"
                        shape="rounded"
                        showFirstButton
                        showLastButton
                        siblingCount={1}
                        boundaryCount={1}
                        disabled={totalPages <= 1}
                      />
                    </Stack>
                  </Box>
                </Box>
              </Stack>
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
      <Dialog
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        fullScreen
        aria-labelledby="counter-scanner-title"
      >
        <DialogTitle
          id="counter-scanner-title"
          sx={{ m: 0, p: 2, pb: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
        >
          <Typography variant="h6" component="span">
            {scannerBookingMatch ? 'Booking Check-In' : 'Scanner'}
          </Typography>
          <IconButton onClick={() => setScannerOpen(false)} aria-label="close scanner">
            <Close />
          </IconButton>
        </DialogTitle>
        <DialogContent
          dividers
          sx={scannerBookingMatch ? { p: 0, display: 'flex', flexDirection: 'column' } : { p: { xs: 2, sm: 3 } }}
        >
          {scannerBookingMatch ? (
            <Box
              sx={{
                p: { xs: 2, sm: 3 },
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
                minHeight: 'calc(100vh - 104px)',
              }}
            >
              <Stack spacing={1.5}>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'flex-start', sm: 'center' }}>
                  <Typography variant="h6">Booking Match</Typography>
                  <Chip
                    size="small"
                    color={resolveScannerStatusColor(scannerBookingMatch.order.status)}
                    label={formatBookingStatusLabel(scannerBookingMatch.order.status)}
                  />
                </Stack>
                {scannerBookingMatch.matchedCount > 1 && (
                  <Typography variant="body2" color="text.secondary">
                    {`Found ${scannerBookingMatch.matchedCount} matches. Showing the best match for the current counter date/product.`}
                  </Typography>
                )}
                <Typography variant="h3" sx={{ lineHeight: 1.1 }}>
                  {scannerBookingMatch.shouldLetIn}
                </Typography>
                <Typography variant="subtitle1" color="text.secondary">
                  Should Let In
                </Typography>
                <Divider />
                <Typography variant="body1">
                  Platform Booking ID: {scannerBookingMatch.order.platformBookingId}
                </Typography>
                <Typography variant="body1">
                  Product: {scannerBookingMatch.order.productName}
                </Typography>
                <Typography variant="body1">
                  Experience: {scannerBookingMatch.order.date} {scannerBookingMatch.order.timeslot}
                </Typography>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  <Chip
                    size="medium"
                    label={`Cocktails: ${Math.max(0, Number(scannerBookingMatch.order.extras?.cocktails) || 0)}`}
                    color="info"
                    variant="outlined"
                  />
                  <Chip
                    size="medium"
                    label={`T-Shirts: ${Math.max(0, Number(scannerBookingMatch.order.extras?.tshirts) || 0)}`}
                    color="primary"
                    variant="outlined"
                  />
                  <Chip
                    size="medium"
                    label={`Instant Pictures: ${Math.max(0, Number(scannerBookingMatch.order.extras?.photos) || 0)}`}
                    color="secondary"
                    variant="outlined"
                  />
                </Stack>
              </Stack>
              <Box sx={{ mt: 'auto' }}>
                <Button variant="contained" size="large" fullWidth onClick={handleScannerCheckIn}>
                  Check-In
                </Button>
              </Box>
            </Box>
          ) : (
            <Stack spacing={2}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
                <Chip
                  size="small"
                  color={scannerReady ? 'success' : 'default'}
                  label={scannerReady ? 'Live QR/Barcode scan active' : 'Starting camera...'}
                />
                <Box sx={{ flexGrow: 1 }} />
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => {
                    void handleCaptureFrameScan();
                  }}
                  disabled={!scannerReady || scannerTextLoading || scannerCaptureLoading}
                >
                  {scannerCaptureLoading ? 'Capturing...' : 'Capture Frame'}
                </Button>
                <Button
                  size="small"
                  variant="contained"
                  onClick={() => {
                    void handleScanTextCapture();
                  }}
                  disabled={!scannerReady || scannerTextLoading || scannerCaptureLoading}
                >
                  {scannerTextLoading ? 'Reading Text...' : 'Read Text'}
                </Button>
              </Stack>
              <Box sx={{ bgcolor: 'black', borderRadius: 1, overflow: 'hidden', position: 'relative' }}>
                <video
                  ref={scannerVideoRef}
                  autoPlay
                  playsInline
                  muted
                  style={{ display: 'block', width: '100%', maxHeight: '70vh', objectFit: 'cover' }}
                />
                {scannerCaptureLoading && (
                  <Box
                    sx={{
                      position: 'absolute',
                      inset: 0,
                      bgcolor: 'rgba(0, 0, 0, 0.58)',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 1.25,
                      zIndex: 2,
                    }}
                  >
                    <CircularProgress size={34} />
                    <Typography variant="body2" sx={{ color: 'common.white', textAlign: 'center', px: 2 }}>
                      Capturing frame and scanning...
                    </Typography>
                  </Box>
                )}
              </Box>
              {scannerResult && (
                <Alert severity="success">
                  <Stack spacing={0.5}>
                    <Typography variant="body2">
                      {`Detected ${scannerResult.kind.toUpperCase()} from ${scannerResult.source === 'ocr' ? 'text OCR' : 'live camera'} at ${scannerResult.scannedAt}`}
                    </Typography>
                    {scannerResult.format && (
                      <Typography variant="caption" color="text.secondary">
                        Format: {scannerResult.format}
                      </Typography>
                    )}
                    <Typography variant="body2">
                      Booking ID: {scannerResult.bookingId ?? 'Not parsed yet'}
                    </Typography>
                    <TextField
                      size="small"
                      label="Raw Value"
                      value={scannerResult.rawValue}
                      multiline
                      minRows={2}
                      InputProps={{ readOnly: true }}
                    />
                    {typeof scannerResult.confidence === 'number' && (
                      <Typography variant="caption" color="text.secondary">
                        OCR confidence: {scannerResult.confidence.toFixed(1)}%
                      </Typography>
                    )}
                  </Stack>
                </Alert>
              )}
              {scannerLookupLoading && (
                <Stack spacing={0.75}>
                  <LinearProgress />
                  <Typography variant="caption" color="text.secondary">
                    Searching booking by platform booking ID...
                  </Typography>
                </Stack>
              )}
              {scannerCaptureLoading && (
                <Stack spacing={0.75}>
                  <LinearProgress />
                  <Typography variant="caption" color="text.secondary">
                    Running aggressive barcode recognition and OCR fallback on captured frame...
                  </Typography>
                </Stack>
              )}
              {scannerCheckInNotice && <Alert severity="success">{scannerCheckInNotice}</Alert>}
              {scannerLookupError && <Alert severity="warning">{scannerLookupError}</Alert>}
              {scannerError ? (
                <Alert severity="error">{scannerError}</Alert>
              ) : (
                <Alert severity="info">
                  QR/barcode is scanned automatically. Use "Read Text" for printed or handwritten booking IDs.
                </Alert>
              )}
            </Stack>
          )}
        </DialogContent>
      </Dialog>
    </LocalizationProvider>
  );
};

export default Counters;

