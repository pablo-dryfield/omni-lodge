import React, { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Paper,
  Container,
  Box,
  Table,
  Text,
  Center,
  Loader,
  Button,
  Alert,
  Stack,
  Group,
  ScrollArea,
  Badge,
  Title,
  useMantineTheme,
  Card,
  SimpleGrid,
  Select,
  ActionIcon,
  Collapse,
  Modal,
  NumberInput,
  Textarea,
  SegmentedControl,
} from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import dayjs, { Dayjs } from 'dayjs';
import {
  type Pay,
  type PayBreakdown,
  type PayComponentSummary,
  type PlatformGuestTierBreakdown,
  type LockedComponentSummary,
} from '../types/pays/Pay';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { fetchPays } from '../actions/payActions';
import {
  fetchFinanceAccounts,
  fetchFinanceCategories,
  fetchFinanceVendors,
  createFinanceTransaction,
} from '../actions/financeActions';
import { useModuleAccess } from '../hooks/useModuleAccess';
import { PageAccessGuard } from '../components/access/PageAccessGuard';
import { PAGE_SLUGS } from '../constants/pageSlugs';
import { useMediaQuery } from '@mantine/hooks';
import axiosInstance from '../utils/axiosInstance';
import {
  selectFinanceAccounts,
  selectFinanceCategories,
  selectFinanceVendors,
} from '../selectors/financeSelectors';
import type { FinanceVendor } from '../types/finance';
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';

const EARLIEST_DATA_DATE = dayjs('2020-01-01');
const DEFAULT_CURRENCY = 'PLN';

type DatePreset = 'this_month' | 'last_month' | 'custom';

