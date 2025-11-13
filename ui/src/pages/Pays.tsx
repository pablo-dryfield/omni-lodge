import React, { Fragment, useEffect, useMemo, useState } from 'react';
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
} from '@mantine/core';
import { DatePicker } from '@mui/x-date-pickers';
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
import { useModuleAccess } from '../hooks/useModuleAccess';
import { PageAccessGuard } from '../components/access/PageAccessGuard';
import { PAGE_SLUGS } from '../constants/pageSlugs';
import { useMediaQuery } from '@mantine/hooks';
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

const formatCurrency = (value: number | undefined): string => {
  const numberPart = (value ?? 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${numberPart} zł`;
};

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

const FULL_ACCESS_MODULE = 'staff-payouts-all';
const SELF_ACCESS_MODULE = 'staff-payouts-self';
const PAGE_SLUG = PAGE_SLUGS.pays;

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
              <Stack key={component.componentId} gap={4}>
                <Group justify="space-between" gap="xs">
                  <Group gap={6}>
                    <Badge color={getComponentColor(component.category)} variant="light">
                      {component.category}
                    </Badge>
                    <Text size="sm">{component.name}</Text>
                  </Group>
                  <Text size="sm" fw={600}>
                    {formatCurrency(component.amount)}
                  </Text>
                </Group>
                {showPlatformTotals && (
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
                          {tier.cumulativeGuests - tier.units + 1}–{tier.cumulativeGuests} guests @{' '}
                          {tier.rate.toFixed(2)} zł
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
                    (needs {entry.requirement.minReviews} reviews, current {entry.requirement.actualReviews})
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


const renderBucketTotals = (bucketTotals?: Record<string, number>) => {
  if (!bucketTotals || Object.keys(bucketTotals).length === 0) {
    return null;
  }
  return (
    <Stack gap="xs">
      <Text size="sm" fw={600}>
        Payments
      </Text>
      <Stack gap={4}>
        {Object.entries(bucketTotals).map(([bucket, amount]) => (
          <Group key={bucket} justify="space-between">
            <Badge variant="outline" color={getComponentColor(bucket)}>
              {bucket}
            </Badge>
            <Text size="sm">{formatCurrency(amount)}</Text>
          </Group>
        ))}
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
        {items.map((entry, index) => (
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
          const hasUnlockedComponent =
            componentBreakdown.some(
              (component) =>
                !lockedComponents?.some((entry) => entry.componentId === component.componentId)
            );
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
                    {lockedComponents && lockedComponents.length > 0 && (
                      <Stack gap={2} pt="xs">
                        <Text size="xs" c="red" fw={600}>
                          Locked incentives
                        </Text>
                        {lockedComponents.map((entry, lockedIdx) => (
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

  const today = dayjs();
  const [startDate, setStartDate] = useState<Dayjs | null>(today.startOf('month'));
  const [endDate, setEndDate] = useState<Dayjs | null>(today.endOf('month'));
  const [expandedRow, setExpandedRow] = useState<number | null>(null);

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

  const toggleRow = (index: number) => {
    setExpandedRow((prev) => (prev === index ? null : index));
  };

  const theme = useMantineTheme();
  const isDesktop = useMediaQuery(`(min-width: ${theme.breakpoints.md})`);

  const bucketChartColors = aggregatedBucketData.map(
    (data) => theme.colors[getComponentColor(data.bucket) as keyof typeof theme.colors]?.[5] ?? theme.colors.blue[6],
  );

  const renderSummaryBoard = () => (
    <SimpleGrid cols={{ base: 1, sm: 2, md: 4 }}>
      <Card withBorder>
        <Text size="sm" c="dimmed">
          Total payout
        </Text>
        <Title order={4}>{formatCurrency(totalPayout)}</Title>
        <Text size="xs" c="dimmed">
          Across {totalGuides} guide{totalGuides === 1 ? '' : 's'}
        </Text>
      </Card>
      <Card withBorder>
        <Text size="sm" c="dimmed">
          Commission
        </Text>
        <Title order={4}>{formatCurrency(totalCommission)}</Title>
        <Text size="xs" c="dimmed">
          Direct commission earned
        </Text>
      </Card>
      <Card withBorder>
        <Text size="sm" c="dimmed">
          Incentives & bonuses
        </Text>
        <Title order={4}>
          {formatCurrency(
            aggregatedBucketData
              .filter((bucket) => bucket.bucket !== 'commission')
              .reduce((sum, bucket) => sum + bucket.amount, 0),
          )}
        </Title>
        <Text size="xs" c="dimmed">
          Additional payouts (base, incentives, reviews)
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
          Updated from counter data
        </Text>
      </Card>
    </SimpleGrid>
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
                {renderComponentList(
                  item.componentTotals,
                  item.platformGuestBreakdowns,
                  item.platformGuestTotals,
                  item.lockedComponents,
                )}
                {renderBucketTotals(item.bucketTotals)}
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
    return (
      <ScrollArea>
        <Table striped highlightOnHover withRowBorders style={{ minWidth: 640 }}>
          <thead>
            <tr>
              <th style={{ padding: 12 }}>Name</th>
              <th style={{ padding: 12 }}>Commission</th>
              <th style={{ padding: 12 }}>Incentives</th>
              <th style={{ padding: 12 }}>Total payout</th>
              <th style={{ padding: 12 }} />
            </tr>
          </thead>
          <tbody>
            {summaries.map((item, index) => {
              const rowHasDetails =
                (item.productTotals && item.productTotals.length > 0) ||
                item.breakdown.length > 0 ||
                hasPlatformGuestDetails(item) ||
                (item.lockedComponents && item.lockedComponents.length > 0);
              const incentiveAmount = calculateIncentiveTotal(item);
              return (
                <Fragment key={item.userId ?? index}>
                  <tr>
                    <td style={{ padding: 12 }}>{item.firstName}</td>
                    <td style={{ padding: 12 }}>{formatCurrency(item.totalCommission)}</td>
                    <td style={{ padding: 12 }}>{formatCurrency(incentiveAmount)}</td>
                    <td style={{ padding: 12 }}>{formatCurrency(normalizeTotal(item))}</td>
                    <td style={{ padding: 12, textAlign: 'right' }}>
                      {rowHasDetails && (
                        <Button variant="subtle" size="xs" onClick={() => toggleRow(index)}>
                          {expandedRow === index ? 'Hide details' : 'Show details'}
                        </Button>
                      )}
                    </td>
                  </tr>
                  {expandedRow === index && (
                    <tr>
                      <td colSpan={4} style={{ backgroundColor: '#fafafa', padding: '12px 8px' }}>
                        <Stack gap="md">
                          {renderBucketTotals(item.bucketTotals)}
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
              <Group
                justify={isDesktop ? 'space-between' : 'flex-start'}
                align={isDesktop ? 'center' : 'stretch'}
                gap={isDesktop ? 'lg' : 'sm'}
                wrap="wrap"
              >
                <Box style={{ flex: isDesktop ? 1 : 'unset', width: isDesktop ? 'auto' : '100%' }}>
                  <DatePicker
                    label="Start Date"
                    format="YYYY-MM-DD"
                    value={startDate}
                    onChange={(newValue: Dayjs | null) => setStartDate(newValue)}
                  />
                </Box>
                <Box style={{ flex: isDesktop ? 1 : 'unset', width: isDesktop ? 'auto' : '100%' }}>
                  <DatePicker
                    label="End Date"
                    format="YYYY-MM-DD"
                    value={endDate}
                    onChange={(newValue: Dayjs | null) => setEndDate(newValue)}
                  />
                </Box>
              </Group>

              {loading && (
                <Center>
                  <Loader size="lg" />
                </Center>
              )}

              {error && (
                <Text c="red" ta="center">
                  {error}
                </Text>
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

  return <PageAccessGuard pageSlug={PAGE_SLUG}>{content}</PageAccessGuard>;
};

export default Pays;
