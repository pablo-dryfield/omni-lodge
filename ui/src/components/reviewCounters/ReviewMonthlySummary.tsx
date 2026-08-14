import { useCallback, useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Collapse,
  Divider,
  Group,
  LoadingOverlay,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { IconChevronDown, IconChevronRight, IconInfoCircle, IconRefresh } from '@tabler/icons-react';
import type { ReviewCounterStaffSummary, ReviewCounterStaffRow } from '../../types/reviewCounters/ReviewCounterStaffSummary';
import { fetchReviewStaffSummary, updateReviewMonthlyApproval } from '../../api/reviewCounters';
import { useAppSelector } from '../../store/hooks';
import { reviewMonthInWarsaw } from '../../utils/reviewCreditMonth';

type Preset = 'thisMonth' | 'lastMonth' | 'custom';

const getPresetRange = (preset: Exclude<Preset, 'custom'>): [Date, Date] => {
  const currentWarsawMonth = dayjs(`${reviewMonthInWarsaw(new Date())}-01`);
  const selectedMonth = preset === 'thisMonth' ? currentWarsawMonth : currentWarsawMonth.subtract(1, 'month');
  return [selectedMonth.startOf('month').toDate(), selectedMonth.endOf('month').toDate()];
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

const ReviewMonthlySummary = ({
  month,
  hideDateControls = false,
  collapsible = false,
}: {
  month?: string;
  hideDateControls?: boolean;
  collapsible?: boolean;
}) => {
  const roleSlug = useAppSelector((state) => state.session.roleSlug);
  const canManage = ['owner', 'manager', 'admin', 'administrator'].includes(String(roleSlug ?? '').trim().toLowerCase());
  const initialRange = month ? [dayjs(`${month}-01`).startOf('month').toDate(), dayjs(`${month}-01`).endOf('month').toDate()] as [Date, Date] : getPresetRange('thisMonth');
  const [preset, setPreset] = useState<Preset>(month ? 'custom' : 'thisMonth');
  const [range, setRange] = useState<[Date | null, Date | null]>(initialRange);
  const [summary, setSummary] = useState<ReviewCounterStaffSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingActions, setPendingActions] = useState<Set<string>>(new Set());
  const [opened, setOpened] = useState(!collapsible);

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
    if (collapsible && !opened) {
      return;
    }
    loadSummary(range).catch(() => {});
  }, [collapsible, loadSummary, opened, range]);

  useEffect(() => {
    if (!month) return;
    const selected = dayjs(`${month}-01`);
    setPreset('custom');
    setRange([selected.startOf('month').toDate(), selected.endOf('month').toDate()]);
  }, [month]);

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

  const handleApprovalClick = async (
    row: ReviewCounterStaffRow,
    type: 'payment' | 'incentive',
    options?: { componentId?: number; actionKey?: string },
  ) => {
    if (!summary) {
      return;
    }
    const key = options?.actionKey ?? `${row.userId}:${type}`;
    setActionState(key, true);
    setError(null);
    try {
      const payload: {
        periodStart: string;
        paymentApproved?: boolean;
        incentiveApproved?: boolean;
        componentId?: number;
      } =
        type === 'payment'
          ? { periodStart: summary.periodStart, paymentApproved: true }
          : { periodStart: summary.periodStart, incentiveApproved: true };
      if (options?.componentId != null) {
        payload.componentId = options.componentId;
      }
      const updated = await updateReviewMonthlyApproval(row.userId, payload);
      setSummary(updated);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setActionState(key, false);
    }
  };

  const handleComponentApprovalClick = (
    row: ReviewCounterStaffRow,
    component: ReviewCounterStaffRow['reviewComponents'][number],
  ) => {
    handleApprovalClick(row, 'incentive', {
      componentId: component.componentId,
      actionKey: `${row.userId}:component:${component.componentId}`,
    });
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
    <Stack gap="xs" align="center" w="100%">
      {row.platforms.map((platform) => (
        <Stack key={`${row.userId}-${platform.counterId}`} gap={4} align="center">
          <Text size="sm" fw={500} ta="center">
            {platform.platform}
          </Text>
          <Stack gap={0} align="center">
            <Badge color="teal" variant="light">
              {platform.rawCount.toFixed(2)} reviews
            </Badge>
            <Text size="xs" c="dimmed" ta="center">
              Rounded: {platform.roundedCount.toFixed(0)}
            </Text>
          </Stack>
        </Stack>
      ))}
    </Stack>
  );

  const renderPaymentCell = (row: ReviewCounterStaffRow) => {
    const minimumReviews = summary?.minimumReviews ?? 15;
    const actionKey = `${row.userId}:payment`;
    if (row.paymentApproval.approved) {
      return (
        <Stack gap={4} align="center">
          <Badge color="teal" variant="light">
            Approved
          </Badge>
          {row.paymentApproval.approvedByName && (
            <Text size="xs" c="dimmed" ta="center">
              by {row.paymentApproval.approvedByName}
            </Text>
          )}
        </Stack>
      );
    }
    if (row.totalReviews >= minimumReviews) {
      return (
        <Stack gap={4} align="center">
          <Badge color="teal" variant="light">
            Hit review target
          </Badge>
          <Text size="xs" c="dimmed" ta="center">
            Reviews will be paid automatically.
          </Text>
        </Stack>
      );
    }
    if (!canManage) return <Text size="xs" c="dimmed" ta="center">Awaiting manager approval</Text>;
    return (
      <Stack gap={4} align="center" w="100%">
        <Button
          size="xs"
          w="100%"
          maw={300}
          onClick={() => handleApprovalClick(row, 'payment')}
          disabled={pendingActions.has(actionKey)}
          loading={pendingActions.has(actionKey)}
        >
          Approve for Review Payment
        </Button>
        <Text size="xs" c="dimmed" ta="center">
          Marks all platforms under 15 as approved.
        </Text>
      </Stack>
    );
  };

  const renderCompensationComponentsCell = (row: ReviewCounterStaffRow) => {
    if (row.reviewComponents.length === 0) {
      return (
        <Text size="xs" c="dimmed" ta="center">
          No review-based compensation components
        </Text>
      );
    }
    if (row.incentiveApproval.approved) {
      return (
        <Stack gap={4} align="center">
          <Badge color="blue" variant="light">
            Compensation approved
          </Badge>
          {row.incentiveApproval.approvedByName && (
            <Text size="xs" c="dimmed" ta="center">
              by {row.incentiveApproval.approvedByName}
            </Text>
          )}
          <Stack gap={2} align="center">
            {row.reviewComponents.map((component) => (
              <Text key={`${row.userId}-${component.componentId}`} size="xs" c="dimmed" ta="center">
                {component.name}
              </Text>
            ))}
          </Stack>
        </Stack>
      );
    }
    if (!canManage) return <Text size="xs" c="dimmed" ta="center">Awaiting manager approval</Text>;
    return (
      <Stack gap="xs" align="center" w="100%">
        {row.reviewComponents.map((component) => {
          const actionKey = `${row.userId}:component:${component.componentId}`;
          const isPending = pendingActions.has(actionKey);
          return (
            <Button
              key={`${row.userId}-${component.componentId}`}
              size="xs"
              variant="light"
              w="100%"
              maw={300}
              onClick={() => handleComponentApprovalClick(row, component)}
              disabled={isPending}
              loading={isPending}
            >
              Approve for {component.name} Payment
            </Button>
          );
        })}
      </Stack>
    );
  };

  return (
    <Card withBorder p={{ base: 'sm', sm: 'md' }} radius="md" pos="relative">
      <LoadingOverlay visible={loading} zIndex={5} />
      <Stack gap="md">
        <Group justify="center" gap="xs" wrap="wrap">
          {collapsible ? (
            <UnstyledButton
              onClick={() => setOpened((current) => !current)}
              aria-expanded={opened}
              aria-controls="monthly-review-approvals-content"
            >
              <Group gap="xs" wrap="nowrap">
                {opened ? <IconChevronDown size={18} /> : <IconChevronRight size={18} />}
                <Text fw={600} ta="center">Monthly Review Approvals</Text>
              </Group>
            </UnstyledButton>
          ) : (
            <Text fw={600} ta="center">Monthly Review Approvals</Text>
          )}
          <Tooltip label="Refresh summary">
            <ActionIcon variant="light" onClick={handleRefresh} aria-label="Refresh monthly review approvals">
              <IconRefresh size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
        <Collapse in={opened} id="monthly-review-approvals-content">
          <Stack gap="md">
          {!hideDateControls && (
          <Stack gap="xs" align="center">
            <Text size="sm" fw={500} ta="center">
              Date range
            </Text>
            <Group gap="xs" justify="center" wrap="wrap">
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
                w="100%"
                maw={420}
                styles={{ input: { textAlign: 'center' } }}
              />
            ) : (
              <Text size="sm" c="dimmed" ta="center">
                {formatDisplayRange(range)}
              </Text>
            )}
          </Stack>
        )}
        {error && (
          <Alert color="red" title="Approvals">
            {error}
          </Alert>
        )}
        {summary && summary.staff.length > 0 ? (
          <>
            <Box visibleFrom="sm">
              <Table.ScrollContainer minWidth={900}>
                <Table striped highlightOnHover verticalSpacing="sm">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th ta="center">Staff</Table.Th>
                      <Table.Th ta="center">Total Reviews</Table.Th>
                      <Table.Th ta="center">Platforms</Table.Th>
                      <Table.Th ta="center">Review Payment</Table.Th>
                      <Table.Th ta="center">Compensation Components</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {summary.staff.map((row) => (
                      <Table.Tr key={row.userId}>
                        <Table.Td ta="center">
                          <Stack gap={4} align="center">
                            <Text fw={600} ta="center">{row.displayName}</Text>
                            {row.needsMinimum ? (
                              <Badge color="red" variant="light">
                                Needs {summary.minimumReviews} reviews
                              </Badge>
                            ) : (
                              <Badge color="teal" variant="light">
                                Meets minimum
                              </Badge>
                            )}
                          </Stack>
                        </Table.Td>
                        <Table.Td ta="center">
                          <Stack gap={4} align="center">
                            <Text fw={600}>{row.totalReviews.toFixed(2)}</Text>
                            <Text size="xs" c="dimmed" ta="center">
                              Rounded credit: {row.totalRoundedReviews.toFixed(0)}
                            </Text>
                          </Stack>
                        </Table.Td>
                        <Table.Td ta="center">{renderPlatformBadges(row)}</Table.Td>
                        <Table.Td ta="center">{renderPaymentCell(row)}</Table.Td>
                        <Table.Td ta="center">{renderCompensationComponentsCell(row)}</Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            </Box>
            <Stack hiddenFrom="sm" gap="sm">
              {summary.staff.map((row) => (
                <Card key={row.userId} withBorder radius="md" p="md">
                  <Stack align="center" gap="md">
                    <Stack align="center" gap={4}>
                      <Text fw={700} ta="center">{row.displayName}</Text>
                      {row.needsMinimum ? (
                        <Badge color="red" variant="light">
                          Needs {summary.minimumReviews} reviews
                        </Badge>
                      ) : (
                        <Badge color="teal" variant="light">
                          Meets minimum
                        </Badge>
                      )}
                    </Stack>
                    <SimpleGrid cols={2} spacing="sm" w="100%">
                      <Stack gap={2} align="center">
                        <Text size="xs" c="dimmed" ta="center">Total reviews</Text>
                        <Text fw={700}>{row.totalReviews.toFixed(2)}</Text>
                      </Stack>
                      <Stack gap={2} align="center">
                        <Text size="xs" c="dimmed" ta="center">Rounded credit</Text>
                        <Text fw={700}>{row.totalRoundedReviews.toFixed(0)}</Text>
                      </Stack>
                    </SimpleGrid>
                    <Divider w="100%" />
                    <Stack align="center" gap="xs" w="100%">
                      <Text fw={600} ta="center">Platforms</Text>
                      {renderPlatformBadges(row)}
                    </Stack>
                    <Divider w="100%" />
                    <Stack align="center" gap="xs" w="100%">
                      <Text fw={600} ta="center">Review payment</Text>
                      {renderPaymentCell(row)}
                    </Stack>
                    <Divider w="100%" />
                    <Stack align="center" gap="xs" w="100%">
                      <Text fw={600} ta="center">Compensation components</Text>
                      {renderCompensationComponentsCell(row)}
                    </Stack>
                  </Stack>
                </Card>
              ))}
            </Stack>
          </>
        ) : (
          emptyState
          )}
          </Stack>
        </Collapse>
      </Stack>
    </Card>
  );
};

export default ReviewMonthlySummary;
