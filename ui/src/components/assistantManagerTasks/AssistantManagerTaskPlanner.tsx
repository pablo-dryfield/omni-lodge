import { useCallback, useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import { ActionIcon, Alert, Avatar, Badge, Box, Button, Card, Center, Divider, Group, Modal, SegmentedControl, Select, Stack, Switch, Text, Textarea, TextInput, Tooltip } from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { IconCheck, IconCircleX, IconLoader2, IconAdjustments, IconCalendar, IconRefresh, IconPencil, IconBolt, IconMessageCircle2, IconPaperclip, IconPlus, IconAlertTriangle } from '@tabler/icons-react';
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
  createManualAmTaskLog,
  updateAmTaskLogMeta,
} from '../../actions/assistantManagerTaskActions';
import type {
  AssistantManagerTaskTemplate,
  AssistantManagerTaskAssignment,
  AssistantManagerTaskLog,
  AssistantManagerTaskCadence,
  AssistantManagerTaskLogMeta,
  ManualAssistantManagerTaskPayload,
  TaskLogMetaUpdatePayload,
} from '../../types/assistantManagerTasks/AssistantManagerTask';
import type { ServerResponse } from '../../types/general/ServerResponse';

type TemplateFormState = {
  name: string;
  description: string;
  cadence: AssistantManagerTaskCadence;
  scheduleConfigText: string;
  defaultTime: string;
  defaultDuration: string;
  defaultPriority: PlannerDisplayTask['priority'];
  defaultPoints: string;
  requireShift: boolean;
};

const defaultTemplateFormState: TemplateFormState = {
  name: '',
  description: '',
  cadence: 'daily',
  scheduleConfigText: '{}',
  defaultTime: '',
  defaultDuration: '',
  defaultPriority: 'medium',
  defaultPoints: '',
  requireShift: false,
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

type ManualTaskFormState = {
  templateId: number | null;
  userId: string;
  assignmentId: string;
  taskDate: Date | null;
  time: string;
  durationHours: string;
  priority: PlannerDisplayTask['priority'];
  points: string;
  tags: string;
  notes: string;
  comment: string;
  requireShift: boolean;
};

const defaultManualTaskFormState: ManualTaskFormState = {
  templateId: null,
  userId: '',
  assignmentId: '',
  taskDate: new Date(),
  time: '',
  durationHours: '1',
  priority: 'medium',
  points: '1',
  tags: '',
  notes: '',
  comment: '',
  requireShift: true,
};

type LogDetailFormState = {
  taskDate: Date | null;
  time: string;
  durationHours: string;
  priority: PlannerDisplayTask['priority'];
  points: string;
  tags: string;
  evidence: string;
  notes: string;
  requireShift: boolean;
};

const defaultLogDetailFormState: LogDetailFormState = {
  taskDate: null,
  time: '',
  durationHours: '1',
  priority: 'medium',
  points: '1',
  tags: '',
  evidence: '',
  notes: '',
  requireShift: true,
};

const buildLogDetailFormStateFromLog = (log: AssistantManagerTaskLog): LogDetailFormState => {
  const meta = log.meta ?? {};
  const priority =
    typeof meta.priority === 'string' && (meta.priority === 'high' || meta.priority === 'low' || meta.priority === 'medium')
      ? (meta.priority as PlannerDisplayTask['priority'])
      : 'medium';
  return {
    taskDate: log.taskDate ? dayjs(log.taskDate).toDate() : null,
    time: typeof meta.time === 'string' ? meta.time : '',
    durationHours: meta.durationHours != null ? String(meta.durationHours) : '1',
    priority,
    points: meta.points != null ? String(meta.points) : '1',
    tags: Array.isArray(meta.tags) ? meta.tags.join(', ') : '',
    evidence: Array.isArray(meta.evidence) ? meta.evidence.join('\n') : '',
    notes: log.notes ?? '',
    requireShift: typeof meta.requireShift === 'boolean' ? meta.requireShift : false,
  };
};

const TASK_STATUS_OPTIONS: { value: AssistantManagerTaskLog['status']; label: string }[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'completed', label: 'Completed' },
  { value: 'missed', label: 'Missed' },
  { value: 'waived', label: 'Waived' },
];

type TaskStatusFilterValue = AssistantManagerTaskLog['status'] | 'all';

const STATUS_FILTER_OPTIONS: { value: TaskStatusFilterValue; label: string }[] = [
  { value: 'all', label: 'All statuses' },
  ...TASK_STATUS_OPTIONS,
];

