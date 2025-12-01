import { useCallback, useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Center,
  Collapse,
  Group,
  Loader,
  Modal,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Textarea,
  Tooltip,
} from '@mantine/core';
import { IconPlus, IconRefresh, IconPencil, IconTrash, IconChevronDown, IconChevronUp } from '@tabler/icons-react';
import {
  fetchReviewCounters,
  createReviewCounter,
  updateReviewCounter,
  deleteReviewCounter,
} from '../../actions/reviewCounterActions';
import type { ReviewCounter, ReviewCounterEntry, ReviewCounterPayload } from '../../types/reviewCounters/ReviewCounter';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import ReviewCounterEntriesPanel from './ReviewCounterEntriesPanel';
import axiosInstance from '../../utils/axiosInstance';
import type { ServerResponse } from '../../types/general/ServerResponse';
import type { ReviewPlatform as ReviewPlatformDto } from '../../types/reviewPlatforms/ReviewPlatform';

const CURRENT_MONTH_START = dayjs().startOf('month').format('YYYY-MM-DD');
const summarizeEntries = (entries?: ReviewCounterEntry[]) => {
  return (entries ?? []).reduce(
    (acc, entry) => {
      const amount = Number(entry.rawCount) || 0;
      acc.total += amount;
      if (entry.category === 'bad') {
        acc.bad += amount;
      } else if (entry.category === 'no_name') {
        acc.noName += amount;
      }
      return acc;
    },
    { total: 0, bad: 0, noName: 0 },
  );
};

type CounterFormState = {
  platform: string;
  periodStart: string;
  periodEnd: string | null;
  firstReviewAuthor: string;
  secondReviewAuthor: string;
  beforeLastReviewAuthor: string;
  lastReviewAuthor: string;
  notes: string;
};

const initialFormState: CounterFormState = {
  platform: '',
  periodStart: CURRENT_MONTH_START,
  periodEnd: null,
  firstReviewAuthor: '',
  secondReviewAuthor: '',
  beforeLastReviewAuthor: '',
  lastReviewAuthor: '',
  notes: '',
};

const buildFormStateFromCounter = (counter: ReviewCounter): CounterFormState => ({
  platform: counter.platform,
  periodStart: counter.periodStart ?? CURRENT_MONTH_START,
  periodEnd: counter.periodEnd,
  firstReviewAuthor: counter.firstReviewAuthor ?? '',
  secondReviewAuthor: counter.secondReviewAuthor ?? '',
  beforeLastReviewAuthor: counter.beforeLastReviewAuthor ?? '',
  lastReviewAuthor: counter.lastReviewAuthor ?? '',
  notes: counter.notes ?? '',
});

