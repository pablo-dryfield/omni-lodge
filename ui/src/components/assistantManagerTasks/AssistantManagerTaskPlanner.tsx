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
  Modal,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { IconCheck, IconCircle, IconCircleX, IconLoader2, IconAdjustments, IconNotes, IconCalendar, IconRefresh, IconPencil } from '@tabler/icons-react';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { useModuleAccess } from '../../hooks/useModuleAccess';
import {
  fetchAmTaskTemplates,
  fetchAmTaskLogs,
  createAmTaskTemplate,
  updateAmTaskTemplate,
  createAmTaskAssignment,
  updateAmTaskAssignment,
  deleteAmTaskAssignment,
  updateAmTaskLogStatus,
} from '../../actions/assistantManagerTaskActions';
import type {
  AssistantManagerTaskTemplate,
  AssistantManagerTaskAssignment,
  AssistantManagerTaskLog,
  AssistantManagerTaskCadence,
} from '../../types/assistantManagerTasks/AssistantManagerTask';

type TemplateFormState = {
  name: string;
  description: string;
  cadence: AssistantManagerTaskCadence;
  scheduleConfigText: string;
};

const defaultTemplateFormState: TemplateFormState = {
  name: '',
  description: '',
  cadence: 'daily',
  scheduleConfigText: '{}',
};

type AssignmentFormState = {
  targetScope: 'staff_type' | 'user';
  staffType: string;
  userId: string;
  effectiveStart: string;
  effectiveEnd: string;
};

const defaultAssignmentFormState: AssignmentFormState = {
  targetScope: 'staff_type',
  staffType: 'assistant_manager',
  userId: '',
  effectiveStart: '',
  effectiveEnd: '',
};

const TASK_STATUS_OPTIONS = [
  { value: 'pending', label: 'Pending' },
  { value: 'completed', label: 'Completed' },
  { value: 'missed', label: 'Missed' },
  { value: 'waived', label: 'Waived' },
];

const CADENCE_LABELS: Record<AssistantManagerTaskCadence, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  biweekly: 'Biweekly',
  every_two_weeks: 'Every 2 Weeks',
  monthly: 'Monthly',
};