const PLANNER_START_HOUR = 6;
const PLANNER_END_HOUR = 22;
const PLANNER_SLOT_HEIGHT = 56;
const PLANNER_DAYS = 7;

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
  const [assignmentFormError, setAssignmentFormError] = useState<string | null>(null);

  const [logDateRange, setLogDateRange] = useState<[Date | null, Date | null]>([new Date(), dayjs().add(6, 'day').toDate()]);
  const [logScope, setLogScope] = useState<'self' | 'all'>('all');
  const [logFilterStatus, setLogFilterStatus] = useState<TaskStatusFilterValue>('all');
  const [activeSection, setActiveSection] = useState<'setup' | 'dashboard'>('dashboard');
  const [manualModalOpen, setManualModalOpen] = useState(false);
  const [manualFormState, setManualFormState] = useState<ManualTaskFormState>(defaultManualTaskFormState);
  const [manualFormError, setManualFormError] = useState<string | null>(null);
  const [manualSubmitting, setManualSubmitting] = useState(false);
  const [selectedLog, setSelectedLog] = useState<AssistantManagerTaskLog | null>(null);
  const [logDetailModalOpen, setLogDetailModalOpen] = useState(false);
  const [logDetailFormState, setLogDetailFormState] = useState<LogDetailFormState>(defaultLogDetailFormState);
  const [logDetailSubmitting, setLogDetailSubmitting] = useState(false);
  const [logDetailError, setLogDetailError] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState('');
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  const selectedLogComments = useMemo(
    () => (selectedLog && Array.isArray(selectedLog.meta?.comments) ? selectedLog.meta?.comments ?? [] : []),
    [selectedLog],
  );

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
      const config = (template.scheduleConfig ?? {}) as Record<string, unknown>;
      const resolvePriority = (): PlannerDisplayTask['priority'] => {
        if (typeof config.priority === 'string') {
          const normalized = config.priority.toLowerCase();
          if (normalized === 'high' || normalized === 'medium' || normalized === 'low') {
            return normalized;
          }
        }
        return 'medium';
      };
      setEditingTemplate(template);
      setTemplateFormState({
        name: template.name,
        description: template.description ?? '',
        cadence: template.cadence,
        scheduleConfigText: JSON.stringify(template.scheduleConfig ?? {}, null, 2),
        defaultTime: typeof config.time === 'string' ? config.time : typeof config.hour === 'string' ? config.hour : '',
        defaultDuration: config.durationHours != null ? String(config.durationHours) : '',
        defaultPriority: resolvePriority(),
        defaultPoints: config.points != null ? String(config.points) : '',
        requireShift: config.requireShift === true || config.requireScheduledShift === true,
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
      const nextScheduleConfig: Record<string, unknown> = { ...scheduleConfig };
      const trimmedTime = templateFormState.defaultTime.trim();
      if (trimmedTime) {
        nextScheduleConfig.time = trimmedTime;
      }
      const durationNumeric = Number(templateFormState.defaultDuration);
      if (templateFormState.defaultDuration.trim() && Number.isFinite(durationNumeric) && durationNumeric > 0) {
        nextScheduleConfig.durationHours = durationNumeric;
      }
      if (templateFormState.defaultPriority) {
        nextScheduleConfig.priority = templateFormState.defaultPriority;
      }
      const pointsNumeric = Number(templateFormState.defaultPoints);
      if (templateFormState.defaultPoints.trim() && Number.isFinite(pointsNumeric) && pointsNumeric >= 0) {
        nextScheduleConfig.points = pointsNumeric;
      }
      const payload = {
        name: templateFormState.name.trim(),
        description: templateFormState.description.trim() || null,
        cadence: templateFormState.cadence,
        scheduleConfig: nextScheduleConfig,
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
    setAssignmentFormError(null);
    setAssignmentModalOpen(true);
  }, []);

  const closeAssignmentModal = useCallback(() => {
    if (assignmentSubmitting) {
      return;
    }
    setAssignmentModalOpen(false);
    setEditingAssignment(null);
    setAssignmentFormState(defaultAssignmentFormState);
    setAssignmentFormError(null);
  }, [assignmentSubmitting]);

  const handleAssignmentSubmit = useCallback(async () => {
    if (!selectedTemplateId) {
      return;
    }
    setAssignmentFormError(null);
    if (assignmentFormState.targetScope === 'user' && !assignmentFormState.userId.trim()) {
      setAssignmentFormError('User ID is required when target scope is user');
      return;
    }
    if (assignmentFormState.targetScope === 'staff_type' && !assignmentFormState.staffType.trim()) {
      setAssignmentFormError('Staff type is required when target scope is staff type');
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
      setAssignmentFormError(error instanceof Error ? error.message : 'Failed to save assignment');
    } finally {
      setAssignmentSubmitting(false);
    }
  }, [assignmentFormState, selectedTemplateId, editingAssignment, dispatch, closeAssignmentModal]);

  const handleAssignmentDateChange = useCallback((key: 'effectiveStart' | 'effectiveEnd', date: Date | null) => {
    setAssignmentFormState((prev) => ({
      ...prev,
      [key]: date ? dayjs(date).format('YYYY-MM-DD') : '',
    }));
  }, []);

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

  const openManualModal = useCallback(() => {
    setManualFormState(defaultManualTaskFormState);
    setManualFormError(null);
    setManualModalOpen(true);
  }, []);

  const closeManualModal = useCallback(() => {
    if (manualSubmitting) {
      return;
    }
    setManualModalOpen(false);
    setManualFormState(defaultManualTaskFormState);
    setManualFormError(null);
  }, [manualSubmitting]);

  const handleManualSubmit = useCallback(async () => {
    if (!manualFormState.templateId) {
      setManualFormError('Template is required');
      return;
    }
    if (!manualFormState.userId.trim()) {
      setManualFormError('User ID is required');
      return;
    }
    if (!manualFormState.taskDate) {
      setManualFormError('Task date is required');
      return;
    }
    const userId = Number(manualFormState.userId);
    if (!Number.isFinite(userId) || userId <= 0) {
      setManualFormError('User ID must be numeric');
      return;
    }
    let assignmentId: number | undefined;
    if (manualFormState.assignmentId.trim()) {
      const parsed = Number(manualFormState.assignmentId);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        setManualFormError('Assignment ID must be numeric');
        return;
      }
      assignmentId = parsed;
    }
    let durationHours: number | undefined;
    if (manualFormState.durationHours.trim()) {
      durationHours = Number(manualFormState.durationHours);
      if (!Number.isFinite(durationHours) || durationHours <= 0) {
        setManualFormError('Duration must be a positive number');
        return;
      }
    }
    let points: number | undefined;
    if (manualFormState.points.trim()) {
      points = Number(manualFormState.points);
      if (!Number.isFinite(points) || points < 0) {
        setManualFormError('Points must be zero or greater');
        return;
      }
    }
    const payload: ManualAssistantManagerTaskPayload = {
      templateId: manualFormState.templateId,
      userId,
      taskDate: dayjs(manualFormState.taskDate).format('YYYY-MM-DD'),
      assignmentId,
      notes: manualFormState.notes.trim() ? manualFormState.notes.trim() : undefined,
      time: manualFormState.time.trim() || undefined,
      durationHours,
      priority: manualFormState.priority,
      points,
      tags: manualFormState.tags
        ? manualFormState.tags.split(',').map((tag) => tag.trim()).filter(Boolean)
        : undefined,
      comment: manualFormState.comment.trim() ? manualFormState.comment.trim() : undefined,
      requireShift: manualFormState.requireShift,
    };
    setManualSubmitting(true);
    setManualFormError(null);
    try {
      await dispatch(createManualAmTaskLog(payload)).unwrap();
      await refreshLogs();
      closeManualModal();
    } catch (error) {
      setManualFormError(error instanceof Error ? error.message : 'Failed to create task');
    } finally {
      setManualSubmitting(false);
    }
  }, [manualFormState, dispatch, refreshLogs, closeManualModal]);

  const handleLogSelect = useCallback((log: AssistantManagerTaskLog) => {
    setSelectedLog(log);
    setLogDetailFormState(buildLogDetailFormStateFromLog(log));
    setLogDetailError(null);
    setCommentDraft('');
    setLogDetailModalOpen(true);
  }, []);

  const closeLogDetailModal = useCallback(() => {
    if (logDetailSubmitting || commentSubmitting) {
      return;
    }
    setLogDetailModalOpen(false);
    setSelectedLog(null);
    setLogDetailFormState(defaultLogDetailFormState);
    setLogDetailError(null);
    setCommentDraft('');
  }, [logDetailSubmitting, commentSubmitting]);

