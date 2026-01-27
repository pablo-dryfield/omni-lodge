import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  Alert,
  Badge,
  Box,
  Button,
  Center,
  Group,
  LoadingOverlay,
  Modal,
  MultiSelect,
  NumberInput,
  Paper,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Textarea,
  ThemeIcon,
  UnstyledButton,
  useMantineTheme,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { DatePickerInput } from '@mantine/dates';
import { IconAlertCircle, IconChartBar, IconInfoCircle } from '@tabler/icons-react';
import dayjs from 'dayjs';
import { useSearchParams } from 'react-router-dom';

import {
  fetchChannelNumbersBootstrap,
  recordChannelCashCollection,
  fetchChannelNumbersDetails,
} from '../../api/channelNumbers';
import {
  ChannelNumbersAddon,
  ChannelNumbersSummary as ChannelNumbersSummaryType,
  ChannelProductMetrics,
  ChannelCashRow,
  ChannelCashEntry,
  type ChannelNumbersDetailMetric,
  type ChannelNumbersDetailEntry,
} from '../../types/channelNumbers/ChannelNumbersSummary';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { selectFinanceAccounts, selectFinanceCategories, selectFinanceClients } from '../../selectors/financeSelectors';
import { createFinanceTransaction } from '../../actions/financeActions';
import { setFinanceBasics } from '../../reducers/financeReducer';

type Preset = 'thisMonth' | 'lastMonth' | 'custom';

const DATE_FORMAT = 'YYYY-MM-DD';
const MAIN_PRODUCT_TYPE_SLUG = 'main product';
const MAIN_PRODUCT_LABEL = 'Main Product';
const ACTIVITY_PRODUCT_LABEL = 'Activities';
const START_DATE_PARAM = 'startDate';
const END_DATE_PARAM = 'endDate';
const LEGACY_CUTOFF_DATE = '2025-10-01';

const DETAIL_METRIC_META: Record<
  ChannelNumbersDetailMetric,
  { label: string; color: string; totalLabel: string }
> = {
  normal: { label: 'Normal', color: 'blue', totalLabel: 'Normal total' },
  nonShow: { label: 'Non-Show', color: 'orange', totalLabel: 'Non-Show total' },
  addon: { label: 'Add-on', color: 'teal', totalLabel: 'Add-on total' },
  addonNonShow: { label: 'Add-on Non-Show', color: 'grape', totalLabel: 'Add-on Non-Show total' },
  total: { label: 'Combined', color: 'violet', totalLabel: 'Metric total' },
};

const normalizeTypeName = (value?: string | null) => (value ?? 'Other').trim().toLowerCase();

const formatDisplayRange = (value: [Date | null, Date | null]) => {
  const [start, end] = value;
  if (!start || !end) {
    return 'Select a date range';
  }
  return `${dayjs(start).format('MMM D, YYYY')} - ${dayjs(end).format('MMM D, YYYY')}`;
};

type ProductGroup = {
  id: number | string;
  name: string;
  slug: string;
  addons: ChannelNumbersAddon[];
};

type ProductTypeGroup = {
  id: number | string;
  name: string;
  slug: string;
  products: ProductGroup[];
};

type CashModalState = {
  open: boolean;
  channel: ChannelCashRow | null;
  amount: number;
  currency: string;
  accountId: string;
  categoryId: string;
  counterpartyId: string;
  date: Date;
  description: string;
};

type DrilldownContext = {
  metric: ChannelNumbersDetailMetric;
  channelId?: number;
  channelName?: string;
  productId?: number | null;
  productName?: string;
  addonKey?: string;
  addonName?: string;
  suffix?: string;
  label: string;
};

type DetailModalState = {
  open: boolean;
  loading: boolean;
  context: DrilldownContext | null;
  entries: ChannelNumbersDetailEntry[];
  totals: {
    bookedBefore: number;
    bookedAfter: number;
    attended: number;
    nonShow: number;
    value: number;
  } | null;
  error: string | null;
};

const getProductColumnCount = (product: ProductGroup) =>
  product.addons.length > 0 ? product.addons.length * 2 + 2 : 2;

const getTypeColumnCount = (type: ProductTypeGroup) =>
  type.products.reduce((sum, product) => sum + getProductColumnCount(product), 0);

const getProductKey = (productId: number | string) => productId.toString();

const getQuantityForProduct = (product: ProductGroup, metrics?: ChannelProductMetrics): number => {
  if (!metrics) {
    return 0;
  }
  if (product.addons.length === 0) {
    return metrics.normal;
  }
  return product.addons.reduce((sum, addon) => sum + (metrics.addons[addon.key] ?? 0), 0);
};

const CELL_BORDER_STYLE: CSSProperties = {
  border: '1px solid var(--mantine-color-gray-4)',
  textAlign: 'center',
};
const EMPHASIS_BORDER = '2px solid var(--mantine-color-gray-6)';
const NO_LEFT_BORDER: CSSProperties = { borderLeft: '0' };
const mergeCellStyles = (...styles: Array<CSSProperties | undefined>) =>
  Object.assign({}, CELL_BORDER_STYLE, ...styles.filter(Boolean));

