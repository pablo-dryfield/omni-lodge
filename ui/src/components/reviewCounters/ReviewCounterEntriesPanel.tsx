import { useMemo, useState } from 'react';
import {
  ActionIcon,
  Badge,
  Button,
  Group,
  Modal,
  NumberInput,
  Select,
  Stack,
  Table as MantineTable,
  Text,
  TextInput,
  Textarea,
  Tooltip,
} from '@mantine/core';
import { IconPlus, IconRefresh, IconEdit, IconTrash } from '@tabler/icons-react';
import { useAppDispatch } from '../../store/hooks';
import {
  createReviewCounterEntry,
  updateReviewCounterEntry,
  deleteReviewCounterEntry,
} from '../../actions/reviewCounterActions';
import type { ReviewCounter, ReviewCounterEntry } from '../../types/reviewCounters/ReviewCounter';

export type SelectOption = {
  value: string;
  label: string;
};

type ReviewCounterEntriesPanelProps = {
  counter: ReviewCounter;
  onRefresh: () => Promise<void>;
  userOptions: SelectOption[];
};

type EntryFormState = {
  userId: string | null;
  displayName: string;
  category: ReviewCounterEntry['category'];
  rawCount: number;
  notes: string;
};

const defaultEntryState: EntryFormState = {
  userId: null,
  displayName: '',
  category: 'staff',
  rawCount: 0,
  notes: '',
};

const categoryOptions: SelectOption[] = [
  { value: 'staff', label: 'Staff' },
  { value: 'bad', label: 'Bad Review' },
  { value: 'no_name', label: 'No Name' },
  { value: 'other', label: 'Other' },
];

const categoryColor: Record<ReviewCounterEntry['category'], string> = {
  staff: 'blue',
  bad: 'red',
  no_name: 'gray',
  other: 'violet',
};