const handleLogDetailSave = useCallback(async () => {
    if (!selectedLog) {
      return;
    }
    if (!logDetailFormState.taskDate) {
      setLogDetailError('Task date is required');
      return;
    }
    const payload: TaskLogMetaUpdatePayload = {
      taskDate: dayjs(logDetailFormState.taskDate).format('YYYY-MM-DD'),
      time: logDetailFormState.time.trim() || undefined,
      durationHours: logDetailFormState.durationHours.trim() ? Number(logDetailFormState.durationHours) : undefined,
      priority: logDetailFormState.priority,
      points: logDetailFormState.points.trim() ? Number(logDetailFormState.points) : undefined,
      tags: logDetailFormState.tags.length
        ? logDetailFormState.tags.split(',').map((tag) => tag.trim()).filter(Boolean)
        : [],
      evidence: logDetailFormState.evidence.length
        ? logDetailFormState.evidence
            .split('\n')
            .map((entry) => entry.trim())
            .filter(Boolean)
        : [],
      notes: logDetailFormState.notes.trim() ? logDetailFormState.notes : null,
      requireShift: logDetailFormState.requireShift,
    };
    const durationValue = payload.durationHours;
    if (durationValue !== undefined && durationValue !== null) {
      if (!Number.isFinite(durationValue) || durationValue <= 0) {
        setLogDetailError('Duration must be greater than 0');
        return;
      }
    }
    const pointsValue = payload.points;
    if (pointsValue !== undefined && pointsValue !== null) {
      if (!Number.isFinite(pointsValue) || pointsValue < 0) {
        setLogDetailError('Points must be zero or greater');
        return;
      }
    }
    setLogDetailSubmitting(true);
    setLogDetailError(null);
    try {
      const response = (await dispatch(updateAmTaskLogMeta({ logId: selectedLog.id, payload })).unwrap()) as ServerResponse<AssistantManagerTaskLog>;
      const updatedLog = (response?.[0]?.data as AssistantManagerTaskLog[] | undefined)?.[0];
      if (updatedLog) {
        setSelectedLog(updatedLog);
        setLogDetailFormState(buildLogDetailFormStateFromLog(updatedLog));
      }
      await refreshLogs();
    } catch (error) {
      setLogDetailError(error instanceof Error ? error.message : 'Failed to update task');
    } finally {
      setLogDetailSubmitting(false);
    }
  }, [selectedLog, logDetailFormState, dispatch, refreshLogs]);

  const handleCommentSubmit = useCallback(async () => {
    if (!selectedLog || !commentDraft.trim()) {
      return;
    }
    setCommentSubmitting(true);
    try {
      const response = (await dispatch(updateAmTaskLogMeta({ logId: selectedLog.id, payload: { comment: commentDraft.trim() } })).unwrap()) as ServerResponse<AssistantManagerTaskLog>;
      const updatedLog = (response?.[0]?.data as AssistantManagerTaskLog[] | undefined)?.[0];
      if (updatedLog) {
        setSelectedLog(updatedLog);
        setLogDetailFormState(buildLogDetailFormStateFromLog(updatedLog));
      }
      await refreshLogs();
      setCommentDraft('');
    } catch (error) {
      setLogDetailError(error instanceof Error ? error.message : 'Failed to add comment');
    } finally {
      setCommentSubmitting(false);
    }
  }, [selectedLog, commentDraft, dispatch, refreshLogs]);

  const filteredLogs = useMemo(() => {
    if (logFilterStatus === 'all') {
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
      <Group justify="space-between" align="flex-start" wrap="wrap">
        <Stack gap={4} style={{ flex: 1, minWidth: 240 }}>
          <Text size="lg" fw={600}>
            Assistant Manager Task Planner
          </Text>
          <Text size="sm" c="dimmed">
            Configure the checklist templates and track completion to support base salary proration.
          </Text>
        </Stack>
        <Group gap="md" align="center" wrap="wrap">
          <SegmentedControl
            value={activeSection}
            onChange={(value) => setActiveSection((value as 'setup' | 'dashboard') ?? 'dashboard')}
            data={[
              { label: 'Setup', value: 'setup' },
              { label: 'Dashboard', value: 'dashboard' },
            ]}
            aria-label="Task planner view"
          />
          <Group gap="xs">
            {activeSection === 'dashboard' && (
              <Tooltip label="Refresh logs">
                <ActionIcon variant="light" onClick={refreshLogs}>
                  <IconRefresh size={16} />
                </ActionIcon>
              </Tooltip>
            )}
            {canManage && activeSection === 'dashboard' && (
              <Button leftSection={<IconPlus size={16} />} variant="light" onClick={openManualModal}>
                New Task
              </Button>
            )}
            {canManage && activeSection === 'setup' && (
              <Button leftSection={<IconAdjustments size={16} />} onClick={() => openTemplateModal()}>
                New Template
              </Button>
            )}
          </Group>
        </Group>
      </Group>

      {activeSection === 'setup' && (
        <>
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
                            <Badge variant="outline">
                              {assignment.targetScope === 'user' ? 'Specific user' : assignment.staffType ?? 'staff'}
                            </Badge>
                            {assignment.userName && <Text size="sm">{assignment.userName}</Text>}
                            <Text size="xs" c="dimmed">
                              {assignment.effectiveStart || 'start'} - {assignment.effectiveEnd || 'open'}
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
        </>
      )}

      {activeSection === 'dashboard' && (
        <Card withBorder radius="md" padding="md">
          <Stack gap="sm">
            <WeeklyTaskPlannerBoard logs={filteredLogs} templates={templates} rangeStart={logDateRange[0]} onSelectLog={handleLogSelect} />
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
                data={STATUS_FILTER_OPTIONS}
                value={logFilterStatus}
                onChange={(value) => setLogFilterStatus((value as TaskStatusFilterValue) ?? 'all')}
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
      )}

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
          <Group grow>
            <TextInput
              label="Default Start Time"
              placeholder="e.g. 08:00"
              value={templateFormState.defaultTime}
              onChange={(event) => setTemplateFormState((prev) => ({ ...prev, defaultTime: event.currentTarget.value }))}
            />
            <TextInput
              label="Default Duration (hours)"
              placeholder="1.5"
              value={templateFormState.defaultDuration}
              onChange={(event) => setTemplateFormState((prev) => ({ ...prev, defaultDuration: event.currentTarget.value }))}
            />
          </Group>
          <Group grow>
            <Select
              label="Default Priority"
              data={(Object.keys(PRIORITY_META) as PlannerDisplayTask['priority'][]).map((priority) => ({
                value: priority,
                label: PRIORITY_META[priority].label,
              }))}
              value={templateFormState.defaultPriority}
              onChange={(value) =>
                setTemplateFormState((prev) => ({
                  ...prev,
                  defaultPriority: (value as PlannerDisplayTask['priority']) ?? prev.defaultPriority,
                }))
              }
            />
            <TextInput
              label="Default Points"
              placeholder="1"
              value={templateFormState.defaultPoints}
              onChange={(event) => setTemplateFormState((prev) => ({ ...prev, defaultPoints: event.currentTarget.value }))}
            />
          </Group>
          <Textarea
            label="Schedule Config (JSON)"
            description="Optional fine-tuning for cadence (e.g., daysOfWeek, dayOfMonth)."
            minRows={3}
            value={templateFormState.scheduleConfigText}
            onChange={(event) => setTemplateFormState((prev) => ({ ...prev, scheduleConfigText: event.currentTarget.value }))}
          />
          {templateFormError && (
            <Alert color="red" title="Unable to save">
              {templateFormError}
            </Alert>
          )}
          <Group justify="flex-end" gap="sm">
            <Button variant="default" onClick={closeTemplateModal} disabled={templateSubmitting}>
              Cancel
            </Button>
            <Button onClick={handleTemplateSubmit} loading={templateSubmitting}>
              {editingTemplate ? 'Save Changes' : 'Create Template'}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={assignmentModalOpen}
        onClose={closeAssignmentModal}
        title={editingAssignment ? 'Edit Assignment' : 'New Assignment'}
        centered
      >
        <Stack gap="md">
          {selectedTemplateId && (
            <Text size="sm" c="dimmed">
              Template: {templates.find((tpl) => tpl.id === selectedTemplateId)?.name ?? `#${selectedTemplateId}`}
            </Text>
          )}
          <Select
            label="Target Scope"
            data={[
              { value: 'staff_type', label: 'Staff Type' },
              { value: 'user', label: 'Specific User' },
            ]}
            value={assignmentFormState.targetScope}
            onChange={(value) =>
              setAssignmentFormState((prev) => ({
                ...prev,
                targetScope: (value as AssignmentFormState['targetScope']) ?? prev.targetScope,
              }))
            }
          />
          {assignmentFormState.targetScope === 'staff_type' ? (
            <TextInput
              label="Staff Type"
              required
              value={assignmentFormState.staffType}
              onChange={(event) => setAssignmentFormState((prev) => ({ ...prev, staffType: event.currentTarget.value }))}
            />
          ) : (
            <TextInput
              label="User ID"
              required
              value={assignmentFormState.userId}
              onChange={(event) => setAssignmentFormState((prev) => ({ ...prev, userId: event.currentTarget.value }))}
            />
          )}
          <DatePickerInput
            label="Effective Start"
            value={assignmentFormState.effectiveStart ? dayjs(assignmentFormState.effectiveStart).toDate() : null}
            onChange={(value) => handleAssignmentDateChange('effectiveStart', value)}
            valueFormat="YYYY-MM-DD"
            clearable
          />
          <DatePickerInput
            label="Effective End"
            value={assignmentFormState.effectiveEnd ? dayjs(assignmentFormState.effectiveEnd).toDate() : null}
            onChange={(value) => handleAssignmentDateChange('effectiveEnd', value)}
            valueFormat="YYYY-MM-DD"
            placeholder="Leave empty for open-ended"
            clearable
          />
          {assignmentFormError && (
            <Alert color="red" title="Unable to save">
              {assignmentFormError}
            </Alert>
          )}
          <Group justify="flex-end" gap="sm">
            <Button variant="default" onClick={closeAssignmentModal} disabled={assignmentSubmitting}>
              Cancel
            </Button>
            <Button onClick={handleAssignmentSubmit} loading={assignmentSubmitting}>
              {editingAssignment ? 'Save Assignment' : 'Create Assignment'}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal opened={manualModalOpen} onClose={closeManualModal} title="New Task" centered>
        <Stack gap="md">
          <Select
            label="Template"
            required
            placeholder="Select template"
            data={templates.map((template) => ({ value: String(template.id), label: template.name }))}
            value={manualFormState.templateId ? String(manualFormState.templateId) : null}
            onChange={(value) =>
              setManualFormState((prev) => ({ ...prev, templateId: value ? Number(value) : null }))
            }
          />
          <TextInput
            label="User ID"
            required
            value={manualFormState.userId}
            onChange={(event) => setManualFormState((prev) => ({ ...prev, userId: event.currentTarget.value }))}
          />
          <TextInput
            label="Assignment ID"
            description="Optional"
            value={manualFormState.assignmentId}
            onChange={(event) =>
              setManualFormState((prev) => ({
                ...prev,
                assignmentId: event.currentTarget.value,
              }))
            }
          />
          <DatePickerInput
            label="Task Date"
            value={manualFormState.taskDate}
            onChange={(value) => setManualFormState((prev) => ({ ...prev, taskDate: value }))}
            valueFormat="YYYY-MM-DD"
            required
          />
          <Group grow>
            <TextInput
              label="Start Time"
              placeholder="08:00"
              value={manualFormState.time}
              onChange={(event) => setManualFormState((prev) => ({ ...prev, time: event.currentTarget.value }))}
            />
            <TextInput
              label="Duration (hours)"
              placeholder="1.5"
              value={manualFormState.durationHours}
              onChange={(event) =>
                setManualFormState((prev) => ({ ...prev, durationHours: event.currentTarget.value }))
              }
            />
          </Group>
          <Group grow>
            <Select
              label="Priority"
              data={(Object.keys(PRIORITY_META) as PlannerDisplayTask['priority'][]).map((priority) => ({
                value: priority,
                label: PRIORITY_META[priority].label,
              }))}
              value={manualFormState.priority}
              onChange={(value) =>
                setManualFormState((prev) => ({
                  ...prev,
                  priority: (value as PlannerDisplayTask['priority']) ?? prev.priority,
                }))
              }
            />
            <TextInput
              label="Points"
              value={manualFormState.points}
              onChange={(event) => setManualFormState((prev) => ({ ...prev, points: event.currentTarget.value }))}
            />
          </Group>
          <TextInput
            label="Tags"
            description="Comma separated"
            value={manualFormState.tags}
            onChange={(event) => setManualFormState((prev) => ({ ...prev, tags: event.currentTarget.value }))}
          />
          <Textarea
            label="Notes"
            minRows={2}
            value={manualFormState.notes}
            onChange={(event) => setManualFormState((prev) => ({ ...prev, notes: event.currentTarget.value }))}
          />
          <Textarea
            label="Comment"
            minRows={2}
            value={manualFormState.comment}
            onChange={(event) => setManualFormState((prev) => ({ ...prev, comment: event.currentTarget.value }))}
          />
          <Switch
            label="Require staff to be on shift"
            checked={manualFormState.requireShift}
            onChange={(event) =>
              setManualFormState((prev) => ({ ...prev, requireShift: event.currentTarget.checked }))
            }
          />
          {manualFormError && (
            <Alert color="red" title="Unable to save">
              {manualFormError}
            </Alert>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={closeManualModal} disabled={manualSubmitting}>
              Cancel
            </Button>
            <Button onClick={handleManualSubmit} loading={manualSubmitting}>
              Create Task
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={logDetailModalOpen}
        onClose={closeLogDetailModal}
        title={selectedLog ? selectedLog.templateName ?? `Template #${selectedLog.templateId}` : 'Task Details'}
        size="lg"
        centered
      >
        {selectedLog ? (
          <Stack gap="md">
            <Stack gap={2}>
              <Group gap="xs">
                <Badge color={STATUS_COLORS[selectedLog.status]}>{selectedLog.status}</Badge>
                {selectedLog.meta.manual && (
                  <Badge color="grape" variant="light">
                    Manual
                  </Badge>
                )}
              </Group>
              <Text size="sm" c="dimmed">
                Assigned to {selectedLog.userName ?? `User #${selectedLog.userId}`}
              </Text>
            </Stack>
            <DatePickerInput
              label="Task Date"
              value={logDetailFormState.taskDate}
              onChange={(value) => setLogDetailFormState((prev) => ({ ...prev, taskDate: value }))}
              valueFormat="YYYY-MM-DD"
            />
            <Group grow>
              <TextInput
                label="Start Time"
                value={logDetailFormState.time}
                onChange={(event) =>
                  setLogDetailFormState((prev) => ({ ...prev, time: event.currentTarget.value }))
                }
              />
              <TextInput
                label="Duration (hours)"
                value={logDetailFormState.durationHours}
                onChange={(event) =>
                  setLogDetailFormState((prev) => ({
                    ...prev,
                    durationHours: event.currentTarget.value,
                  }))
                }
              />
            </Group>
            <Group grow>
              <Select
                label="Priority"
                data={(Object.keys(PRIORITY_META) as PlannerDisplayTask['priority'][]).map((priority) => ({
                  value: priority,
                  label: PRIORITY_META[priority].label,
                }))}
                value={logDetailFormState.priority}
                onChange={(value) =>
                  setLogDetailFormState((prev) => ({
                    ...prev,
                    priority: (value as PlannerDisplayTask['priority']) ?? prev.priority,
                  }))
                }
              />
              <TextInput
                label="Points"
                value={logDetailFormState.points}
                onChange={(event) =>
                  setLogDetailFormState((prev) => ({ ...prev, points: event.currentTarget.value }))
                }
              />
            </Group>
            <TextInput
              label="Tags"
              description="Comma separated"
              value={logDetailFormState.tags}
              onChange={(event) => setLogDetailFormState((prev) => ({ ...prev, tags: event.currentTarget.value }))}
            />
            <Textarea
              label="Evidence"
              description="One entry per line"
              minRows={2}
              value={logDetailFormState.evidence}
              onChange={(event) =>
                setLogDetailFormState((prev) => ({ ...prev, evidence: event.currentTarget.value }))
              }
            />
            <Textarea
              label="Notes"
              minRows={3}
              value={logDetailFormState.notes}
              onChange={(event) =>
                setLogDetailFormState((prev) => ({ ...prev, notes: event.currentTarget.value }))
              }
            />
            <Switch
              label="Require shift availability"
              checked={logDetailFormState.requireShift}
              onChange={(event) =>
                setLogDetailFormState((prev) => ({ ...prev, requireShift: event.currentTarget.checked }))
              }
            />
            {logDetailError && (
              <Alert color="red" title="Unable to save">
                {logDetailError}
              </Alert>
            )}
            <Group justify="flex-end">
              <Button variant="default" onClick={closeLogDetailModal} disabled={logDetailSubmitting}>
                Close
              </Button>
              <Button onClick={handleLogDetailSave} loading={logDetailSubmitting}>
                Save Changes
              </Button>
            </Group>
            <Divider label="Comments" />
            <Stack gap="sm">
              {selectedLogComments.length > 0 ? (
                selectedLogComments.map((comment) => (
                  <Card key={comment.id} withBorder padding="xs" radius="sm">
                    <Stack gap={2}>
                      <Group justify="space-between">
                        <Text size="sm" fw={500}>
                          {comment.authorName ?? 'System'}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {dayjs(comment.createdAt).format('MMM D, h:mm A')}
                        </Text>
                      </Group>
                      <Text size="sm">{comment.body}</Text>
                    </Stack>
                  </Card>
                ))
              ) : (
                <Text size="sm" c="dimmed">
                  No comments yet.
                </Text>
              )}
            </Stack>
            <Textarea
              label="Add comment"
              minRows={2}
              value={commentDraft}
              onChange={(event) => setCommentDraft(event.currentTarget.value)}
            />
            <Group justify="flex-end">
              <Button onClick={handleCommentSubmit} loading={commentSubmitting} disabled={!commentDraft.trim()}>
                Add Comment
              </Button>
            </Group>
          </Stack>
        ) : (
          <Text size="sm" c="dimmed">
            Select a task to view details.
          </Text>
        )}
      </Modal>

    </Stack>
  );
};

export default AssistantManagerTaskPlanner;

type PlannerDisplayTask = {
  id: number;
  templateName: string;
  ownerName: string;
  ownerInitials: string;
  dayIndex: number;
  startHour: number;
  durationHours: number;
  priority: 'high' | 'medium' | 'low';
  points: number;
  comments: number;
  attachments: number;
  tags: string[];
  notes: string | null;
  status: AssistantManagerTaskLog['status'];
  manual: boolean;
  requiresShift: boolean;
  scheduleConflict: boolean;
  onShift: boolean;
  offDay: boolean;
  shiftTimeStart: string | null;
  shiftTimeEnd: string | null;
  source: AssistantManagerTaskLog;
};

const PRIORITY_META: Record<PlannerDisplayTask['priority'], { label: string; color: string; accent: string }> = {
  high: { label: 'High', color: 'red', accent: 'linear-gradient(135deg, rgba(244, 63, 94, 0.12), rgba(244, 63, 94, 0.04))' },
  medium: { label: 'Medium', color: 'yellow', accent: 'linear-gradient(135deg, rgba(250, 204, 21, 0.18), rgba(250, 204, 21, 0.04))' },
  low: { label: 'Low', color: 'green', accent: 'linear-gradient(135deg, rgba(34, 197, 94, 0.12), rgba(34, 197, 94, 0.04))' },
};

const STATUS_COLORS: Record<AssistantManagerTaskLog['status'], string> = {
  pending: 'gray',
  completed: 'green',
  missed: 'red',
  waived: 'yellow',
};

const parseHourValue = (input: unknown): number | null => {
  if (typeof input === 'number' && Number.isFinite(input)) {
    return input;
  }
  if (typeof input === 'string' && input.trim().length > 0) {
    const parsed = dayjs(input, ['HH:mm', 'H:mm', 'h:mm A'], true);
    if (parsed.isValid()) {
      return parsed.hour() + parsed.minute() / 60;
    }
    const numeric = Number(input);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }
  return null;
};

const normalizePriority = (value: unknown): PlannerDisplayTask['priority'] => {
  if (typeof value === 'string') {
    const normalized = value.toLowerCase();
    if (normalized === 'high' || normalized === 'low' || normalized === 'medium') {
      return normalized;
    }
  }
  return 'medium';
};

const normalizeTags = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        if (typeof entry === 'string') {
          return entry;
        }
        if (entry && typeof entry === 'object' && 'label' in entry && typeof (entry as { label?: string }).label === 'string') {
          return (entry as { label?: string }).label ?? '';
        }
        return null;
      })
      .filter((tag): tag is string => Boolean(tag));
  }
  return [];
};