const DATE_PRESET_OPTIONS: Array<{ value: DatePreset; label: string }> = [
  { value: 'this_month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'custom', label: 'Custom range' },
];

const formatCurrency = (value: number | undefined, currencyCode?: string): string => {
  const numberPart = (value ?? 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (currencyCode && currencyCode.trim().length > 0) {
    return `${currencyCode.trim().toUpperCase()} ${numberPart}`;
  }
  return `${numberPart} zł`;
};

const toMinorUnits = (value: number): number => Math.round(value * 100);

const computePreviousRange = (start: Dayjs, end: Dayjs) => {
  const diffDays = end.startOf('day').diff(start.startOf('day'), 'day');
  const previousRangeEnd = start.subtract(1, 'day');
  const previousRangeStart =
    diffDays > 0 ? previousRangeEnd.subtract(diffDays, 'day') : previousRangeEnd;
  return {
    start: previousRangeStart,
    end: previousRangeEnd,
  };
};

const formatRangeLabel = (start: string, end: string) =>
  `${dayjs(start).format('MMM D, YYYY')} - ${dayjs(end).format('MMM D, YYYY')}`;

const getComponentColor = (category: string) => {
  switch (category) {
    case 'base':
      return 'blue';
    case 'commission':
      return 'green';
    case 'incentive':
      return 'violet';
    case 'bonus':
      return 'grape';
    case 'review':
      return 'teal';
    case 'adjustment':
      return 'yellow';
    case 'deduction':
      return 'red';
    default:
      return 'gray';
  }
};

const normalizeTotal = (summary: Pay) => summary.totalPayout ?? summary.totalCommission;
const calculateIncentiveTotal = (summary: Pay) =>
  (summary.componentTotals ?? []).reduce(
    (sum, component) => (component.category === 'incentive' ? sum + component.amount : sum),
    0,
  );

const humanizeErrorMessage = (rawMessage?: string | null): { title: string; description: string; details?: string } => {
  const defaultDescription = 'Please adjust the selected period or try again in a moment.';
  if (!rawMessage) {
    return {
      title: 'Unable to load payouts',
      description: defaultDescription,
    };
  }
  const normalized = rawMessage.toLowerCase();
  if (normalized.includes('forbidden') || normalized.includes('unauthorized') || normalized.includes('401') || normalized.includes('403')) {
    return {
      title: 'Access restricted',
      description: 'You do not have permission to view payouts for this range. Switch to the self scope or contact an administrator.',
      details: rawMessage,
    };
  }
  if (normalized.includes('network') || normalized.includes('timeout')) {
    return {
      title: 'Network error',
      description: 'We could not reach the server. Check your connection and try again.',
      details: rawMessage,
    };
  }
  if (normalized.includes('not found')) {
    return {
      title: 'No data available',
      description: 'We could not find payouts for the selected dates.',
      details: rawMessage,
    };
  }
  return {
    title: 'Unable to load payouts',
    description: defaultDescription,
    details: rawMessage,
  };
};

const calculatePresetRange = (preset: DatePreset, reference: Dayjs = dayjs()): { start: Dayjs; end: Dayjs } => {
  const today = reference.endOf('day');
  const startOfToday = today.startOf('day');
  const clampStart = (value: Dayjs) => (value.isBefore(EARLIEST_DATA_DATE) ? EARLIEST_DATA_DATE.startOf('day') : value);

  const getLastWeekRange = () => {
    const daysSinceMonday = (today.day() + 6) % 7;
    const start = today.subtract(daysSinceMonday + 7, 'day').startOf('day');
    const end = start.add(6, 'day').endOf('day');
    return { start, end };
  };

  switch (preset) {
    case 'last_month': {
      const start = today.subtract(1, 'month').startOf('month');
      return { start: clampStart(start), end: start.endOf('month') };
    }
    case 'this_month':
    default:
      return { start: clampStart(today.startOf('month')), end: today.endOf('month') };
  }
};

const FULL_ACCESS_MODULE = 'staff-payouts-all';
const SELF_ACCESS_MODULE = 'staff-payouts-self';
const PAGE_SLUG = PAGE_SLUGS.pays;

type ComponentListItemProps = {
  component: PayComponentSummary;
  breakdown: PlatformGuestTierBreakdown[];
  showPlatformTotals: boolean;
  platformGuestTotals?: { totalGuests: number; totalBooked: number; totalAttended: number };
};

const ComponentListItem: React.FC<ComponentListItemProps> = ({
  component,
  breakdown,
  showPlatformTotals,
  platformGuestTotals,
}) => {
  const [showBaseDays, setShowBaseDays] = useState(false);
  const isBaseComponent = component.category === 'base';
  const explicitBaseDays =
    isBaseComponent && Array.isArray(component.baseDays) ? component.baseDays.filter(Boolean) : [];
  const computedBaseDayCount =
    isBaseComponent && explicitBaseDays.length > 0
      ? explicitBaseDays.length
      : isBaseComponent && typeof component.baseDaysCount === 'number' && component.baseDaysCount > 0
      ? component.baseDaysCount
      : null;
  const formattedBaseDays =
    computedBaseDayCount !== null
      ? Number.isInteger(computedBaseDayCount)
        ? computedBaseDayCount.toString()
        : computedBaseDayCount.toFixed(2)
      : null;
  const hasBaseDayList = explicitBaseDays.length > 0;

  return (
    <Stack gap={4}>
      <Group justify="space-between" gap="xs">
        <Group gap={6} align="center">
          <Badge color={getComponentColor(component.category)} variant="light">
            {component.category}
          </Badge>
          <Text size="sm">
            {component.name}
            {computedBaseDayCount !== null && (
              <Text
                component="span"
                size="xs"
                c="dimmed"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
              >
                {'  '}
                ({formattedBaseDays} {computedBaseDayCount === 1 ? 'day' : 'days'} counted
                {hasBaseDayList && (
                  <ActionIcon
                    size="xs"
                    variant="subtle"
                    color="blue"
                    onClick={() => setShowBaseDays((prev) => !prev)}
                    aria-label={showBaseDays ? 'Hide counted dates' : 'Show counted dates'}
                  >
                    {showBaseDays ? '\u25B2' : '\u25BC'}
                  </ActionIcon>
                )}
                )
              </Text>
            )}
          </Text>
        </Group>
        <Text size="sm" fw={600}>
          {formatCurrency(component.amount)}
        </Text>
      </Group>

      {hasBaseDayList && (
        <Collapse in={showBaseDays}>
          <Stack gap={2} pl="md">
            {explicitBaseDays.map((day, index) => {
              const parsed = dayjs(day);
              const formatted = parsed.isValid() ? parsed.format('MMM D, YYYY') : day;
              return (
                <Text key={`${component.componentId}-day-${index}`} size="xs" c="dimmed">
                  {formatted}
                </Text>
              );
            })}
          </Stack>
        </Collapse>
      )}

      {showPlatformTotals && platformGuestTotals && platformGuestTotals.totalGuests > 0 && (
        <Text size="xs" c="dimmed">
          Total guests: {platformGuestTotals.totalGuests} (Booked {platformGuestTotals.totalBooked}, Attended{' '}
          {platformGuestTotals.totalAttended})
        </Text>
      )}

      {breakdown.length > 0 && (
        <Stack gap={2} pl="md">
          {breakdown.map((tier, index) => (
            <Group key={`${component.componentId}-${index}`} justify="space-between">
              <Text size="xs" c="dimmed">
                {tier.cumulativeGuests - tier.units + 1}-{tier.cumulativeGuests} guests @ {tier.rate.toFixed(2)} zł
              </Text>
              <Text size="xs" fw={600}>
                {formatCurrency(tier.amount)}
              </Text>
            </Group>
          ))}
        </Stack>
      )}
    </Stack>
  );
};

const renderComponentList = (
  components?: PayComponentSummary[],
  platformGuestBreakdowns?: Record<string, PlatformGuestTierBreakdown[]>,
  platformGuestTotals?: { totalGuests: number; totalBooked: number; totalAttended: number },
  lockedComponents?: LockedComponentSummary[],
) => {
  const paidComponents = components ?? [];
  const lockedList = lockedComponents ?? [];
  if (paidComponents.length === 0 && lockedList.length === 0) {
    return null;
  }

  return (
    <Stack gap="xs">
      <Text size="sm" fw={600}>
        Breakdown
      </Text>
      {paidComponents.length > 0 && (
        <Stack gap={4}>
          {paidComponents.map((component) => {
            const breakdown = platformGuestBreakdowns?.[String(component.componentId)] ?? [];
            const showPlatformTotals =
              component.name?.toLowerCase().includes('platform') &&
              platformGuestTotals &&
              platformGuestTotals.totalGuests > 0;
            return (
              <ComponentListItem
                key={component.componentId}
                component={component}
                breakdown={breakdown}
                showPlatformTotals={Boolean(showPlatformTotals)}
                platformGuestTotals={platformGuestTotals}
              />
            );
          })}
        </Stack>
      )}
      {lockedList.length > 0 && (
        <Stack gap={4} pt="xs">
          <Text size="xs" c="red" fw={600}>
            Incentives locked by review target
          </Text>
          {lockedList.map((entry, index) => (
            <Group key={`${entry.componentId}-${index}`} justify="space-between">
              <Group gap={6}>
                <Badge color="red" variant="light">
                  {entry.category}
                </Badge>
                <Text size="sm">
                  {entry.name}{' '}
                  <Text component="span" size="xs" c="dimmed">
                    (needs {entry.requirement.minReviews} reviews, current{' '}
                    {entry.requirement.actualReviews})
                  </Text>
                </Text>
              </Group>
              <Text size="sm" fw={600} c="red">
                {formatCurrency(entry.amount)}
              </Text>
            </Group>
          ))}
        </Stack>
      )}
    </Stack>
  );
};

type EntryModalState = {
  open: boolean;
  staff: Pay | null;
  amount: number;
  currency: string;
  date: Date;
  accountId: string;
  categoryId: string;
  counterpartyId: string;
  description: string;
  rangeStart: string;
  rangeEnd: string;
  period: 'current' | 'previous';
  previousRangeStart?: string;
  previousRangeEnd?: string;
};

const createEmptyEntryModalState = (): EntryModalState => ({
  open: false,
  staff: null,
  amount: 0,
  currency: DEFAULT_CURRENCY,
  date: new Date(),
  accountId: '',
  categoryId: '',
  counterpartyId: '',
  description: '',
  rangeStart: '',
  rangeEnd: '',
  period: 'current',
  previousRangeStart: undefined,
  previousRangeEnd: undefined,
});


const renderBucketTotals = (
  bucketTotals?: Record<string, number>,
  lockedComponents?: LockedComponentSummary[],
) => {
  if (!bucketTotals || Object.keys(bucketTotals).length === 0) {
    return null;
  }
  const entries = Object.entries(bucketTotals).filter(([, amount]) => amount !== 0);
  if (entries.length === 0) {
    return null;
  }
  const lockedMap = new Map<string, LockedComponentSummary[]>();
  lockedComponents?.forEach((entry) => {
    const bucket = entry.bucketCategory ?? entry.category;
    if (!bucket) {
      return;
    }
    const list = lockedMap.get(bucket) ?? [];
    list.push(entry);
    lockedMap.set(bucket, list);
  });
  return (
    <Stack gap="xs">
      <Text size="sm" fw={600}>
        Payments
      </Text>
      <Stack gap={4}>
        {entries.map(([bucket, amount]) => {
          const lockedList = lockedMap.get(bucket) ?? [];
          const lockedLabel =
            lockedList.length > 0
              ? Array.from(
                  new Set(
                    lockedList.map((entry) => {
                      const requirement = entry.requirement;
                      const current = requirement.actualReviews;
                      return `(needs ${requirement.minReviews} reviews, current ${current})`;
                    }),
                  ),
                ).join(' • ')
              : null;
          return (
            <Group key={bucket} justify="space-between" align="center">
              <Group gap="xs" align="center">
                <Badge
                  variant={lockedList.length > 0 ? 'light' : 'outline'}
                  color={lockedList.length > 0 ? 'red' : getComponentColor(bucket)}
                >
                  {bucket}
                </Badge>
                {lockedLabel && (
                  <Text size="xs" c="dimmed">
                    {lockedLabel}
                  </Text>
                )}
              </Group>
              <Text size="sm">{formatCurrency(amount)}</Text>
            </Group>
          );
        })}
      </Stack>
    </Stack>
  );
};

const buildIncentiveLookup = (summary: Pay): Map<number, string[]> => {
  const map = new Map<number, string[]>();
  const markers = summary.counterIncentiveMarkers ?? {};
  Object.entries(markers).forEach(([counterIdKey, letters]) => {
    const counterId = Number(counterIdKey);
    if (!Number.isFinite(counterId) || counterId <= 0 || !Array.isArray(letters)) {
      return;
    }
    const normalized = Array.from(
      new Set(
        letters
          .map((letter) => (typeof letter === 'string' && letter.trim().length > 0 ? letter.trim()[0].toUpperCase() : null))
          .filter((value): value is string => Boolean(value)),
      ),
    );
    if (normalized.length > 0) {
      map.set(counterId, normalized);
    }
  });
  return map;
};

const hasPlatformGuestDetails = (summary: Pay): boolean =>
  Object.values(summary.platformGuestBreakdowns ?? {}).some(
    (tiers) => Array.isArray(tiers) && tiers.length > 0,
  );

const getCounterIncentiveAmount = (summary: Pay, counterId?: number | null) => {
  if (!counterId || counterId <= 0) {
    return 0;
  }
  const key = String(counterId);
  return summary.counterIncentiveTotals?.[key] ?? 0;
};

const renderBreakdownTable = (
  summary: Pay,
  items: PayBreakdown[],
  incentiveLookup?: Map<number, string[]>,
) => {
  const hasProduct = items.some((entry) => Boolean(entry.productName));
  const filteredItems = items.filter((entry) => {
    const incentiveAmount = getCounterIncentiveAmount(summary, entry.counterId);
    return incentiveAmount !== 0 || entry.commission !== 0;
  });
  if (filteredItems.length === 0) {
    return null;
  }
  return (
    <Table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          <th style={{ borderBottom: '1px solid #ddd', padding: 6, textAlign: 'left' }}>Date</th>
          {hasProduct && <th style={{ borderBottom: '1px solid #ddd', padding: 6, textAlign: 'left' }}>Product</th>}
          <th style={{ borderBottom: '1px solid #ddd', padding: 6, textAlign: 'right' }}>Customers</th>
          <th style={{ borderBottom: '1px solid #ddd', padding: 6, textAlign: 'right' }}>Guides</th>
          <th style={{ borderBottom: '1px solid #ddd', padding: 6, textAlign: 'right' }}>Incentives</th>
          <th style={{ borderBottom: '1px solid #ddd', padding: 6, textAlign: 'right' }}>Commission</th>
        </tr>
      </thead>
      <tbody>
        {filteredItems.map((entry, index) => (
          <tr key={`${entry.date}-${index}`}>
            <td style={{ borderBottom: '1px solid #eee', padding: 6 }}>
              {entry.date}
              {entry.counterId !== undefined &&
                entry.counterId !== null &&
                incentiveLookup?.get(entry.counterId) &&
                incentiveLookup.get(entry.counterId)!.length > 0 && (
                  <span style={{ marginLeft: 6, display: 'inline-flex', gap: 4 }}>
                    {incentiveLookup
                      .get(entry.counterId)!
                      .map((letter) => (
                        <span
                          key={`${entry.counterId}-${letter}`}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: 16,
                            height: 16,
                            borderRadius: '50%',
                            backgroundColor: '#edf2ff',
                            color: '#3b5bdb',
                            fontSize: 10,
                            fontWeight: 700,
                          }}
                        >
                          {letter}
                        </span>
                      ))}
                  </span>
                )}
            </td>
            {hasProduct && (
              <td style={{ borderBottom: '1px solid #eee', padding: 6 }}>{entry.productName ?? '—'}</td>
            )}
            <td style={{ borderBottom: '1px solid #eee', padding: 6, textAlign: 'right' }}>{entry.customers}</td>
            <td style={{ borderBottom: '1px solid #eee', padding: 6, textAlign: 'right' }}>{entry.guidesCount}</td>
            <td style={{ borderBottom: '1px solid #eee', padding: 6, textAlign: 'right' }}>
              {formatCurrency(getCounterIncentiveAmount(summary, entry.counterId))}
            </td>
            <td style={{ borderBottom: '1px solid #eee', padding: 6, textAlign: 'right' }}>
              {formatCurrency(entry.commission)}
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
};

const renderProductTotals = (
  productTotals?: Pay['productTotals'],
  componentSummaries?: PayComponentSummary[],
  lockedComponents?: LockedComponentSummary[],
) => {
  if (!productTotals || productTotals.length === 0) {
    return null;
  }

  const componentLookup = new Map<number, PayComponentSummary>();
  componentSummaries?.forEach((component) => {
    componentLookup.set(component.componentId, component);
  });

  return (
    <Stack gap="xs">
      <Text size="sm" fw={600}>
        Payout Details
      </Text>
      <Stack gap="sm">
        {productTotals.map((product, index) => {
          const componentBreakdown = product.componentTotals ?? [];
          const incentiveTotal = componentBreakdown.reduce((sum, component) => sum + component.amount, 0);
          const payoutTotal = product.totalCommission + incentiveTotal;
          const lockedForProduct =
            lockedComponents?.filter((entry) =>
              componentBreakdown.some((component) => component.componentId === entry.componentId),
            ) ?? [];
          const hasUnlockedComponent = componentBreakdown.some(
            (component) => !lockedForProduct.some((entry) => entry.componentId === component.componentId),
          );
          if (payoutTotal === 0) {
            return null;
          }
          return (
            <Card key={`${product.productId ?? 'legacy'}-${index}`} withBorder padding="sm" radius="md">
              <Stack gap="0">
                <Text fw={600}>{product.productName}</Text>
                <Group justify="space-between" align="center"> 
                    <Text size="xs" c="dimmed">
                      Total payout
                    </Text>
                    <Text fw={700}>{formatCurrency(payoutTotal)}</Text>
                </Group>
                <Group justify="space-between">
                  <Text size="xs" c="dimmed">
                    Commission share
                  </Text>
                  <Text size="sm" fw={600}>
                    {formatCurrency(product.totalCommission)}
                  </Text>
                </Group>
                {(componentBreakdown.length > 0 || (lockedComponents && lockedComponents.length > 0)) && (
                  <Stack gap={4}>
                    {componentBreakdown.length > 0 && (
                      <>
                        {hasUnlockedComponent && (
                          <Text size="xs" c="dimmed">
                            Incentives
                          </Text>
                        )}
                        {componentBreakdown.map((component) => {
                          const meta = componentLookup.get(component.componentId);
                          const isLocked = lockedComponents?.some((entry) => entry.componentId === component.componentId);
                          if (isLocked) {
                            return null;
                          }
                          return (
                            <Group key={`${product.productId ?? 'legacy'}-${component.componentId}`} justify="space-between">
                              <Group gap={6}>
                                {meta && (
                                  <Badge size="xs" variant="light" color={getComponentColor(meta.category)}>
                                    {meta.category}
                                  </Badge>
                                )}
                                <Text size="sm">{meta?.name ?? `Component #${component.componentId}`}</Text>
                              </Group>
                              <Text size="sm" fw={600}>
                                {formatCurrency(component.amount)}
                              </Text>
                            </Group>
                          );
                        })}
                      </>
                    )}
                    {lockedForProduct.length > 0 && (
                      <Stack gap={2} pt="xs">
                        <Text size="xs" c="red" fw={600}>
                          Locked incentives
                        </Text>
                        {lockedForProduct.map((entry, lockedIdx) => (
                          <Group key={`${entry.componentId}-locked-${lockedIdx}`} justify="space-between">
                            <Group gap={6}>
                              <Badge size="xs" variant="light" color="red">
                                {entry.category}
                              </Badge>
                              <Text size="sm">
                                {entry.name}{' '}
                                <Text component="span" size="xs" c="dimmed">
                                  (needs {entry.requirement.minReviews} reviews, current{' '}
                                  {entry.requirement.actualReviews})
                                </Text>
                              </Text>
                            </Group>
                            <Text size="sm" fw={600} c="red">
                              {formatCurrency(entry.amount)}
                            </Text>
                          </Group>
                        ))}
                      </Stack>
                    )}
                  </Stack>
                )}
              </Stack>
            </Card>
          );
        })}
      </Stack>
    </Stack>
  );
};

const Pays: React.FC = () => {
  const dispatch = useAppDispatch();
  const payState = useAppSelector((state) => state.pays)[0];
  const { data: responseData, loading, error } = payState;
  const accounts = useAppSelector(selectFinanceAccounts);
  const categories = useAppSelector(selectFinanceCategories);
  const vendors = useAppSelector(selectFinanceVendors);

  const today = dayjs();
  const initialRange = calculatePresetRange('this_month', today);
  const [datePreset, setDatePreset] = useState<DatePreset>('this_month');
  const [startDate, setStartDate] = useState<Dayjs | null>(initialRange.start);
  const [endDate, setEndDate] = useState<Dayjs | null>(initialRange.end);
  const [customRangeValue, setCustomRangeValue] = useState<[Date | null, Date | null]>([
    initialRange.start.toDate(),
    initialRange.end.toDate(),
  ]);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [entryModal, setEntryModal] = useState<EntryModalState>(createEmptyEntryModalState());
  const [entryMessage, setEntryMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null);
  const [entrySubmitting, setEntrySubmitting] = useState(false);
  const friendlyError = error ? humanizeErrorMessage(error) : null;

  useEffect(() => {
    if (datePreset === 'custom') {
      const [start, end] = customRangeValue;
      if (start && end) {
        setStartDate(dayjs(start).startOf('day'));
        setEndDate(dayjs(end).endOf('day'));
      }
      return;
    }
    const range = calculatePresetRange(datePreset);
    setStartDate(range.start);
    setEndDate(range.end);
  }, [datePreset, customRangeValue]);

  useEffect(() => {
    if (!accounts.loading && accounts.data.length === 0) {
      void dispatch(fetchFinanceAccounts());
    }
  }, [dispatch, accounts.data.length, accounts.loading]);

  useEffect(() => {
    if (!categories.loading && categories.data.length === 0) {
      void dispatch(fetchFinanceCategories());
    }
  }, [dispatch, categories.data.length, categories.loading]);

  useEffect(() => {
    if (!vendors.loading && vendors.data.length === 0) {
      void dispatch(fetchFinanceVendors());
    }
  }, [dispatch, vendors.data.length, vendors.loading]);

  const financeVendorsById = useMemo(() => {
    const map = new Map<number, FinanceVendor>();
    vendors.data.forEach((vendor) => {
      if (typeof vendor.id === 'number') {
        map.set(vendor.id, vendor);
      }
    });
    return map;
  }, [vendors.data]);

  const accountOptions = useMemo(
    () =>
      accounts.data
        .filter(
          (account) =>
            (account.type === 'cash' || account.type === 'bank') && (account.isActive ?? true),
        )
        .map((account) => ({
          value: String(account.id),
          label: `${account.name} (${account.currency})`,
        })),
    [accounts.data],
  );

  const expenseCategoryOptions = useMemo(
    () =>
      categories.data
        .filter((category) => category.kind === 'expense')
        .map((category) => ({ value: String(category.id), label: category.name })),
    [categories.data],
  );

  const vendorOptions = useMemo(
    () => vendors.data.map((vendor) => ({ value: String(vendor.id), label: vendor.name })),
    [vendors.data],
  );

  const resolveStaffCounterpartyDefaults = useCallback(
    (staff: Pay) => {
      let counterpartyId = '';
      let categoryId = '';
      const vendorId = staff.financeVendorId;
      if (vendorId) {
        counterpartyId = String(vendorId);
        const defaultCategoryId = financeVendorsById.get(vendorId)?.defaultCategoryId;
        if (defaultCategoryId) {
          categoryId = String(defaultCategoryId);
        }
      }
      return { counterpartyId, categoryId };
    },
    [financeVendorsById],
  );

  const handleCounterpartyChange = useCallback(
    (value: string | null) => {
      setEntryModal((prev) => {
        const nextId = value ?? '';
        let nextCategoryId = prev.categoryId;
        if (!value) {
          nextCategoryId = '';
        } else {
          const vendor = financeVendorsById.get(Number(value));
          nextCategoryId = vendor?.defaultCategoryId ? String(vendor.defaultCategoryId) : '';
        }
        return { ...prev, counterpartyId: nextId, categoryId: nextCategoryId };
      });
    },
    [financeVendorsById],
  );

  const openEntryModal = useCallback(
    (staff: Pay) => {
      const outstanding = staff.closingBalance ?? staff.payouts?.payableOutstanding ?? 0;
      const defaults = resolveStaffCounterpartyDefaults(staff);
      const currency = staff.payouts?.currency ?? DEFAULT_CURRENCY;
      const rangeStartValue =
        staff.range?.startDate ?? startDate?.format('YYYY-MM-DD') ?? dayjs().format('YYYY-MM-DD');
      const rangeEndValue =
        staff.range?.endDate ?? endDate?.format('YYYY-MM-DD') ?? dayjs().format('YYYY-MM-DD');
      const baseRangeStart = dayjs(rangeStartValue);
      const baseRangeEnd = dayjs(rangeEndValue);
      const previousRange = computePreviousRange(baseRangeStart, baseRangeEnd);

      setEntryModal({
        open: true,
        staff,
        amount:
          outstanding > 0 ? outstanding : Math.max(staff.totalPayout ?? staff.totalCommission, 0),
        currency,
        date: new Date(),
        accountId: '',
        categoryId: defaults.categoryId,
        counterpartyId: defaults.counterpartyId,
        description: `Staff payout for ${staff.firstName} (${formatRangeLabel(rangeStartValue, rangeEndValue)})`,
        rangeStart: rangeStartValue,
        rangeEnd: rangeEndValue,
        period: 'current',
        previousRangeStart: previousRange.start.format('YYYY-MM-DD'),
        previousRangeEnd: previousRange.end.format('YYYY-MM-DD'),
      });
      setEntryMessage(null);
    },
    [endDate, resolveStaffCounterpartyDefaults, startDate],
  );

  const closeEntryModal = useCallback(() => {
    setEntryModal(createEmptyEntryModalState());
    setEntryMessage(null);
  }, []);

  const handleEntryAccountChange = useCallback(
    (value: string | null) => {
      if (!value) {
        setEntryModal((prev) => ({ ...prev, accountId: '' }));
        return;
      }
      const account = accounts.data.find((item) => item.id === Number(value));
      setEntryModal((prev) => ({
        ...prev,
        accountId: value,
        currency: account?.currency ?? prev.currency,
      }));
    },
    [accounts.data],
  );

  const handleEntryPeriodChange = useCallback(
    (value: 'current' | 'previous') => {
      setEntryModal((prev) => {
        if (value === 'previous' && prev.previousRangeStart && prev.previousRangeEnd) {
          return {
            ...prev,
            period: value,
            rangeStart: prev.previousRangeStart,
            rangeEnd: prev.previousRangeEnd,
            description: `Staff payout for ${prev.staff?.firstName ?? ''} (${formatRangeLabel(
              prev.previousRangeStart,
              prev.previousRangeEnd,
            )})`,
          };
        }
        return {
          ...prev,
          period: 'current',
          rangeStart: prev.staff?.range?.startDate ?? startDate?.format('YYYY-MM-DD') ?? prev.rangeStart,
          rangeEnd: prev.staff?.range?.endDate ?? endDate?.format('YYYY-MM-DD') ?? prev.rangeEnd,
          description: `Staff payout for ${prev.staff?.firstName ?? ''} (${formatRangeLabel(
            prev.staff?.range?.startDate ?? startDate?.format('YYYY-MM-DD') ?? prev.rangeStart,
            prev.staff?.range?.endDate ?? endDate?.format('YYYY-MM-DD') ?? prev.rangeEnd,
          )})`,
        };
      });
    },
    [endDate, startDate],
  );

  const handlePresetChange = (value: string | null) => {
    if (!value) {
      return;
    }
    setDatePreset(value as DatePreset);
  };

  const handleCustomRangeChange = (value: [Date | null, Date | null] | null) => {
    setCustomRangeValue(value ?? [null, null]);
  };

  const fullAccess = useModuleAccess(FULL_ACCESS_MODULE);
  const selfAccess = useModuleAccess(SELF_ACCESS_MODULE);

  const summaries: Pay[] = useMemo(() => responseData?.[0]?.data ?? [], [responseData]);

  const aggregatedBucketData = useMemo(() => {
    const map = new Map<string, number>();
    summaries.forEach((summary) => {
      Object.entries(summary.bucketTotals ?? {}).forEach(([bucket, amount]) => {
        map.set(bucket, (map.get(bucket) ?? 0) + amount);
      });
    });
    return Array.from(map.entries())
      .map(([bucket, amount]) => ({ bucket, amount }))
      .sort((a, b) => b.amount - a.amount);
  }, [summaries]);

  const aggregatedComponentData = useMemo(() => {
    const map = new Map<string, number>();
    summaries.forEach((summary) => {
      (summary.componentTotals ?? []).forEach((component) => {
        map.set(component.name, (map.get(component.name) ?? 0) + component.amount);
      });
    });
    return Array.from(map.entries())
      .map(([name, amount]) => ({ name, amount }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 6);
  }, [summaries]);

  const dailyTrendData = useMemo(() => {
    const map = new Map<string, { commission: number; payout: number }>();
    summaries.forEach((summary) => {
      summary.breakdown.forEach((entry) => {
        if (!map.has(entry.date)) {
          map.set(entry.date, { commission: 0, payout: 0 });
        }
        const record = map.get(entry.date)!;
        record.commission += entry.commission;
        record.payout += entry.commission;
      });
      const difference = (summary.totalPayout ?? summary.totalCommission) - summary.totalCommission;
      if (difference !== 0 && summary.breakdown.length > 0) {
        const lastDate = summary.breakdown[summary.breakdown.length - 1].date;
        const record = map.get(lastDate) ?? { commission: 0, payout: 0 };
        record.payout += difference;
        map.set(lastDate, record);
      }
    });
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, values]) => ({
        date,
        commission: Number(values.commission.toFixed(2)),
        payout: Number(values.payout.toFixed(2)),
      }));
  }, [summaries]);

  const totalOpening = useMemo(
    () => summaries.reduce((sum, item) => sum + (item.openingBalance ?? 0), 0),
    [summaries],
  );
  const totalEarnings = useMemo(
    () =>
      summaries.reduce(
        (sum, item) => sum + (item.dueAmount ?? item.totalPayout ?? normalizeTotal(item)),
        0,
      ),
    [summaries],
  );
  const totalPaid = useMemo(
    () =>
      summaries.reduce(
        (sum, item) => sum + (item.paidAmount ?? item.payouts?.payablePaid ?? 0),
        0,
      ),
    [summaries],
  );
  const totalClosing = useMemo(
    () =>
      summaries.reduce(
        (sum, item) => sum + (item.closingBalance ?? item.payouts?.payableOutstanding ?? 0),
        0,
      ),
    [summaries],
  );

  const totalCommission = useMemo(
    () => summaries.reduce((sum, item) => sum + item.totalCommission, 0),
    [summaries],
  );
  const totalPayout = useMemo(
    () => summaries.reduce((sum, item) => sum + normalizeTotal(item), 0),
    [summaries],
  );
  const totalGuides = summaries.length;

  const permissionsReady = fullAccess.ready || selfAccess.ready;
  const permissionsLoading = fullAccess.loading || selfAccess.loading;
  const canViewFull = fullAccess.ready && fullAccess.canView;
  const canViewSelf = selfAccess.ready && selfAccess.canView;
  const usingSelfScope = !canViewFull && canViewSelf;

  const scopeParam = usingSelfScope ? 'self' : undefined;

  useEffect(() => {
    if (!permissionsReady || permissionsLoading) {
      return;
    }

    if (!(canViewFull || canViewSelf)) {
      return;
    }

    if (startDate && endDate) {
      const start = startDate.format('YYYY-MM-DD');
      const end = endDate.format('YYYY-MM-DD');
      void dispatch(fetchPays({ startDate: start, endDate: end, scope: scopeParam }));
    }
  }, [startDate, endDate, dispatch, permissionsReady, permissionsLoading, canViewFull, canViewSelf, scopeParam]);

  const handleEntrySubmit = async () => {
    setEntryMessage(null);
    if (!entryModal.staff) {
      setEntryMessage({ type: 'error', text: 'Select a staff entry before recording a payout.' });
      return;
    }
    if (!entryModal.rangeStart || !entryModal.rangeEnd) {
      setEntryMessage({ type: 'error', text: 'Select a payout period before recording a payment.' });
      return;
    }
    if (!entryModal.staff.staffProfileId) {
      setEntryMessage({
        type: 'error',
        text: 'Link this staff profile to a finance vendor before recording a payout.',
      });
      return;
    }
    if (
      entryModal.amount <= 0 ||
      !entryModal.accountId ||
      !entryModal.categoryId ||
      !entryModal.counterpartyId
    ) {
      setEntryMessage({
        type: 'error',
        text: 'Fill in the amount, account, category, and vendor before submitting.',
      });
      return;
    }

    setEntrySubmitting(true);
    try {
      const transaction = await dispatch(
        createFinanceTransaction({
          kind: 'expense',
          date: dayjs(entryModal.date).format('YYYY-MM-DD'),
          accountId: Number(entryModal.accountId),
          currency: entryModal.currency,
          amountMinor: toMinorUnits(entryModal.amount),
          categoryId: Number(entryModal.categoryId),
          counterpartyType: 'vendor',
          counterpartyId: Number(entryModal.counterpartyId),
          status: 'paid',
          description: entryModal.description || null,
          meta: {
            source: 'staff-payments',
            rangeStart: entryModal.rangeStart,
            rangeEnd: entryModal.rangeEnd,
            staffUserId: entryModal.staff.userId ?? null,
          },
        }),
      ).unwrap();

      await axiosInstance.post(
        '/reports/staffPayouts/collections',
        {
          staffProfileId: entryModal.staff.staffProfileId,
          direction: 'payable',
          currency: entryModal.currency,
          amount: entryModal.amount,
          rangeStart: entryModal.rangeStart,
          rangeEnd: entryModal.rangeEnd,
          financeTransactionId: transaction.id,
          note: entryModal.description ?? null,
        },
        { withCredentials: true },
      );

      closeEntryModal();
      const refetchStart = startDate ? startDate.format('YYYY-MM-DD') : entryModal.rangeStart;
      const refetchEnd = endDate ? endDate.format('YYYY-MM-DD') : entryModal.rangeEnd;
      await dispatch(
        fetchPays({
          startDate: refetchStart,
          endDate: refetchEnd,
          scope: scopeParam,
        }),
      );
    } catch (submissionError) {
      const message =
        submissionError instanceof Error ? submissionError.message : 'Unable to record payout.';
      setEntryMessage({ type: 'error', text: message });
    } finally {
      setEntrySubmitting(false);
    }
  };

  const toggleRow = (index: number) => {
    setExpandedRow((prev) => (prev === index ? null : index));
  };

  const theme = useMantineTheme();
  const isDesktop = useMediaQuery(`(min-width: ${theme.breakpoints.md})`);

  const bucketChartColors = aggregatedBucketData.map(
    (data) => theme.colors[getComponentColor(data.bucket) as keyof typeof theme.colors]?.[5] ?? theme.colors.blue[6],
  );

  const renderSummaryBoard = () => (
    <Stack gap="sm">
      <SimpleGrid cols={{ base: 1, sm: 2, md: 4 }}>
        <Card withBorder>
          <Text size="sm" c="dimmed">
            Opening balance
          </Text>
          <Title order={4}>{formatCurrency(totalOpening)}</Title>
          <Text size="xs" c="dimmed">
            Carry-over into this period
          </Text>
        </Card>
        <Card withBorder>
          <Text size="sm" c="dimmed">
            New earnings
          </Text>
          <Title order={4}>{formatCurrency(totalEarnings)}</Title>
          <Text size="xs" c="dimmed">
            Guides with payouts this range
          </Text>
        </Card>
        <Card withBorder>
          <Text size="sm" c="dimmed">
            Paid this period
          </Text>
          <Title order={4}>{formatCurrency(totalPaid, DEFAULT_CURRENCY)}</Title>
          <Text size="xs" c="dimmed">
            Finance transactions recorded
          </Text>
        </Card>
        <Card withBorder>
          <Text size="sm" c="dimmed">
            Closing balance
          </Text>
          <Title order={4}>{formatCurrency(totalClosing)}</Title>
          <Text size="xs" c="dimmed">
            Outstanding across {totalGuides} guide{totalGuides === 1 ? '' : 's'}
          </Text>
        </Card>
      </SimpleGrid>
      <SimpleGrid cols={{ base: 1, sm: 2 }}>
        <Card withBorder>
          <Text size="sm" c="dimmed">
            Total commission
          </Text>
          <Title order={4}>{formatCurrency(totalCommission)}</Title>
          <Text size="xs" c="dimmed">
            Direct commission earned
          </Text>
        </Card>
        <Card withBorder>
          <Text size="sm" c="dimmed">
            Range
          </Text>
          <Title order={5}>
            {startDate?.format('MMM D, YYYY')} - {endDate?.format('MMM D, YYYY')}
          </Title>
          <Text size="xs" c="dimmed">
            Period payout total: {formatCurrency(totalPayout)}
          </Text>
        </Card>
      </SimpleGrid>
    </Stack>
  );

  const renderCharts = () => {
    if (aggregatedBucketData.length === 0 && dailyTrendData.length === 0 && aggregatedComponentData.length === 0) {
      return null;
    }
    return (
      <SimpleGrid cols={{ base: 1, md: 2 }}>
        <Card withBorder padding="md">
          <Group justify="space-between" mb="sm">
            <Text fw={600}>Bucket distribution</Text>
            <Badge>{aggregatedBucketData.length} buckets</Badge>
          </Group>
          {aggregatedBucketData.length === 0 ? (
            <Text size="sm" c="dimmed">
              No bucket adjustments recorded for this range.
            </Text>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Tooltip
                  formatter={(value: number, name: string) => [formatCurrency(value), name]}
                  labelFormatter={(label) => label}
                />
                <Pie
                  data={aggregatedBucketData}
                  dataKey="amount"
                  nameKey="bucket"
                  outerRadius={90}
                  innerRadius={40}
                  labelLine={false}
                  label={(entry) => `${entry.bucket} ${(entry.amount / (totalPayout || 1) * 100).toFixed(1)}%`}
                >
                  {aggregatedBucketData.map((entry, index) => (
                    <Cell
                      key={entry.bucket}
                      fill={
                        bucketChartColors[index] ??
                        theme.colors[getComponentColor(entry.bucket) as keyof typeof theme.colors]?.[6] ??
                        theme.colors.gray[5]
                      }
                    />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card withBorder padding="md">
          <Group justify="space-between" mb="sm">
            <Text fw={600}>Daily trend</Text>
            <Badge>{dailyTrendData.length} days</Badge>
          </Group>
          {dailyTrendData.length === 0 ? (
            <Text size="sm" c="dimmed">
              No daily breakdown available for this range.
            </Text>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={dailyTrendData} margin={{ top: 5, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tickFormatter={(value) => dayjs(value).format('MM/DD')} />
                <YAxis tickFormatter={(value) => `${(value / 1000).toFixed(0)}k`} />
                <Tooltip
                  formatter={(value: number, name: string) => [formatCurrency(value), name]}
                  labelFormatter={(value) => dayjs(value).format('MMM D, YYYY')}
                />
                <Bar dataKey="commission" name="Commission" fill={theme.colors.green[6]} />
                <Bar dataKey="payout" name="Total payout" fill={theme.colors.blue[6]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
        {aggregatedComponentData.length > 0 && (
          <Card withBorder padding="md">
            <Group justify="space-between" mb="sm">
              <Text fw={600}>Top components</Text>
              <Badge>{aggregatedComponentData.length}</Badge>
            </Group>
            <Stack gap="xs">
              {aggregatedComponentData.map((component) => (
                <Group key={component.name} justify="space-between">
                  <Group gap="xs">
                    <Badge variant="light" color="violet">
                      {component.name}
                    </Badge>
                  </Group>
                  <Text fw={600}>{formatCurrency(component.amount)}</Text>
                </Group>
              ))}
            </Stack>
          </Card>
        )}
      </SimpleGrid>
    );
  };

  const renderMobileCards = () => (
    <Stack gap="md">
      {summaries.map((item, index) => {
        const expanded = expandedRow === index;
        const total = normalizeTotal(item);
        const hasDetails =
          (item.productTotals && item.productTotals.length > 0) ||
          item.breakdown.length > 0 ||
          hasPlatformGuestDetails(item) ||
          (item.lockedComponents && item.lockedComponents.length > 0);
        return (
          <Paper key={item.userId ?? index} shadow="sm" radius="lg" p="md" withBorder>
            <Stack gap="sm">
              <Group justify="space-between" align="flex-start">
                <div>
                  <Title order={4}>{item.firstName}</Title>
                  <Text size="sm" c="dimmed">
                    Total payout
                  </Text>
                  <Title order={5}>{formatCurrency(total)}</Title>
                </div>
                <Badge color="blue" variant="light">
                  {item.breakdown.length} {item.breakdown.length === 1 ? 'entry' : 'entries'}
                </Badge>
              </Group>

              <Stack gap="xs">
                <Stack gap={4}>
                  <Group justify="space-between">
                    <Text size="sm" c="dimmed">
                      Paid
                    </Text>
                    <Text size="sm" fw={600}>
                      {formatCurrency(item.payouts?.payablePaid ?? 0, item.payouts?.currency ?? DEFAULT_CURRENCY)}
                    </Text>
                  </Group>
                  <Group justify="space-between">
                    <Text size="sm" c="dimmed">
                      Outstanding
                    </Text>
                    <Text size="sm" fw={600} c={(item.payouts?.payableOutstanding ?? 0) > 0 ? undefined : 'teal'}>
                      {formatCurrency(item.payouts?.payableOutstanding ?? 0, item.payouts?.currency ?? DEFAULT_CURRENCY)}
                    </Text>
                  </Group>
                  {(item.payouts?.payableOutstanding ?? 0) > 0 ? (
                    <Button variant="light" size="xs" onClick={() => openEntryModal(item)}>
                      Record payment
                    </Button>
                  ) : (
                    <Badge color="green" variant="light" w="fit-content">
                      Settled
                    </Badge>
                  )}
                </Stack>
                {renderComponentList(
                  item.componentTotals,
                  item.platformGuestBreakdowns,
                  item.platformGuestTotals,
                  item.lockedComponents,
                )}
                {renderBucketTotals(item.bucketTotals, item.lockedComponents)}
              </Stack>

              {hasDetails && (
                <Button variant="subtle" size="xs" onClick={() => toggleRow(index)}>
                  {expanded ? 'Hide details' : 'Show details'}
                </Button>
              )}

              {expanded && (
                <Stack gap="sm" pt="xs">
                  {renderProductTotals(item.productTotals, item.componentTotals, item.lockedComponents)}
                  {item.breakdown.length > 0 &&
                    renderBreakdownTable(item, item.breakdown, buildIncentiveLookup(item))}
                </Stack>
              )}
            </Stack>
          </Paper>
        );
      })}
    </Stack>
  );

  const renderDesktopTable = () => {
    const tableCommissionTotal = summaries.reduce((sum, item) => sum + item.totalCommission, 0);
    const tablePayoutTotal = summaries.reduce((sum, item) => sum + normalizeTotal(item), 0);
    const tableIncentiveTotal = summaries.reduce((sum, item) => sum + calculateIncentiveTotal(item), 0);
    const tablePaidTotal = summaries.reduce(
      (sum, item) => sum + (item.payouts?.payablePaid ?? 0),
      0,
    );
    const tableOutstandingTotal = summaries.reduce(
      (sum, item) => sum + (item.payouts?.payableOutstanding ?? 0),
      0,
    );
    return (
      <ScrollArea>
        <Table striped highlightOnHover withRowBorders style={{ minWidth: 640 }}>
          <thead>
            <tr>
              <th style={{ padding: 12 }}>Name</th>
              <th style={{ padding: 12 }}>Commission</th>
              <th style={{ padding: 12 }}>Incentives</th>
              <th style={{ padding: 12 }}>Total payout</th>
              <th style={{ padding: 12 }}>Paid</th>
              <th style={{ padding: 12 }}>Outstanding</th>
              <th style={{ padding: 12 }} />
            </tr>
          </thead>
          <tbody>
            {summaries.map((item, index) => {
              const rowHasDetails =
                (item.productTotals && item.productTotals.length > 0) ||
                item.breakdown.length > 0 ||
                hasPlatformGuestDetails(item) ||
                (item.lockedComponents && item.lockedComponents.length > 0) ||
                (item.componentTotals && item.componentTotals.length > 0);
              const incentiveAmount = calculateIncentiveTotal(item);
              const paidAmount = item.payouts?.payablePaid ?? 0;
              const outstandingAmount = item.payouts?.payableOutstanding ?? 0;
              const payoutCurrency = item.payouts?.currency ?? DEFAULT_CURRENCY;
              return (
                <Fragment key={item.userId ?? index}>
                  <tr>
                    <td style={{ padding: 12 }}>{item.firstName}</td>
                    <td style={{ padding: 12 }}>{formatCurrency(item.totalCommission)}</td>
                    <td style={{ padding: 12 }}>{formatCurrency(incentiveAmount)}</td>
                    <td style={{ padding: 12 }}>{formatCurrency(normalizeTotal(item))}</td>
                    <td style={{ padding: 12 }}>{formatCurrency(paidAmount, payoutCurrency)}</td>
                    <td style={{ padding: 12 }}>{formatCurrency(outstandingAmount, payoutCurrency)}</td>
                    <td style={{ padding: 12, textAlign: 'right' }}>
                      <Stack gap={6} align="flex-end">
                        {outstandingAmount > 0 ? (
                          <Button variant="light" size="xs" onClick={() => openEntryModal(item)}>
                            Record payment
                          </Button>
                        ) : (
                          <Text size="xs" c="dimmed">
                            Settled
                          </Text>
                        )}
                        {rowHasDetails && (
                          <Button variant="subtle" size="xs" onClick={() => toggleRow(index)}>
                            {expandedRow === index ? 'Hide details' : 'Show details'}
                          </Button>
                        )}
                      </Stack>
                    </td>
                  </tr>
                  {expandedRow === index && (
                    <tr>
                      <td colSpan={7} style={{ backgroundColor: '#fafafa', padding: '12px 8px' }}>
                        <Stack gap="md">
                          {renderBucketTotals(item.bucketTotals, item.lockedComponents)}
                          {renderComponentList(
                            item.componentTotals,
                            item.platformGuestBreakdowns,
                            item.platformGuestTotals,
                            item.lockedComponents,
                          )}
                          {renderProductTotals(item.productTotals, item.componentTotals, item.lockedComponents)}
                          {item.breakdown.length > 0 &&
                            renderBreakdownTable(item, item.breakdown, buildIncentiveLookup(item))}
                        </Stack>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            <tr>
              <td style={{ padding: 12 }}>
                <strong>Total</strong>
              </td>
              <td style={{ padding: 12 }}>
                <strong>{formatCurrency(tableCommissionTotal)}</strong>
              </td>
              <td style={{ padding: 12 }}>
                <strong>{formatCurrency(tableIncentiveTotal)}</strong>
              </td>
              <td style={{ padding: 12 }}>
                <strong>{formatCurrency(tablePayoutTotal)}</strong>
              </td>
              <td style={{ padding: 12 }}>
                <strong>{formatCurrency(tablePaidTotal, DEFAULT_CURRENCY)}</strong>
              </td>
              <td style={{ padding: 12 }}>
                <strong>{formatCurrency(tableOutstandingTotal, DEFAULT_CURRENCY)}</strong>
              </td>
              <td />
            </tr>
          </tbody>
        </Table>
      </ScrollArea>
    );
  };

  let content: React.ReactNode;

  if (!permissionsReady || permissionsLoading) {
    content = (
      <Center style={{ height: '60vh' }}>
        <Loader variant="dots" />
      </Center>
    );
  } else if (!(canViewFull || canViewSelf)) {
    content = (
      <Container size={600} my={40}>
        <Alert color="yellow" title="No access">
          You do not have permission to view staff payment details.
        </Alert>
      </Container>
    );
  } else {
    content = (
      <Container fluid={!isDesktop} size={isDesktop ? 780 : undefined} my={isDesktop ? 40 : 16} px={isDesktop ? 'md' : 'sm'}>
        <Paper radius={isDesktop ? 12 : 'lg'} p={isDesktop ? 'xl' : 'md'} withBorder>
          <Stack gap="md">
            {usingSelfScope && (
              <Alert color="blue" title="Personal view">
                You are viewing your own payouts only.
              </Alert>
            )}

            <Stack gap={isDesktop ? 'lg' : 'sm'}>
              <Stack gap="xs">
                <Group
                  justify={isDesktop ? 'space-between' : 'flex-start'}
                  align={isDesktop ? 'end' : 'stretch'}
                  gap={isDesktop ? 'lg' : 'sm'}
                  wrap="wrap"
                >
                  <Box style={{ flex: isDesktop ? 1 : 'unset', width: isDesktop ? 'auto' : '100%' }}>
                    <Select
                      label="Period"
                      data={DATE_PRESET_OPTIONS}
                      value={datePreset}
                      onChange={(value) => handlePresetChange(value)}
                    />
                  </Box>
                  {datePreset === 'custom' && (
                    <Box style={{ flex: isDesktop ? 1 : 'unset', width: isDesktop ? 'auto' : '100%' }}>
                      <DatePickerInput
                        label="Custom range"
                        type="range"
                        value={customRangeValue}
                        onChange={handleCustomRangeChange}
                        valueFormat="MMM DD, YYYY"
                        allowSingleDateInRange
                        minDate={EARLIEST_DATA_DATE.toDate()}
                        maxDate={today.toDate()}
                      />
                    </Box>
                  )}
                </Group>
                <Text size="sm" c="dimmed" ta="center">
                  {startDate && endDate
                    ? `${startDate.format('MMM D, YYYY')} › ${endDate.format('MMM D, YYYY')}`
                    : 'Select a date range'}
                </Text>
              </Stack>

              {loading && (
                <Center>
                  <Loader size="lg" />
                </Center>
              )}

              {friendlyError && (
                <Alert color="red" title={friendlyError.title} variant="light">
                  <Text size="sm">{friendlyError.description}</Text>
                  {friendlyError.details && (
                    <Text size="xs" c="dimmed" mt={4}>
                      Details: {friendlyError.details}
                    </Text>
                  )}
                </Alert>
              )}

              {!loading && !error && summaries.length > 0 && (
                <Stack gap="lg">
                  {renderSummaryBoard()}
                  {renderCharts()}
                  {isDesktop ? renderDesktopTable() : renderMobileCards()}
                </Stack>
              )}

              {!loading && !error && summaries.length === 0 && (
                <Text ta="center">No data available for the selected dates.</Text>
              )}
            </Stack>
          </Stack>
        </Paper>
      </Container>
    );
  }

  const reportingRangeLabel =
    startDate && endDate
      ? `${startDate.format('MMM D, YYYY')} - ${endDate.format('MMM D, YYYY')}`
      : 'selected period';

  return (
    <PageAccessGuard pageSlug={PAGE_SLUG}>
      <>
        {content}
        <Modal
          opened={entryModal.open}
          onClose={closeEntryModal}
          title={
            entryModal.staff
              ? `Record payout for ${entryModal.staff.firstName}`
              : 'Record staff payout'
          }
          size="lg"
          radius="md"
        >
          <Stack gap="sm">
            {entryModal.staff && (
              <Alert color="blue" variant="light">
                Outstanding this range:{' '}
                {formatCurrency(
                  entryModal.staff.payouts?.payableOutstanding ?? 0,
                  entryModal.staff.payouts?.currency ?? DEFAULT_CURRENCY,
                )}
              </Alert>
            )}
            <Text size="xs" c="dimmed">
              Period: {reportingRangeLabel}
            </Text>
            <NumberInput
              label="Amount"
              value={entryModal.amount}
              min={0}
              step={10}
              hideControls
              onChange={(value) => {
                const numericValue = typeof value === 'number' ? value : Number(value ?? 0);
                setEntryModal((prev) => ({
                  ...prev,
                  amount: Number.isFinite(numericValue) ? numericValue : prev.amount,
                }));
              }}
            />
            <Select
              label="Account"
              placeholder="Select an account"
              data={accountOptions}
              value={entryModal.accountId}
              onChange={handleEntryAccountChange}
              searchable
            />
            <Select
              label="Expense category"
              placeholder="Select a category"
              data={expenseCategoryOptions}
              value={entryModal.categoryId}
              onChange={(value) => setEntryModal((prev) => ({ ...prev, categoryId: value ?? '' }))}
              searchable
            />
            <Select
              label="Vendor"
              placeholder="Select the staff vendor profile"
              data={vendorOptions}
              value={entryModal.counterpartyId}
              onChange={handleCounterpartyChange}
              searchable
            />
            <DatePickerInput
              label="Payment date"
              value={entryModal.date}
              onChange={(value) => {
                if (value) {
                  setEntryModal((prev) => ({ ...prev, date: value }));
                }
              }}
            />
            <Textarea
              label="Description"
              minRows={2}
              value={entryModal.description}
              onChange={(event) =>
                setEntryModal((prev) => ({ ...prev, description: event.currentTarget.value }))
              }
            />
            <Text size="xs" c="dimmed">
              Currency: {entryModal.currency}
            </Text>
            {entryMessage && (
              <Alert color={entryMessage.type === 'error' ? 'red' : 'green'}>{entryMessage.text}</Alert>
            )}
            <Group justify="flex-end">
              <Button variant="subtle" onClick={closeEntryModal}>
                Cancel
              </Button>
              <Button onClick={handleEntrySubmit} loading={entrySubmitting}>
                Record payout
              </Button>
            </Group>
          </Stack>
        </Modal>
      </>
    </PageAccessGuard>
  );
};

export default Pays;

