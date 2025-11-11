import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActionIcon, Alert, Badge, Button, Card, Group, NumberInput, Stack, Text, Tooltip } from '@mantine/core';
import { IconMinus, IconPlus, IconRefresh } from '@tabler/icons-react';
import { useAppDispatch } from '../../store/hooks';
import { updateReviewCounterEntry } from '../../actions/reviewCounterActions';
import type { ReviewCounter, ReviewCounterEntry, ReviewCounterEntryPayload } from '../../types/reviewCounters/ReviewCounter';
import { useModuleAccess } from '../../hooks/useModuleAccess';

const AMOUNT_STEP = 1;
const MINIMUM_REVIEWS_FOR_PAYMENT = 15;
const CATEGORY_ORDER: Record<ReviewCounterEntry['category'], number> = {
  staff: 0,
  no_name: 1,
  bad: 2,
  other: 3,
};
const CATEGORY_LABEL: Record<ReviewCounterEntry['category'], string> = {
  staff: 'Staff',
  no_name: 'No Name',
  bad: 'Bad Review',
  other: 'Other',
};
const CATEGORY_COLOR: Record<ReviewCounterEntry['category'], string> = {
  staff: 'blue',
  no_name: 'gray',
  bad: 'red',
  other: 'violet',
};

type ReviewCounterEntriesPanelProps = {
  counter: ReviewCounter;
  onRefresh: () => Promise<void>;
};