const WeeklyTaskPlannerBoard = ({
  logs,
  templates,
  rangeStart,
  onSelectLog,
}: {
  logs: AssistantManagerTaskLog[];
  templates: AssistantManagerTaskTemplate[];
  rangeStart: Date | null;
  onSelectLog?: (log: AssistantManagerTaskLog) => void;
}) => {
  const templateMap = useMemo(() => new Map(templates.map((template) => [template.id, template])), [templates]);
  const weekStart = useMemo(() => dayjs(rangeStart ?? new Date()).startOf('week'), [rangeStart]);
  const days = Array.from({ length: PLANNER_DAYS }, (_, index) => weekStart.add(index, 'day'));
  const totalGridHeight = (PLANNER_END_HOUR - PLANNER_START_HOUR) * PLANNER_SLOT_HEIGHT;

  const plannerTasks = useMemo<PlannerDisplayTask[]>(() => {
    const items: PlannerDisplayTask[] = [];
    logs.forEach((log) => {
      const template = templateMap.get(log.templateId);
      const meta = (log.meta ?? {}) as AssistantManagerTaskLogMeta;
      const scheduleConfig = (template?.scheduleConfig ?? {}) as Record<string, unknown>;
      const day = dayjs(log.taskDate);
      const dayIndex = day.diff(weekStart, 'day');
      if (dayIndex < 0 || dayIndex >= PLANNER_DAYS) {
        return;
      }
      const resolvedHour =
        parseHourValue(
          meta.time ??
            meta.shiftTimeStart ??
            (scheduleConfig.time as string | undefined) ??
            (scheduleConfig.hour as string | undefined),
        ) ?? 9;
      const startHour = Math.max(PLANNER_START_HOUR, Math.min(PLANNER_END_HOUR - 1, resolvedHour));
      const durationValue =
        typeof meta.durationHours === 'number'
          ? meta.durationHours
          : Number(meta.durationHours ?? scheduleConfig.durationHours ?? 1);
      const durationHours = Number.isFinite(durationValue) && durationValue > 0 ? Math.min(durationValue, PLANNER_END_HOUR - startHour) : 1;
      const pointValue = typeof meta.points === 'number' ? meta.points : Number(meta.points ?? scheduleConfig.points ?? 1);
      const tagList =
        Array.isArray(meta.tags) && meta.tags.length > 0 ? meta.tags : normalizeTags(scheduleConfig.tags);
      const commentCount = Array.isArray(meta.comments) ? meta.comments.length : Number((meta as Record<string, unknown>).commentCount ?? 0);
      const attachmentCount = Array.isArray(meta.evidence)
        ? meta.evidence.length
        : Number((meta as Record<string, unknown>).attachments ?? (meta as Record<string, unknown>).attachmentCount ?? 0);
      const shiftTimeStart = meta.shiftTimeStart ?? null;
      const shiftTimeEnd = meta.shiftTimeEnd ?? null;
      items.push({
        id: log.id,
        templateName: log.templateName ?? template?.name ?? `Template #${log.templateId}`,
        ownerName: log.userName ?? `User #${log.userId}`,
        ownerInitials: (log.userName ?? `U${log.userId}`).split(' ').filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase(),
        dayIndex,
        startHour,
        durationHours,
        priority: normalizePriority(meta.priority ?? scheduleConfig.priority),
        points: Number.isFinite(pointValue) && pointValue >= 0 ? pointValue : 1,
        comments: Number.isFinite(commentCount) ? commentCount : 0,
        attachments: Number.isFinite(attachmentCount) ? attachmentCount : 0,
        tags: tagList,
        notes: typeof meta.notes === 'string' ? meta.notes : log.notes ?? null,
        status: log.status,
        manual: Boolean(meta.manual),
        requiresShift: meta.requireShift === undefined ? true : Boolean(meta.requireShift),
        scheduleConflict: Boolean(meta.scheduleConflict),
        onShift: meta.onShift === undefined ? true : Boolean(meta.onShift),
        offDay: Boolean(meta.offDay),
        shiftTimeStart,
        shiftTimeEnd,
        source: log,
      });
    });
    return items;
  }, [logs, templateMap, weekStart]);

  return (
    <Stack gap="xs">
      <Group justify="space-between" align="flex-start">
        <Stack gap={2}>
          <Text fw={600}>Weekly Calendar</Text>
          <Text size="sm" c="dimmed">
            Organize assistant-manager workflow by hour. Timeslots honor template metadata when available.
          </Text>
        </Stack>
        <Group gap="xs">
          {(['high', 'medium', 'low'] as PlannerDisplayTask['priority'][]).map((priority) => (
            <Badge key={priority} color={PRIORITY_META[priority].color} variant="light">
              {PRIORITY_META[priority].label}
            </Badge>
          ))}
        </Group>
      </Group>

      <Box style={{ border: '1px solid rgba(0,0,0,0.08)', borderRadius: 12, overflow: 'hidden' }}>
        <Box
          style={{
            display: 'grid',
            gridTemplateColumns: '80px repeat(7, minmax(0, 1fr))',
            backgroundColor: '#f8fafc',
            borderBottom: '1px solid rgba(0,0,0,0.08)',
          }}
        >
          <Box />
          {days.map((date) => (
            <Box key={date.toString()} style={{ padding: '8px 0', textAlign: 'center' }}>
              <Text size="sm" fw={600}>
                {date.format('ddd')}
              </Text>
              <Text size="xs" c="dimmed">
                {date.format('MMM D')}
              </Text>
            </Box>
          ))}
        </Box>
        <Box style={{ display: 'grid', gridTemplateColumns: '80px repeat(7, minmax(0, 1fr))' }}>
          <Box style={{ borderRight: '1px solid rgba(0,0,0,0.08)' }}>
            {Array.from({ length: PLANNER_END_HOUR - PLANNER_START_HOUR }, (_, index) => PLANNER_START_HOUR + index).map((hour) => (
              <Box
                key={`hour-${hour}`}
                style={{
                  height: PLANNER_SLOT_HEIGHT,
                  borderBottom: '1px solid rgba(0,0,0,0.05)',
                  display: 'flex',
                  justifyContent: 'flex-end',
                  alignItems: 'flex-start',
                  paddingRight: 8,
                  paddingTop: 4,
                }}
              >
                <Text size="xs" c="dimmed">
                  {dayjs().hour(hour).minute(0).format('h A')}
                </Text>
              </Box>
            ))}
          </Box>
          {days.map((date, columnIndex) => {
            const dayTasks = plannerTasks.filter((task) => task.dayIndex === columnIndex);
            return (
              <Box
                key={`planner-day-${date.toString()}`}
                style={{
                  position: 'relative',
                  minHeight: totalGridHeight,
                  borderRight: columnIndex === days.length - 1 ? 'none' : '1px solid rgba(0,0,0,0.08)',
                  backgroundImage:
                    'linear-gradient(transparent calc(100% - 1px), rgba(0,0,0,0.04) 1px), linear-gradient(90deg, rgba(0,0,0,0.03) 1px, transparent 1px)',
                  backgroundSize: `100% ${PLANNER_SLOT_HEIGHT}px`,
                }}
              >
                {dayTasks.map((task) => (
                  <PlannerTaskCard key={task.id} task={task} onSelect={onSelectLog ? () => onSelectLog(task.source) : undefined} />
                ))}
                {dayTasks.length === 0 && (
                  <Center style={{ position: 'absolute', inset: 0 }}>
                    <Text size="xs" c="dimmed">
                      No tasks
                    </Text>
                  </Center>
                )}
              </Box>
            );
          })}
        </Box>
      </Box>
    </Stack>
  );
};