const ReviewCounterEntriesPanel = ({ counter, onRefresh, userOptions }: ReviewCounterEntriesPanelProps) => {
  const dispatch = useAppDispatch();
  const [modalOpen, setModalOpen] = useState(false);
  const [formState, setFormState] = useState<EntryFormState>(defaultEntryState);
  const [editingEntry, setEditingEntry] = useState<ReviewCounterEntry | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sortedEntries = useMemo(() => {
    return [...(counter.entries ?? [])].sort((a, b) => {
      if (a.category === b.category) {
        return a.displayName.localeCompare(b.displayName);
      }
      return a.category.localeCompare(b.category);
    });
  }, [counter.entries]);

  const totals = useMemo(() => {
    return counter.entries.reduce(
      (acc, entry) => {
        acc.raw += entry.rawCount;
        acc.rounded += entry.roundedCount;
        return acc;
      },
      { raw: 0, rounded: 0 },
    );
  }, [counter.entries]);

  const closeModal = () => {
    setModalOpen(false);
    setFormState(defaultEntryState);
    setEditingEntry(null);
    setError(null);
  };

  const openCreateModal = () => {
    setEditingEntry(null);
    setFormState(defaultEntryState);
    setModalOpen(true);
  };

  const openEditModal = (entry: ReviewCounterEntry) => {
    setEditingEntry(entry);
    setFormState({
      userId: entry.userId ? String(entry.userId) : null,
      displayName: entry.displayName,
      category: entry.category,
      rawCount: entry.rawCount,
      notes: entry.notes ?? '',
    });
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    if (!formState.displayName.trim()) {
      setError('Display name is required');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const payload = {
        userId: formState.userId ? Number(formState.userId) : undefined,
        displayName: formState.displayName.trim(),
        category: formState.category,
        rawCount: Number.isFinite(formState.rawCount) ? formState.rawCount : 0,
        notes: formState.notes.trim() ? formState.notes.trim() : undefined,
      };

      if (editingEntry) {
        await dispatch(
          updateReviewCounterEntry({ counterId: counter.id, entryId: editingEntry.id, payload }),
        ).unwrap();
      } else {
        await dispatch(createReviewCounterEntry({ counterId: counter.id, payload })).unwrap();
      }

      await onRefresh();
      closeModal();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save entry');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (entryId: number) => {
    if (!window.confirm('Delete this entry?')) {
      return;
    }
    try {
      await dispatch(deleteReviewCounterEntry({ counterId: counter.id, entryId })).unwrap();
      await onRefresh();
    } catch (err) {
      console.error('Failed to delete review counter entry', err);
    }
  };

  const handleUserChange = (value: string | null) => {
    setFormState((prev) => {
      const selected = userOptions.find((option) => option.value === value);
      return {
        ...prev,
        userId: value,
        displayName:
          !prev.displayName && selected
            ? selected.label.replace(/ \(#.+\)$/, '')
            : prev.displayName,
      };
    });
  };

  return (
    <Stack gap="sm" p="sm">
      <Group justify="space-between" align="center">
        <div>
          <Text fw={600}>{counter.platform} — Entries</Text>
          <Text size="xs" c="dimmed">
            Credits are rounded so that ? 0.50 goes down and ? 0.51 goes up.
          </Text>
        </div>
        <Group gap="xs">
          <Tooltip label="Refresh entries">
            <ActionIcon variant="light" onClick={onRefresh}>
              <IconRefresh size={16} />
            </ActionIcon>
          </Tooltip>
          <Button leftSection={<IconPlus size={16} />} onClick={openCreateModal}>
            Add Entry
          </Button>
        </Group>
      </Group>

      <Text size="sm" c="dimmed">
        Totals: {totals.raw.toFixed(2)} raw credits › {totals.rounded} rounded
      </Text>

      <MantineTable striped highlightOnHover withColumnBorders>
        <thead>
          <tr>
            <th>Display Name</th>
            <th>Category</th>
            <th>Raw Credit</th>
            <th>Rounded</th>
            <th>User</th>
            <th>Notes</th>
            <th style={{ textAlign: 'right' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {sortedEntries.length === 0 && (
            <tr>
              <td colSpan={7}>
                <Text size="sm" c="dimmed">
                  No entries recorded yet.
                </Text>
              </td>
            </tr>
          )}
          {sortedEntries.map((entry) => (
            <tr key={entry.id}>
              <td>{entry.displayName}</td>
              <td>
                <Badge color={categoryColor[entry.category]}>{entry.category}</Badge>
              </td>
              <td>{entry.rawCount.toFixed(2)}</td>
              <td>{entry.roundedCount}</td>
              <td>{entry.userName ?? '—'}</td>
              <td>{entry.notes ?? '—'}</td>
              <td>
                <Group justify="flex-end" gap="xs">
                  <ActionIcon variant="subtle" onClick={() => openEditModal(entry)}>
                    <IconEdit size={16} />
                  </ActionIcon>
                  <ActionIcon color="red" variant="subtle" onClick={() => handleDelete(entry.id)}>
                    <IconTrash size={16} />
                  </ActionIcon>
                </Group>
              </td>
            </tr>
          ))}
        </tbody>
      </MantineTable>

      <Modal opened={modalOpen} onClose={closeModal} title={editingEntry ? 'Edit Entry' : 'Add Entry'} centered>
        <Stack gap="sm">
          <Select
            label="Staff Member"
            placeholder="Optional — link to a user"
            data={userOptions}
            value={formState.userId}
            onChange={handleUserChange}
            clearable
          />
          <TextInput
            label="Display Name"
            value={formState.displayName}
            onChange={(event) => setFormState((prev) => ({ ...prev, displayName: event.currentTarget.value }))}
            required
          />
          <Select
            label="Category"
            data={categoryOptions}
            value={formState.category}
            onChange={(value) =>
              setFormState((prev) => ({ ...prev, category: (value as ReviewCounterEntry['category']) ?? 'staff' }))
            }
          />
          <NumberInput
            label="Raw Credit"
            value={formState.rawCount}
            onChange={(value) => setFormState((prev) => ({ ...prev, rawCount: Number(value) || 0 }))}
            min={0}
            step={0.25}
            precision={2}
          />
          <Textarea
            label="Notes"
            value={formState.notes}
            onChange={(event) => setFormState((prev) => ({ ...prev, notes: event.currentTarget.value }))}
            minRows={2}
          />
          {error && (
            <Text size="sm" c="red">
              {error}
            </Text>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={closeModal} disabled={submitting}>
              Cancel
            </Button>
            <Button loading={submitting} onClick={handleSubmit}>
              {editingEntry ? 'Save Changes' : 'Add Entry'}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
};

export default ReviewCounterEntriesPanel;
