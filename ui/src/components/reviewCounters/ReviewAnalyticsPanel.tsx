import { useCallback, useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Loader,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Title,
  Tooltip,
  Select,
} from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { IconRefresh } from '@tabler/icons-react';
import axiosInstance from '../../utils/axiosInstance';
import type { ReviewAnalyticsPayload } from '../../types/reviewCounters/ReviewAnalytics';
import type { ReviewPlatform as ReviewPlatformDto } from '../../types/reviewPlatforms/ReviewPlatform';
import type { ServerResponse } from '../../types/general/ServerResponse';

type RangePreset = 'thisMonth' | 'lastMonth' | 'custom';

const DATE_FORMAT = 'YYYY-MM-DD';

const formatDisplayRange = (range: [Date | null, Date | null]) => {
  const [start, end] = range;
  if (!start || !end) {
    return 'Select a date range';
  }
  return `${dayjs(start).format('MMM D, YYYY')} - ${dayjs(end).format('MMM D, YYYY')}`;
};

const groupByOptions = [
  { value: 'day', label: 'Daily' },
  { value: 'week', label: 'Weekly' },
  { value: 'month', label: 'Monthly' },
];

const getPresetRange = (preset: Exclude<RangePreset, 'custom'>): [Date, Date] => {
  if (preset === 'thisMonth') {
    const start = dayjs().startOf('month').toDate();
    const end = dayjs().endOf('month').toDate();
    return [start, end];
  }
  const lastMonthEnd = dayjs().startOf('month').subtract(1, 'day');
  return [lastMonthEnd.startOf('month').toDate(), lastMonthEnd.endOf('month').toDate()];
};

