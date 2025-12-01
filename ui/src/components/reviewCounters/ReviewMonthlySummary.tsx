import { useCallback, useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Group,
  LoadingOverlay,
  Stack,
  Table,
  Text,
  Tooltip,
} from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { IconInfoCircle, IconRefresh } from '@tabler/icons-react';
import type { ReviewCounterStaffSummary, ReviewCounterStaffRow } from '../../types/reviewCounters/ReviewCounterStaffSummary';
import { fetchReviewStaffSummary, updateReviewMonthlyApproval } from '../../api/reviewCounters';

type Preset = 'thisMonth' | 'lastMonth' | 'custom';

const getPresetRange = (preset: Exclude<Preset, 'custom'>): [Date, Date] => {
  if (preset === 'thisMonth') {
    return [dayjs().startOf('month').toDate(), dayjs().endOf('month').toDate()];
  }
  const lastMonthEnd = dayjs().startOf('month').subtract(1, 'day');
  return [lastMonthEnd.startOf('month').toDate(), lastMonthEnd.endOf('month').toDate()];
};

const formatDisplayRange = (range: [Date | null, Date | null]) => {
  const [start, end] = range;
  if (!start || !end) {
    return 'Select a date range';
  }
  return `${dayjs(start).format('MMM D, YYYY')} - ${dayjs(end).format('MMM D, YYYY')}`;
};

