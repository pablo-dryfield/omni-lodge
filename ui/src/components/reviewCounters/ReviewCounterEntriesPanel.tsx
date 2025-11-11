import { useCallback, useMemo, useState } from 'react';
import { ActionIcon, Alert, Badge, Card, Group, Stack, Text, Tooltip } from '@mantine/core';
import { IconMinus, IconPlus, IconRefresh } from '@tabler/icons-react';
import { useAppDispatch } from '../../store/hooks';
import { updateReviewCounterEntry } from '../../actions/reviewCounterActions';
import type { ReviewCounter, ReviewCounterEntry } from '../../types/reviewCounters/ReviewCounter';

const AMOUNT_STEP = 0.25;
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
  const [updatingEntryId, setUpdatingEntryId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sortedEntries = useMemo(() => {
    return [...(counter.entries ?? [])].sort((a, b) => {
      const categoryDiff = (CATEGORY_ORDER[a.category] ?? 99) - (CATEGORY_ORDER[b.category] ?? 99);
      if (categoryDiff !== 0) {
        return categoryDiff;
      }
      return a.displayName.localeCompare(b.displayName);
    });
  }, [counter.entries]);

  const handleAdjustAmount = useCallback(
    async (entry: ReviewCounterEntry, delta: number) => {
      const currentAmount = Number(entry.rawCount) || 0;
      const nextAmount = Math.max(0, currentAmount + delta);
      if (nextAmount === currentAmount) {
        return;
      }

      setUpdatingEntryId(entry.id);
      setError(null);
      try {
        await dispatch(
          updateReviewCounterEntry({
            counterId: counter.id,
            entryId: entry.id,
            payload: { rawCount: nextAmount },
          }),
        ).unwrap();
        await onRefresh();
      } catch (updateError) {
        console.error('Failed to update review counter entry', updateError);
        setError('Failed to update entry amount. Please try again.');
      } finally {
        setUpdatingEntryId(null);
      }
    },
    [counter.id, dispatch, onRefresh],
  );

  return (
    <Stack gap="sm">
      <Group gap="xs" align="center">
        <Text fw={600}>{counter.platform} entries</Text>
        <Tooltip label="Refresh entries">
          <ActionIcon variant="subtle" onClick={onRefresh} disabled={updatingEntryId !== null}>
            <IconRefresh size={16} />
          </ActionIcon>
        </Tooltip>
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
        sortedEntries.map((entry) => (
          <Card key={entry.id} withBorder radius="md" padding="sm">
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
                    disabled={updatingEntryId === entry.id || entry.rawCount <= 0}
                  >
                    <IconMinus size={16} />
                  </ActionIcon>
                </Tooltip>
                <Text fw={600}>{entry.rawCount.toFixed(2)}</Text>
                <Tooltip label="Increase amount">
                  <ActionIcon
                    variant="light"
                    color="blue"
                    onClick={() => handleAdjustAmount(entry, AMOUNT_STEP)}
                    disabled={updatingEntryId === entry.id}
                  >
                    <IconPlus size={16} />
                  </ActionIcon>
                </Tooltip>
              </Group>
            </Group>
          </Card>
        ))
      )}
    </Stack>
  );
};

export default ReviewCounterEntriesPanel;