const ReviewAnalyticsPanel = () => {
  const [preset, setPreset] = useState<RangePreset>('thisMonth');
  const [dateRange, setDateRange] = useState<[Date | null, Date | null]>(() => getPresetRange('thisMonth'));
  const [groupBy, setGroupBy] = useState<'day' | 'week' | 'month'>('month');
  const [platform, setPlatform] = useState<string | null>(null);
  const [analytics, setAnalytics] = useState<ReviewAnalyticsPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [platformOptions, setPlatformOptions] = useState<Array<{ value: string; label: string }>>([
    { value: 'all', label: 'All platforms' },
  ]);

  useEffect(() => {
    const loadPlatforms = async () => {
      try {
        const response = await axiosInstance.get<ServerResponse<ReviewPlatformDto>>('/reviewPlatforms', {
          withCredentials: true,
        });
        const records = response.data[0]?.data ?? [];
        setPlatformOptions(
          [{ value: 'all', label: 'All platforms' }].concat(
            records
              .filter((platformRecord) => platformRecord.isActive !== false)
              .map((record) => ({ value: record.slug, label: record.name ?? record.slug })),
          ),
        );
      } catch (platformError) {
        console.error('Failed to load review platforms', platformError);
      }
    };
    loadPlatforms().catch(() => {});
  }, []);

  const handlePresetChange = useCallback(
    (value: RangePreset) => {
      setPreset(value);
      if (value !== 'custom') {
        setDateRange(getPresetRange(value));
      }
    },
    [],
  );

  const fetchAnalytics = useCallback(async () => {
    if (!dateRange[0] || !dateRange[1]) {
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const params: Record<string, string> = {
        startDate: dayjs(dateRange[0]).format(DATE_FORMAT),
        endDate: dayjs(dateRange[1]).format(DATE_FORMAT),
        groupBy,
      };
      if (platform && platform !== 'all') {
        params.platform = platform;
      }
        const response = await axiosInstance.get<ServerResponse<ReviewAnalyticsPayload>>('/reviewCounters/analytics', {
          params,
          withCredentials: true,
        });
        const payload = response.data[0]?.data?.[0] ?? null;
        setAnalytics(payload ?? null);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : 'Failed to load review analytics');
      setAnalytics(null);
    } finally {
      setLoading(false);
    }
  }, [dateRange, groupBy, platform]);

  useEffect(() => {
    fetchAnalytics().catch(() => {});
  }, [fetchAnalytics]);

  const stats = useMemo(() => {
    if (!analytics) {
      return [];
    }
    return [
      {
        label: 'Total Reviews',
        value: analytics.totals.totalReviews.toLocaleString(),
        description: `${analytics.totals.counters} counter${analytics.totals.counters === 1 ? '' : 's'}`,
      },
      {
        label: 'Bad Reviews',
        value: analytics.totals.badReviews.toLocaleString(),
        description: 'All platforms',
      },
      {
        label: 'No Name Reviews',
        value: analytics.totals.noNameReviews.toLocaleString(),
        description: 'Across range',
      },
      {
        label: 'Contributors',
        value: analytics.totals.contributors.toLocaleString(),
        description: `${analytics.totals.platforms} platform${analytics.totals.platforms === 1 ? '' : 's'}`,
      },
    ];
  }, [analytics]);

  return (
    <Card withBorder radius="md" padding="md">
      <Stack gap="md">
        <Group justify="space-between" align="flex-start">
          <Stack gap={2}>
            <Title order={3}>Historical Analytics</Title>
            <Text size="sm" c="dimmed">
              Compare review totals, retention, and staff credit trends across any date range.
            </Text>
          </Stack>
          <Tooltip label="Refresh analytics">
            <ActionIcon variant="light" onClick={() => fetchAnalytics().catch(() => {})}>
              <IconRefresh size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>

        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="sm">
          <Stack gap={6}>
            <Text size="sm" fw={500}>
              Date range
            </Text>
            <Group gap="xs">
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
                onClick={() => handlePresetChange('custom')}
              >
                Custom
              </Button>
            </Group>
            {preset === 'custom' ? (
              <DatePickerInput
                type="range"
                value={dateRange}
                onChange={(rangeValue) => {
                  setDateRange(rangeValue);
                  setPreset('custom');
                }}
                allowSingleDateInRange={false}
                valueFormat="MMM D, YYYY"
                maxDate={new Date()}
              />
            ) : (
              <Text size="sm" c="dimmed">
                {formatDisplayRange(dateRange)}
              </Text>
            )}
          </Stack>
          <Select
            label="Grouping"
            data={groupByOptions}
            value={groupBy}
            onChange={(value) => setGroupBy((value as 'day' | 'week' | 'month') ?? 'month')}
          />
          <Select
            label="Platform"
            placeholder="All platforms"
            data={platformOptions}
            value={platform ?? 'all'}
            onChange={(value) => setPlatform(!value || value === 'all' ? null : value)}
          />
        </SimpleGrid>

        {error && (
          <Alert color="red" title="Analytics unavailable">
            {error}
          </Alert>
        )}

        {loading ? (
          <Group justify="center">
            <Loader />
          </Group>
        ) : analytics ? (
          <Stack gap="md">
            <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
              {stats.map((stat) => (
                <Card key={stat.label} withBorder radius="md" padding="md">
                  <Text size="sm" c="dimmed">
                    {stat.label}
                  </Text>
                  <Text size="xl" fw={600}>
                    {stat.value}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {stat.description}
                  </Text>
                </Card>
              ))}
            </SimpleGrid>

            <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
              <Card withBorder padding="md" radius="md">
                <Group justify="space-between" mb="sm">
                  <Text fw={600}>Timeline</Text>
                  <Badge>{analytics.timeline.length} buckets</Badge>
                </Group>
                {analytics.timeline.length === 0 ? (
                  <Text size="sm" c="dimmed">
                    No review counters were submitted for this range.
                  </Text>
                ) : (
                  <Stack gap="xs">
                    {analytics.timeline.map((bucket) => (
                      <Group key={bucket.key} justify="space-between">
                        <Stack gap={0}>
                          <Text fw={500}>{bucket.label}</Text>
                          <Text size="xs" c="dimmed">
                            Starting {dayjs(bucket.startDate).format('MMM D, YYYY')}
                          </Text>
                        </Stack>
                        <Group gap="xs">
                          <Badge color="blue">{bucket.totalReviews} reviews</Badge>
                          {bucket.badReviews > 0 && <Badge color="red">Bad: {bucket.badReviews}</Badge>}
                          {bucket.noNameReviews > 0 && <Badge color="gray">No name: {bucket.noNameReviews}</Badge>}
                        </Group>
                      </Group>
                    ))}
                  </Stack>
                )}
              </Card>

              <Card withBorder padding="md" radius="md">
                <Group justify="space-between" mb="sm">
                  <Text fw={600}>Top Contributors</Text>
                  <Badge>{analytics.topContributors.length}</Badge>
                </Group>
                {analytics.topContributors.length === 0 ? (
                  <Text size="sm" c="dimmed">
                    No staff contributions recorded for this period.
                  </Text>
                ) : (
                  <Stack gap="xs">
                    {analytics.topContributors.map((contributor) => (
                      <Group key={`${contributor.displayName}-${contributor.userId ?? 'anon'}`} justify="space-between">
                        <Stack gap={0}>
                          <Text fw={500}>{contributor.displayName}</Text>
                          <Text size="xs" c="dimmed">
                            Logged {contributor.counters} counter{contributor.counters === 1 ? '' : 's'}
                          </Text>
                        </Stack>
                        <Group gap="xs">
                          <Badge color="green">{contributor.rawCount.toFixed(2)} credits</Badge>
                          {contributor.roundedCount !== contributor.rawCount && (
                            <Badge color="gray" variant="light">
                              Rounded {contributor.roundedCount}
                            </Badge>
                          )}
                        </Group>
                      </Group>
                    ))}
                  </Stack>
                )}
              </Card>
            </SimpleGrid>

            <Card withBorder padding="md" radius="md">
              <Group justify="space-between" mb="sm">
                <Text fw={600}>Platforms</Text>
                <Badge>{analytics.platforms.length}</Badge>
              </Group>
              {analytics.platforms.length === 0 ? (
                <Text size="sm" c="dimmed">
                  No platforms reported reviews for this range.
                </Text>
              ) : (
                <Table striped highlightOnHover>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Platform</Table.Th>
                      <Table.Th ta="right">Reviews</Table.Th>
                      <Table.Th ta="right">Bad</Table.Th>
                      <Table.Th ta="right">No Name</Table.Th>
                      <Table.Th ta="right">Counters</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {analytics.platforms.map((platformRow) => (
                      <Table.Tr key={platformRow.platform}>
                        <Table.Td>{platformRow.platform}</Table.Td>
                        <Table.Td ta="right">{platformRow.totalReviews.toLocaleString()}</Table.Td>
                        <Table.Td ta="right">{platformRow.badReviews.toLocaleString()}</Table.Td>
                        <Table.Td ta="right">{platformRow.noNameReviews.toLocaleString()}</Table.Td>
                        <Table.Td ta="right">{platformRow.counters.toLocaleString()}</Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              )}
            </Card>
          </Stack>
        ) : (
          <Text size="sm" c="dimmed">
            Select a date range to visualize analytics.
          </Text>
        )}
      </Stack>
    </Card>
  );
};

export default ReviewAnalyticsPanel;