const ReviewCounterList = () => {
  const dispatch = useAppDispatch();
  const reviewCounterState = useAppSelector((state) => state.reviewCounters)[0];
  const [platformOptions, setPlatformOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [platformLabelMap, setPlatformLabelMap] = useState<Map<string, string>>(new Map());
  const [expandedCounters, setExpandedCounters] = useState<Set<number>>(new Set());
  const [formState, setFormState] = useState<CounterFormState>(initialFormState);
  const [formError, setFormError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [editingCounter, setEditingCounter] = useState<ReviewCounter | null>(null);

  useEffect(() => {
    dispatch(fetchReviewCounters());
  }, [dispatch]);

  useEffect(() => {
    const loadPlatforms = async () => {
      try {
        const response = await axiosInstance.get<ServerResponse<ReviewPlatformDto>>('/reviewPlatforms', {
          withCredentials: true,
        });
        const records = response.data[0]?.data ?? [];
        setPlatformOptions(
          records
            .filter((platform) => platform.isActive !== false)
            .map((platform) => ({ value: platform.slug, label: platform.name ?? platform.slug })),
        );
        setPlatformLabelMap(new Map(records.map((platform) => [platform.slug, platform.name ?? platform.slug])));
      } catch (error) {
        console.error('Failed to load review platforms', error);
      }
    };
    loadPlatforms().catch((error) => console.error('Failed to load review platforms', error));
  }, []);

  const counters = useMemo<ReviewCounter[]>(() => {
    const serverData = (reviewCounterState.data as ServerResponse<ReviewCounter>)[0]?.data;
    return serverData ? [...serverData] : [];
  }, [reviewCounterState.data]);

  const countersByMonth = useMemo(() => {
    const groups = new Map<
      string,
      { label: string; monthStart: string; counters: ReviewCounter[] }
    >();
    counters.forEach((counter) => {
      const monthStart = dayjs(counter.periodStart ?? CURRENT_MONTH_START).startOf('month');
      const key = monthStart.format('YYYY-MM');
      const label = monthStart.format('MMMM YYYY');
      const bucket =
        groups.get(key) ??
        (() => {
          const next = { label, monthStart: monthStart.format('YYYY-MM-DD'), counters: [] as ReviewCounter[] };
          groups.set(key, next);
          return next;
        })();
      bucket.counters.push(counter);
    });
    return Array.from(groups.values()).sort((a, b) => dayjs(b.monthStart).valueOf() - dayjs(a.monthStart).valueOf());
  }, [counters]);

  const refreshCounters = useCallback(async () => {
    await dispatch(fetchReviewCounters());
  }, [dispatch]);

  const closeForm = () => {
    setFormOpen(false);
    setEditingCounter(null);
    setFormError(null);
    setFormState(initialFormState);
  };

  const openCreateForm = () => {
    setEditingCounter(null);
    setFormState(initialFormState);
    setFormOpen(true);
  };

  const openEditForm = (counter: ReviewCounter) => {
    setEditingCounter(counter);
    setFormState(buildFormStateFromCounter(counter));
    setFormOpen(true);
  };

  const handleDelete = async (counterId: number) => {
    if (!window.confirm('Delete this review counter?')) {
      return;
    }
    try {
      await dispatch(deleteReviewCounter(counterId)).unwrap();
      await refreshCounters();
      setExpandedCounters((prev) => {
        if (!prev.has(counterId)) {
          return prev;
        }
        const next = new Set(prev);
        next.delete(counterId);
        return next;
      });
    } catch (error) {
      console.error('Failed to delete review counter', error);
    }
  };

  const toggleExpanded = (counterId: number) => {
    setExpandedCounters((prev) => {
      const next = new Set(prev);
      if (next.has(counterId)) {
        next.delete(counterId);
      } else {
        next.add(counterId);
      }
      return next;
    });
  };

  const handleFormSubmit = async () => {
    if (!formState.platform.trim()) {
      setFormError('Platform is required');
      return;
    }
    if (!formState.periodStart) {
      setFormError('Period start is required');
      return;
    }

    setSubmitting(true);
    setFormError(null);

    const payloadSource: ReviewCounterPayload = {
      platform: formState.platform.trim(),
      periodStart: formState.periodStart,
      periodEnd: formState.periodEnd,
      firstReviewAuthor: formState.firstReviewAuthor.trim() || null,
      secondReviewAuthor: formState.secondReviewAuthor.trim() || null,
      beforeLastReviewAuthor: formState.beforeLastReviewAuthor.trim() || null,
      lastReviewAuthor: formState.lastReviewAuthor.trim() || null,
      notes: formState.notes.trim() || null,
    };

    try {
      if (editingCounter) {
        await dispatch(updateReviewCounter({ counterId: editingCounter.id, payload: payloadSource })).unwrap();
      } else {
        await dispatch(createReviewCounter(payloadSource)).unwrap();
      }
      await refreshCounters();
      closeForm();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save counter';
      setFormError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const platformSelectData = useMemo(() => {
    if (!formState.platform) {
      return platformOptions;
    }
    if (platformOptions.some((option) => option.value === formState.platform)) {
      return platformOptions;
    }
    return [
      ...platformOptions,
      {
        value: formState.platform,
        label: platformLabelMap.get(formState.platform) ?? formState.platform,
      },
    ];
  }, [platformOptions, formState.platform, platformLabelMap]);

  if (reviewCounterState.loading && counters.length === 0) {
    return (
      <Center style={{ minHeight: 320 }}>
        <Loader size="lg" />
      </Center>
    );
  }

  if (reviewCounterState.error) {
    return (
      <Alert color="red" title="Failed to load reviews">
        {reviewCounterState.error}
      </Alert>
    );
  }

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="center">
        <div>
          <Text size="sm" c="dimmed">
            Manage counters per platform and expand rows to log staff credits.
          </Text>
        </div>
        <Group gap="xs">
          <Tooltip label="Refresh data">
            <ActionIcon variant="light" onClick={() => refreshCounters()}>
              <IconRefresh size={16} />
            </ActionIcon>
          </Tooltip>
          <Button leftSection={<IconPlus size={16} />} onClick={openCreateForm}>
            Add Counter
          </Button>
        </Group>
      </Group>

      {counters.length === 0 ? (
        <Card withBorder radius="md" p="xl">
          <Stack gap="xs" align="center">
            <Text size="sm" c="dimmed">
              No review counters recorded yet. Create your first entry to get started.
            </Text>
            <Button onClick={openCreateForm} leftSection={<IconPlus size={16} />}>
              Create Counter
            </Button>
          </Stack>
        </Card>
      ) : (
        <Stack gap="xl">
          {countersByMonth.map((group) => (
            <Stack key={group.monthStart} gap="sm">
              <Group justify="space-between" align="center">
                <Text fw={600}>{group.label}</Text>
                <Badge color="gray" variant="light">
                  {group.counters.length} platform{group.counters.length === 1 ? '' : 's'}
                </Badge>
              </Group>
              <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
                {group.counters.map((counter) => {
                  const periodLabel = counter.periodEnd
                    ? `${counter.periodStart ?? '?'} – ${counter.periodEnd}`
                    : counter.periodStart ?? '-';
                  const platformLabel = platformLabelMap.get(counter.platform ?? '') ?? counter.platform ?? 'Unknown';
                  const isExpanded = expandedCounters.has(counter.id);
                  const entryTotals = summarizeEntries(counter.entries);
                  return (
                    <Card key={counter.id} withBorder radius="md" padding="md">
                      <Stack gap="sm">
                        <Group justify="space-between" align="flex-start">
                          <div>
                            <Group gap="xs">
                              <Text fw={600}>{platformLabel}</Text>
                              <Badge color="blue" variant="light">
                                Period {periodLabel}
                              </Badge>
                            </Group>
                            <Group gap="xs" mt={4}>
                              <Badge color="teal" variant="light">
                                {entryTotals.total.toFixed(2)} reviews
                              </Badge>
                              <Badge color="yellow" variant="light">
                                Bad: {entryTotals.bad.toFixed(2)}
                              </Badge>
                              <Badge color="gray" variant="light">
                                No name: {entryTotals.noName.toFixed(2)}
                              </Badge>
                            </Group>
                            {counter.notes && (
                              <Text size="sm" mt={6}>
                                {counter.notes}
                              </Text>
                            )}
                          </div>
                          <Group gap="xs">
                            <Tooltip label="Manage entries">
                              <ActionIcon variant="light" onClick={() => toggleExpanded(counter.id)}>
                                {isExpanded ? <IconChevronUp size={16} /> : <IconChevronDown size={16} />}
                              </ActionIcon>
                            </Tooltip>
                            <Tooltip label="Edit counter">
                              <ActionIcon variant="light" onClick={() => openEditForm(counter)}>
                                <IconPencil size={16} />
                              </ActionIcon>
                            </Tooltip>
                            <Tooltip label="Delete counter">
                              <ActionIcon color="red" variant="light" onClick={() => handleDelete(counter.id)}>
                                <IconTrash size={16} />
                              </ActionIcon>
                            </Tooltip>
                          </Group>
                        </Group>

                        <Collapse in={isExpanded} transitionDuration={150}>
                          <ReviewCounterEntriesPanel counter={counter} onRefresh={refreshCounters} />
                        </Collapse>
                      </Stack>
                    </Card>
                  );
                })}
              </SimpleGrid>
            </Stack>
          ))}
        </Stack>
      )}

      <Modal
        opened={formOpen}
        onClose={closeForm}
        title={editingCounter ? 'Edit Review Counter' : 'New Review Counter'}
        centered
        size="lg"
        radius="md"
      >
        <Stack gap="md">
          <Select
            label="Platform"
            placeholder="Select platform"
            searchable
            data={platformSelectData}
            required
            value={formState.platform || null}
            onChange={(value) => setFormState((prev) => ({ ...prev, platform: value ?? '' }))}
            nothingFoundMessage="Configure platforms under Settings › Review Platforms"
          />
          <Group grow>
            <TextInput
              label="Period Start"
              type="date"
              required
              value={formState.periodStart}
              onChange={(event) => setFormState((prev) => ({ ...prev, periodStart: event.currentTarget.value }))}
            />
            <TextInput
              label="Period End"
              type="date"
              value={formState.periodEnd ?? ''}
              onChange={(event) =>
                setFormState((prev) => ({ ...prev, periodEnd: event.currentTarget.value || null }))
              }
            />
          </Group>
          <Group grow>
            <TextInput
              label="First Review"
              value={formState.firstReviewAuthor}
              onChange={(event) => setFormState((prev) => ({ ...prev, firstReviewAuthor: event.currentTarget.value }))}
            />
            <TextInput
              label="Second Review"
              value={formState.secondReviewAuthor}
              onChange={(event) => setFormState((prev) => ({ ...prev, secondReviewAuthor: event.currentTarget.value }))}
            />
          </Group>
          <Group grow>
            <TextInput
              label="Before Last Review"
              value={formState.beforeLastReviewAuthor}
              onChange={(event) =>
                setFormState((prev) => ({ ...prev, beforeLastReviewAuthor: event.currentTarget.value }))
              }
            />
            <TextInput
              label="Last Review"
              value={formState.lastReviewAuthor}
              onChange={(event) => setFormState((prev) => ({ ...prev, lastReviewAuthor: event.currentTarget.value }))}
            />
          </Group>
          <Textarea
            label="Notes"
            minRows={3}
            value={formState.notes}
            onChange={(event) => setFormState((prev) => ({ ...prev, notes: event.currentTarget.value }))}
          />
          {formError && (
            <Alert color="red" title="Unable to save">
              {formError}
            </Alert>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={closeForm} disabled={submitting}>
              Cancel
            </Button>
            <Button loading={submitting} onClick={handleFormSubmit}>
              {editingCounter ? 'Save Changes' : 'Create Counter'}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
};

export default ReviewCounterList;