const PlannerTaskCard = ({ task, onSelect }: { task: PlannerDisplayTask; onSelect?: () => void }) => {
  const priorityMeta = PRIORITY_META[task.priority];
  const topOffset = (task.startHour - PLANNER_START_HOUR) * PLANNER_SLOT_HEIGHT + 6;
  const height = Math.max(task.durationHours * PLANNER_SLOT_HEIGHT - 12, 48);
  const startHourInt = Math.floor(task.startHour);
  const startMinutes = Math.round((task.startHour - startHourInt) * 60);
  const startTime = dayjs().startOf('day').hour(startHourInt).minute(startMinutes);
  const endTime = startTime.add(Math.round(task.durationHours * 60), 'minute');
  const hasConflict = task.scheduleConflict || (task.requiresShift && !task.onShift);
  const formatShiftTime = (value?: string | null) => {
    if (!value) {
      return null;
    }
    const parsed = dayjs(value, ['HH:mm', 'H:mm', 'HH:mm:ss'], true);
    return parsed.isValid() ? parsed.format('h:mm A') : value;
  };

  return (
    <Card
      shadow="sm"
      padding="xs"
      radius="md"
      withBorder
      onClick={onSelect}
      style={{
        position: 'absolute',
        left: 8,
        right: 8,
        top: topOffset,
        minHeight: height,
        background: priorityMeta.accent,
        cursor: onSelect ? 'pointer' : 'default',
        border: hasConflict ? '1px solid rgba(244,63,94,0.6)' : undefined,
      }}
    >
      <Stack gap={4}>
        <Group justify="space-between" align="flex-start">
          <Stack gap={0} style={{ flex: 1 }}>
            <Group gap={6} align="center">
              <Text size="sm" fw={600}>
                {task.templateName}
              </Text>
              {task.manual && (
                <Badge size="xs" color="grape" variant="light">
                  Manual
                </Badge>
              )}
            </Group>
            <Text size="xs" c="dimmed">
              {task.ownerName}
            </Text>
          </Stack>
          <Stack gap={2} align="flex-end">
            <Badge size="xs" color={priorityMeta.color} variant="light">
              {priorityMeta.label}
            </Badge>
            <Badge size="xs" color={STATUS_COLORS[task.status]} variant="outline">
              {task.status}
            </Badge>
            {hasConflict && (
              <Badge size="xs" color="red" leftSection={<IconAlertTriangle size={12} />} variant="filled">
                Off shift
              </Badge>
            )}
          </Stack>
        </Group>
        {task.notes && (
          <Text size="xs" c="dimmed">
            {task.notes}
          </Text>
        )}
        <Group gap="xs" wrap="wrap" align="center">
          <Avatar size="sm" radius="xl">
            {task.ownerInitials}
          </Avatar>
          <Badge size="xs" leftSection={<IconBolt size={12} />} variant="outline">
            {task.points} pts
          </Badge>
          <Text size="xs" c="dimmed">
            {startTime.format('h:mm A')} - {endTime.format('h:mm A')}
          </Text>
        </Group>
        {task.shiftTimeStart && task.shiftTimeEnd && (
          <Text size="xs" c="dimmed">
            Shift {formatShiftTime(task.shiftTimeStart)} - {formatShiftTime(task.shiftTimeEnd)}
          </Text>
        )}
        {task.tags.length > 0 && (
          <Group gap={4} wrap="wrap">
            {task.tags.map((tag) => (
              <Badge key={`${task.id}-${tag}`} size="xs" variant="outline">
                {tag}
              </Badge>
            ))}
          </Group>
        )}
        <Group gap="md">
          <Group gap={4}>
            <IconMessageCircle2 size={14} />
            <Text size="xs">{task.comments}</Text>
          </Group>
          <Group gap={4}>
            <IconPaperclip size={14} />
            <Text size="xs">{task.attachments}</Text>
          </Group>
        </Group>
      </Stack>
    </Card>
  );
};