const extractErrorMessage = (error: unknown): string => {
  if (error && typeof error === 'object' && 'response' in error) {
    const axiosError = error as { response?: { data?: Array<{ message?: string }> } };
    const message = axiosError.response?.data?.[0]?.message;
    if (message) {
      return message;
    }
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'Something went wrong';
};

const ReviewMonthlySummary = () => {
  const [preset, setPreset] = useState<Preset>('thisMonth');
  const [range, setRange] = useState<[Date | null, Date | null]>(getPresetRange('thisMonth'));
  const [summary, setSummary] = useState<ReviewCounterStaffSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingActions, setPendingActions] = useState<Set<string>>(new Set());

  const loadSummary = useCallback(
    async (nextRange: [Date | null, Date | null]) => {
      if (!nextRange[0]) {
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const periodStart = dayjs(nextRange[0]).startOf('month').format('YYYY-MM-DD');
        const payload = await fetchReviewStaffSummary({ periodStart });
        setSummary(payload);
      } catch (err) {
        setSummary(null);
        setError(extractErrorMessage(err));
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    loadSummary(range).catch(() => {});
  }, [loadSummary, range]);

  const handlePresetChange = (value: Preset) => {
    setPreset(value);
    if (value === 'custom') {
      return;
    }
    setRange(getPresetRange(value));
  };

  const handleCustomRangeChange = (nextRange: [Date | null, Date | null]) => {
    setPreset('custom');
    setRange(nextRange);
  };

  const handleRefresh = () => {
    loadSummary(range).catch(() => {});
  };

  const setActionState = useCallback((key: string, active: boolean) => {
    setPendingActions((prev) => {
      const next = new Set(prev);
      if (active) {
        next.add(key);
      } else {
        next.delete(key);
      }
      return next;
    });
  }, []);

  const handleApprovalClick = async (row: ReviewCounterStaffRow, type: 'payment' | 'incentive') => {
    if (!summary) {
      return;
    }
    const key = `${row.userId}:${type}`;
    setActionState(key, true);
    setError(null);
    try {
      const payload =
        type === 'payment'
          ? { periodStart: summary.periodStart, paymentApproved: true }
          : { periodStart: summary.periodStart, incentiveApproved: true };
      const updated = await updateReviewMonthlyApproval(row.userId, payload);
      setSummary(updated);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setActionState(key, false);
    }
  };

  const emptyState = useMemo(() => {
    if (loading) {
      return (
        <Group justify="center" py="md">
          <IconInfoCircle size={18} />
          <Text size="sm" c="dimmed">
            Loading summary...
          </Text>
        </Group>
      );
    }
    return (
      <Group justify="center" py="md">
        <IconInfoCircle size={18} />
        <Text size="sm" c="dimmed">
          No staff review counters recorded for this range.
        </Text>
      </Group>
    );
  }, [loading]);

  const renderPlatformBadges = (row: ReviewCounterStaffRow) => (
    <Stack gap={4}>
      {row.platforms.map((platform) => (
        <Group key={`${row.userId}-${platform.counterId}`} justify="space-between">
          <Group gap={6}>
            <Text size="sm" fw={500}>
              {platform.platform}
            </Text>
            {platform.needsMinimum && (
              <Badge color={platform.underMinimumApproved ? 'yellow' : 'red'} variant="light">
                {platform.underMinimumApproved ? 'Approved under 15' : 'Needs approval'}
              </Badge>
            )}
          </Group>
          <Badge color={platform.needsMinimum ? 'gray' : 'teal'} variant="light">
            {platform.rawCount.toFixed(2)} reviews
          </Badge>
        </Group>
      ))}
    </Stack>
  );

  const renderPaymentCell = (row: ReviewCounterStaffRow) => {
    const minimumReviews = summary?.minimumReviews ?? 15;
    const actionKey = `${row.userId}:payment`;
    if (row.paymentApproval.approved) {
      return (
        <Stack gap={4}>
          <Badge color="teal" variant="light">
            Approved
          </Badge>
          {row.paymentApproval.approvedByName && (
            <Text size="xs" c="dimmed">
              by {row.paymentApproval.approvedByName}
            </Text>
          )}
        </Stack>
      );
    }
    if (row.totalReviews >= minimumReviews) {
      return (
        <Stack gap={4}>
          <Badge color="teal" variant="light">
            Hit review target
          </Badge>
          <Text size="xs" c="dimmed">
            Reviews will be paid automatically.
          </Text>
        </Stack>
      );
    }
    return (
      <Stack gap={4}>
        <Button
          size="xs"
          onClick={() => handleApprovalClick(row, 'payment')}
          disabled={pendingActions.has(actionKey)}
          loading={pendingActions.has(actionKey)}
        >
          Approve for Review Payment
        </Button>
        <Text size="xs" c="dimmed">
          Marks all platforms under 15 as approved.
        </Text>
      </Stack>
    );
  };

  const renderIncentiveCell = (row: ReviewCounterStaffRow) => {
    const actionKey = `${row.userId}:incentive`;
    if (!row.eligibleForIncentive) {
      return (
        <Text size="xs" c="dimmed">
          No incentive component
        </Text>
      );
    }
    if (row.incentiveApproval.approved) {
      return (
        <Stack gap={4}>
          <Badge color="blue" variant="light">
            Incentive approved
          </Badge>
          {row.incentiveApproval.approvedByName && (
            <Text size="xs" c="dimmed">
              by {row.incentiveApproval.approvedByName}
            </Text>
          )}
        </Stack>
      );
    }
    return (
      <Stack gap={4}>
        <Button
          size="xs"
          variant="light"
          onClick={() => handleApprovalClick(row, 'incentive')}
          disabled={!row.canApproveIncentive || pendingActions.has(actionKey)}
          loading={pendingActions.has(actionKey)}
        >
          Approve for Incentives
        </Button>
        {!row.canApproveIncentive && (
          <Text size="xs" c="dimmed">
            Complete review payment approval first
          </Text>
        )}
      </Stack>
    );
  };

  return (
    <Card withBorder padding="md" radius="md" pos="relative">
      <LoadingOverlay visible={loading} zIndex={5} />
      <Stack gap="md">
        <Group justify="space-between" align="flex-start">
          <Stack gap={2}>
            <Text fw={600}>Monthly Review Approvals</Text>
            <Text size="sm" c="dimmed">
              Combine review counters across platforms to approve payroll and incentive payouts.
            </Text>
          </Stack>
          <Tooltip label="Refresh summary">
            <ActionIcon variant="light" onClick={handleRefresh}>
              <IconRefresh size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
        <Stack gap={4}>
          <Text size="sm" fw={500}>
            Date range
          </Text>
          <Group gap="xs">
            <Button size="xs" variant={preset === 'thisMonth' ? 'filled' : 'light'} onClick={() => handlePresetChange('thisMonth')}>
              This Month
            </Button>
            <Button size="xs" variant={preset === 'lastMonth' ? 'filled' : 'light'} onClick={() => handlePresetChange('lastMonth')}>
              Last Month
            </Button>
            <Button size="xs" variant={preset === 'custom' ? 'filled' : 'light'} onClick={() => handlePresetChange('custom')}>
              Custom
            </Button>
          </Group>
          {preset === 'custom' ? (
            <DatePickerInput
              type="range"
              value={range}
              onChange={handleCustomRangeChange}
              allowSingleDateInRange={false}
              valueFormat="MMM D, YYYY"
              maxDate={dayjs().endOf('day').toDate()}
            />
          ) : (
            <Text size="sm" c="dimmed">
              {formatDisplayRange(range)}
            </Text>
          )}
        </Stack>
        {error && (
          <Alert color="red" title="Approvals">
            {error}
          </Alert>
        )}
        {summary && summary.staff.length > 0 ? (
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Staff</Table.Th>
                <Table.Th>Total Reviews</Table.Th>
                <Table.Th>Platforms</Table.Th>
                <Table.Th>Review Payment</Table.Th>
                <Table.Th>Incentives</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {summary.staff.map((row) => (
                <Table.Tr key={row.userId}>
                  <Table.Td>
                    <Stack gap={2}>
                      <Text fw={600}>{row.displayName}</Text>
                      {row.needsMinimum ? (
                        <Badge color="red" variant="light">
                          Needs {summary.minimumReviews} reviews
                        </Badge>
                      ) : (
                        <Badge color="teal" variant="light">
                          Meets minimum
                        </Badge>
                      )}
                      {row.pendingPlatformApprovals && (
                        <Text size="xs" c="dimmed">
                          Awaiting platform approvals
                        </Text>
                      )}
                    </Stack>
                  </Table.Td>
                  <Table.Td>
                    <Stack gap={4}>
                      <Text fw={600}>{row.totalReviews.toFixed(2)}</Text>
                      <Text size="xs" c="dimmed">
                        Rounded credit: {row.totalRoundedReviews.toFixed(0)}
                      </Text>
                    </Stack>
                  </Table.Td>
                  <Table.Td>{renderPlatformBadges(row)}</Table.Td>
                  <Table.Td>{renderPaymentCell(row)}</Table.Td>
                  <Table.Td>{renderIncentiveCell(row)}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        ) : (
          emptyState
        )}
      </Stack>
    </Card>
  );
};

export default ReviewMonthlySummary;
