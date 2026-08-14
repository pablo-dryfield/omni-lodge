import { useCallback, useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Group,
  Loader,
  Paper,
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
import { reviewMonthInWarsaw } from '../../utils/reviewCreditMonth';

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
  const currentWarsawMonth = dayjs(`${reviewMonthInWarsaw(new Date())}-01`);
  const selectedMonth = preset === 'thisMonth' ? currentWarsawMonth : currentWarsawMonth.subtract(1, 'month');
  return [selectedMonth.startOf('month').toDate(), selectedMonth.endOf('month').toDate()];
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
    <Card withBorder radius="md" p={{ base: 'sm', sm: 'md' }}>
      <Stack gap="md">
        <Stack align="center" gap="xs">
          <Title order={3} ta="center">Historical Analytics</Title>
          <Text size="sm" c="dimmed" ta="center" maw={720}>
              Compare review totals, retention, and staff credit trends across any date range.
          </Text>
          <Tooltip label="Refresh analytics">
            <ActionIcon
              variant="light"
              onClick={() => fetchAnalytics().catch(() => {})}
              aria-label="Refresh historical review analytics"
            >
              <IconRefresh size={16} />
            </ActionIcon>
          </Tooltip>
        </Stack>

        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="sm">
          <Stack gap={6} align="center">
            <Text size="sm" fw={500} ta="center">
              Date range
            </Text>
            <Group gap="xs" justify="center" wrap="wrap">
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
                w="100%"
                styles={{ input: { textAlign: 'center' } }}
              />
            ) : (
              <Text size="sm" c="dimmed" ta="center">
                {formatDisplayRange(dateRange)}
              </Text>
            )}
          </Stack>
          <Select
            label="Grouping"
            data={groupByOptions}
            value={groupBy}
            onChange={(value) => setGroupBy((value as 'day' | 'week' | 'month') ?? 'month')}
            w="100%"
            styles={{ label: { width: '100%', textAlign: 'center' }, input: { textAlign: 'center' } }}
          />
          <Select
            label="Platform"
            placeholder="All platforms"
            data={platformOptions}
            value={platform ?? 'all'}
            onChange={(value) => setPlatform(!value || value === 'all' ? null : value)}
            w="100%"
            styles={{ label: { width: '100%', textAlign: 'center' }, input: { textAlign: 'center' } }}
          />
        </SimpleGrid>

        {error && (
          <Alert color="red" title="Analytics unavailable">
            {error}
          </Alert>
        )}

        {loading ? (
          <Group justify="center" py="md">
            <Loader />
          </Group>
        ) : analytics ? (
          <Stack gap="md">
            <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
              {stats.map((stat) => (
                <Card key={stat.label} withBorder radius="md" p="md">
                  <Stack align="center" gap={2}>
                    <Text size="sm" c="dimmed" ta="center">
                      {stat.label}
                    </Text>
                    <Text size="xl" fw={600} ta="center">
                      {stat.value}
                    </Text>
                    <Text size="xs" c="dimmed" ta="center">
                      {stat.description}
                    </Text>
                  </Stack>
                </Card>
              ))}
            </SimpleGrid>

            <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
              <Card withBorder p="md" radius="md">
                <Group justify="center" mb="sm" gap="xs" wrap="wrap">
                  <Text fw={600} ta="center">Timeline</Text>
                  <Badge>{analytics.timeline.length} buckets</Badge>
                </Group>
                {analytics.timeline.length === 0 ? (
                  <Text size="sm" c="dimmed" ta="center">
                    No review counters were submitted for this range.
                  </Text>
                ) : (
                  <Stack gap="xs">
                    {analytics.timeline.map((bucket) => (
                      <Paper key={bucket.key} withBorder radius="sm" p="sm">
                        <Stack gap="xs" align="center">
                          <Stack gap={0} align="center">
                            <Text fw={500} ta="center">{bucket.label}</Text>
                            <Text size="xs" c="dimmed" ta="center">
                            Starting {dayjs(bucket.startDate).format('MMM D, YYYY')}
                            </Text>
                          </Stack>
                          <Group gap="xs" justify="center" wrap="wrap">
                            <Badge color="blue">{bucket.totalReviews} reviews</Badge>
                            {bucket.badReviews > 0 && <Badge color="red">Bad: {bucket.badReviews}</Badge>}
                            {bucket.noNameReviews > 0 && <Badge color="gray">No name: {bucket.noNameReviews}</Badge>}
                          </Group>
                        </Stack>
                      </Paper>
                    ))}
                  </Stack>
                )}
              </Card>

              <Card withBorder p="md" radius="md">
                <Group justify="center" mb="sm" gap="xs" wrap="wrap">
                  <Text fw={600} ta="center">Top Contributors</Text>
                  <Badge>{analytics.topContributors.length}</Badge>
                </Group>
                {analytics.topContributors.length === 0 ? (
                  <Text size="sm" c="dimmed" ta="center">
                    No staff contributions recorded for this period.
                  </Text>
                ) : (
                  <Stack gap="xs">
                    {analytics.topContributors.map((contributor) => (
                      <Paper
                        key={`${contributor.displayName}-${contributor.userId ?? 'anon'}`}
                        withBorder
                        radius="sm"
                        p="sm"
                      >
                        <Stack gap="xs" align="center">
                          <Stack gap={0} align="center">
                            <Text fw={500} ta="center">{contributor.displayName}</Text>
                            <Text size="xs" c="dimmed" ta="center">
                              Logged {contributor.counters} counter{contributor.counters === 1 ? '' : 's'}
                            </Text>
                          </Stack>
                          <Group gap="xs" justify="center" wrap="wrap">
                            <Badge color="green">{contributor.rawCount.toFixed(2)} credits</Badge>
                            {contributor.roundedCount !== contributor.rawCount && (
                              <Badge color="gray" variant="light">
                                Rounded {contributor.roundedCount}
                              </Badge>
                            )}
                          </Group>
                        </Stack>
                      </Paper>
                    ))}
                  </Stack>
                )}
              </Card>
            </SimpleGrid>

            <Card withBorder p="md" radius="md">
              <Group justify="center" mb="sm" gap="xs" wrap="wrap">
                <Text fw={600} ta="center">Platforms</Text>
                <Badge>{analytics.platforms.length}</Badge>
              </Group>
              {analytics.platforms.length === 0 ? (
                <Text size="sm" c="dimmed" ta="center">
                  No platforms reported reviews for this range.
                </Text>
              ) : (
                <>
                  <Box visibleFrom="sm">
                    <Table.ScrollContainer minWidth={620}>
                      <Table striped highlightOnHover>
                        <Table.Thead>
                          <Table.Tr>
                            <Table.Th ta="center">Platform</Table.Th>
                            <Table.Th ta="center">Reviews</Table.Th>
                            <Table.Th ta="center">Bad</Table.Th>
                            <Table.Th ta="center">No Name</Table.Th>
                            <Table.Th ta="center">Counters</Table.Th>
                          </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                          {analytics.platforms.map((platformRow) => (
                            <Table.Tr key={platformRow.platform}>
                              <Table.Td ta="center">{platformRow.platform}</Table.Td>
                              <Table.Td ta="center">{platformRow.totalReviews.toLocaleString()}</Table.Td>
                              <Table.Td ta="center">{platformRow.badReviews.toLocaleString()}</Table.Td>
                              <Table.Td ta="center">{platformRow.noNameReviews.toLocaleString()}</Table.Td>
                              <Table.Td ta="center">{platformRow.counters.toLocaleString()}</Table.Td>
                            </Table.Tr>
                          ))}
                        </Table.Tbody>
                      </Table>
                    </Table.ScrollContainer>
                  </Box>
                  <Stack hiddenFrom="sm" gap="sm">
                    {analytics.platforms.map((platformRow) => (
                      <Paper key={platformRow.platform} withBorder radius="sm" p="md">
                        <Stack align="center" gap="sm">
                          <Text fw={700} ta="center">{platformRow.platform}</Text>
                          <SimpleGrid cols={2} spacing="sm" w="100%">
                            <Stack align="center" gap={0}>
                              <Text size="xs" c="dimmed" ta="center">Reviews</Text>
                              <Text fw={600}>{platformRow.totalReviews.toLocaleString()}</Text>
                            </Stack>
                            <Stack align="center" gap={0}>
                              <Text size="xs" c="dimmed" ta="center">Bad</Text>
                              <Text fw={600}>{platformRow.badReviews.toLocaleString()}</Text>
                            </Stack>
                            <Stack align="center" gap={0}>
                              <Text size="xs" c="dimmed" ta="center">No name</Text>
                              <Text fw={600}>{platformRow.noNameReviews.toLocaleString()}</Text>
                            </Stack>
                            <Stack align="center" gap={0}>
                              <Text size="xs" c="dimmed" ta="center">Counters</Text>
                              <Text fw={600}>{platformRow.counters.toLocaleString()}</Text>
                            </Stack>
                          </SimpleGrid>
                        </Stack>
                      </Paper>
                    ))}
                  </Stack>
                </>
              )}
            </Card>
          </Stack>
        ) : (
          <Text size="sm" c="dimmed" ta="center">
            Select a date range to visualize analytics.
          </Text>
        )}
      </Stack>
    </Card>
  );
};

export default ReviewAnalyticsPanel;
