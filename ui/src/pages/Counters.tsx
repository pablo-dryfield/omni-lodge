import type { KeyboardEvent, MouseEvent, SyntheticEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { Add, Close, Delete, Edit, Remove } from '@mui/icons-material';
import { useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { deleteCounter, fetchCounters } from '../actions/counterActions';
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

const BUCKETS: BucketDescriptor[] = [
  { tallyType: 'attended', period: null, label: bucketLabels.attended },
  { tallyType: 'booked', period: 'before_cutoff', label: bucketLabels.before_cutoff },
  { tallyType: 'booked', period: 'after_cutoff', label: bucketLabels.after_cutoff },
];

const WALK_IN_DISCOUNT_OPTIONS = ['Second Timers', 'Third Timers', 'Half Price', 'Students', 'Group'];
const WALK_IN_DISCOUNT_NOTE_PREFIX = 'Walk-In Discounts applied:';
const WALK_IN_CASH_NOTE_PREFIX = 'Cash Collected:';
const WALK_IN_DISCOUNT_LOOKUP = new Map(
  WALK_IN_DISCOUNT_OPTIONS.map((label) => [label.toLowerCase(), label] as const),
);

const WALK_IN_CASH_FORMATTER = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const formatCashAmount = (amount: number): string => {
  if (!Number.isFinite(amount)) {
    return WALK_IN_CASH_FORMATTER.format(0);
  }
  return WALK_IN_CASH_FORMATTER.format(amount);
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
  const [walkInNoteDirty, setWalkInNoteDirty] = useState(false);


const counterId = registry.counter?.counter.id ?? null;
const counterStatus = (registry.counter?.counter.status as CounterStatus | undefined) ?? 'draft';
const counterProductId = registry.counter?.counter.productId ?? null;
const currentProductId = pendingProductId ?? counterProductId ?? null;
const defaultProductId = useMemo(() => {
    if (catalog.products.length === 0) {
      return null;
    }
    const normalizedDefault =
      catalog.products.find((product) => product.name?.toLowerCase() === DEFAULT_PRODUCT_NAME.toLowerCase()) ??
      catalog.products[0] ?? null;
    return normalizedDefault ? normalizedDefault.id : null;
  }, [catalog.products]);

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

  useEffect(() => {
    if (!registry.counter && pendingProductId === null && defaultProductId != null) {
      setPendingProductId(defaultProductId);
    }
  }, [registry.counter, pendingProductId, defaultProductId]);

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
  async (formattedDate: string) => {
    if (!formattedDate) {
        return;
      }
      if (fetchCounterRequestRef.current === formattedDate) {
        return;
      }
      fetchCounterRequestRef.current = formattedDate;
      try {
        await dispatch(fetchCounterByDate(formattedDate)).unwrap();
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

  useEffect(() => {
    if (!registry.counter) {
      setWalkInCashByChannel({});
      setWalkInDiscountsByChannel({});
      setWalkInNoteDirty(false);
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
    ].join('|');

    if (lastWalkInInitRef.current === initKey) {
      return;
    }

    lastWalkInInitRef.current = initKey;

    const metricsList = registry.counter.metrics ?? [];
    const nextCash: Record<number, string> = {};
    const nextDiscounts: Record<number, string[]> = {};
    const parsedDiscounts = parseDiscountsFromNote(note);

    let cashChanged = false;
    let discountsChanged = false;

    walkInChannelIds.forEach((channelId) => {
      const cashMetric =
        metricsList.find(
          (metric) =>
            metric.channelId === channelId &&
            metric.kind === 'cash_payment' &&
            metric.tallyType === 'attended',
        ) ?? null;
      const numericQty = cashMetric ? Math.max(0, Number(cashMetric.qty) || 0) : 0;
      const nextCashValue = numericQty > 0 ? String(numericQty) : '';
      nextCash[channelId] = nextCashValue;
      if (!cashChanged) {
        const currentCashValue = walkInCashByChannel[channelId] ?? '';
        if (currentCashValue !== nextCashValue) {
          cashChanged = true;
        }
      }

      const nextDiscountSelection = [...parsedDiscounts];
      nextDiscounts[channelId] = nextDiscountSelection;
      if (!discountsChanged) {
        const currentSelection = walkInDiscountsByChannel[channelId] ?? [];
        if (
          currentSelection.length !== nextDiscountSelection.length ||
          currentSelection.some((value, index) => value !== nextDiscountSelection[index])
        ) {
          discountsChanged = true;
        }
      }
    });

    if (!cashChanged) {
      const currentKeys = Object.keys(walkInCashByChannel);
      if (
        currentKeys.length !== walkInChannelIds.length ||
        currentKeys.some((key) => !(key in nextCash))
      ) {
        cashChanged = true;
      }
    }

    if (!discountsChanged) {
      const currentKeys = Object.keys(walkInDiscountsByChannel);
      if (
        currentKeys.length !== walkInChannelIds.length ||
        currentKeys.some((key) => !(key in nextDiscounts))
      ) {
        discountsChanged = true;
      }
    }

    if (cashChanged) {
      setWalkInCashByChannel(nextCash);
    }
    if (discountsChanged) {
      setWalkInDiscountsByChannel(nextDiscounts);
    }
    setWalkInNoteDirty(false);
  }, [registry.counter, walkInChannelIds, walkInCashByChannel, walkInDiscountsByChannel]);

 const channelHasAnyQty = useCallback(
   (channelId: number) => mergedMetrics.some((metric) => metric.channelId === channelId && metric.qty > 0),
   [mergedMetrics],
 );


  const allowedAfterCutoffChannelIds = useMemo(
    () =>
      registry.channels
        .filter((channel) => {
          const normalizedName = channel.name.toLowerCase();
          if (AFTER_CUTOFF_ALLOWED.has(normalizedName)) {
            return true;
          }
          const catalogChannel = catalog.channels.find((catalogItem) => catalogItem.id === channel.id);
          return catalogChannel?.lateBookingAllowed ?? false;
        })
        .map((channel) => channel.id),
    [catalog.channels, registry.channels],
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
        results.add(metric.channelId);
      }
    });
    return results;
  }, [mergedMetrics]);

  const appliedPlatformSelectionRef = useRef<number | null>(null);
  const [selectedChannelIds, setSelectedChannelIds] = useState<number[]>([]);
  const [selectedAfterCutoffChannelIds, setSelectedAfterCutoffChannelIds] = useState<number[]>([]);
  const appliedAfterCutoffSelectionRef = useRef<number | null>(null);

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
      const baseMetric = getMetric(channelId, tallyType, period, kind, addonId);
      if (!baseMetric) {
        return;
      }
      const nextQty = Math.max(0, qty);
      if (baseMetric.qty === nextQty) {
        return;
      }
      dispatch(setMetric({ ...baseMetric, qty: nextQty }));

      if (kind === 'cash_payment') {
        return;
      }

      const channel = registry.channels.find((item) => item.id === channelId);
      const normalizedChannelName = channel?.name?.toLowerCase() ?? '';
      const isAfterCutoffChannel = AFTER_CUTOFF_ALLOWED.has(normalizedChannelName);
      const normalizedPeriod =
        tallyType === 'booked'
          ? period ?? 'before_cutoff'
          : tallyType === 'attended'
            ? null
            : period ?? null;

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
            const delta = nextQty - baseMetric.qty;
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
        if (attendedMetric && attendedMetric.qty !== nextQty) {
          dispatch(setMetric({ ...attendedMetric, qty: nextQty }));
        }
      }
    },
    [catalog.addons, dispatch, getMetric, registry.addons, registry.channels, syncAfterCutoffAttendance],
  );

  const totalWalkInCash = useMemo(() => {
    return walkInChannelIds.reduce((sum, channelId) => {
      const rawValue = walkInCashByChannel[channelId];
      const numeric = Number(rawValue ?? 0);
      if (!Number.isFinite(numeric)) {
        return sum;
      }
      return sum + Math.max(0, numeric);
    }, 0);
  }, [walkInCashByChannel, walkInChannelIds]);

  const formattedWalkInCash = useMemo(() => formatCashAmount(totalWalkInCash), [totalWalkInCash]);

  const aggregatedWalkInDiscounts = useMemo(() => {
    const combined = new Set<string>();
    walkInChannelIds.forEach((channelId) => {
      const selection = walkInDiscountsByChannel[channelId] ?? [];
      selection.forEach((label) => combined.add(label));
    });
    return WALK_IN_DISCOUNT_OPTIONS.filter((option) => combined.has(option));
  }, [walkInChannelIds, walkInDiscountsByChannel]);

  const handleWalkInDiscountToggle = useCallback(
    (channelId: number, option: string) => {
      let didChange = false;
      setWalkInDiscountsByChannel((prev) => {
        const current = prev[channelId] ?? [];
        const alreadySelected = current.includes(option);
        const nextSelection = alreadySelected
          ? current.filter((item) => item !== option)
          : normalizeDiscountSelection([...current, option]);
        if (current.length === nextSelection.length && current.every((item, index) => item === nextSelection[index])) {
          return prev;
        }
        didChange = true;
        return { ...prev, [channelId]: nextSelection };
      });
      if (didChange) {
        setWalkInNoteDirty(true);
      }
    },
    [],
  );

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

      const metric = getMetric(channelId, 'attended', null, 'cash_payment', null);
      if (!metric) {
        return;
      }
      const numericQty = displayValue === '' ? 0 : Math.max(0, Number(displayValue));
      if (metric.qty !== numericQty) {
        handleMetricChange(channelId, 'attended', null, 'cash_payment', null, numericQty);
      }
    },
    [getMetric, handleMetricChange],
  );

  const buildWalkInNote = useCallback((): string => {
    const currentNote = registry.counter?.counter.notes ?? '';
    const existingLines = currentNote ? currentNote.split(/\r?\n/) : [];
    const filteredLines = existingLines
      .map((line) => line.trimEnd())
      .filter((line) => {
        const lower = line.trim().toLowerCase();
        if (!lower) {
          return false;
        }
        if (lower.startsWith(WALK_IN_DISCOUNT_NOTE_PREFIX.toLowerCase())) {
          return false;
        }
        if (lower.startsWith(WALK_IN_CASH_NOTE_PREFIX.toLowerCase())) {
          return false;
        }
        return true;
      });

    const discountLine =
      aggregatedWalkInDiscounts.length > 0
        ? `${WALK_IN_DISCOUNT_NOTE_PREFIX} ${aggregatedWalkInDiscounts.join(', ')}`
        : '';
    const cashLine = `${WALK_IN_CASH_NOTE_PREFIX} ${formattedWalkInCash} z\u0142`;
    const autoLine = discountLine ? `${discountLine} | ${cashLine}` : cashLine;

    if (filteredLines.length === 0) {
      return autoLine;
    }

    const manualSection = filteredLines.join('\n');
    return autoLine ? `${manualSection}\n${autoLine}` : manualSection;
  }, [aggregatedWalkInDiscounts, formattedWalkInCash, registry.counter]);

  const computedWalkInNote = useMemo(() => buildWalkInNote(), [buildWalkInNote]);
  const currentCounterNotes = registry.counter?.counter.notes ?? '';
  const noteNeedsUpdate = registry.counter ? computedWalkInNote !== currentCounterNotes : false;

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
    void loadCountersList();
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
        const shouldFetch =
          formatted !== currentDate ||
          (selectedManagerId != null && selectedManagerId !== currentUserId);
        if (shouldFetch) {
          fetchCounterRequestRef.current = null;
          void loadCounterForDate(formatted);
        }
      }
      setIsModalOpen(true);
    },
    [loadCounterForDate, registry.counter, selectedCounterId, selectedDate, selectedManagerId, setActiveRegistryStep],
  );

  const handleCloseModal = useCallback(() => {
    setIsModalOpen(false);
    setModalMode(null);
    setActiveRegistryStep('details');
    void loadCountersList();
  }, [loadCountersList, setActiveRegistryStep]);

  useEffect(() => {
    if (isModalOpen && !catalog.loaded && !catalog.loading) {
      dispatch(loadCatalog());
    }
  }, [catalog.loaded, catalog.loading, dispatch, isModalOpen]);

  const handleCounterSelect = useCallback(
    (counterSummary: Partial<Counter>) => {
      setCounterListError(null);
      fetchCounterRequestRef.current = null;
      const nextCounterId = counterSummary.id ?? null;
      setSelectedCounterId(nextCounterId);
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
    },
    [],
  );

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
const effectiveSelectedChannelIds = useMemo<number[]>(() => {
    if (selectedChannelIds.length > 0) {
      return selectedChannelIds;
    }
    return savedPlatformChannelIds;
}, [savedPlatformChannelIds, selectedChannelIds]);

 useEffect(() => {
   setSelectedChannelIds((prev) => {
     const filtered = prev.filter((id) => channelHasAnyQty(id));
     return filtered.length === prev.length ? prev : filtered;
   });
 }, [channelHasAnyQty]);

  const effectiveAfterCutoffIds = useMemo<number[]>(() => {
    if (selectedAfterCutoffChannelIds.length > 0) {
      return selectedAfterCutoffChannelIds;
    }
    return savedAfterCutoffChannelIds.filter((id: number) => allowedAfterCutoffChannelIds.includes(id));
  }, [allowedAfterCutoffChannelIds, savedAfterCutoffChannelIds, selectedAfterCutoffChannelIds]);

  useEffect(() => {
    setSelectedAfterCutoffChannelIds((prev) => {
      const filtered = prev.filter((id) => channelHasAnyQty(id));
      return filtered.length === prev.length ? prev : filtered;
    });
  }, [channelHasAnyQty]);
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

  const metricsStatusMessage = useMemo(() => {
    if (registry.savingMetrics || registry.savingNotes || confirmingMetrics) {
      return 'Saving changes...';
    }
    const pendingNoteChange = walkInNoteDirty || noteNeedsUpdate;
    const noteDirtyCount = pendingNoteChange ? 1 : 0;
    const totalDirty = dirtyMetricCount + noteDirtyCount;
    if (totalDirty > 0) {
      return `${totalDirty} unsaved ${totalDirty === 1 ? 'change' : 'changes'}`;
    }
    return 'Metrics saved';
  }, [
    confirmingMetrics,
    dirtyMetricCount,
    noteNeedsUpdate,
    registry.savingMetrics,
    registry.savingNotes,
    walkInNoteDirty,
  ]);
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
      if (hasDirtyMetrics) {
        await dispatch(flushDirtyMetrics()).unwrap();
        shouldRefreshCounter = true;
      }
      if (noteUpdateNeeded) {
        if (computedWalkInNote !== currentCounterNotes) {
          await dispatch(
            updateCounterNotes({
              counterId: activeCounterId,
              notes: computedWalkInNote,
            }),
          ).unwrap();
        }
        setWalkInNoteDirty(false);
      }
      if (shouldRefreshCounter) {
        const formatted = selectedDate.format(COUNTER_DATE_FORMAT);
        await dispatch(fetchCounterByDate(formatted)).unwrap();
      }
      return true;
    } catch (_error) {
      return false;
    } finally {
      setConfirmingMetrics(false);
    }
  }, [
    computedWalkInNote,
    counterId,
    currentCounterNotes,
    dispatch,
    hasDirtyMetrics,
    noteNeedsUpdate,
    selectedDate,
    walkInNoteDirty,
  ]);

  const handleSaveAndExit = useCallback(async () => {
    const saved = await flushMetrics();
    if (saved) {
      handleCloseModal();
    }
  }, [flushMetrics, handleCloseModal]);
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
        <Stack direction="row" spacing={0.5} alignItems="center">
          <IconButton
            aria-label={`Decrease ${ariaLabel}`}
            size="small"
            onClick={() => adjust(-step)}
            disabled={decreaseDisabled}
            sx={{
              border: '1px solid',
              borderColor: decreaseDisabled ? 'divider' : 'primary.main',
              borderRadius: 1,
              width: 40,
              height: 40,
            }}
          >
            <Remove fontSize="small" />
          </IconButton>
          <TextField
            value={qty}
            type="number"
            size="small"
            disabled={disabled}
            onChange={(event) => handleInputChange(event.target.value)}
            onKeyDown={onKeyDown}
            inputProps={{
              min,
              max,
              style: { width: 64, textAlign: 'center' as const },
            }}
          />
          <IconButton
            aria-label={`Increase ${ariaLabel}`}
            size="small"
            onClick={() => adjust(step)}
            disabled={increaseDisabled}
            sx={{
              border: '1px solid',
              borderColor: increaseDisabled ? 'divider' : 'primary.main',
              borderRadius: 1,
              width: 40,
              height: 40,
            }}
          >
            <Add fontSize="small" />
          </IconButton>
        </Stack>
      </Stack>
    );
  };
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
      .filter((product) => product.status)
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

    return Array.from(map.values());
  }, [catalog.products, registry.counter]);

  useEffect(() => {
    if (!counterId) {
      return;
    }
    if (counterProductId) {
      return;
    }
    if (catalog.products.length === 0) {
      return;
    }
    const defaultProduct =
      catalog.products.find((product) => product.name?.toLowerCase() === DEFAULT_PRODUCT_NAME.toLowerCase()) ??
      catalog.products[0] ?? null;
    if (!defaultProduct) {
      return;
    }
    dispatch(updateCounterProduct({ counterId, productId: defaultProduct.id }));
  }, [catalog.products, counterId, counterProductId, dispatch]);

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
    const walkInCashValue = walkInCashByChannel[channel.id] ?? '';
    const walkInDiscountSelection = walkInDiscountsByChannel[channel.id] ?? [];
    const showWalkInExtras =
      isWalkInChannel && (bucket.tallyType === 'attended' || bucket.period === 'after_cutoff');

    return (
      <Card key={channel.id + '-' + bucket.label} variant="outlined" sx={{ mb: 2 }}>
        <CardContent>
          <Stack spacing={1.5}>
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Typography variant="subtitle1" fontWeight={600}>
                {channel.name}
              </Typography>
              {warningActive && <Chip label="After cut-off" color="warning" size="small" />}
            </Stack>
            {renderStepper('People', peopleMetric, disableInputs)}
            {showWalkInExtras && (
              <Stack spacing={1}>
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
                <Stack spacing={0.5}>
                  <Typography variant="subtitle2">Discounts Applied</Typography>
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
                  </Stack>
                </Stack>
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
                return (
                  <Stack key={addonKey} spacing={0.5}>
                    {renderStepper(addon.name, metric, disableInputs, 0, stepperMax, 1)}
                    {addon.maxPerAttendee != null && !isCocktail && (
                      <Typography variant="caption" color="text.secondary">
                        Max {addon.maxPerAttendee} per attendee (cap {calculatedMax ?? 0})
                      </Typography>
                    )}
                  </Stack>
                );
              })}
            </Stack>
          </Stack>
        </CardContent>
      </Card>
    );
  };
  const selectedDateString = selectedDate.format(COUNTER_DATE_FORMAT);
  const stepIndex = useMemo(() => STEP_CONFIGS.findIndex((step) => step.key === activeRegistryStep), [activeRegistryStep]);
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

      fetchCounterRequestRef.current = formatted;

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
      return (
        <Alert severity="info">No platform buckets are configured.</Alert>
      );
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
            {registry.channels.map((channel) => (
              <ToggleButton key={channel.id} value={channel.id} sx={{ flex: '0 0 auto' }}>
                {channel.name}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
          {effectiveSelectedChannelIds.length === 0 ? (
            <Alert severity="info">Select platforms to enter the metrics or skip if not operating the experience.</Alert>
          ) : (
            <Stack spacing={2}>
              {effectiveSelectedChannelIds.map((channelId: number) => {
                const channel = registry.channels.find((item) => item.id === channelId);
                if (!channel) {
                  return null;
                }
                return renderChannelCard(channel, platformBucket, registry.addons);
              })}
            </Stack>
          )}
        </Stack>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1.5}
          justifyContent={{ xs: 'flex-start', sm: 'space-between' }}
          alignItems={{ xs: 'flex-start', sm: 'center' }}
        >
          <Button
            variant="contained"
            onClick={() => {
              void handleProceedToReservations();
            }}
            disabled={registry.savingMetrics || confirmingMetrics}
          >
            Go to Reservations Check
          </Button>
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
        (channel): channel is ChannelConfig =>
          Boolean(channel) && !shouldHideAfterCutoffChannel(channel),
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
              <Stack spacing={2}>
              {effectiveSelectedChannelIds.map((channelId: number) => {
                const channel = registry.channels.find((item) => item.id === channelId);
                if (!channel) {
                  return null;
                }
                return renderChannelCard(channel, bucket, registry.addons);
              })}
              </Stack>
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
                <Stack spacing={2}>
                  {selectedAfterCutoffChannels.map((channel: ChannelConfig) => (
                    <Box key={channel.id + '-after-cutoff'}>
                      {renderChannelCard(channel, AFTER_CUTOFF_BUCKET, registry.addons)}
                    </Box>
                  ))}
                </Stack>
              )}
            </Stack>
          </Box>
        )}
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1.5}
          justifyContent={{ xs: 'flex-start', sm: 'space-between' }}
          alignItems={{ xs: 'flex-start', sm: 'center' }}
        >
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ xs: 'flex-start', sm: 'center' }}>
            <Button
              variant="outlined"
              onClick={() => {
                void handleReturnToPlatforms();
              }}
              disabled={registry.savingMetrics || confirmingMetrics}
            >
              Go to Platform Check
            </Button>
            <Button
              variant="contained"
              onClick={() => {
                void handleProceedToSummary();
              }}
              disabled={registry.savingMetrics || confirmingMetrics}
            >
              Proceed to Summary
            </Button>
          </Stack>
        </Stack>
      </Stack>
    );
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

  const summaryRow = (label: string, bucket: CounterSummaryBucket, options: SummaryRowOptions = {}) => {
    const { showBefore = true, showAfter = true, showNonShow = true } = options;

    const chips: JSX.Element[] = [];
    if (showBefore && bucket.bookedBefore > 0) {
      chips.push(<Chip key="before" label={'Before: ' + bucket.bookedBefore} size="small" />);
    }
    if (showAfter && bucket.bookedAfter > 0) {
      chips.push(
        <Chip
          key="after"
          label={'After: ' + bucket.bookedAfter}
          size="small"
          color="info"
        />,
      );
    }
    if (bucket.attended > 0) {
      chips.push(<Chip key="attended" label={'Attended: ' + bucket.attended} size="small" color="success" />);
    }
    if (showNonShow && bucket.nonShow > 0) {
      chips.push(<Chip key="non-show" label={'Non-show: ' + bucket.nonShow} size="small" color="warning" />);
    }

    if (chips.length === 0) {
      chips.push(<Chip key="no-bookings" label="No Bookings" size="small" variant="outlined" />);
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

    if (summaryChannels.length === 0) {
      return (
        <Stack spacing={3} sx={{ mt: 4 }}>
          <Alert severity="info">Select channels in Platform and Reservations to review the summary.</Alert>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1.5}
            justifyContent={{ xs: 'flex-start', sm: 'space-between' }}
            alignItems={{ xs: 'flex-start', sm: 'center' }}
          >
            <Typography
              variant="caption"
              sx={{ color: registry.savingMetrics || confirmingMetrics ? 'text.secondary' : hasDirtyMetrics ? 'warning.main' : 'text.secondary' }}
            >
              {metricsStatusMessage}
            </Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ xs: 'flex-start', sm: 'center' }}>
              <Button variant="outlined" onClick={() => setActiveRegistryStep('reservations')}>
                Back to Reservations
              </Button>
              <Button
                variant="contained"
                onClick={() => {
                  void handleSaveAndExit();
                }}
                disabled={registry.savingMetrics || confirmingMetrics}
              >
                SAVE & EXIT
              </Button>
            </Stack>
          </Stack>
        </Stack>
      );
    }

    const addonTotalsToShow = Object.values(summaryTotals.addons).filter(
      (addon) => addon.bookedBefore > 0 || addon.bookedAfter > 0 || addon.attended > 0 || addon.nonShow > 0,
    );

    return (
      <Stack spacing={3} sx={{ mt: 4 }}>
        <Box>
          <Typography variant="h6" gutterBottom>
            Summary
          </Typography>
          <Grid container spacing={2}>
            {summaryChannels.map((item) => {
              const isAfterCutoffChannel = AFTER_CUTOFF_ALLOWED.has(item.channelName.toLowerCase());
              const addonBuckets = Object.values(item.addons);
              const showBeforeForChannel =
                !isAfterCutoffChannel || effectiveSelectedChannelIds.includes(item.channelId);
              return (
                <Grid size={{ xs: 12, md: 6, lg: 4 }} key={item.channelId}>
                  <Card variant="outlined">
                    <CardContent>
                      <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                        {item.channelName}
                      </Typography>
                      {summaryRow('People', item.people, {
                        showBefore: showBeforeForChannel,
                        showAfter: true,
                        showNonShow: !isAfterCutoffChannel,
                      })}
                      <Divider sx={{ my: 1 }} />
                      {addonBuckets.map((addon) => (
                        <Box key={addon.key} sx={{ mb: 1 }}>
                          {summaryRow(addon.name, addon, {
                            showBefore: showBeforeForChannel,
                            showAfter: true,
                            showNonShow: !isAfterCutoffChannel,
                          })}
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
                  {summaryRow('People', summaryTotals.people, { showBefore: false, showAfter: false, showNonShow: true })}
                  <Divider sx={{ my: 1 }} />
                  {addonTotalsToShow.map((addon) => (
                    <Box key={addon.key} sx={{ mb: 1 }}>
                      {summaryRow(addon.name, addon, { showBefore: false, showAfter: false, showNonShow: true })}
                    </Box>
                  ))}
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        </Box>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1.5}
          justifyContent={{ xs: 'flex-start', sm: 'space-between' }}
          alignItems={{ xs: 'flex-start', sm: 'center' }}
        >
          <Typography
            variant="caption"
            sx={{ color: registry.savingMetrics || confirmingMetrics ? 'text.secondary' : hasDirtyMetrics ? 'warning.main' : 'text.secondary' }}
          >
            {metricsStatusMessage}
          </Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ xs: 'flex-start', sm: 'center' }}>
            <Button variant="outlined" onClick={() => setActiveRegistryStep('reservations')}>
              Back to Reservations
            </Button>
            <Button
              variant="contained"
              onClick={() => {
                void handleSaveAndExit();
              }}
              disabled={registry.savingMetrics || confirmingMetrics}
            >
              SAVE & EXIT
            </Button>
          </Stack>
        </Stack>
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
            minWidth: { xs: 'auto', md: '60vw' },
          }}
        >
          <CircularProgress />
        </Box>
      );
    }

    if (!registry.counter && modalMode !== 'create') {
      return (
        <Box sx={{ textAlign: 'center', py: 4, minWidth: { xs: 'auto', md: '60vw' } }}>
          <Typography variant="h6">Unable to load counter data.</Typography>
        </Box>
      );
    }

  return (
    <Box
      sx={{
        minWidth: { xs: '100%', md: '70vw' },
        minHeight: { xs: '100%', md: 'auto' },
        display: 'flex',
        flexDirection: 'column',
        px: { xs: 2, sm: 0 },
        py: { xs: 2, sm: 0 },
        boxSizing: 'border-box',
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
    <Stack
      direction="row"
      spacing={1.75}
      alignItems="center"
      justifyContent="flex-end"
      sx={{
        '& .MuiIconButton-root': {
          border: '1px solid rgba(255,255,255,0.35)',
          backgroundColor: 'rgba(255,255,255,0.12)',
          padding: 0.5,
          transition: 'background-color 120ms ease, transform 120ms ease',
          '&:active': {
            transform: 'scale(0.96)',
          },
        },
      }}
    >
      <Tooltip title="Add Counter">
        <IconButton
          color="primary"
          size="small"
          onClick={handleAddNewCounter}
          aria-label="Add counter"
        >
          <Add fontSize="small" />
        </IconButton>
      </Tooltip>
      <Tooltip title={canModifyCounter ? 'Update Counter' : 'Select a counter to update'}>
        <span style={{ display: 'inline-flex' }}>
          <IconButton
            size="small"
            onClick={() => handleOpenModal('update')}
            disabled={!canModifyCounter}
            sx={{ color: 'inherit' }}
            aria-label="Update counter"
          >
            <Edit fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title={canModifyCounter ? 'Delete Counter' : 'Select a counter to delete'}>
        <span style={{ display: 'inline-flex' }}>
          <IconButton
            size="small"
            color="error"
            onClick={handleDeleteCounter}
            disabled={!canModifyCounter}
            aria-label="Delete counter"
          >
            <Delete fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
    </Stack>
  ) : (
    <Stack direction="row" spacing={1} alignItems="center">
      <Button variant="contained" size="small" startIcon={<Add />} onClick={handleAddNewCounter}>
        Add New
      </Button>
      <Button
        variant="outlined"
        size="small"
        startIcon={<Edit />}
        onClick={() => handleOpenModal('update')}
        disabled={!canModifyCounter}
      >
        Update
      </Button>
      <Button
        variant="outlined"
        color="error"
        size="small"
        startIcon={<Delete />}
        onClick={handleDeleteCounter}
        disabled={!canModifyCounter}
      >
        Delete
      </Button>
    </Stack>
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
                  const secondaryContent = (
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
                  return (
                    <ListItem
                      key={(counter.id ?? 'counter') + '-' + dateLabel}
                      disablePadding
                      sx={{
                        borderBottom: (theme) => `1px dashed ${theme.palette.divider}`,
                        '&:last-of-type': { borderBottom: 'none' },
                      }}
                    >
                      <ListItemButton
                        disableRipple
                        disableTouchRipple
                        onClick={() => handleCounterSelect(counter)}
                        selected={Boolean(isSelected)}
                        sx={(theme) => ({
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
                        />
                      </ListItemButton>
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
        <DialogTitle id="counter-dialog-title" sx={{ m: 0, p: 2 }}>
          {modalTitle}
          <IconButton
            aria-label="close"
            onClick={handleCloseModal}
            sx={{ position: 'absolute', right: 8, top: 8 }}
          >
            <Close />
          </IconButton>
        </DialogTitle>
        <DialogContent
          dividers
          sx={{
            p: { xs: 2, sm: 3 },
          }}
        >
          {renderCounterEditor()}
        </DialogContent>
      </Dialog>
    </LocalizationProvider>
  );
};

export default Counters;