const AssistantManagerTaskPlanner = () => {
  const dispatch = useAppDispatch();
  const templateState = useAppSelector((state) => state.assistantManagerTasks.templates)[0];
  const logState = useAppSelector((state) => state.assistantManagerTasks.logs)[0];
  const templates = useMemo(() => ((templateState.data as any)[0]?.data ?? []) as AssistantManagerTaskTemplate[], [templateState.data]);
  const logs = useMemo(() => ((logState.data as any)[0]?.data ?? []) as AssistantManagerTaskLog[], [logState.data]);

  const access = useModuleAccess('am-task-management');
  const canManage = access.canCreate || access.canUpdate;

  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [templateFormState, setTemplateFormState] = useState<TemplateFormState>(defaultTemplateFormState);
  const [templateFormError, setTemplateFormError] = useState<string | null>(null);
  const [editingTemplate, setEditingTemplate] = useState<AssistantManagerTaskTemplate | null>(null);
  const [templateSubmitting, setTemplateSubmitting] = useState(false);

  const [assignmentModalOpen, setAssignmentModalOpen] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null);
  const [assignmentFormState, setAssignmentFormState] = useState<AssignmentFormState>(defaultAssignmentFormState);
  const [assignmentSubmitting, setAssignmentSubmitting] = useState(false);
  const [editingAssignment, setEditingAssignment] = useState<AssistantManagerTaskAssignment | null>(null);

  const [logDateRange, setLogDateRange] = useState<[Date | null, Date | null]>([new Date(), dayjs().add(6, 'day').toDate()]);
  const [logScope, setLogScope] = useState<'self' | 'all'>('all');
  const [logFilterStatus, setLogFilterStatus] = useState<string | null>(null);

  useEffect(() => {
    dispatch(fetchAmTaskTemplates());
  }, [dispatch]);

  const refreshLogs = useCallback(async () => {
    const [start, end] = logDateRange;
    if (!start || !end) {
      return;
    }
    await dispatch(
      fetchAmTaskLogs({
        startDate: dayjs(start).format('YYYY-MM-DD'),
        endDate: dayjs(end).format('YYYY-MM-DD'),
        scope: logScope,
      }),
    );
  }, [dispatch, logDateRange, logScope]);

  useEffect(() => {
    refreshLogs().catch((error) => console.error('Failed to refresh task logs', error));
  }, [refreshLogs]);

  const openTemplateModal = useCallback((template?: AssistantManagerTaskTemplate) => {
    if (template) {
      setEditingTemplate(template);
      setTemplateFormState({
        name: template.name,
        description: template.description ?? '',
        cadence: template.cadence,
        scheduleConfigText: JSON.stringify(template.scheduleConfig ?? {}, null, 2),
      });
    } else {
      setEditingTemplate(null);
      setTemplateFormState(defaultTemplateFormState);
    }
    setTemplateFormError(null);
    setTemplateModalOpen(true);
  }, []);

  const closeTemplateModal = useCallback(() => {
    if (templateSubmitting) {
      return;
    }
    setTemplateModalOpen(false);
    setEditingTemplate(null);
    setTemplateFormState(defaultTemplateFormState);
  }, [templateSubmitting]);

  const handleTemplateSubmit = useCallback(async () => {
    if (!templateFormState.name.trim()) {
      setTemplateFormError('Name is required');
      return;
    }
    setTemplateSubmitting(true);
    setTemplateFormError(null);
    try {
      const scheduleConfig = JSON.parse(templateFormState.scheduleConfigText || '{}');
      const payload = {
        name: templateFormState.name.trim(),
        description: templateFormState.description.trim() || null,
        cadence: templateFormState.cadence,
        scheduleConfig,
      };
      if (editingTemplate) {
        await dispatch(updateAmTaskTemplate({ templateId: editingTemplate.id, payload })).unwrap();
      } else {
        await dispatch(createAmTaskTemplate(payload)).unwrap();
      }
      await dispatch(fetchAmTaskTemplates());
      closeTemplateModal();
    } catch (error) {
      setTemplateFormError(error instanceof Error ? error.message : 'Failed to save template');
    } finally {
      setTemplateSubmitting(false);
    }
  }, [templateFormState, editingTemplate, dispatch, closeTemplateModal]);

  const openAssignmentModal = useCallback((template: AssistantManagerTaskTemplate, assignment?: AssistantManagerTaskAssignment) => {
    setSelectedTemplateId(template.id);
    if (assignment) {
      setEditingAssignment(assignment);
      setAssignmentFormState({
        targetScope: assignment.targetScope,
        staffType: assignment.staffType ?? 'assistant_manager',
        userId: assignment.userId ? String(assignment.userId) : '',
        effectiveStart: assignment.effectiveStart ?? '',
        effectiveEnd: assignment.effectiveEnd ?? '',
      });
    } else {
      setEditingAssignment(null);
      setAssignmentFormState({
        targetScope: 'staff_type',
        staffType: 'assistant_manager',
        userId: '',
        effectiveStart: '',
        effectiveEnd: '',
      });
    }
    setAssignmentModalOpen(true);
  }, []);

  const closeAssignmentModal = useCallback(() => {
    if (assignmentSubmitting) {
      return;
    }
    setAssignmentModalOpen(false);
    setEditingAssignment(null);
    setAssignmentFormState(defaultAssignmentFormState);
  }, [assignmentSubmitting]);

  const handleAssignmentSubmit = useCallback(async () => {
    if (!selectedTemplateId) {
      return;
    }
    if (assignmentFormState.targetScope === 'user' && !assignmentFormState.userId.trim()) {
      setTemplateFormError('User ID is required when target scope is user');
      return;
    }
    if (assignmentFormState.targetScope === 'staff_type' && !assignmentFormState.staffType.trim()) {
      setTemplateFormError('Staff type is required when target scope is staff type');
      return;
    }
    setAssignmentSubmitting(true);
    try {
      const payload = {
        targetScope: assignmentFormState.targetScope,
        staffType: assignmentFormState.targetScope === 'staff_type' ? assignmentFormState.staffType.trim() : undefined,
        userId: assignmentFormState.targetScope === 'user' ? Number(assignmentFormState.userId) : undefined,
        effectiveStart: assignmentFormState.effectiveStart || null,
        effectiveEnd: assignmentFormState.effectiveEnd || null,
      };
      if (editingAssignment) {
        await dispatch(
          updateAmTaskAssignment({
            templateId: selectedTemplateId,
            assignmentId: editingAssignment.id,
            payload,
          }),
        ).unwrap();
      } else {
        await dispatch(createAmTaskAssignment({ templateId: selectedTemplateId, payload })).unwrap();
      }
      await dispatch(fetchAmTaskTemplates());
      closeAssignmentModal();
    } catch (error) {
      setTemplateFormError(error instanceof Error ? error.message : 'Failed to save assignment');
    } finally {
      setAssignmentSubmitting(false);
    }
  }, [assignmentFormState, selectedTemplateId, editingAssignment, dispatch, closeAssignmentModal]);

  const handleAssignmentDelete = useCallback(
    async (templateId: number, assignmentId: number) => {
      if (!window.confirm('Delete this assignment?')) {
        return;
      }
      try {
        await dispatch(deleteAmTaskAssignment({ templateId, assignmentId })).unwrap();
        await dispatch(fetchAmTaskTemplates());
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('Failed to delete assignment', error);
      }
    },
    [dispatch],
  );

  const handleLogStatusChange = useCallback(
    async (log: AssistantManagerTaskLog, status: AssistantManagerTaskLog['status']) => {
      try {
        await dispatch(updateAmTaskLogStatus({ logId: log.id, payload: { status } })).unwrap();
        await refreshLogs();
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('Failed to update log', error);
      }
    },
    [dispatch, refreshLogs],
  );

  const filteredLogs = useMemo(() => {
    if (!logFilterStatus) {
      return logs;
    }
    return logs.filter((log) => log.status === logFilterStatus);
  }, [logs, logFilterStatus]);

  const groupedLogs = useMemo(() => {
    const map = new Map<string, AssistantManagerTaskLog[]>();
    filteredLogs.forEach((log) => {
      if (!map.has(log.taskDate)) {
        map.set(log.taskDate, []);
      }
      map.get(log.taskDate)!.push(log);
    });
    return Array.from(map.entries()).sort(([a], [b]) => (a < b ? -1 : 1));
  }, [filteredLogs]);

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="center">
        <div>
          <Text size="lg" fw={600}>
            Assistant Manager Task Planner
          </Text>
          <Text size="sm" c="dimmed">
            Configure the checklist templates and track completion to support base salary proration.
          </Text>
        </div>
        <Group gap="xs">
          <Tooltip label="Refresh logs">
            <ActionIcon variant="light" onClick={refreshLogs}>
              <IconRefresh size={16} />
            </ActionIcon>
          </Tooltip>
          {canManage && (
            <Button leftSection={<IconAdjustments size={16} />} onClick={() => openTemplateModal()}>
              New Template
            </Button>
          )}
        </Group>
      </Group>

      {templateState.error && (
        <Alert color="red" title="Templates">
          {templateState.error}
        </Alert>
      )}

      <Stack>
        {templates.map((template) => (
          <Card key={template.id} withBorder radius="md" padding="md">
            <Stack gap="xs">
              <Group justify="space-between" align="flex-start">
                <Stack gap={2}>
                  <Group gap="xs">
                    <Text fw={600}>{template.name}</Text>
                    <Badge color="blue" variant="light">
                      {CADENCE_LABELS[template.cadence]}
                    </Badge>
                  </Group>
                  {template.description && (
                    <Text size="sm" c="dimmed">
                      {template.description}
                    </Text>
                  )}
                </Stack>
                {canManage && (
                  <Group gap="xs">
                    <Button size="xs" variant="subtle" onClick={() => openAssignmentModal(template)}>
                      Assign
                    </Button>
                    <Button size="xs" variant="subtle" onClick={() => openTemplateModal(template)}>
                      Edit
                    </Button>
                  </Group>
                )}
              </Group>
              {template.assignments && template.assignments.length > 0 && (
                <Stack gap={4}>
                  {template.assignments.map((assignment) => (
                    <Group key={assignment.id} justify="space-between">
                      <Group gap="xs">
                        <Badge variant="outline">{assignment.targetScope === 'user' ? 'Specific user' : assignment.staffType ?? 'staff'}</Badge>
                        {assignment.userName && <Text size="sm">{assignment.userName}</Text>}
                        <Text size="xs" c="dimmed">
                          {assignment.effectiveStart || 'start'} → {assignment.effectiveEnd || 'open'}
                        </Text>
                      </Group>
                      {canManage && (
                        <Group gap="xs">
                          <Tooltip label="Edit assignment">
                            <ActionIcon variant="light" onClick={() => openAssignmentModal(template, assignment)}>
                              <IconPencil size={16} />
                            </ActionIcon>
                          </Tooltip>
                          <Tooltip label="Delete assignment">
                            <ActionIcon color="red" variant="light" onClick={() => handleAssignmentDelete(template.id, assignment.id)}>
                              <IconCircleX size={16} />
                            </ActionIcon>
                          </Tooltip>
                        </Group>
                      )}
                    </Group>
                  ))}
                </Stack>
              )}
            </Stack>
          </Card>
        ))}
      </Stack>

      <Card withBorder radius="md" padding="md">
        <Stack gap="sm">
          <Group justify="space-between" align="center">
            <Group gap="xs">
              <IconCalendar size={16} />
              <Text fw={600}>Task Logs</Text>
            </Group>
            <Group gap="xs">
              <DatePickerInput
                type="range"
                label={null}
                value={logDateRange}
                onChange={setLogDateRange}
                valueFormat="YYYY-MM-DD"
              />
              <Select
                placeholder="Scope"
                data={[
                  { value: 'all', label: 'All' },
                  { value: 'self', label: 'My tasks' },
                ]}
                value={logScope}
                onChange={(value) => setLogScope((value as 'self' | 'all') ?? 'all')}
                style={{ width: 120 }}
              />
              <Select
                placeholder="Status"
                data={[{ value: null, label: 'All statuses' }, ...TASK_STATUS_OPTIONS]}
                value={logFilterStatus}
                onChange={(value) => setLogFilterStatus(value)}
                allowDeselect
              />
            </Group>
          </Group>

          {logState.loading && (
            <Center>
              <IconLoader2 size={20} className="spin" />
            </Center>
          )}

          {logState.error && (
            <Alert color="red" title="Logs">
              {logState.error}
            </Alert>
          )}

          {!logState.loading && groupedLogs.length === 0 && (
            <Text size="sm" c="dimmed">
              No tasks scheduled for this range.
            </Text>
          )}

          <Stack gap="sm">
            {groupedLogs.map(([date, dailyLogs]) => (
              <Card key={date} withBorder radius="md" padding="sm">
                <Stack gap="xs">
                  <Text size="sm" fw={600}>
                    {dayjs(date).format('dddd, MMM D')}
                  </Text>
                  {dailyLogs.map((log) => (
                    <Card key={log.id} withBorder radius="md" padding="sm" shadow="xs">
                      <Stack gap="xs">
                        <Group justify="space-between" align="flex-start">
                          <Stack gap={2}>
                            <Text fw={600}>{log.templateName ?? `Template #${log.templateId}`}</Text>
                            <Text size="xs" c="dimmed">
                              {log.userName ?? `User #${log.userId}`}
                            </Text>
                          </Stack>
                          <Badge color={log.status === 'completed' ? 'green' : log.status === 'missed' ? 'red' : log.status === 'waived' ? 'yellow' : 'gray'}>
                            {log.status}
                          </Badge>
                        </Group>
                        {log.notes && (
                          <Text size="sm" c="dimmed">
                            Notes: {log.notes}
                          </Text>
                        )}
                        <Group gap="xs">
                          <Button
                            size="xs"
                            leftSection={<IconCheck size={14} />}
                            variant={log.status === 'completed' ? 'filled' : 'outline'}
                            onClick={() => handleLogStatusChange(log, 'completed')}
                          >
                            Complete
                          </Button>
                          <Button size="xs" variant="outline" onClick={() => handleLogStatusChange(log, 'missed')}>
                            Missed
                          </Button>
                          <Button size="xs" variant="outline" onClick={() => handleLogStatusChange(log, 'waived')}>
                            Waive
                          </Button>
                        </Group>
                      </Stack>
                    </Card>
                  ))}
                </Stack>
              </Card>
            ))}
          </Stack>
        </Stack>
      </Card>

      <Modal opened={templateModalOpen} onClose={closeTemplateModal} title={editingTemplate ? 'Edit Template' : 'New Template'} centered>
        <Stack gap="md">
          <TextInput
            label="Name"
            required
            value={templateFormState.name}
            onChange={(event) => setTemplateFormState((prev) => ({ ...prev, name: event.currentTarget.value }))}
          />
          <Textarea
            label="Description"
            minRows={3}
            value={templateFormState.description}
            onChange={(event) => setTemplateFormState((prev) => ({ ...prev, description: event.currentTarget.value }))}
          />
          <Select
            label="Cadence"
            data={Object.entries(CADENCE_LABELS).map(([value, label]) => ({ value, label }))}
            value={templateFormState.cadence}
            onChange={(value) => setTemplateFormState((prev) => ({ ...prev, cadence: (value as AssistantManagerTaskCadence) ?? prev.cadence }))}
          />
          <Textarea
            label="Schedule Config (JSON)"
            description="Optional fine-tuning for cadence (e.g., daysOfWeek, dayOfMonth)."
            minRows={3}
            value={templateFormState.scheduleConfigText}
            onChange={(event) => setTemplateFormState((prev) => ({ ...prev, scheduleConfigText: event.currentTarget.value }))}