const ChannelNumbersSummary = () => {
  const dispatch = useAppDispatch();
  const theme = useMantineTheme();
  const isMobile = useMediaQuery(`(max-width: ${theme.breakpoints.sm})`);
  const [searchParams, setSearchParams] = useSearchParams();
  const accountsState = useAppSelector(selectFinanceAccounts);
  const categoriesState = useAppSelector(selectFinanceCategories);
  const clientsState = useAppSelector(selectFinanceClients);
  const initialRange = useMemo<[Date | null, Date | null]>(() => {
    const startParam = searchParams.get(START_DATE_PARAM);
    const endParam = searchParams.get(END_DATE_PARAM);
    const parsedStart = startParam ? dayjs(startParam, DATE_FORMAT, true) : null;
    const parsedEnd = endParam ? dayjs(endParam, DATE_FORMAT, true) : null;
    if (parsedStart?.isValid() && parsedEnd?.isValid()) {
      return [parsedStart.toDate(), parsedEnd.toDate()];
    }
    return [dayjs().startOf('month').toDate(), dayjs().endOf('month').toDate()];
  }, [searchParams]);
  const initialPreset = useMemo<Preset>(() => {
    const startParam = searchParams.get(START_DATE_PARAM);
    const endParam = searchParams.get(END_DATE_PARAM);
    if (startParam && endParam) {
      return 'custom';
    }
    return 'thisMonth';
  }, [searchParams]);
  const [preset, setPreset] = useState<Preset>(initialPreset);
  const [range, setRange] = useState<[Date | null, Date | null]>(initialRange);
  const [summary, setSummary] = useState<ChannelNumbersSummaryType | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedProductTypes, setSelectedProductTypes] = useState<string[]>([]);
  const [cashModal, setCashModal] = useState<CashModalState>({
    open: false,
    channel: null,
    amount: 0,
    currency: 'PLN',
    accountId: '',
    categoryId: '',
    counterpartyId: '',
    date: new Date(),
    description: '',
  });
  const [cashSubmitting, setCashSubmitting] = useState(false);
  const [cashMessage, setCashMessage] = useState<string | null>(null);
  const [detailModal, setDetailModal] = useState<DetailModalState>({
    open: false,
    loading: false,
    context: null,
    entries: [],
    totals: null,
    error: null,
  });

  const handlePresetChange = useCallback((value: Preset) => {
    setPreset(value);
    if (value === 'thisMonth') {
      setRange([dayjs().startOf('month').toDate(), dayjs().endOf('month').toDate()]);
      return;
    }
    if (value === 'lastMonth') {
      const lastMonthEnd = dayjs().startOf('month').subtract(1, 'day');
      setRange([lastMonthEnd.startOf('month').toDate(), lastMonthEnd.endOf('month').toDate()]);
      return;
    }
  }, []);

  const fetchSummary = useCallback(async (): Promise<ChannelNumbersSummaryType | null> => {
    const [start, end] = range;
    if (!start || !end) {
      return null;
    }
    const response = await fetchChannelNumbersBootstrap({
      startDate: dayjs(start).format(DATE_FORMAT),
      endDate: dayjs(end).format(DATE_FORMAT),
    });
    if (response?.finance) {
      dispatch(
        setFinanceBasics({
          accounts: response.finance.accounts ?? [],
          categories: response.finance.categories ?? [],
          vendors: response.finance.vendors ?? [],
          clients: response.finance.clients ?? [],
        }),
      );
    }
    return response.summary ?? null;
  }, [dispatch, range]);

  useEffect(() => {
    let isMounted = true;
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetchSummary();
        if (!isMounted) {
          return;
        }
        if (response) {
          setSummary(response);
        } else {
          setSummary(null);
        }
      } catch (err) {
        if (!isMounted) {
          return;
        }
        const message =
          (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
          (err as { message?: string }).message ??
          'Failed to load channel numbers';
        setError(message);
        setSummary(null);
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };
    run();
    return () => {
      isMounted = false;
    };
  }, [fetchSummary]);

  useEffect(() => {
    const [start, end] = range;
    if (!start || !end) {
      return;
    }
    const startValue = dayjs(start).format(DATE_FORMAT);
    const endValue = dayjs(end).format(DATE_FORMAT);
    const currentStart = searchParams.get(START_DATE_PARAM);
    const currentEnd = searchParams.get(END_DATE_PARAM);
    if (currentStart === startValue && currentEnd === endValue) {
      return;
    }
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set(START_DATE_PARAM, startValue);
    nextParams.set(END_DATE_PARAM, endValue);
    setSearchParams(nextParams, { replace: true });
  }, [range, searchParams, setSearchParams]);

  const productTypeGroups = useMemo<ProductTypeGroup[]>(() => {
    if (!summary) {
      return [];
    }
    const addonLookup = new Map<string, ChannelNumbersAddon>();
    (summary?.addons ?? []).forEach((addon) => {
      addonLookup.set(addon.key, addon);
    });

    const rawProducts =
      summary?.products && summary.products.length > 0
        ? summary.products
        : (() => {
            const grouped = new Map<
              number | string,
              {
                id: number | string;
                name: string;
                productTypeId: number | null;
                productTypeName: string | null;
                addonKeys: string[];
              }
            >();
            (summary?.addons ?? []).forEach((addon) => {
              const key = addon.productId ?? addon.productName ?? addon.key;
              const existing =
                grouped.get(key) ??
                {
                  id: addon.productId ?? key,
                  name: addon.productName ?? addon.name,
                  productTypeId: addon.productTypeId ?? null,
                  productTypeName: addon.productTypeName ?? null,
                  addonKeys: [],
                };
              existing.addonKeys.push(addon.key);
              grouped.set(key, existing);
            });
            return Array.from(grouped.values());
          })();

    const groups = new Map<string, ProductTypeGroup>();
    const ensureGroup = (typeId: number | string | null, typeName: string | null): ProductTypeGroup => {
      const slug = normalizeTypeName(typeName ?? 'Other');
      if (!groups.has(slug)) {
        groups.set(slug, {
          id: typeId ?? slug,
          name: typeName ?? 'Other',
          slug,
          products: [],
        });
      }
      return groups.get(slug)!;
    };

    rawProducts.forEach((product) => {
      const group = ensureGroup(product.productTypeId ?? `type-${product.id}`, product.productTypeName ?? null);
      const addons =
        (product.addonKeys ?? [])
          .map((key) => addonLookup.get(key))
          .filter((addon): addon is ChannelNumbersAddon => Boolean(addon)) ?? [];
      group.products.push({
        id: product.id,
        name: product.name,
        slug: normalizeTypeName(product.name),
        addons,
      });
    });

    if (groups.size === 0) {
      groups.set(MAIN_PRODUCT_TYPE_SLUG, {
        id: MAIN_PRODUCT_TYPE_SLUG,
        name: MAIN_PRODUCT_LABEL,
        slug: MAIN_PRODUCT_TYPE_SLUG,
        products: [
          {
            id: 'default-main',
            name: MAIN_PRODUCT_LABEL,
            slug: normalizeTypeName(MAIN_PRODUCT_LABEL),
            addons: [],
          },
        ],
      });
    }

    const prioritizedTypes = new Map<string, number>([
      [MAIN_PRODUCT_TYPE_SLUG, 0],
      [normalizeTypeName(ACTIVITY_PRODUCT_LABEL), 1],
    ]);

    const prioritizeMainProduct = (group: ProductTypeGroup) =>
      group.products.sort((a, b) => {
        if (group.slug === MAIN_PRODUCT_TYPE_SLUG) {
          const aIsPub = a.name.toLowerCase() === 'pub crawl';
          const bIsPub = b.name.toLowerCase() === 'pub crawl';
          if (aIsPub || bIsPub) {
            return Number(bIsPub) - Number(aIsPub);
          }
        }
        return a.name.localeCompare(b.name);
      });

    return Array.from(groups.values())
      .map((group) => ({
        ...group,
        products: prioritizeMainProduct(group),
      }))
      .sort((a, b) => {
        const aPriority = prioritizedTypes.get(a.slug);
        const bPriority = prioritizedTypes.get(b.slug);
        if (aPriority != null || bPriority != null) {
          return (aPriority ?? Number.MAX_SAFE_INTEGER) - (bPriority ?? Number.MAX_SAFE_INTEGER);
        }
        return a.name.localeCompare(b.name);
      });
  }, [summary]);

  const selectableProductTypes = useMemo(() => {
    const names = new Set(productTypeGroups.map((group) => group.name));
    return Array.from(names);
  }, [productTypeGroups]);

  const accountOptions = useMemo(
    () =>
      accountsState.data
        .filter((account) => (account.type === 'cash' || account.type === 'bank') && (account.isActive ?? true))
        .map((account) => ({
          value: String(account.id),
          label: account.currency ? `${account.name} (${account.currency})` : account.name,
        })),
    [accountsState.data],
  );

  const incomeCategoryOptions = useMemo(
    () =>
      categoriesState.data
        .filter((category) => category.kind === 'income')
        .map((category) => ({ value: String(category.id), label: category.name })),
    [categoriesState.data],
  );

  const clientOptions = useMemo(
    () => clientsState.data.map((client) => ({ value: String(client.id), label: client.name })),
    [clientsState.data],
  );

  const resolveDefaultAccountId = useCallback(
    (currencyCode: string): string => {
      if (!accountsState.data.length) {
        return '';
      }
      const normalizedCurrency = currencyCode?.toUpperCase() || 'PLN';
      const matchingCashAccount = accountsState.data.find(
        (account) => account.type === 'cash' && (account.currency ?? '').toUpperCase() === normalizedCurrency,
      );
      if (matchingCashAccount) {
        return String(matchingCashAccount.id);
      }
      const anyCash = accountsState.data.find((account) => account.type === 'cash');
      if (anyCash) {
        return String(anyCash.id);
      }
      return String(accountsState.data[0].id);
    },
    [accountsState.data],
  );

  const resolveDefaultCategoryId = useCallback((): string => {
    if (!incomeCategoryOptions.length) {
      return '';
    }
    return incomeCategoryOptions[0].value;
  }, [incomeCategoryOptions]);

  useEffect(() => {
    if (selectableProductTypes.length === 0) {
      setSelectedProductTypes([]);
      return;
    }
    setSelectedProductTypes((prev) => {
      const prevKey = [...prev].sort().join('|');
      const nextKey = [...selectableProductTypes].sort().join('|');
      if (prevKey === nextKey) {
        return prev;
      }
      return selectableProductTypes;
    });
  }, [selectableProductTypes]);

  const visibleTypeGroups = useMemo(() => {
    if (selectedProductTypes.length === 0) {
      return productTypeGroups;
    }
    const selected = new Set(selectedProductTypes);
    return productTypeGroups.filter((group) => selected.has(group.name));
  }, [productTypeGroups, selectedProductTypes]);

  const totalTypeColumns = useMemo(
    () => visibleTypeGroups.reduce((sum, group) => sum + getTypeColumnCount(group), 0),
    [visibleTypeGroups],
  );

  const cashSummary = summary?.cashSummary;
  const isLegacyRange = useMemo(() => {
    if (!summary?.endDate) {
      return false;
    }
    return dayjs(summary.endDate).isBefore(LEGACY_CUTOFF_DATE, 'day');
  }, [summary?.endDate]);
  const cashRows = useMemo(() => {
    const rows = cashSummary?.channels ?? [];
    if (!isLegacyRange) {
      return rows;
    }
    return rows.map((row) => ({
      ...row,
      collectedAmount: row.dueAmount,
      outstandingAmount: 0,
    }));
  }, [cashSummary?.channels, isLegacyRange]);
  const cashEntries = cashSummary?.entries ?? [];
  const cashTotals = useMemo(() => {
    const totals = cashSummary?.totals ?? [];
    if (!isLegacyRange) {
      return totals;
    }
    return totals.map((total) => ({
      ...total,
      collectedAmount: total.dueAmount,
      outstandingAmount: 0,
    }));
  }, [cashSummary?.totals, isLegacyRange]);
  const cashRangeIsCanonical = cashSummary?.rangeIsCanonical ?? false;

  const numberFormatter = useMemo(
    () =>
      new Intl.NumberFormat('en-US', {
        maximumFractionDigits: 0,
      }),
    [],
  );
  const formatCurrencyValue = useCallback((value: number, currency: string) => {
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: currency || 'PLN',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(value || 0);
    } catch {
      return `${currency || 'PLN'} ${value.toFixed(2)}`;
    }
  }, []);

  const handleOpenCashModal = useCallback(
    (row: ChannelCashRow) => {
      if (!summary) {
        return;
      }
      const rangeLabel = `${dayjs(summary.startDate).format('MMM D, YYYY')} - ${dayjs(summary.endDate).format('MMM D, YYYY')}`;
      setCashModal({
        open: true,
        channel: row,
        amount: row.outstandingAmount > 0 ? row.outstandingAmount : row.dueAmount,
        currency: row.currency,
        accountId: resolveDefaultAccountId(row.currency),
        categoryId: resolveDefaultCategoryId(),
        counterpartyId: clientOptions[0]?.value ?? '',
        date: new Date(),
        description: `Cash collection for ${row.channelName} (${rangeLabel})`,
      });
      setCashMessage(null);
    },
    [clientOptions, resolveDefaultAccountId, resolveDefaultCategoryId, summary],
  );

  const handleCloseCashModal = useCallback(() => {
    setCashModal({
      open: false,
      channel: null,
      amount: 0,
      currency: 'PLN',
      accountId: '',
      categoryId: '',
      counterpartyId: '',
      date: new Date(),
      description: '',
    });
    setCashMessage(null);
  }, []);

  const handleCashSubmit = useCallback(async () => {
    if (!summary || !cashModal.channel) {
      setCashMessage('Select a channel entry before recording a collection.');
      return;
    }
    if (
      cashModal.amount <= 0 ||
      !cashModal.accountId ||
      !cashModal.categoryId ||
      !cashModal.counterpartyId
    ) {
      setCashMessage('Fill in the amount, account, category, and client.');
      return;
    }
    setCashSubmitting(true);
    setCashMessage(null);
    try {
      const transaction = await dispatch(
        createFinanceTransaction({
          kind: 'income',
          date: dayjs(cashModal.date).format('YYYY-MM-DD'),
          accountId: Number(cashModal.accountId),
          currency: cashModal.currency,
          amountMinor: Math.round(cashModal.amount * 100),
          categoryId: Number(cashModal.categoryId),
          counterpartyType: 'client',
          counterpartyId: Number(cashModal.counterpartyId),
          status: 'paid',
          description: cashModal.description || null,
          meta: {
            source: 'channel-numbers',
            channelId: cashModal.channel.channelId,
            rangeStart: summary.startDate,
            rangeEnd: summary.endDate,
          },
        }),
      ).unwrap();

      await recordChannelCashCollection({
        channelId: cashModal.channel.channelId,
        currency: cashModal.currency,
        amount: cashModal.amount,
        rangeStart: summary.startDate,
        rangeEnd: summary.endDate,
        financeTransactionId: transaction.id,
        note: cashModal.description,
      });
      handleCloseCashModal();
      await fetchSummary();
    } catch (err) {
      const message =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        (err as { message?: string }).message ??
        'Failed to record cash collection';
      setCashMessage(message);
    } finally {
      setCashSubmitting(false);
    }
  }, [cashModal, dispatch, fetchSummary, handleCloseCashModal, summary]);
  const handleCloseDetailModal = useCallback(() => {
    setDetailModal({
      open: false,
      loading: false,
      context: null,
      entries: [],
      totals: null,
      error: null,
    });
  }, []);

  const handleShowDetail = useCallback(
    (context: DrilldownContext) => {
      if (!summary) {
        return;
      }
      setDetailModal({
        open: true,
        loading: true,
        context,
        entries: [],
        totals: null,
        error: null,
      });
      const payload: {
        startDate: string;
        endDate: string;
        metric: ChannelNumbersDetailMetric;
        channelId?: number;
        productId?: number | null;
        addonKey?: string;
      } = {
        startDate: summary.startDate,
        endDate: summary.endDate,
        metric: context.metric,
      };
      if (typeof context.channelId === 'number') {
        payload.channelId = context.channelId;
      }
      if (context.productId !== undefined) {
        payload.productId = context.productId;
      }
      if (context.addonKey) {
        payload.addonKey = context.addonKey;
      }
      fetchChannelNumbersDetails(payload)
        .then((response) => {
          setDetailModal((prev) => ({
            ...prev,
            loading: false,
            entries: response.entries,
            totals: response.totals,
          }));
        })
        .catch((err) => {
          const message =
            (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
            (err as { message?: string }).message ??
            'Failed to load metric details';
          setDetailModal((prev) => ({
            ...prev,
            loading: false,
            error: message,
          }));
        });
    },
    [summary],
  );

  const buildDrilldownContext = (
    metric: ChannelNumbersDetailMetric,
    options: {
      channelId?: number;
      channelName?: string;
      productId?: number | null;
      productName?: string;
      addonKey?: string;
      addonName?: string;
      suffix?: string;
    },
  ): DrilldownContext => {
    const parts = [options.channelName, options.productName, options.addonName, options.suffix].filter(
      (part): part is string => Boolean(part && part.trim().length > 0),
    );
    return {
      metric,
      channelId: options.channelId,
      channelName: options.channelName,
      productId: options.productId,
      productName: options.productName,
      addonKey: options.addonKey,
      addonName: options.addonName,
      suffix: options.suffix,
      label: parts.length > 0 ? parts.join(' • ') : 'Metric details',
    };
  };

  const renderValue = useCallback(
    (value: number, context?: DrilldownContext) => {
      const content = <Text fw={value > 0 ? 600 : undefined}>{numberFormatter.format(value)}</Text>;
      if (!context || !summary) {
        return content;
      }
      return (
        <UnstyledButton
          type="button"
          onClick={() => handleShowDetail(context)}
          style={{ width: '100%', display: 'block', textAlign: 'center', color: 'inherit', padding: '0.1rem' }}
          aria-label={context.label}
        >
          {content}
        </UnstyledButton>
      );
    },
    [handleShowDetail, numberFormatter, summary],
  );

  const formatDetailNote = (note?: string | null) => {
    if (!note) {
      return '—';
    }
    const trimmed = note.replace(/\s+/g, ' ').trim();
    if (!trimmed) {
      return '—';
    }
    return trimmed.length > 140 ? `${trimmed.slice(0, 140)}…` : trimmed;
  };

  const renderMetricCard = (label: string, value: number, color: string) => (
    <Paper withBorder p="md" key={label}>
      <Group justify="space-between">
        <Stack gap={2}>
          <Text size="sm" c="dimmed">
            {label}
          </Text>
          <Text size="xl" fw={700}>
            {numberFormatter.format(value)}
          </Text>
        </Stack>
        <ThemeIcon color={color} variant="light" size="lg">
          <IconChartBar size={18} />
        </ThemeIcon>
      </Group>
    </Paper>
  );

  const renderDetailStat = (label: string, value: number, highlighted?: boolean) => (
    <Paper withBorder p="sm" radius="md" key={label} bg={highlighted ? 'var(--mantine-color-gray-0)' : undefined}>
      <Stack gap={2}>
        <Text size="xs" c="dimmed">
          {label}
        </Text>
        <Text fw={highlighted ? 700 : 600} size="lg">
          {numberFormatter.format(value)}
        </Text>
      </Stack>
    </Paper>
  );

  const tableHasData = Boolean(summary && summary.channels.length > 0);
  const currentDetailMetricKey: ChannelNumbersDetailMetric =
    detailModal.context?.metric ?? 'normal';

  return (
    <Stack mt="lg">
      <Paper withBorder p="md">
        <Stack gap="sm">
          <Group justify="space-between" align={isMobile ? 'stretch' : 'flex-end'} gap="sm" wrap="wrap">
            <Stack gap={4} style={{ flex: '1 1 260px', minWidth: 0 }}>
              <Text fw={600}>Reporting period</Text>
              <Group gap="xs" wrap="wrap">
                <Button
                  size="xs"
                  variant={preset === 'thisMonth' ? 'filled' : 'light'}
                  onClick={() => handlePresetChange('thisMonth')}
                >
                  This Month
                </Button>
                <Button
                  size="xs"
                  variant={preset === 'lastMonth' ? 'filled' : 'light'}
                  onClick={() => handlePresetChange('lastMonth')}
                >
                  Last Month
                </Button>
                <Button
                  size="xs"
                  variant={preset === 'custom' ? 'filled' : 'light'}
                  onClick={() => setPreset('custom')}
                >
                  Custom
                </Button>
              </Group>
            </Stack>
            <Box
              w={isMobile ? '100%' : 'auto'}
              style={{ display: 'flex', justifyContent: isMobile ? 'flex-start' : 'flex-end' }}
            >
              {preset === 'custom' ? (
                <DatePickerInput
                  type="range"
                  value={range}
                  onChange={setRange}
                  maxDate={dayjs().endOf('day').toDate()}
                  placeholder="Select range"
                  allowSingleDateInRange
                  style={{ width: isMobile ? '100%' : 260 }}
                />
              ) : (
                <Text size="sm" c="dimmed" style={{ textAlign: isMobile ? 'left' : 'right', width: '100%' }}>
                  {formatDisplayRange(range)}
                </Text>
              )}
            </Box>
          </Group>
          {selectableProductTypes.length > 0 && (
            <MultiSelect
              label="Product types"
              data={selectableProductTypes.map((type) => ({ label: type, value: type }))}
              value={selectedProductTypes}
              onChange={setSelectedProductTypes}
              placeholder="Select product types"
              clearable
            />
          )}
        </Stack>
      </Paper>

      <Paper withBorder p="md" pos="relative">
        <LoadingOverlay visible={loading} zIndex={5} />
        {error && (
          <Alert color="red" icon={<IconAlertCircle size={16} />} mb="md">
            {error}
          </Alert>
        )}
        {summary && (
          <Stack gap="md">
            <SimpleGrid cols={{ base: 1, md: 3 }}>
              {renderMetricCard('Pub crawl attendees', summary.totals.normal, 'blue')}
              {renderMetricCard(
                'Add-ons sold',
                Object.values(summary.totals.addons).reduce((sum, v) => sum + v, 0),
                'green',
              )}
              {renderMetricCard('Platform total', summary.totals.total, 'violet')}
            </SimpleGrid>
            {cashSummary && (
              <Paper withBorder p="md">
                <Stack gap="sm">
                  <Group
                    justify="space-between"
                    align={isMobile ? 'flex-start' : 'flex-end'}
                    gap="sm"
                    wrap="wrap"
                  >
                    <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                      <Text fw={600}>Cash collections</Text>
                      <Text size="sm" c="dimmed">
                        Outstanding amounts recorded for cash payment channels
                      </Text>
                    </div>
                    {!cashRangeIsCanonical && (
                      <Box w={isMobile ? '100%' : 'auto'}>
                        <Text size="sm" c="red" ta={isMobile ? 'left' : 'right'}>
                          Collections can only be recorded when viewing a full calendar month.
                        </Text>
                      </Box>
                    )}
                  </Group>
                  {cashRows.length === 0 ? (
                    <Text size="sm" c="dimmed">
                      No cash activity recorded for the selected period.
                    </Text>
                  ) : (
                    <ScrollArea offsetScrollbars type="auto">
                      <Table
                        highlightOnHover
                        withColumnBorders
                        horizontalSpacing="sm"
                        verticalSpacing="xs"
                        miw={600}
                      >
                        <thead>
                          <tr>
                            <th>Channel</th>
                            <th>Currency</th>
                            <th>Due</th>
                            <th>Collected</th>
                            <th>Outstanding</th>
                            <th>Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {cashRows.map((row) => {
                            const key = `${row.channelId}-${row.currency}`;
                            const canCollect = !isLegacyRange && cashRangeIsCanonical && row.outstandingAmount > 0;
                            return (
                              <tr key={key}>
                                <td>
                                  <Text fw={600}>{row.channelName}</Text>
                                </td>
                                <td>{row.currency}</td>
                                <td>{formatCurrencyValue(row.dueAmount, row.currency)}</td>
                                <td>{formatCurrencyValue(row.collectedAmount, row.currency)}</td>
                                <td>{formatCurrencyValue(row.outstandingAmount, row.currency)}</td>
                                <td>
                                  <Button
                                    size="xs"
                                    variant="light"
                                    disabled={!canCollect}
                                    onClick={() => handleOpenCashModal(row)}
                                  >
                                    Collect
                                  </Button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </Table>
                    </ScrollArea>
                  )}
                  {cashTotals.length > 0 && (
                    <Group gap="lg" wrap="wrap">
                      {cashTotals.map((total) => (
                        <Stack gap={0} key={total.currency}>
                          <Text size="sm" c="dimmed">
                            {total.currency} totals
                          </Text>
                          <Text size="sm">
                            Due {formatCurrencyValue(total.dueAmount, total.currency)} · Collected{' '}
                            {formatCurrencyValue(total.collectedAmount, total.currency)} · Outstanding{' '}
                            {formatCurrencyValue(total.outstandingAmount, total.currency)}
                          </Text>
                        </Stack>
                      ))}
                    </Group>
                  )}
                  {cashEntries.length > 0 && (
                    <Stack gap="xs">
                      <Text fw={600}>Ticket and note summary</Text>
                      <ScrollArea h={240} offsetScrollbars type="auto">
                        <Table
                          striped
                          withColumnBorders
                          highlightOnHover
                          horizontalSpacing="sm"
                          verticalSpacing="xs"
                          miw={720}
                        >
                          <thead>
                            <tr>
                              <th style={{ width: 140 }}>Date</th>
                              <th style={{ width: 180 }}>Channel</th>
                              <th>Tickets</th>
                              <th style={{ width: 200 }}>Amounts</th>
                              <th>Notes</th>
                            </tr>
                          </thead>
                          <tbody>
                            {cashEntries.map((entry: ChannelCashEntry) => (
                              <tr key={`${entry.counterId}-${entry.channelId}`}>
                                <td>{dayjs(entry.counterDate).format('MMM D, YYYY')}</td>
                                <td>{entry.channelName}</td>
                                <td>{entry.ticketSummary ?? '—'}</td>
                                <td>
                                  {entry.amounts.length === 0
                                    ? '—'
                                    : entry.amounts
                                        .map((amount) => formatCurrencyValue(amount.amount, amount.currency))
                                        .join(', ')}
                                </td>
                                <td>{entry.note ?? '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </Table>
                      </ScrollArea>
                    </Stack>
                  )}
                </Stack>
              </Paper>
            )}
            <ScrollArea offsetScrollbars type="auto">
              <Table
                highlightOnHover
                withColumnBorders
                withRowBorders
                withTableBorder
                horizontalSpacing="sm"
                verticalSpacing="xs"
                style={{ borderWidth: 2, borderColor: 'var(--mantine-color-gray-5)' }}
              >
                <thead>
                  <tr>
                    <th
                      rowSpan={3}
                      style={mergeCellStyles({
                        textAlign: 'center',
                        borderRight: EMPHASIS_BORDER,
                        borderBottom: EMPHASIS_BORDER,
                      })}
                    >
                      Channel
                    </th>
                    {visibleTypeGroups.map((group, groupIndex) => (
                      <th
                        key={`type-${group.slug}`}
                        colSpan={getTypeColumnCount(group)}
                        style={{
                          ...mergeCellStyles({
                            textAlign: 'center',
                            fontWeight: 700,
                            borderLeft: groupIndex === 0 ? undefined : EMPHASIS_BORDER,
                            borderRight: groupIndex === visibleTypeGroups.length - 1 ? undefined : EMPHASIS_BORDER,
                            borderBottom: EMPHASIS_BORDER,
                          }),
                        }}
                      >
                        {group.name}
                      </th>
                    ))}
                    <th
                      rowSpan={3}
                      style={mergeCellStyles({
                        textAlign: 'center',
                        borderLeft: EMPHASIS_BORDER,
                        borderBottom: EMPHASIS_BORDER,
                        fontWeight: 700,
                      })}
                    >
                      Totals by Platform
                    </th>
                  </tr>
                  <tr>
                    {visibleTypeGroups.flatMap((group, groupIndex) =>
                      group.products.map((product, productIndex) => (
                        <th
                          key={`product-${group.slug}-${product.slug}`}
                          colSpan={getProductColumnCount(product)}
                          style={{
                            ...mergeCellStyles({
                              textAlign: 'center',
                              fontWeight: 600,
                              borderBottom: EMPHASIS_BORDER,
                            }),
                            borderLeft: EMPHASIS_BORDER,
                            borderRight:
                              productIndex === group.products.length - 1
                                ? groupIndex === visibleTypeGroups.length - 1
                                  ? undefined
                                  : EMPHASIS_BORDER
                                : undefined,
                          }}
                        >
                          {product.name}
                        </th>
                      )),
                    )}
                  </tr>
                  <tr>
                    {visibleTypeGroups.flatMap((group, groupIndex) =>
                      group.products.flatMap((product, productIndex) =>
                        product.addons.length > 0
                          ? [
                              <th
                                key={`label-normal-${group.slug}-${product.slug}`}
                                style={{
                                  ...mergeCellStyles({ textAlign: 'center', fontWeight: 600 }),
                                  borderLeft: EMPHASIS_BORDER,
                                  borderBottom: EMPHASIS_BORDER,
                                }}
                              >
                                Normal
                              </th>,
                              <th
                                key={`label-nonshow-${group.slug}-${product.slug}`}
                                style={mergeCellStyles(
                                  { textAlign: 'center', fontWeight: 600, borderBottom: EMPHASIS_BORDER },
                                  NO_LEFT_BORDER,
                                )}
                              >
                                Non-Show
                              </th>,
                              ...product.addons.flatMap((addon, addonIndex) => [
                                <th
                                  key={`label-addon-${group.slug}-${product.slug}-${addon.key}`}
                                  style={mergeCellStyles({
                                    textAlign: 'center',
                                    fontWeight: 600,
                                    borderBottom: EMPHASIS_BORDER,
                                  })}
                                >
                                  {addon.name}
                                </th>,
                                <th
                                  key={`label-addon-nonshow-${group.slug}-${product.slug}-${addon.key}`}
                                  style={mergeCellStyles(
                                    {
                                      textAlign: 'center',
                                      fontWeight: 600,
                                      borderBottom: EMPHASIS_BORDER,
                                    },
                                    NO_LEFT_BORDER,
                                    addonIndex === product.addons.length - 1 &&
                                      (groupIndex !== visibleTypeGroups.length - 1 ||
                                        productIndex !== group.products.length - 1)
                                      ? { borderRight: EMPHASIS_BORDER }
                                      : undefined,
                                  )}
                                >
                                  {`${addon.name} (Non-Show)`}
                                </th>,
                              ]),
                            ]
                          : [
                                <th
                                  key={`label-quantity-${group.slug}-${product.slug}`}
                                  style={{
                                    ...mergeCellStyles({ textAlign: 'center', fontWeight: 600 }),
                                    borderLeft: EMPHASIS_BORDER,
                                    borderBottom: EMPHASIS_BORDER,
                                  }}
                                >
                                  Quantity
                                </th>,
                                <th
                                  key={`label-quantity-nonshow-${group.slug}-${product.slug}`}
                                  style={mergeCellStyles(
                                    {
                                      textAlign: 'center',
                                      fontWeight: 600,
                                      borderBottom: EMPHASIS_BORDER,
                                    },
                                    NO_LEFT_BORDER,
                                    productIndex === group.products.length - 1 && groupIndex !== visibleTypeGroups.length - 1
                                      ? { borderRight: EMPHASIS_BORDER }
                                      : undefined,
                                  )}
                                >
                                  Non-Show
                                </th>,
                              ],
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {tableHasData ? (
                    summary.channels.map((channel) => (
                      <tr key={channel.channelId}>
                        <td style={mergeCellStyles({ borderRight: EMPHASIS_BORDER })}>
                          <Text fw={600}>{channel.channelName}</Text>
                        </td>
                        {visibleTypeGroups.flatMap((group, groupIndex) =>
                          group.products.flatMap((product, productIndex) => {
                            const isLastProductInGroup = productIndex === group.products.length - 1;
                            const productKey = getProductKey(product.id);
                            const productMetrics = channel.products?.[productKey];
                            const numericProductId =
                              typeof product.id === 'number' ? product.id : productMetrics?.productId ?? undefined;
                            const baseContextOptions = {
                              channelId: channel.channelId,
                              channelName: channel.channelName,
                              productId: numericProductId,
                              productName: product.name,
                            };
                            if (product.addons.length > 0) {
                              const normalValue = productMetrics?.normal ?? 0;
                              const nonShowValue = productMetrics?.nonShow ?? 0;
                              const normalContext = buildDrilldownContext('normal', {
                                ...baseContextOptions,
                                suffix: 'Normal',
                              });
                              const nonShowContext = buildDrilldownContext('nonShow', {
                                ...baseContextOptions,
                                suffix: 'Non-Show',
                              });
                              return [
                                <td
                                  key={`normal-${group.slug}-${product.slug}-${channel.channelId}`}
                                  style={mergeCellStyles({
                                    fontWeight:
                                      group.slug === MAIN_PRODUCT_TYPE_SLUG && normalValue > 0 ? 600 : undefined,
                                    borderLeft: EMPHASIS_BORDER,
                                  })}
                                >
                                  {renderValue(normalValue, normalContext)}
                                </td>,
                                <td
                                  key={`nonshow-${group.slug}-${product.slug}-${channel.channelId}`}
                                  style={mergeCellStyles(NO_LEFT_BORDER)}
                                >
                                  {renderValue(nonShowValue, nonShowContext)}
                                </td>,
                                ...product.addons.flatMap((addon, addonIndex) => [
                                  <td
                                    key={`addon-${group.slug}-${product.slug}-${addon.key}-${channel.channelId}`}
                                    style={mergeCellStyles()}
                                  >
                                    {renderValue(
                                      productMetrics?.addons?.[addon.key] ?? 0,
                                      buildDrilldownContext('addon', {
                                        ...baseContextOptions,
                                        addonKey: addon.key,
                                        addonName: addon.name,
                                      }),
                                    )}
                                  </td>,
                                  <td
                                    key={`addon-nonshow-${group.slug}-${product.slug}-${addon.key}-${channel.channelId}`}
                                    style={mergeCellStyles(
                                      NO_LEFT_BORDER,
                                      isLastProductInGroup &&
                                        addonIndex === product.addons.length - 1 &&
                                        groupIndex !== visibleTypeGroups.length - 1
                                        ? { borderRight: EMPHASIS_BORDER }
                                        : undefined,
                                    )}
                                  >
                                    {renderValue(
                                      productMetrics?.addonNonShow?.[addon.key] ?? 0,
                                      buildDrilldownContext('addonNonShow', {
                                        ...baseContextOptions,
                                        addonKey: addon.key,
                                        addonName: addon.name,
                                        suffix: 'Non-Show',
                                      }),
                                    )}
                                  </td>,
                                ]),
                              ];
                            }
                            const quantityContext = buildDrilldownContext('normal', {
                              ...baseContextOptions,
                              suffix: 'Quantity',
                            });
                            const productNonShowContext = buildDrilldownContext('nonShow', {
                              ...baseContextOptions,
                              suffix: 'Non-Show',
                            });
                            return [
                              <td
                                key={`quantity-${group.slug}-${product.slug}-${channel.channelId}`}
                                style={mergeCellStyles(
                                  { borderLeft: EMPHASIS_BORDER },
                                )}
                              >
                                {renderValue(getQuantityForProduct(product, productMetrics), quantityContext)}
                              </td>,
                              <td
                                key={`quantity-nonshow-${group.slug}-${product.slug}-${channel.channelId}`}
                                style={mergeCellStyles(
                                  NO_LEFT_BORDER,
                                  isLastProductInGroup && groupIndex !== visibleTypeGroups.length - 1
                                    ? { borderRight: EMPHASIS_BORDER }
                                    : undefined,
                                )}
                              >
                                {renderValue(productMetrics?.nonShow ?? 0, productNonShowContext)}
                              </td>,
                            ];
                          }),
                        )}
                        <td style={mergeCellStyles({ fontWeight: 600, borderLeft: EMPHASIS_BORDER })}>
                          {renderValue(
                            channel.total,
                            buildDrilldownContext('total', {
                              channelId: channel.channelId,
                              channelName: channel.channelName,
                              suffix: 'Platform Total',
                            }),
                          )}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td
                        colSpan={1 + totalTypeColumns + 1}
                        style={mergeCellStyles({ textAlign: 'center', borderLeft: EMPHASIS_BORDER, borderRight: EMPHASIS_BORDER })}
                      >
                        <Group justify="center" gap="xs">
                          <IconInfoCircle size={16} />
                          <Text c="dimmed" size="sm">
                            No channel metrics available for the selected period.
                          </Text>
                        </Group>
                      </td>
                    </tr>
                  )}
                </tbody>
                {tableHasData && (
                  <tfoot>
                    <tr>
                      <td style={mergeCellStyles({ borderRight: EMPHASIS_BORDER, borderTop: EMPHASIS_BORDER })}>
                        <Text fw={700}>Total</Text>
                      </td>
                      {visibleTypeGroups.flatMap((group, groupIndex) =>
                        group.products.flatMap((product, productIndex) => {
                          const isLastProductInGroup = productIndex === group.products.length - 1;
                          const productKey = getProductKey(product.id);
                          const productTotals = summary.productTotals?.[productKey];
                          const totalsProductId =
                            typeof product.id === 'number' ? product.id : productTotals?.productId ?? undefined;
                          const totalsContextBase = {
                            productId: totalsProductId,
                            productName: product.name,
                          };
                          if (product.addons.length > 0) {
                            const normalTotal = productTotals?.normal ?? 0;
                            const nonShowTotal = productTotals?.nonShow ?? 0;
                            return [
                              <td
                                key={`total-normal-${group.slug}-${product.slug}`}
                                style={mergeCellStyles({ borderTop: EMPHASIS_BORDER, borderLeft: EMPHASIS_BORDER })}
                              >
                                {renderValue(
                                  normalTotal,
                                  buildDrilldownContext('normal', {
                                    ...totalsContextBase,
                                    suffix: 'Normal (All Channels)',
                                  }),
                                )}
                              </td>,
                              <td
                                key={`total-nonshow-${group.slug}-${product.slug}`}
                                style={mergeCellStyles({ borderTop: EMPHASIS_BORDER }, NO_LEFT_BORDER)}
                              >
                                {renderValue(
                                  nonShowTotal,
                                  buildDrilldownContext('nonShow', {
                                    ...totalsContextBase,
                                    suffix: 'Non-Show (All Channels)',
                                  }),
                                )}
                              </td>,
                              ...product.addons.flatMap((addon, addonIndex) => [
                                <td
                                  key={`total-addon-${group.slug}-${product.slug}-${addon.key}`}
                                  style={mergeCellStyles({ borderTop: EMPHASIS_BORDER })}
                                >
                                  {renderValue(
                                    productTotals?.addons?.[addon.key] ?? 0,
                                    buildDrilldownContext('addon', {
                                      ...totalsContextBase,
                                      addonKey: addon.key,
                                      addonName: addon.name,
                                    }),
                                  )}
                                </td>,
                                <td
                                  key={`total-addon-nonshow-${group.slug}-${product.slug}-${addon.key}`}
                                  style={mergeCellStyles(
                                    { borderTop: EMPHASIS_BORDER },
                                    NO_LEFT_BORDER,
                                    isLastProductInGroup &&
                                      addonIndex === product.addons.length - 1 &&
                                      groupIndex !== visibleTypeGroups.length - 1
                                      ? { borderRight: EMPHASIS_BORDER }
                                      : undefined,
                                  )}
                                >
                                  {renderValue(
                                    productTotals?.addonNonShow?.[addon.key] ?? 0,
                                    buildDrilldownContext('addonNonShow', {
                                      ...totalsContextBase,
                                      addonKey: addon.key,
                                      addonName: addon.name,
                                      suffix: 'Non-Show',
                                    }),
                                  )}
                                </td>,
                              ]),
                            ];
                          }
                          return [
                            <td
                              key={`total-quantity-${group.slug}-${product.slug}`}
                              style={mergeCellStyles(
                                { borderTop: EMPHASIS_BORDER, borderLeft: EMPHASIS_BORDER },
                              )}
                            >
                                {renderValue(
                                  getQuantityForProduct(product, productTotals),
                                  buildDrilldownContext('normal', {
                                    ...totalsContextBase,
                                    suffix: 'Quantity (All Channels)',
                                  }),
                                )}
                            </td>,
                            <td
                              key={`total-quantity-nonshow-${group.slug}-${product.slug}`}
                              style={mergeCellStyles(
                                { borderTop: EMPHASIS_BORDER },
                                NO_LEFT_BORDER,
                                isLastProductInGroup && groupIndex !== visibleTypeGroups.length - 1
                                  ? { borderRight: EMPHASIS_BORDER }
                                  : undefined,
                              )}
                            >
                              {renderValue(
                                productTotals?.nonShow ?? 0,
                                buildDrilldownContext('nonShow', {
                                  ...totalsContextBase,
                                  suffix: 'Non-Show (All Channels)',
                                }),
                              )}
                            </td>,
                          ];
                        }),
                      )}
                      <td style={mergeCellStyles({ borderLeft: EMPHASIS_BORDER, borderTop: EMPHASIS_BORDER })}>
                        {renderValue(
                          summary.totals.total,
                          buildDrilldownContext('total', {
                            suffix: 'Grand Total',
                          }),
                        )}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </Table>
            </ScrollArea>
          </Stack>
        )}
        {!loading && !summary && !error && (
          <Stack align="center" gap={4} mt="md">
            <IconInfoCircle size={20} />
            <Text size="sm" c="dimmed">
              Select a reporting range to load channel metrics.
            </Text>
          </Stack>
        )}
      </Paper>
      <Modal opened={cashModal.open} onClose={handleCloseCashModal} title="Record cash collection" centered>
        <Stack gap="sm">
          {cashModal.channel && (
            <Stack gap={0}>
              <Text fw={600}>{cashModal.channel.channelName}</Text>
              <Text size="sm" c="dimmed">
                Outstanding: {formatCurrencyValue(cashModal.channel.outstandingAmount, cashModal.currency)}
              </Text>
            </Stack>
          )}
          <NumberInput
            label="Amount"
            value={cashModal.amount}
            onChange={(value) =>
              setCashModal((prev) => ({
                ...prev,
                amount: typeof value === 'number' ? value : 0,
              }))
            }
            min={0}
            decimalScale={2}
            fixedDecimalScale
            hideControls
          />
          <Select
            label="Account"
            data={accountOptions}
            value={cashModal.accountId}
            onChange={(value) => setCashModal((prev) => ({ ...prev, accountId: value ?? '' }))}
            placeholder="Select account"
          />
          <Select
            label="Income category"
            data={incomeCategoryOptions}
            value={cashModal.categoryId}
            onChange={(value) => setCashModal((prev) => ({ ...prev, categoryId: value ?? '' }))}
            placeholder="Select category"
          />
          <Select
            label="Client"
            data={clientOptions}
            value={cashModal.counterpartyId}
            onChange={(value) => setCashModal((prev) => ({ ...prev, counterpartyId: value ?? '' }))}
            placeholder="Select client"
          />
          <DatePickerInput
            label="Date"
            value={cashModal.date}
            onChange={(value) => setCashModal((prev) => ({ ...prev, date: value ?? new Date() }))}
          />
          <Textarea
            label="Description"
            value={cashModal.description}
            onChange={(event) => setCashModal((prev) => ({ ...prev, description: event.currentTarget.value }))}
            minRows={2}
          />
          {cashMessage && (
            <Alert color="red" variant="light">
              {cashMessage}
            </Alert>
          )}
          <Group justify="flex-end" gap="sm">
            <Button variant="default" onClick={handleCloseCashModal}>
              Cancel
            </Button>
            <Button onClick={handleCashSubmit} loading={cashSubmitting} disabled={!cashModal.channel}>
              Record collection
            </Button>
          </Group>
        </Stack>
      </Modal>
      <Modal
        opened={detailModal.open}
        onClose={handleCloseDetailModal}
        title={detailModal.context?.label ?? 'Metric details'}
        size="xl"
        centered
        radius="lg"
        scrollAreaComponent={ScrollArea.Autosize}
      >
        <Stack gap="md">
          {detailModal.context && (
            <Group justify="space-between" align="flex-start">
              <Stack gap={2}>
                <Text fw={600}>{detailModal.context.channelName ?? 'All channels'}</Text>
                <Text size="sm" c="dimmed">
                  {detailModal.context.productName ?? 'All products'}
                </Text>
              </Stack>
              <Badge color={DETAIL_METRIC_META[currentDetailMetricKey].color} variant="light">
                {DETAIL_METRIC_META[currentDetailMetricKey].label}
              </Badge>
            </Group>
          )}
          {detailModal.context?.addonName && (
            <Text size="sm" c="dimmed">
              Add-on: <Text span fw={600}>{detailModal.context.addonName}</Text>
            </Text>
          )}
          {detailModal.context?.suffix && (
            <Text size="sm" c="dimmed">
              {detailModal.context.suffix}
            </Text>
          )}
          {detailModal.error && (
            <Alert color="red" variant="light">
              {detailModal.error}
            </Alert>
          )}
          {detailModal.totals && (
            <SimpleGrid cols={{ base: 1, sm: 2, md: 3, lg: 5 }}>
              {renderDetailStat('Booked (Before)', detailModal.totals.bookedBefore)}
              {renderDetailStat('Booked (After)', detailModal.totals.bookedAfter)}
              {renderDetailStat('Attended', detailModal.totals.attended)}
              {renderDetailStat('Non-Show', detailModal.totals.nonShow)}
              {renderDetailStat(
                DETAIL_METRIC_META[currentDetailMetricKey].totalLabel,
                detailModal.totals.value,
                true,
              )}
            </SimpleGrid>
          )}
          <Paper withBorder p="sm" radius="md" style={{ position: 'relative', maxHeight: '70vh' }}>
            <LoadingOverlay visible={detailModal.loading} zIndex={5} />
            <ScrollArea maw="100%" h="60vh" offsetScrollbars type="always">
              {detailModal.entries.length > 0 ? (
                <Table
                  striped
                  highlightOnHover
                  withColumnBorders
                  stickyHeader
                  horizontalSpacing="md"
                  verticalSpacing="sm"
                  style={{ minWidth: 960, fontVariantNumeric: 'tabular-nums' }}
                >
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Date</Table.Th>
                      <Table.Th>Channel</Table.Th>
                      <Table.Th>Product</Table.Th>
                      <Table.Th>Addon</Table.Th>
                      <Table.Th>Booked (Before)</Table.Th>
                      <Table.Th>Booked (After)</Table.Th>
                      <Table.Th>Attended</Table.Th>
                      <Table.Th>Non-Show</Table.Th>
                      <Table.Th>Value</Table.Th>
                      <Table.Th>Notes</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {detailModal.entries.map((entry) => (
                      <Table.Tr key={`${entry.counterId}-${entry.channelId}-${entry.addonKey ?? 'none'}`}>
                        <Table.Td>{dayjs(entry.counterDate).format('MMM D, YYYY')}</Table.Td>
                        <Table.Td>{entry.channelName}</Table.Td>
                        <Table.Td>{entry.productName ?? '—'}</Table.Td>
                        <Table.Td>{entry.addonName ?? '—'}</Table.Td>
                        <Table.Td>{numberFormatter.format(entry.bookedBefore)}</Table.Td>
                        <Table.Td>{numberFormatter.format(entry.bookedAfter)}</Table.Td>
                        <Table.Td>{numberFormatter.format(entry.attended)}</Table.Td>
                        <Table.Td>{numberFormatter.format(entry.nonShow)}</Table.Td>
                        <Table.Td>{numberFormatter.format(entry.value)}</Table.Td>
                        <Table.Td style={{ maxWidth: 220 }}>
                          <Text size="sm" c="dimmed" lineClamp={2}>
                            {formatDetailNote(entry.note)}
                          </Text>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                  {detailModal.totals && (
                    <Table.Tfoot>
                      <Table.Tr>
                        <Table.Th colSpan={4}>Totals</Table.Th>
                        <Table.Th>{numberFormatter.format(detailModal.totals.bookedBefore)}</Table.Th>
                        <Table.Th>{numberFormatter.format(detailModal.totals.bookedAfter)}</Table.Th>
                        <Table.Th>{numberFormatter.format(detailModal.totals.attended)}</Table.Th>
                        <Table.Th>{numberFormatter.format(detailModal.totals.nonShow)}</Table.Th>
                        <Table.Th>{numberFormatter.format(detailModal.totals.value)}</Table.Th>
                        <Table.Th />
                      </Table.Tr>
                    </Table.Tfoot>
                  )}
                </Table>
              ) : (
                <Center py="md">
                  <Text size="sm" c="dimmed">
                    {detailModal.loading
                      ? 'Loading metric details...'
                      : 'No daily entries found for this selection.'}
                  </Text>
                </Center>
              )}
            </ScrollArea>
          </Paper>
        </Stack>
      </Modal>
    </Stack>
  );
};

export default ChannelNumbersSummary;