const ReviewCounterEntriesPanel = ({ counter, onRefresh }: ReviewCounterEntriesPanelProps) => {
  const dispatch = useAppDispatch();
  const moduleAccess = useModuleAccess('review-counter-management');
  const canApproveUnderMinimum = moduleAccess.canUpdate;

  const [pendingValues, setPendingValues] = useState<Map<number, number>>(new Map());
  const [pendingApprovals, setPendingApprovals] = useState<Map<number, boolean>>(new Map());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const nextValues = new Map<number, number>();
    const nextApprovals = new Map<number, boolean>();
    (counter.entries ?? []).forEach((entry) => {
      nextValues.set(entry.id, Number(entry.rawCount) || 0);
      nextApprovals.set(entry.id, Boolean(entry.underMinimumApproved));
    });
    setPendingValues(nextValues);
    setPendingApprovals(nextApprovals);
  }, [counter.entries]);

  const originalValues = useMemo(() => {
    const map = new Map<number, number>();
    (counter.entries ?? []).forEach((entry) => {
      map.set(entry.id, Number(entry.rawCount) || 0);
    });
    return map;
  }, [counter.entries]);

  const originalApprovals = useMemo(() => {
    const map = new Map<number, boolean>();
    (counter.entries ?? []).forEach((entry) => {
      map.set(entry.id, Boolean(entry.underMinimumApproved));
    });
    return map;
  }, [counter.entries]);

  const hasChanges = useMemo(() => {
    if (pendingValues.size !== originalValues.size || pendingApprovals.size !== originalApprovals.size) {
      return true;
    }
    for (const [entryId, pending] of pendingValues.entries()) {
      const original = originalValues.get(entryId) ?? 0;
      if (Math.abs(original - pending) > 1e-6) {
        return true;
      }
      const originalApproval = originalApprovals.get(entryId) ?? false;
      const pendingApproval = pendingApprovals.get(entryId) ?? originalApproval;
      if (originalApproval !== pendingApproval) {
        return true;
      }
    }
    return false;
  }, [pendingApprovals, pendingValues, originalApprovals, originalValues]);

  const sortedEntries = useMemo(() => {
    return [...(counter.entries ?? [])].sort((a, b) => {
      const categoryDiff = (CATEGORY_ORDER[a.category] ?? 99) - (CATEGORY_ORDER[b.category] ?? 99);
      if (categoryDiff !== 0) {
        return categoryDiff;
      }
      return a.displayName.localeCompare(b.displayName);
    });
  }, [counter.entries]);

  const setLocalAmount = useCallback(
    (entry: ReviewCounterEntry, nextAmount: number) => {
      const safeAmount = Math.max(0, nextAmount);
      setPendingValues((prev) => {
        const next = new Map(prev);
        next.set(entry.id, safeAmount);
        return next;
      });
      setPendingApprovals((prev) => {
        const next = new Map(prev);
        const currentApproval = next.get(entry.id) ?? originalApprovals.get(entry.id) ?? false;
        next.set(entry.id, safeAmount >= MINIMUM_REVIEWS_FOR_PAYMENT ? false : currentApproval);
        return next;
      });
    },
    [originalApprovals],
  );

  const handleAdjustAmount = useCallback(
    (entry: ReviewCounterEntry, delta: number) => {
      const current = pendingValues.get(entry.id) ?? Number(entry.rawCount) ?? 0;
      setLocalAmount(entry, current + delta);
    },
    [pendingValues, setLocalAmount],
  );

  const handleAmountChange = useCallback(
    (entry: ReviewCounterEntry, value: number | string) => {
      const numericValue = typeof value === 'number' ? value : Number(value);
      if (Number.isNaN(numericValue)) {
        return;
      }
      setLocalAmount(entry, numericValue);
    },
    [setLocalAmount],
  );

  const handleApprovalToggle = useCallback(
    (entryId: number, approved: boolean) => {
      setPendingApprovals((prev) => {
        const next = new Map(prev);
        next.set(entryId, approved);
        return next;
      });
    },
    [],
  );

  const handleReset = useCallback(() => {
    const nextValues = new Map<number, number>();
    const nextApprovals = new Map<number, boolean>();
    (counter.entries ?? []).forEach((entry) => {
      nextValues.set(entry.id, Number(entry.rawCount) || 0);
      nextApprovals.set(entry.id, Boolean(entry.underMinimumApproved));
    });
    setPendingValues(nextValues);
    setPendingApprovals(nextApprovals);
    setError(null);
  }, [counter.entries]);

  const handleSave = useCallback(async () => {
    if (!hasChanges) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      for (const entry of counter.entries ?? []) {
        const pendingAmount = pendingValues.get(entry.id);
        const pendingApproval = pendingApprovals.get(entry.id);
        const originalAmount = Number(entry.rawCount) || 0;
        const originalApproval = Boolean(entry.underMinimumApproved);

        const nextAmount = pendingAmount ?? originalAmount;
        const nextApproval =
          nextAmount >= MINIMUM_REVIEWS_FOR_PAYMENT
            ? false
            : pendingApproval ?? originalApproval;

        const amountChanged = Math.abs(nextAmount - originalAmount) > 1e-6;
        const approvalChanged = nextApproval !== originalApproval;

        if (!amountChanged && !approvalChanged) {
          continue;
        }

        const payload: ReviewCounterEntryPayload = {
          displayName: entry.displayName,
          rawCount: nextAmount,
        };
        if (approvalChanged) {
          payload.underMinimumApproved = nextApproval;
        }

        await dispatch(
          updateReviewCounterEntry({
            counterId: counter.id,
            entryId: entry.id,
            payload,
          }),
        ).unwrap();
      }
      await onRefresh();
    } catch (saveError) {
      console.error('Failed to save entry changes', saveError);
      setError('Failed to save entry changes. Please try again.');
    } finally {
      setSaving(false);
    }
  }, [counter.entries, counter.id, dispatch, hasChanges, onRefresh, pendingApprovals, pendingValues]);

  return (
    <Stack gap="sm">
      <Group gap="xs" align="center">
        <Text fw={600}>{counter.platform} entries</Text>
        <Tooltip label="Refresh entries">
          <ActionIcon variant="subtle" onClick={onRefresh} disabled={saving}>
            <IconRefresh size={16} />
          </ActionIcon>
        </Tooltip>
        <Button size="xs" onClick={handleSave} disabled={!hasChanges || saving} loading={saving}>
          Save changes
        </Button>
        <Button size="xs" variant="default" onClick={handleReset} disabled={!hasChanges || saving}>
          Reset
        </Button>
      </Group>
      {error && (
        <Alert color="red" title="Entries">
          {error}
        </Alert>
      )}
      {sortedEntries.length === 0 ? (
        <Text size="sm" c="dimmed">
          No entries available.
        </Text>
      ) : (
        sortedEntries.map((entry) => {
          const amount = pendingValues.get(entry.id) ?? (Number(entry.rawCount) || 0);
          const pendingApproval = pendingApprovals.get(entry.id) ?? Boolean(entry.underMinimumApproved);
          const needsMinimum = amount < MINIMUM_REVIEWS_FOR_PAYMENT;
          const originalApproval = Boolean(entry.underMinimumApproved);
          const approvalChanged = pendingApproval !== originalApproval;
          const approverName = entry.underMinimumApprovedByName ?? null;
          return (
            <Card key={entry.id} withBorder radius="md" padding="sm">
              <Stack gap="xs">
                <Group justify="space-between" align="center">
                  <Stack gap={2}>
                    <Group gap="xs">
                      <Text fw={600}>{entry.displayName}</Text>
                      <Badge size="xs" color={CATEGORY_COLOR[entry.category] ?? 'gray'}>
                        {CATEGORY_LABEL[entry.category] ?? 'Entry'}
                      </Badge>
                    </Group>
                    {entry.userName && entry.category === 'staff' && (
                      <Text size="xs" c="dimmed">
                        Linked user: {entry.userName}
                      </Text>
                    )}
                  </Stack>
                  <Group gap="xs" align="center">
                    <Tooltip label="Decrease amount">
                      <ActionIcon
                        variant="light"
                        color="gray"
                        onClick={() => handleAdjustAmount(entry, -AMOUNT_STEP)}
                        disabled={saving}
                      >
                        <IconMinus size={16} />
                      </ActionIcon>
                    </Tooltip>
                    <NumberInput
                      value={amount}
                      onChange={(value) => handleAmountChange(entry, value)}
                      min={0}
                      step={AMOUNT_STEP}
                      style={{ width: 110 }}
                      disabled={saving}
                    />
                    <Tooltip label="Increase amount">
                      <ActionIcon
                        variant="light"
                        color="blue"
                        onClick={() => handleAdjustAmount(entry, AMOUNT_STEP)}
                        disabled={saving}
                      >
                        <IconPlus size={16} />
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                </Group>
                {needsMinimum && (
                  <Group gap="xs" align="center">
                    <Badge color={pendingApproval ? 'teal' : 'red'} variant="light">
                      {pendingApproval ? 'Approved under 15 reviews' : 'Needs 15 reviews or approval'}
                    </Badge>
                    {pendingApproval && !approvalChanged && (
                      <Text size="xs" c="dimmed">
                        {approverName ? `Approved by ${approverName}` : 'Awaiting approver details'}
                      </Text>
                    )}
                    {approvalChanged && (
                      <Badge size="xs" color="yellow" variant="light">
                        Save changes to update approval
                      </Badge>
                    )}
                    {canApproveUnderMinimum &&
                      (pendingApproval ? (
                        <Button
                          size="xs"
                          variant="outline"
                          color="red"
                          disabled={saving}
                          onClick={() => handleApprovalToggle(entry.id, false)}
                        >
                          Revoke approval
                        </Button>
                      ) : (
                        <Button
                          size="xs"
                          variant="outline"
                          color="green"
                          disabled={saving}
                          onClick={() => handleApprovalToggle(entry.id, true)}
                        >
                          Approve under 15
                        </Button>
                      ))}
                  </Group>
                )}
              </Stack>
            </Card>
          );
        })
      )}
    </Stack>
  );
};

export default ReviewCounterEntriesPanel;
