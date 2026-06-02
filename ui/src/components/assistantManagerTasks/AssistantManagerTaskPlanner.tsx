import { type ReactNode, type WheelEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dayjs from 'dayjs';
import {
  Accordion,
  ActionIcon,
  Alert,
  Avatar,
  Badge,
  Box,
  Button,
  Card,
  Center,
  Checkbox,
  Divider,
  Group,
  Image,
  Loader,
  MultiSelect,
  Modal,
  Popover,
  Paper,
  ScrollArea,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
  ThemeIcon,
  Tooltip,
  useMantineTheme,
} from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { useMediaQuery } from '@mantine/hooks';
import { useSearchParams } from 'react-router-dom';
import axiosInstance from '../../utils/axiosInstance';
import {
  IconArrowDown,
  IconArrowUp,
  IconAdjustments,
  IconAlertTriangle,
  IconBolt,
  IconCalendar,
  IconCamera,
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconDeviceFloppy,
  IconCircleX,
  IconMessageCircle2,
  IconMinus,
  IconInfoCircle,
  IconPaperclip,
  IconPencil,
  IconPlus,
  IconRefresh,
  IconTrash,
  IconX,
} from '@tabler/icons-react';
import {
  bulkCreateAmTaskAssignments,
  clearAmTaskLogsForRange,
  createAmTaskAssignment,
  fetchAmTaskCerebroLinkOptions,
  fetchAmTaskCerebroLinkItemDetail,
  createAmTaskTemplate,
  createManualAmTaskLog,
  deleteAmTaskAssignment,
  deleteAmTaskLog,
  fetchAmTaskPushConfig,
  fetchAmTaskLogs,
  fetchAmTaskTemplates,
  generateAmTaskLogsForRange,
  previewAmTaskLogsForRange,
  removeAmTaskPushSubscription,
  saveAmTaskPushSubscription,
  syncAmTaskLogsWithTemplateConfig,
  type AmTaskCerebroLinkOptionsResponse,
  type AmTaskCerebroLinkItemDetail,
  type AmTaskCerebroLinkItemType,
  type ClearAmTaskLogsResponse,
  type GenerateAmTaskLogsResponse,
  type PreviewAmTaskLogsResponse,
  type SyncAmTaskLogsWithTemplateConfigResponse,
  uploadAmTaskEvidenceImage,
  updateAmTaskAssignment,
  updateAmTaskLogMeta,
  updateAmTaskLogStatus,
  updateAmTaskTemplate,
} from '../../actions/assistantManagerTaskActions';
import { fetchUserTypes } from '../../actions/userTypeActions';
import { useShiftRoles } from '../../api/shiftRoles';
import { useActiveUsers } from '../../api/users';
import { useConfigEntry } from '../../api/config';
import { useModuleAccess } from '../../hooks/useModuleAccess';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { compressImageFile } from '../../utils/imageCompression';
import type { ShiftRole } from '../../types/shiftRoles/ShiftRole';
import type { ServerResponse } from '../../types/general/ServerResponse';
import type {
  AssistantManagerTaskAssignment,
  AssistantManagerTaskCadence,
  AssistantManagerTaskEvidenceItem,
  AssistantManagerTaskEvidenceRule,
  AssistantManagerTaskLog,
  AssistantManagerTaskLogMeta,
  AssistantManagerTaskTemplate,
  ManualAssistantManagerTaskPayload,
  TaskLogMetaUpdatePayload,
  UploadAmTaskEvidenceImageResponse,
} from '../../types/assistantManagerTasks/AssistantManagerTask';
import type { UserType } from '../../types/userTypes/UserType';

type PlannerPriority = 'high' | 'medium' | 'low';
type PlannerDateWindowMode = 'day' | 'week' | 'custom';

type TemplateFormState = {
  name: string;
  description: string;
  category: string;
  subgroup: string;
  categoryOrder: string;
  subgroupOrder: string;
  templateOrder: string;
  cadence: AssistantManagerTaskCadence;
  scheduleConfigText: string;
  timesPerWeekPerAssignedUser: string;
  defaultTime: string;
  defaultDuration: string;
  defaultPriority: PlannerPriority;
  defaultPoints: string;
  requireShift: boolean;
  reminderMinutesBeforeStart: string;
  notifyAtStart: boolean;
  evidenceRules: EvidenceRuleDraft[];
  linkedKnowledgeEntryIds: string[];
  linkedPolicyEntryIds: string[];
  linkedQuizIds: string[];
};

type AssignmentFormState = {
  staffProfileFilter: string;
  userId: string;
  userTypeId: string;
  shiftRoleId: string;
  effectiveStart: string;
  effectiveEnd: string;
};

type ManualTaskFormState = {
  templateId: number | null;
  userId: string;
  assignmentId: string;
  taskDate: Date | null;
  time: string;
  durationHours: string;
  priority: PlannerPriority;
  points: string;
  tags: string;
  notes: string;
  comment: string;
  requireShift: boolean;
};

type LogDetailFormState = {
  taskDate: Date | null;
  time: string;
  durationHours: string;
  priority: PlannerPriority;
  points: string;
  evidenceItems: AssistantManagerTaskEvidenceItem[];
};

type EvidenceRuleDraft = {
  id: string;
  key: string;
  label: string;
  type: 'link' | 'image';
  required: boolean;
  multiple: boolean;
  minItems: string;
  maxItems: string;
  hosts: string;
  contains: string;
  regex: string;
};

type EvidenceRulePreset = {
  id: string;
  label: string;
  description: string;
  draft: Omit<EvidenceRuleDraft, 'id'>;
};

type PlannerDisplayTask = {
  id: number;
  templateName: string;
  ownerName: string;
  ownerInitials: string;
  dayIndex: number;
  startHour: number;
  endHour: number;
  durationHours: number;
  priority: PlannerPriority;
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
  column: number;
  columnCount: number;
  source: AssistantManagerTaskLog;
};

type TaskEvidenceImagePreview = {
  src: string;
  name: string;
  capturedAt: string | null;
  downloadHref: string | null;
};

type CameraCaptureState = {
  opened: boolean;
  rule: AssistantManagerTaskEvidenceRule | null;
};

const defaultTemplateFormState: TemplateFormState = {
  name: '',
  description: '',
  category: 'Assistant Manager Tasks',
  subgroup: 'General',
  categoryOrder: '100',
  subgroupOrder: '100',
  templateOrder: '100',
  cadence: 'daily',
  scheduleConfigText: '{}',
  timesPerWeekPerAssignedUser: '',
  defaultTime: '',
  defaultDuration: '',
  defaultPriority: 'medium',
  defaultPoints: '',
  requireShift: false,
  reminderMinutesBeforeStart: '',
  notifyAtStart: true,
  evidenceRules: [],
  linkedKnowledgeEntryIds: [],
  linkedPolicyEntryIds: [],
  linkedQuizIds: [],
};

const defaultAssignmentFormState: AssignmentFormState = {
  staffProfileFilter: '',
  userId: '',
  userTypeId: '',
  shiftRoleId: '',
  effectiveStart: '',
  effectiveEnd: '',
};

const STAFF_PROFILE_OPTIONS = [
  {
    value: 'volunteer:true',
    label: 'Volunteer - Lives in Accommodation',
  },
  {
    value: 'volunteer:false',
    label: "Volunteer - Doesn't Live in Accommodation",
  },
  {
    value: 'long_term:true',
    label: 'Long Term - Lives in Accommodation',
  },
  {
    value: 'long_term:false',
    label: "Long Term - Doesn't Live in Accommodation",
  },
];

const getStaffProfileFilterValue = (assignment: {
  staffType?: string | null;
  livesInAccom?: boolean | null;
}) => {
  if (
    (assignment.staffType === 'volunteer' || assignment.staffType === 'long_term') &&
    typeof assignment.livesInAccom === 'boolean'
  ) {
    return `${assignment.staffType}:${String(assignment.livesInAccom)}`;
  }
  return '';
};

const parseStaffProfileFilter = (value: string) => {
  const [staffType, livesInAccom] = value.split(':');
  if (
    (staffType === 'volunteer' || staffType === 'long_term') &&
    (livesInAccom === 'true' || livesInAccom === 'false')
  ) {
    return {
      staffType,
      livesInAccom: livesInAccom === 'true',
    };
  }
  return {
    staffType: null,
    livesInAccom: null,
  };
};

const normalizeTemplateCategory = (
  template?:
    | Pick<
        AssistantManagerTaskTemplate,
        'category' | 'subgroup' | 'categoryOrder' | 'subgroupOrder' | 'templateOrder'
      >
    | null,
) => ({
  category: template?.category?.trim() || 'Assistant Manager Tasks',
  subgroup: template?.subgroup?.trim() || 'General',
  categoryOrder: template?.categoryOrder ?? 100,
  subgroupOrder: template?.subgroupOrder ?? 100,
  templateOrder: template?.templateOrder ?? 100,
});

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

const defaultLogDetailFormState: LogDetailFormState = {
  taskDate: null,
  time: '',
  durationHours: '1',
  priority: 'medium',
  points: '1',
  evidenceItems: [],
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

const CADENCE_LABELS: Record<AssistantManagerTaskCadence, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  biweekly: 'Biweekly',
  every_two_weeks: 'Every 2 Weeks',
  monthly: 'Monthly',
};

const PRIORITY_META: Record<
  PlannerPriority,
  { label: string; color: string; accent: string; solid: string }
> = {
  high: {
    label: 'High',
    color: 'red',
    accent: 'linear-gradient(135deg, rgba(190, 24, 93, 0.12), rgba(244, 63, 94, 0.04))',
    solid: '#be123c',
  },
  medium: {
    label: 'Medium',
    color: 'yellow',
    accent: 'linear-gradient(135deg, rgba(217, 119, 6, 0.16), rgba(245, 158, 11, 0.04))',
    solid: '#b45309',
  },
  low: {
    label: 'Low',
    color: 'green',
    accent: 'linear-gradient(135deg, rgba(5, 150, 105, 0.14), rgba(16, 185, 129, 0.04))',
    solid: '#047857',
  },
};

const STATUS_COLORS: Record<AssistantManagerTaskLog['status'], string> = {
  pending: 'gray',
  completed: 'green',
  missed: 'red',
  waived: 'yellow',
};

const EVIDENCE_PREVIEW_MIN_ZOOM = 0.5;
const EVIDENCE_PREVIEW_MAX_ZOOM = 4;

const EVIDENCE_RULE_PRESETS: EvidenceRulePreset[] = [
  {
    id: 'instagram-link',
    label: 'Instagram Link',
    description: 'Require one valid Instagram URL.',
    draft: {
      key: 'instagram_link',
      label: 'Instagram link',
      type: 'link',
      required: true,
      multiple: false,
      minItems: '1',
      maxItems: '1',
      hosts: 'instagram.com, www.instagram.com, instagr.am',
      contains: 'instagram, ig',
      regex: '',
    },
  },
  {
    id: 'tiktok-link',
    label: 'TikTok Link',
    description: 'Require one valid TikTok URL.',
    draft: {
      key: 'tiktok_link',
      label: 'TikTok link',
      type: 'link',
      required: true,
      multiple: false,
      minItems: '1',
      maxItems: '1',
      hosts: 'tiktok.com, www.tiktok.com',
      contains: 'tiktok',
      regex: '',
    },
  },
  {
    id: 'facebook-link',
    label: 'Facebook Link',
    description: 'Require one valid Facebook URL.',
    draft: {
      key: 'facebook_link',
      label: 'Facebook link',
      type: 'link',
      required: true,
      multiple: false,
      minItems: '1',
      maxItems: '1',
      hosts: 'facebook.com, www.facebook.com, fb.com',
      contains: 'facebook, fb',
      regex: '',
    },
  },
  {
    id: 'drive-screenshot',
    label: 'Drive Screenshot',
    description: 'Require one uploaded screenshot as image evidence.',
    draft: {
      key: 'drive_screenshot',
      label: 'Drive screenshot',
      type: 'image',
      required: true,
      multiple: false,
      minItems: '1',
      maxItems: '1',
      hosts: '',
      contains: '',
      regex: '',
    },
  },
];

const createClientSideId = () =>
  globalThis.crypto?.randomUUID?.() ??
  `evidence-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const splitDelimitedValues = (value: string) =>
  value
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);

const normalizeEvidenceRule = (
  rule: AssistantManagerTaskEvidenceRule,
): AssistantManagerTaskEvidenceRule => {
  const match = rule.match ?? null;
  const multiple = rule.multiple === true;
  const required = rule.required !== false;
  const hosts: string[] = Array.isArray(match?.hosts) ? (match!.hosts as string[]) : [];
  const contains: string[] = Array.isArray(match?.contains) ? (match!.contains as string[]) : [];
  const minItemsValue =
    rule.minItems == null || rule.minItems === undefined ? (required ? 1 : 0) : Number(rule.minItems);
  const maxItemsValue =
    rule.maxItems == null || rule.maxItems === undefined
      ? null
      : Number(rule.maxItems);

  return {
    key: rule.key.trim(),
    label: rule.label.trim(),
    type: rule.type,
    required,
    multiple,
    minItems: Number.isInteger(minItemsValue) && minItemsValue >= 0 ? minItemsValue : required ? 1 : 0,
    maxItems:
      maxItemsValue != null && Number.isInteger(maxItemsValue) && maxItemsValue > 0
        ? maxItemsValue
        : null,
    match:
      rule.type === 'link'
        ? {
            hosts: hosts.map((entry) => entry.trim()).filter(Boolean),
            contains: contains.map((entry) => entry.trim()).filter(Boolean),
            regex: typeof match?.regex === 'string' && match.regex.trim()
              ? match.regex.trim()
              : null,
          }
        : null,
  };
};

const getTemplateEvidenceRules = (
  template?: AssistantManagerTaskTemplate | null,
): AssistantManagerTaskEvidenceRule[] => {
  const rawRules = template?.scheduleConfig?.['evidenceRules'];
  if (!Array.isArray(rawRules)) {
    return [];
  }

  return rawRules
    .map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }

      const source = entry as Partial<AssistantManagerTaskEvidenceRule>;
      if (
        typeof source.key !== 'string' ||
        !source.key.trim() ||
        typeof source.label !== 'string' ||
        !source.label.trim() ||
        (source.type !== 'link' && source.type !== 'image')
      ) {
        return null;
      }

      return normalizeEvidenceRule({
        key: source.key,
        label: source.label,
        type: source.type,
        required: source.required,
        multiple: source.multiple,
        minItems: source.minItems,
        maxItems: source.maxItems,
        match: source.match,
      });
    })
    .filter((rule): rule is AssistantManagerTaskEvidenceRule => Boolean(rule));
};

const createEvidenceRuleDraft = (
  type: 'link' | 'image' = 'link',
  overrides?: Partial<EvidenceRuleDraft>,
): EvidenceRuleDraft => ({
  id: createClientSideId(),
  key: '',
  label: '',
  type,
  required: true,
  multiple: false,
  minItems: '1',
  maxItems: '',
  hosts: '',
  contains: '',
  regex: '',
  ...overrides,
});

const getNextEvidenceRuleKey = (
  baseKey: string,
  existingRules: EvidenceRuleDraft[],
) => {
  const normalizedBaseKey = baseKey.trim() || 'evidence_rule';
  const existingKeys = new Set(existingRules.map((rule) => rule.key.trim()).filter(Boolean));
  if (!existingKeys.has(normalizedBaseKey)) {
    return normalizedBaseKey;
  }

  let suffix = 2;
  while (existingKeys.has(`${normalizedBaseKey}_${suffix}`)) {
    suffix += 1;
  }

  return `${normalizedBaseKey}_${suffix}`;
};

const buildEvidenceRuleDrafts = (template?: AssistantManagerTaskTemplate | null): EvidenceRuleDraft[] =>
  getTemplateEvidenceRules(template).map((rule) =>
    createEvidenceRuleDraft(rule.type, {
      key: rule.key,
      label: rule.label,
      required: rule.required !== false,
      multiple: rule.multiple === true,
      minItems:
        rule.minItems != null ? String(rule.minItems) : rule.required === false ? '0' : '1',
      maxItems: rule.maxItems != null ? String(rule.maxItems) : '',
      hosts: rule.type === 'link' ? (rule.match?.hosts ?? []).join(', ') : '',
      contains: rule.type === 'link' ? (rule.match?.contains ?? []).join(', ') : '',
      regex: rule.type === 'link' ? rule.match?.regex ?? '' : '',
    }),
  );

const CEREBRO_LINKS_CONFIG_KEY = 'cerebroLinks';

type TemplateCerebroLinks = {
  knowledgeEntryIds: number[];
  policyEntryIds: number[];
  quizIds: number[];
};

const normalizeNumberIdArray = (value: unknown): number[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => Number(entry))
    .filter((entry) => Number.isInteger(entry) && entry > 0);
};

const getTemplateCerebroLinks = (
  template?: AssistantManagerTaskTemplate | null,
): TemplateCerebroLinks => {
  const scheduleConfig = (template?.scheduleConfig ?? {}) as Record<string, unknown>;
  const rawConfig = scheduleConfig[CEREBRO_LINKS_CONFIG_KEY];
  if (!rawConfig || typeof rawConfig !== 'object') {
    return {
      knowledgeEntryIds: [],
      policyEntryIds: [],
      quizIds: [],
    };
  }

  const links = rawConfig as Record<string, unknown>;
  return {
    knowledgeEntryIds: normalizeNumberIdArray(links.knowledgeEntryIds ?? links.knowledgeIds),
    policyEntryIds: normalizeNumberIdArray(links.policyEntryIds ?? links.policyIds),
    quizIds: normalizeNumberIdArray(links.quizIds),
  };
};

const getAdvancedScheduleConfigText = (template?: AssistantManagerTaskTemplate | null) => {
  const nextConfig = { ...(template?.scheduleConfig ?? {}) } as Record<string, unknown>;
  delete nextConfig.time;
  delete nextConfig.hour;
  delete nextConfig.durationHours;
  delete nextConfig.priority;
  delete nextConfig.points;
  delete nextConfig.requireShift;
  delete nextConfig.requireScheduledShift;
  delete nextConfig.timesPerWeekPerAssignedUser;
  delete nextConfig.evidenceRules;
  delete nextConfig[CEREBRO_LINKS_CONFIG_KEY];
  return JSON.stringify(nextConfig, null, 2);
};

const getNormalizedEvidenceItems = (meta?: AssistantManagerTaskLogMeta | null): AssistantManagerTaskEvidenceItem[] => {
  const evidenceItems = meta?.evidenceItems;
  if (!Array.isArray(evidenceItems)) {
    return [];
  }

  return evidenceItems
    .filter((entry): entry is AssistantManagerTaskEvidenceItem => Boolean(entry && typeof entry === 'object'))
    .map((entry) => ({
      ...entry,
      id: entry.id || createClientSideId(),
      ruleKey: entry.ruleKey,
      type: entry.type,
    }));
};

const getRuleItems = (
  items: AssistantManagerTaskEvidenceItem[],
  rule: AssistantManagerTaskEvidenceRule,
) => items.filter((item) => item.ruleKey === rule.key && item.type === rule.type);

const validateEvidenceLinkValue = (
  rule: AssistantManagerTaskEvidenceRule,
  value: string,
): string | null => {
  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return null;
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(trimmedValue);
  } catch {
    return 'Enter a valid URL';
  }

  const lowerValue = trimmedValue.toLowerCase();
  const host = parsedUrl.hostname.toLowerCase();
  const hosts = rule.match?.hosts ?? [];
  const contains = rule.match?.contains ?? [];
  if (hosts.length > 0 && !hosts.some((candidate) => host === candidate.toLowerCase())) {
    return `Expected host: ${hosts.join(', ')}`;
  }
  if (contains.length > 0 && !contains.some((candidate) => lowerValue.includes(candidate.toLowerCase()))) {
    return `Expected one of: ${contains.join(', ')}`;
  }
  if (rule.match?.regex) {
    try {
      const regex = new RegExp(rule.match.regex, 'i');
      if (!regex.test(trimmedValue)) {
        return 'Link does not match the required format';
      }
    } catch {
      return 'Template has an invalid regex rule';
    }
  }
  return null;
};

const upsertLinkEvidenceItem = (
  items: AssistantManagerTaskEvidenceItem[],
  rule: AssistantManagerTaskEvidenceRule,
  index: number,
  value: string,
) => {
  const matchedItems = getRuleItems(items, rule);
  const targetItem = matchedItems[index];
  const nextValue = value.trim();

  if (!nextValue) {
    if (!targetItem) {
      return items;
    }
    return items.filter((item) => item.id !== targetItem.id);
  }

  const nextItem: AssistantManagerTaskEvidenceItem = {
    ...(targetItem ?? {
      id: createClientSideId(),
      ruleKey: rule.key,
      type: 'link',
    }),
    value: nextValue,
    valid: validateEvidenceLinkValue(rule, nextValue) == null,
  };

  if (!targetItem) {
    return [...items, nextItem];
  }

  return items.map((item) => (item.id === targetItem.id ? nextItem : item));
};

const applyUploadedEvidenceItem = (
  items: AssistantManagerTaskEvidenceItem[],
  rule: AssistantManagerTaskEvidenceRule,
  nextItem: AssistantManagerTaskEvidenceItem,
) => {
  const remainingItems = rule.multiple
    ? items
    : items.filter((item) => !(item.ruleKey === rule.key && item.type === rule.type));
  return [...remainingItems, nextItem];
};

const hasEvidenceItemContent = (item: AssistantManagerTaskEvidenceItem) => {
  if (item.type === 'link') {
    return Boolean(item.value?.trim());
  }
  return Boolean(item.fileName || item.driveWebViewLink || item.driveFileId || item.fileSize);
};

const replaceRuleItems = (
  items: AssistantManagerTaskEvidenceItem[],
  rule: AssistantManagerTaskEvidenceRule,
  nextRuleItems: AssistantManagerTaskEvidenceItem[],
) => {
  const remainingItems = items.filter((item) => !(item.ruleKey === rule.key && item.type === rule.type));
  return [...remainingItems, ...nextRuleItems];
};

const formatEvidenceFileSize = (value?: number | null) => {
  if (!value || value <= 0) {
    return null;
  }
  if (value >= 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (value >= 1024) {
    return `${Math.round(value / 1024)} KB`;
  }
  return `${value} B`;
};

const parseTaskStartDateTime = (
  log: AssistantManagerTaskLog,
  templateMap: Map<number, AssistantManagerTaskTemplate>,
) => {
  const template = templateMap.get(log.templateId);
  const scheduleConfig = (template?.scheduleConfig ?? {}) as Record<string, unknown>;
  const meta = (log.meta ?? {}) as AssistantManagerTaskLogMeta;
  const rawTime =
    typeof meta.time === 'string' && meta.time.trim()
      ? meta.time.trim()
      : typeof meta.shiftTimeStart === 'string' && meta.shiftTimeStart.trim()
        ? meta.shiftTimeStart.trim()
        : typeof scheduleConfig.time === 'string' && scheduleConfig.time.trim()
          ? scheduleConfig.time.trim()
          : typeof scheduleConfig.hour === 'string' && scheduleConfig.hour.trim()
            ? scheduleConfig.hour.trim()
            : '';

  if (!rawTime) {
    return null;
  }

  const parsedTime = dayjs(rawTime, TIME_INPUT_FORMATS, true);
  if (!parsedTime.isValid()) {
    return null;
  }

  const parsedDate = dayjs(log.taskDate);
  if (!parsedDate.isValid()) {
    return null;
  }

  return parsedDate
    .hour(parsedTime.hour())
    .minute(parsedTime.minute())
    .second(0)
    .millisecond(0);
};

const getTaskNotificationEventKey = (
  logId: number,
  eventType: 'reminder' | 'start',
  eventTimestamp: number,
) => `am-task-notification:${logId}:${eventType}:${eventTimestamp}`;

const hasTaskNotificationEventBeenShown = (eventKey: string) => {
  if (typeof window === 'undefined') {
    return false;
  }
  try {
    return window.localStorage.getItem(eventKey) != null;
  } catch {
    return false;
  }
};

const markTaskNotificationEventShown = (eventKey: string) => {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(eventKey, dayjs().toISOString());
  } catch {
    // Ignore localStorage errors and keep runtime notification flow alive.
  }
};

const getErrorMessage = (error: unknown, fallback: string) => {
  if (typeof error === 'string' && error.trim()) {
    return error.trim();
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  if (
    error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof (error as { message?: unknown }).message === 'string'
  ) {
    const message = ((error as { message: string }).message ?? '').trim();
    if (message) {
      return message;
    }
  }
  return fallback;
};

const GLOBAL_TASK_VIEWER_ROLES = new Set(['admin', 'owner', 'manager']);

const normalizeRoleSlug = (value?: string | null): string | null => {
  if (!value) {
    return null;
  }
  const trimmed = value.trim().toLowerCase();
  const withHyphens = trimmed.replace(/[\s_]+/g, '-');
  const collapsed = withHyphens.replace(/-/g, '');

  if (collapsed === 'administrator') {
    return 'admin';
  }
  if (collapsed === 'assistantmanager' || collapsed === 'assistmanager') {
    return 'assistant-manager';
  }
  if (collapsed === 'mgr' || collapsed === 'manager') {
    return 'manager';
  }

  return withHyphens;
};

const PLANNER_START_HOUR = 6;
const PLANNER_END_HOUR = 22;
const PLANNER_SLOT_HEIGHT = 56;
const DEFAULT_PLANNER_DAYS = 7;
const TIME_INPUT_FORMATS = ['HH:mm', 'H:mm', 'HH:mm:ss', 'h:mm A', 'h A'];

const decodeBase64UrlToArrayBuffer = (value: string): ArrayBuffer => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = window.atob(padded);
  const buffer = new ArrayBuffer(binary.length);
  const output = new Uint8Array(buffer);
  for (let index = 0; index < binary.length; index += 1) {
    output[index] = binary.charCodeAt(index);
  }
  return buffer;
};

const startOfPlannerWeek = (value: Date | string | dayjs.Dayjs) => {
  const date = dayjs(value);
  const dayOfWeek = date.day();
  const offset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  return date.startOf('day').subtract(offset, 'day');
};

const buildLogDetailFormStateFromLog = (log: AssistantManagerTaskLog): LogDetailFormState => {
  const meta = log.meta ?? {};
  const priority =
    typeof meta.priority === 'string' &&
    (meta.priority === 'high' || meta.priority === 'medium' || meta.priority === 'low')
      ? (meta.priority as PlannerPriority)
      : 'medium';

  return {
    taskDate: log.taskDate ? dayjs(log.taskDate).toDate() : null,
    time: typeof meta.time === 'string' ? meta.time : '',
    durationHours: meta.durationHours != null ? String(meta.durationHours) : '1',
    priority,
    points: meta.points != null ? String(meta.points) : '1',
    evidenceItems: getNormalizedEvidenceItems(meta),
  };
};

const getLogPoints = (
  log: AssistantManagerTaskLog,
  templateMap: Map<number, AssistantManagerTaskTemplate>,
): number => {
  const template = templateMap.get(log.templateId);
  const meta = (log.meta ?? {}) as AssistantManagerTaskLogMeta;
  const scheduleConfig = (template?.scheduleConfig ?? {}) as Record<string, unknown>;
  const pointsValue =
    typeof meta.points === 'number'
      ? meta.points
      : Number(meta.points ?? scheduleConfig.points ?? resolveTemplateDefaults(template).points ?? 1);

  if (!Number.isFinite(pointsValue) || pointsValue < 0) {
    return 1;
  }

  return pointsValue;
};

const formatTaskDetailTimeRange = (time: string, durationHours: string) => {
  const trimmedTime = time.trim();
  if (!trimmedTime) {
    return 'Not set';
  }

  const parsedTime = dayjs(trimmedTime, ['HH:mm', 'H:mm', 'HH:mm:ss', 'h:mm A'], true);
  const parsedDuration = Number(durationHours);

  if (!parsedTime.isValid() || !Number.isFinite(parsedDuration) || parsedDuration <= 0) {
    return trimmedTime;
  }

  const endTime = parsedTime.add(parsedDuration, 'hour');
  return `${parsedTime.format('HH:mm')} to ${endTime.format('HH:mm')} (${durationHours}h)`;
};

const parseHourValue = (input: unknown): number | null => {
  if (typeof input === 'number' && Number.isFinite(input)) {
    return input;
  }

  if (typeof input === 'string' && input.trim()) {
    const parsed = dayjs(input, ['HH:mm', 'H:mm', 'HH:mm:ss', 'h:mm A'], true);
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

const normalizePriority = (value: unknown): PlannerPriority => {
  if (typeof value === 'string') {
    const normalized = value.toLowerCase();
    if (normalized === 'high' || normalized === 'medium' || normalized === 'low') {
      return normalized;
    }
  }
  return 'medium';
};

const normalizeTags = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (typeof entry === 'string') {
        return entry;
      }

      if (
        entry &&
        typeof entry === 'object' &&
        'label' in entry &&
        typeof (entry as { label?: string }).label === 'string'
      ) {
        return (entry as { label?: string }).label ?? '';
      }

      return null;
    })
    .filter((tag): tag is string => Boolean(tag));
};

const resolveTemplateDefaults = (template?: AssistantManagerTaskTemplate | null) => {
  const config = (template?.scheduleConfig ?? {}) as Record<string, unknown>;
  const timeValue =
    typeof config.time === 'string'
      ? config.time
      : typeof config.hour === 'string'
        ? config.hour
        : null;
  const durationValue =
    typeof config.durationHours === 'number'
      ? config.durationHours
      : Number(config.durationHours ?? NaN);
  const pointsValue =
    typeof config.points === 'number' ? config.points : Number(config.points ?? NaN);
  const timesPerWeekPerAssignedUserValue =
    typeof config.timesPerWeekPerAssignedUser === 'number'
      ? config.timesPerWeekPerAssignedUser
      : Number(config.timesPerWeekPerAssignedUser ?? NaN);
  const reminderMinutesBeforeStartValue =
    typeof config.reminderMinutesBeforeStart === 'number'
      ? config.reminderMinutesBeforeStart
      : Number(config.reminderMinutesBeforeStart ?? NaN);

  return {
    time: timeValue,
    durationHours: Number.isFinite(durationValue) ? durationValue : null,
    points: Number.isFinite(pointsValue) ? pointsValue : null,
    timesPerWeekPerAssignedUser: Number.isInteger(timesPerWeekPerAssignedUserValue) &&
      timesPerWeekPerAssignedUserValue > 0
      ? timesPerWeekPerAssignedUserValue
      : null,
    reminderMinutesBeforeStart:
      Number.isInteger(reminderMinutesBeforeStartValue) &&
      reminderMinutesBeforeStartValue > 0
        ? reminderMinutesBeforeStartValue
        : null,
    notifyAtStart: config.notifyAtStart !== false,
    priority: normalizePriority(config.priority),
    requireShift:
      config.requireShift === true || config.requireScheduledShift === true,
    tags: normalizeTags(config.tags),
  };
};

const getScheduleWindowFromConfig = (scheduleConfig: Record<string, unknown>) => {
  const timeValue =
    typeof scheduleConfig.time === 'string'
      ? scheduleConfig.time
      : typeof scheduleConfig.hour === 'string'
        ? scheduleConfig.hour
        : null;
  const durationValue =
    typeof scheduleConfig.durationHours === 'number'
      ? scheduleConfig.durationHours
      : Number(scheduleConfig.durationHours ?? NaN);

  if (!timeValue || !Number.isFinite(durationValue) || durationValue <= 0) {
    return null;
  }

  const parsed = dayjs(timeValue, ['HH:mm', 'H:mm', 'HH:mm:ss', 'h:mm A'], true);
  if (!parsed.isValid()) {
    return null;
  }

  const startMinutes = parsed.hour() * 60 + parsed.minute();
  const endMinutes = startMinutes + Math.round(durationValue * 60);

  return {
    startMinutes,
    endMinutes,
  };
};

const scheduleWindowsOverlap = (
  left: ReturnType<typeof getScheduleWindowFromConfig>,
  right: ReturnType<typeof getScheduleWindowFromConfig>,
) => {
  if (!left || !right) {
    return false;
  }

  return left.startMinutes < right.endMinutes && right.startMinutes < left.endMinutes;
};

const normalizeDaysOfWeek = (value: unknown, fallback: number[]) => {
  if (!Array.isArray(value)) {
    return fallback;
  }

  const normalized = value
    .map((entry) => Number(entry))
    .filter((entry) => Number.isInteger(entry) && entry >= 0 && entry <= 6);

  return normalized.length > 0 ? normalized : fallback;
};

const enumerateTemplateDatesForCadence = (
  template: Pick<AssistantManagerTaskTemplate, 'cadence' | 'scheduleConfig'>,
  rangeStart: dayjs.Dayjs,
  rangeEnd: dayjs.Dayjs,
) => {
  const config = template.scheduleConfig ?? {};
  const dates: string[] = [];
  const windowStart = rangeStart.startOf('day');
  const windowEnd = rangeEnd.endOf('day');

  const pushDate = (date: dayjs.Dayjs) => {
    if (!date.isBefore(windowStart, 'day') && !date.isAfter(windowEnd, 'day')) {
      dates.push(date.format('YYYY-MM-DD'));
    }
  };

  if (template.cadence === 'daily') {
    let cursor = windowStart.clone();
    while (!cursor.isAfter(windowEnd, 'day')) {
      pushDate(cursor);
      cursor = cursor.add(1, 'day');
    }
    return dates;
  }

  if (template.cadence === 'weekly') {
    const daysOfWeek = normalizeDaysOfWeek(config.daysOfWeek, [windowStart.day()]);
    let cursor = windowStart.clone();
    while (!cursor.isAfter(windowEnd, 'day')) {
      if (daysOfWeek.includes(cursor.day())) {
        pushDate(cursor);
      }
      cursor = cursor.add(1, 'day');
    }
    return dates;
  }

  if (template.cadence === 'biweekly') {
    const daysOfWeek = normalizeDaysOfWeek(config.daysOfWeek, [1, 4]);
    let cursor = windowStart.clone();
    while (!cursor.isAfter(windowEnd, 'day')) {
      if (daysOfWeek.includes(cursor.day())) {
        pushDate(cursor);
      }
      cursor = cursor.add(1, 'day');
    }
    return dates;
  }

  if (template.cadence === 'every_two_weeks') {
    let cursor = windowStart.clone();
    while (!cursor.isAfter(windowEnd, 'day')) {
      pushDate(cursor);
      cursor = cursor.add(14, 'day');
    }
    return dates;
  }

  const dayOfMonthRaw = Number(config.dayOfMonth ?? 1);
  const dayOfMonth = Number.isInteger(dayOfMonthRaw) && dayOfMonthRaw > 0 ? dayOfMonthRaw : 1;
  let cursor = windowStart.clone().date(Math.min(dayOfMonth, windowStart.daysInMonth()));
  if (cursor.isBefore(windowStart, 'day')) {
    cursor = cursor.add(1, 'month').date(Math.min(dayOfMonth, cursor.daysInMonth()));
  }
  while (!cursor.isAfter(windowEnd, 'day')) {
    pushDate(cursor);
    cursor = cursor.add(1, 'month').date(Math.min(dayOfMonth, cursor.daysInMonth()));
  }

  return dates;
};

const templatesCanOccurOnSameDay = (
  left: Pick<AssistantManagerTaskTemplate, 'cadence' | 'scheduleConfig'>,
  right: Pick<AssistantManagerTaskTemplate, 'cadence' | 'scheduleConfig'>,
) => {
  const rangeStart = dayjs().startOf('day');
  const rangeEnd = rangeStart.clone().add(400, 'day').endOf('day');
  const leftDates = enumerateTemplateDatesForCadence(left, rangeStart, rangeEnd);
  if (leftDates.length === 0) {
    return false;
  }

  const rightDates = new Set(enumerateTemplateDatesForCadence(right, rangeStart, rangeEnd));
  return leftDates.some((date) => rightDates.has(date));
};

const findTemplateTimingConflict = ({
  candidateTemplate,
  templates,
  excludeTemplateId,
}: {
  candidateTemplate: AssistantManagerTaskTemplate;
  templates: AssistantManagerTaskTemplate[];
  excludeTemplateId?: number | null;
}) => {
  if (candidateTemplate.isActive === false) {
    return null;
  }

  const candidateWindow = getScheduleWindowFromConfig(candidateTemplate.scheduleConfig ?? {});
  if (!candidateWindow) {
    return null;
  }

  for (const existingTemplate of templates) {
    if (existingTemplate.isActive === false) {
      continue;
    }
    if (excludeTemplateId && existingTemplate.id === excludeTemplateId) {
      continue;
    }
    if (!templatesCanOccurOnSameDay(candidateTemplate, existingTemplate)) {
      continue;
    }

    const existingWindow = getScheduleWindowFromConfig(existingTemplate.scheduleConfig ?? {});
    if (!scheduleWindowsOverlap(candidateWindow, existingWindow)) {
      continue;
    }

    return `Schedule conflict: "${candidateTemplate.name}" overlaps with "${existingTemplate.name}". Choose a different start time or duration.`;
  }

  return null;
};

const formatTimeValue = (value?: string | null) => {
  if (!value) {
    return null;
  }

  const parsed = dayjs(value, ['HH:mm', 'H:mm', 'HH:mm:ss', 'h:mm A'], true);
  return parsed.isValid() ? parsed.format('h:mm A') : value;
};

const getLogStartHour = (
  log: AssistantManagerTaskLog,
  templateMap: Map<number, AssistantManagerTaskTemplate>,
) => {
  const template = templateMap.get(log.templateId);
  const scheduleConfig = (template?.scheduleConfig ?? {}) as Record<string, unknown>;
  const meta = (log.meta ?? {}) as AssistantManagerTaskLogMeta;

  return (
    parseHourValue(
      meta.time ??
        meta.shiftTimeStart ??
        (scheduleConfig.time as string | undefined) ??
        (scheduleConfig.hour as string | undefined),
    ) ?? 9
  );
};

const compareLogsByTime = (
  left: AssistantManagerTaskLog,
  right: AssistantManagerTaskLog,
  templateMap: Map<number, AssistantManagerTaskTemplate>,
) => {
  const dateCompare = dayjs(left.taskDate).valueOf() - dayjs(right.taskDate).valueOf();
  if (dateCompare !== 0) {
    return dateCompare;
  }

  const startCompare = getLogStartHour(left, templateMap) - getLogStartHour(right, templateMap);
  if (startCompare !== 0) {
    return startCompare;
  }

  return left.id - right.id;
};

const buildPlannerTasks = ({
  logs,
  templateMap,
  rangeStart,
  dayCount,
}: {
  logs: AssistantManagerTaskLog[];
  templateMap: Map<number, AssistantManagerTaskTemplate>;
  rangeStart: dayjs.Dayjs;
  dayCount: number;
}) => {
  const baseTasks: PlannerDisplayTask[] = [];

  logs.forEach((log) => {
    const template = templateMap.get(log.templateId);
    const meta = (log.meta ?? {}) as AssistantManagerTaskLogMeta;
    const scheduleConfig = (template?.scheduleConfig ?? {}) as Record<string, unknown>;
    const day = dayjs(log.taskDate);
    const dayIndex = day.diff(rangeStart, 'day');

    if (dayIndex < 0 || dayIndex >= dayCount) {
      return;
    }

    const resolvedHour = getLogStartHour(log, templateMap);
    const startHour = Math.max(
      PLANNER_START_HOUR,
      Math.min(PLANNER_END_HOUR - 0.5, resolvedHour),
    );
    const durationValue =
      typeof meta.durationHours === 'number'
        ? meta.durationHours
        : Number(meta.durationHours ?? scheduleConfig.durationHours ?? 1);
    const durationHours =
      Number.isFinite(durationValue) && durationValue > 0
        ? Math.min(durationValue, PLANNER_END_HOUR - startHour)
        : 1;
    const pointValue =
      typeof meta.points === 'number'
        ? meta.points
        : Number(meta.points ?? scheduleConfig.points ?? 1);
    const tagList =
      Array.isArray(meta.tags) && meta.tags.length > 0
        ? meta.tags
        : normalizeTags(scheduleConfig.tags);
    const commentCount = Array.isArray(meta.comments)
      ? meta.comments.length
      : Number((meta as Record<string, unknown>).commentCount ?? 0);
    const attachmentCount = Array.isArray(meta.evidence)
      ? meta.evidence.length
      : Number(
          (meta as Record<string, unknown>).attachments ??
            (meta as Record<string, unknown>).attachmentCount ??
            0,
        );

    baseTasks.push({
      id: log.id,
      templateName:
        log.templateName ?? template?.name ?? `Template #${log.templateId}`,
      ownerName: log.userName ?? `User #${log.userId}`,
      ownerInitials: (log.userName ?? `U${log.userId}`)
        .split(' ')
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0])
        .join('')
        .toUpperCase(),
      dayIndex,
      startHour,
      endHour: startHour + durationHours,
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
      shiftTimeStart: meta.shiftTimeStart ?? null,
      shiftTimeEnd: meta.shiftTimeEnd ?? null,
      column: 0,
      columnCount: 1,
      source: log,
    });
  });

  const tasksByDay = Array.from({ length: dayCount }, (_, dayIndex) =>
    baseTasks
      .filter((task) => task.dayIndex === dayIndex)
      .sort((left, right) =>
        left.startHour === right.startHour ? left.id - right.id : left.startHour - right.startHour,
      ),
  );

  tasksByDay.forEach((dayTasks) => {
    const active: PlannerDisplayTask[] = [];
    let cluster: PlannerDisplayTask[] = [];

    const finalizeCluster = () => {
      if (cluster.length === 0) {
        return;
      }

      const columnCount =
        cluster.reduce((max, task) => Math.max(max, task.column), 0) + 1;
      cluster.forEach((task) => {
        task.columnCount = columnCount;
      });
      cluster = [];
    };

    dayTasks.forEach((task) => {
      for (let index = active.length - 1; index >= 0; index -= 1) {
        if (active[index].endHour <= task.startHour) {
          active.splice(index, 1);
        }
      }

      if (active.length === 0) {
        finalizeCluster();
      }

      const usedColumns = new Set(active.map((entry) => entry.column));
      let column = 0;
      while (usedColumns.has(column)) {
        column += 1;
      }

      task.column = column;
      active.push(task);
      cluster.push(task);
    });

    finalizeCluster();
  });

  return baseTasks;
};

const formatTaskTimeRange = (task: PlannerDisplayTask) => {
  const startHourInt = Math.floor(task.startHour);
  const startMinutes = Math.round((task.startHour - startHourInt) * 60);
  const startTime = dayjs().startOf('day').hour(startHourInt).minute(startMinutes);
  const endTime = startTime.add(Math.round(task.durationHours * 60), 'minute');

  return `${startTime.format('h:mm A')} - ${endTime.format('h:mm A')}`;
};

const getAssignmentScopeMeta = (assignment: AssistantManagerTaskAssignment) => {
  const filters: Array<{ color: string; label: string }> = [];

  if (assignment.userId) {
    filters.push({
      color: 'teal',
      label: assignment.userName ?? `User #${assignment.userId}`,
    });
  }

  if (assignment.userTypeId) {
    filters.push({
      color: 'cyan',
      label: assignment.userTypeName ?? `User type #${assignment.userTypeId}`,
    });
  }

  if (assignment.shiftRoleId) {
    filters.push({
      color: 'violet',
      label: assignment.shiftRoleName ?? `Shift role #${assignment.shiftRoleId}`,
    });
  }

  if (assignment.staffType) {
    const matchedOption = STAFF_PROFILE_OPTIONS.find(
      (option) => option.value === getStaffProfileFilterValue(assignment),
    );
    filters.push({
      color: 'indigo',
      label:
        matchedOption?.label ??
        (assignment.livesInAccom == null
          ? assignment.staffType
          : `${assignment.staffType} - ${assignment.livesInAccom ? 'Lives in Accommodation' : "Doesn't Live in Accommodation"}`),
    });
  }

  if (filters.length > 0) {
    return filters;
  }

  if (assignment.targetScope === 'user') {
    return [{ color: 'teal', label: 'Specific user' }];
  }
  if (assignment.targetScope === 'user_type') {
    return [{ color: 'cyan', label: 'User type' }];
  }
  if (assignment.targetScope === 'shift_role') {
    return [{ color: 'violet', label: 'Shift role' }];
  }
  return [{ color: 'indigo', label: 'Staff type' }];
};

const PlannerStatCard = ({
  label,
  value,
  icon,
  accent,
}: {
  label: string;
  value: string;
  icon: ReactNode;
  accent: string;
}) => (
  <Paper
    withBorder
    radius="xl"
    p="sm"
    style={{
      height: '100%',
      background: accent,
      borderColor: 'rgba(15, 23, 42, 0.08)',
    }}
  >
    <Box
      style={{
        position: 'relative',
        minHeight: 56,
        height: '100%',
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        paddingLeft: 44,
        paddingRight: 44,
      }}
    >
      <Stack gap={2} align="center" justify="center" style={{ width: '100%' }}>
        <Text size="xs" tt="uppercase" fw={700} c="dimmed">
          {label}
        </Text>
        <Text fz={24} fw={700} lh={1}>
          {value}
        </Text>
      </Stack>
      <ThemeIcon
        size={38}
        radius="xl"
        variant="light"
        color="dark"
        style={{
          position: 'absolute',
          top: '50%',
          right: 0,
          transform: 'translateY(-50%)',
          backgroundColor: 'rgba(15, 23, 42, 0.07)',
          color: '#0f172a',
        }}
      >
        {icon}
      </ThemeIcon>
    </Box>
  </Paper>
);

const PlannerCompletionByOwnerCard = ({
  value,
}: {
  value: string;
}) => (
  <Paper
    withBorder
    radius="xl"
    p="sm"
    style={{
      height: '100%',
      background: 'linear-gradient(180deg, rgba(254, 226, 226, 0.9) 0%, rgba(255, 255, 255, 1) 100%)',
      borderColor: 'rgba(15, 23, 42, 0.08)',
    }}
  >
    <Box
      style={{
        position: 'relative',
        minHeight: 56,
        height: '100%',
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        paddingLeft: 44,
        paddingRight: 44,
      }}
    >
      <Stack gap={2} align="center" justify="center" style={{ width: '100%' }}>
        <Text size="xs" tt="uppercase" fw={700} c="dimmed">
          Progress
        </Text>
        <Text fz={24} fw={700} lh={1}>
          {value}
        </Text>
      </Stack>
      <ThemeIcon
        size={38}
        radius="xl"
        variant="light"
        color="dark"
        style={{
          position: 'absolute',
          top: '50%',
          right: 0,
          transform: 'translateY(-50%)',
          backgroundColor: 'rgba(15, 23, 42, 0.07)',
          color: '#0f172a',
        }}
      >
        <IconBolt size={20} />
      </ThemeIcon>
    </Box>
  </Paper>
);

const PlannerActionsCard = ({
  onGenerate,
  onClear,
  generateLoading,
  clearLoading,
}: {
  onGenerate: () => void;
  onClear: () => void;
  generateLoading: boolean;
  clearLoading: boolean;
}) => (
  <Paper
    withBorder
    radius="xl"
    p="sm"
    style={{
      height: '100%',
      background: 'linear-gradient(180deg, rgba(239, 246, 255, 0.88) 0%, rgba(255, 255, 255, 1) 100%)',
      borderColor: 'rgba(15, 23, 42, 0.08)',
    }}
  >
    <Stack gap="xs" align="center" justify="center" style={{ height: '100%' }} ta="center">
      <Button
        variant="light"
        leftSection={<IconBolt size={16} />}
        radius="xl"
        fullWidth
        loading={generateLoading}
        onClick={onGenerate}
      >
        Generate Week
      </Button>
      <Button
        variant="light"
        color="red"
        leftSection={<IconCircleX size={16} />}
        radius="xl"
        fullWidth
        loading={clearLoading}
        onClick={onClear}
      >
        Clear Week
      </Button>
    </Stack>
  </Paper>
);

const EmptyPlannerState = ({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) => (
  <Paper
    withBorder
    radius="xl"
    p="xl"
    style={{ background: 'linear-gradient(180deg, #f8fafc 0%, #ffffff 100%)' }}
  >
    <Stack gap="sm" align="center">
      <ThemeIcon
        size={48}
        radius="xl"
        variant="light"
        color="gray"
        style={{ backgroundColor: '#e2e8f0', color: '#334155' }}
      >
        <IconCalendar size={24} />
      </ThemeIcon>
      <Stack gap={2} align="center">
        <Text fw={700}>{title}</Text>
        <Text size="sm" c="dimmed" ta="center" maw={420}>
          {description}
        </Text>
      </Stack>
      {action}
    </Stack>
  </Paper>
);

const SetupTemplateCard = ({
  template,
  canManage,
  selected,
  canMoveUp,
  canMoveDown,
  reorderDisabled,
  reorderLoading,
  onAssign,
  onEdit,
  onMoveUp,
  onMoveDown,
  onUpdateExistingTasks,
  onToggleSelected,
  onEditAssignment,
  onDeleteAssignment,
}: {
  template: AssistantManagerTaskTemplate;
  canManage: boolean;
  selected: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  reorderDisabled: boolean;
  reorderLoading: 'up' | 'down' | null;
  onAssign: (template: AssistantManagerTaskTemplate) => void;
  onEdit: (template: AssistantManagerTaskTemplate) => void;
  onMoveUp: (template: AssistantManagerTaskTemplate) => void;
  onMoveDown: (template: AssistantManagerTaskTemplate) => void;
  onUpdateExistingTasks: (template: AssistantManagerTaskTemplate) => void;
  onToggleSelected: (templateId: number, checked: boolean) => void;
  onEditAssignment: (
    template: AssistantManagerTaskTemplate,
    assignment: AssistantManagerTaskAssignment,
  ) => void;
  onDeleteAssignment: (templateId: number, assignmentId: number) => void;
}) => {
  const defaults = resolveTemplateDefaults(template);
  const assignmentCount = template.assignments?.length ?? 0;

  return (
    <Paper withBorder radius="xl" p="md" style={{ height: '100%' }}>
      <Stack gap="md" style={{ height: '100%' }}>
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <Stack gap={6} style={{ flex: 1 }}>
            <Group gap="xs" wrap="wrap">
              {canManage && (
                <Checkbox
                  checked={selected}
                  onChange={(event) => onToggleSelected(template.id, event.currentTarget.checked)}
                  aria-label={`Select ${template.name}`}
                />
              )}
              <Text fw={700}>{template.name}</Text>
              <Badge color="dark" variant="outline">
                {normalizeTemplateCategory(template).subgroup}
              </Badge>
              <Badge color="blue" variant="light">
                {CADENCE_LABELS[template.cadence]}
              </Badge>
              <Badge variant="outline">
                {assignmentCount} assignment{assignmentCount === 1 ? '' : 's'}
              </Badge>
              {defaults.requireShift && (
                <Badge color="orange" variant="light">
                  Shift-aware
                </Badge>
              )}
            </Group>
            <Text size="sm" c="dimmed">
              {template.description?.trim() || 'No description added yet.'}
            </Text>
          </Stack>
          {canManage && (
            <Group gap={6}>
              <Tooltip label="Move template up">
                <ActionIcon
                  variant="light"
                  disabled={!canMoveUp || reorderDisabled}
                  loading={reorderLoading === 'up'}
                  onClick={() => onMoveUp(template)}
                >
                  <IconArrowUp size={16} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label="Move template down">
                <ActionIcon
                  variant="light"
                  disabled={!canMoveDown || reorderDisabled}
                  loading={reorderLoading === 'down'}
                  onClick={() => onMoveDown(template)}
                >
                  <IconArrowDown size={16} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label="Assign template">
                <ActionIcon variant="light" color="blue" onClick={() => onAssign(template)}>
                  <IconPlus size={16} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label="Update existing tasks">
                <ActionIcon
                  variant="light"
                  color="teal"
                  onClick={() => onUpdateExistingTasks(template)}
                >
                  <IconRefresh size={16} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label="Edit template">
                <ActionIcon variant="light" onClick={() => onEdit(template)}>
                  <IconPencil size={16} />
                </ActionIcon>
              </Tooltip>
            </Group>
          )}
        </Group>

        <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
          <Paper withBorder radius="lg" p="sm" bg="gray.0">
            <Text size="xs" c="dimmed">
              Start
            </Text>
            <Text fw={600}>{formatTimeValue(defaults.time) ?? 'Flexible'}</Text>
          </Paper>
          <Paper withBorder radius="lg" p="sm" bg="gray.0">
            <Text size="xs" c="dimmed">
              Duration
            </Text>
            <Text fw={600}>
              {defaults.durationHours != null ? `${defaults.durationHours}h` : 'Default'}
            </Text>
          </Paper>
          <Paper withBorder radius="lg" p="sm" bg="gray.0">
            <Text size="xs" c="dimmed">
              Priority
            </Text>
            <Text fw={600}>{PRIORITY_META[defaults.priority].label}</Text>
          </Paper>
          <Paper withBorder radius="lg" p="sm" bg="gray.0">
            <Text size="xs" c="dimmed">
              Points
            </Text>
            <Text fw={600}>{defaults.points ?? 1}</Text>
          </Paper>
        </SimpleGrid>

        {defaults.tags.length > 0 && (
          <Group gap={6} wrap="wrap">
            {defaults.tags.map((tag) => (
              <Badge key={`${template.id}-${tag}`} variant="outline">
                {tag}
              </Badge>
            ))}
          </Group>
        )}

        <Divider />

        <Stack gap="xs">
          <Group justify="space-between">
            <Text fw={600}>Assignments</Text>
            <Text size="sm" c="dimmed">
              Applies to
            </Text>
          </Group>

          {template.assignments && template.assignments.length > 0 ? (
            template.assignments.map((assignment) => {
              const scopeMeta = getAssignmentScopeMeta(assignment);
              return (
                <Paper
                  key={assignment.id}
                  withBorder
                  radius="lg"
                  p="sm"
                  bg={assignment.isActive ? '#f8fafc' : '#fff7ed'}
                >
                  <Group justify="space-between" align="flex-start" wrap="nowrap">
                    <Stack gap={4} style={{ flex: 1 }}>
                      <Group gap="xs" wrap="wrap">
                        {scopeMeta.map((entry) => (
                          <Badge key={`${assignment.id}-${entry.color}-${entry.label}`} variant="light" color={entry.color}>
                            {entry.label}
                          </Badge>
                        ))}
                        {scopeMeta.length > 1 && (
                          <Badge variant="outline" color="dark">
                            Match all
                          </Badge>
                        )}
                      </Group>
                      <Text size="xs" c="dimmed">
                        {assignment.effectiveStart || 'Immediate'} to{' '}
                        {assignment.effectiveEnd || 'Open ended'}
                      </Text>
                    </Stack>
                    {canManage && (
                      <Group gap={6}>
                        <Tooltip label="Edit assignment">
                          <ActionIcon
                            variant="light"
                            onClick={() => onEditAssignment(template, assignment)}
                          >
                            <IconPencil size={16} />
                          </ActionIcon>
                        </Tooltip>
                        <Tooltip label="Delete assignment">
                          <ActionIcon
                            variant="light"
                            color="red"
                            onClick={() => onDeleteAssignment(template.id, assignment.id)}
                          >
                            <IconCircleX size={16} />
                          </ActionIcon>
                        </Tooltip>
                      </Group>
                    )}
                  </Group>
                </Paper>
              );
            })
          ) : (
            <Text size="sm" c="dimmed">
              No assignments yet. Add one to make this template available to staff.
            </Text>
          )}
        </Stack>
      </Stack>
    </Paper>
  );
};

const PlannerTaskCard = ({
  task,
  onSelect,
  canDelete,
  deleting,
  onDelete,
}: {
  task: PlannerDisplayTask;
  onSelect?: () => void;
  canDelete?: boolean;
  deleting?: boolean;
  onDelete?: (task: PlannerDisplayTask) => void;
}) => {
  const priorityMeta = PRIORITY_META[task.priority];
  const topOffset = (task.startHour - PLANNER_START_HOUR) * PLANNER_SLOT_HEIGHT + 6;
  const height = Math.max(task.durationHours * PLANNER_SLOT_HEIGHT - 12, 52);
  const hasConflict = task.scheduleConflict || (task.requiresShift && !task.onShift);
  const laneWidth = 100 / task.columnCount;

  return (
    <Card
      shadow="sm"
      padding="xs"
      radius="lg"
      withBorder
      onClick={onSelect}
      style={{
        position: 'absolute',
        top: topOffset,
        left: `calc(${laneWidth * task.column}% + 8px)`,
        width:
          task.columnCount === 1
            ? 'calc(100% - 16px)'
            : `calc(${laneWidth}% - 12px)`,
        minHeight: height,
        background: priorityMeta.accent,
        cursor: onSelect ? 'pointer' : 'default',
        borderColor: hasConflict ? 'rgba(190, 24, 93, 0.45)' : 'rgba(15, 23, 42, 0.08)',
        boxShadow: '0 10px 24px rgba(15, 23, 42, 0.08)',
      }}
    >
      <Stack gap={6}>
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <Stack gap={2} style={{ flex: 1 }}>
            <Group gap={6} wrap="wrap">
              <Text size="sm" fw={700} lineClamp={2}>
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
          <Stack gap={4} align="flex-end">
            <Badge size="xs" color={priorityMeta.color} variant="light">
              {priorityMeta.label}
            </Badge>
            <Group gap={6} align="center" wrap="nowrap">
              <Badge size="xs" color={STATUS_COLORS[task.status]} variant="outline">
                {task.status}
              </Badge>
              {canDelete && onDelete && (
                <Tooltip label="Delete task">
                  <ActionIcon
                    size="sm"
                    variant="light"
                    color="red"
                    loading={Boolean(deleting)}
                    onClick={(event) => {
                      event.stopPropagation();
                      onDelete(task);
                    }}
                    aria-label={`Delete task ${task.templateName}`}
                  >
                    <IconTrash size={14} />
                  </ActionIcon>
                </Tooltip>
              )}
            </Group>
          </Stack>
        </Group>

        <Group gap={6} wrap="wrap">
          <Avatar size="sm" radius="xl" color="dark">
            {task.ownerInitials}
          </Avatar>
          <Badge size="xs" variant="outline" leftSection={<IconBolt size={12} />}>
            {task.points} pts
          </Badge>
          <Text size="xs" c="dimmed">
            {formatTaskTimeRange(task)}
          </Text>
        </Group>

        {task.notes && (
          <Text size="xs" c="dimmed" lineClamp={2}>
            {task.notes}
          </Text>
        )}

        {task.shiftTimeStart && task.shiftTimeEnd && (
          <Text size="xs" c="dimmed">
            Shift {formatTimeValue(task.shiftTimeStart)} - {formatTimeValue(task.shiftTimeEnd)}
          </Text>
        )}

        {task.tags.length > 0 && (
          <Group gap={4} wrap="wrap">
            {task.tags.slice(0, 3).map((tag) => (
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
          {hasConflict && (
            <Group gap={4}>
              <IconAlertTriangle size={14} color={PRIORITY_META.high.solid} />
              <Text size="xs" c="red">
                Off shift
              </Text>
            </Group>
          )}
        </Group>
      </Stack>
    </Card>
  );
};

const MobilePlannerDayCard = ({
  date,
  tasks,
  progressPercent,
  onSelectLog,
  canDeleteLogs,
  deletingLogId,
  onDeleteLog,
}: {
  date: dayjs.Dayjs;
  tasks: PlannerDisplayTask[];
  progressPercent: number;
  onSelectLog?: (log: AssistantManagerTaskLog) => void;
  canDeleteLogs?: boolean;
  deletingLogId?: number | null;
  onDeleteLog?: (log: AssistantManagerTaskLog) => void;
}) => (
  <Paper withBorder radius="xl" p="md">
    <Stack gap="xs">
      <Group gap={8} align="baseline" justify="center" wrap="nowrap">
        <Text fw={700} lh={1.1}>
          {date.format('dddd')}
        </Text>
        <Text size="sm" c="dimmed" lh={1.1}>
          {date.format('MMM D')}
        </Text>
      </Group>
      <Group align="center" wrap="nowrap">
        <Box style={{ flex: 1 }} />
        <Text fw={800} size="lg" ta="center" style={{ flex: 1, lineHeight: 1 }}>
          {progressPercent}%
        </Text>
        <Group justify="flex-end" style={{ flex: 1 }}>
          <Badge variant="outline">
            {tasks.length} task{tasks.length === 1 ? '' : 's'}
          </Badge>
        </Group>
      </Group>

      {tasks.length > 0 ? (
        <Stack gap="sm">
          {tasks.map((task) => {
            const hasConflict = task.scheduleConflict || (task.requiresShift && !task.onShift);
            return (
              <Paper
                key={task.id}
                withBorder
                radius="lg"
                p="sm"
                bg={task.manual ? '#faf5ff' : '#f8fafc'}
                onClick={onSelectLog ? () => onSelectLog(task.source) : undefined}
                style={{ cursor: onSelectLog ? 'pointer' : 'default' }}
              >
                <Stack gap={6}>
                  <Group justify="space-between" align="flex-start" wrap="nowrap">
                    <Stack gap={2} style={{ flex: 1 }}>
                      <Text fw={600}>{task.templateName}</Text>
                      <Text size="sm" c="dimmed">
                        {task.ownerName}
                      </Text>
                    </Stack>
                    <Group gap={6} align="center" wrap="nowrap">
                      <Badge color={STATUS_COLORS[task.status]} variant="light">
                        {task.status}
                      </Badge>
                      {canDeleteLogs && onDeleteLog && (
                        <ActionIcon
                          size="sm"
                          variant="light"
                          color="red"
                          loading={deletingLogId === task.source.id}
                          onClick={(event) => {
                            event.stopPropagation();
                            onDeleteLog(task.source);
                          }}
                          aria-label={`Delete task ${task.templateName}`}
                        >
                          <IconTrash size={14} />
                        </ActionIcon>
                      )}
                    </Group>
                  </Group>

                  <Group gap="xs" wrap="wrap">
                    <Badge size="sm" variant="outline">
                      {formatTaskTimeRange(task)}
                    </Badge>
                    <Badge size="sm" color={PRIORITY_META[task.priority].color} variant="light">
                      {PRIORITY_META[task.priority].label}
                    </Badge>
                    <Badge size="sm" variant="outline" leftSection={<IconBolt size={12} />}>
                      {task.points} pts
                    </Badge>
                    {task.manual && (
                      <Badge size="sm" color="grape" variant="light">
                        Manual
                      </Badge>
                    )}
                    {hasConflict && (
                      <Badge size="sm" color="red" variant="light">
                        Needs attention
                      </Badge>
                    )}
                  </Group>

                  {task.notes && (
                    <Text size="sm" c="dimmed">
                      {task.notes}
                    </Text>
                  )}
                </Stack>
              </Paper>
            );
          })}
        </Stack>
      ) : (
        <Text size="sm" c="dimmed">
          No tasks planned for this day.
        </Text>
      )}
    </Stack>
  </Paper>
);

const DesktopOwnerGroupedDayColumn = ({
  date,
  tasks,
  progressPercent,
  onSelectLog,
  canDeleteLogs,
  deletingLogId,
  onDeleteLog,
}: {
  date: dayjs.Dayjs;
  tasks: PlannerDisplayTask[];
  progressPercent: number;
  onSelectLog?: (log: AssistantManagerTaskLog) => void;
  canDeleteLogs?: boolean;
  deletingLogId?: number | null;
  onDeleteLog?: (log: AssistantManagerTaskLog) => void;
}) => {
  const groupedTasks = tasks.reduce<Map<string, PlannerDisplayTask[]>>((map, task) => {
    const key = task.ownerName;
    const existing = map.get(key) ?? [];
    existing.push(task);
    map.set(key, existing);
    return map;
  }, new Map());

  const ownerGroups = Array.from(groupedTasks.entries()).map(([ownerName, ownerTasks]) => ({
    ownerName,
    ownerInitials: ownerTasks[0]?.ownerInitials ?? ownerName.slice(0, 2).toUpperCase(),
    tasks: ownerTasks.sort((left, right) =>
      left.startHour === right.startHour ? left.id - right.id : left.startHour - right.startHour,
    ),
  }));

  return (
    <Paper withBorder radius="xl" p="md" style={{ minWidth: 280, background: '#ffffff' }}>
      <Stack gap="sm">
        <Group gap={8} align="baseline" justify="center" wrap="nowrap">
          <Text fw={700} lh={1.1}>
            {date.format('dddd')}
          </Text>
          <Text size="sm" c="dimmed" lh={1.1}>
            {date.format('MMM D')}
          </Text>
        </Group>
        <Group align="center" wrap="nowrap">
          <Box style={{ flex: 1 }} />
          <Text fw={800} size="lg" ta="center" style={{ flex: 1, lineHeight: 1 }}>
            {progressPercent}%
          </Text>
          <Group justify="flex-end" style={{ flex: 1 }}>
            <Badge variant="outline">
              {tasks.length} task{tasks.length === 1 ? '' : 's'}
            </Badge>
          </Group>
        </Group>

        {ownerGroups.length > 0 ? (
          <Stack gap="sm">
            {ownerGroups.map((group) => (
              <Paper key={`${date.format('YYYY-MM-DD')}-${group.ownerName}`} withBorder radius="lg" p="sm" bg="#f8fafc">
                <Stack gap="sm">
                  <Group gap="xs" wrap="nowrap">
                    <Avatar size="sm" radius="xl" color="dark">
                      {group.ownerInitials}
                    </Avatar>
                    <Stack gap={0} style={{ flex: 1 }}>
                      <Text fw={600} size="sm">
                        {group.ownerName}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {group.tasks.length} item{group.tasks.length === 1 ? '' : 's'}
                      </Text>
                    </Stack>
                  </Group>

                  <Stack gap={8}>
                    {group.tasks.map((task) => {
                      const hasConflict =
                        task.scheduleConflict || (task.requiresShift && !task.onShift);

                      return (
                        <Paper
                          key={task.id}
                          withBorder
                          radius="md"
                          p="xs"
                          bg={task.manual ? '#faf5ff' : '#ffffff'}
                          onClick={onSelectLog ? () => onSelectLog(task.source) : undefined}
                          style={{
                            cursor: onSelectLog ? 'pointer' : 'default',
                            borderColor: hasConflict
                              ? 'rgba(190, 24, 93, 0.35)'
                              : 'rgba(15, 23, 42, 0.08)',
                          }}
                        >
                          <Stack gap={6}>
                            <Group justify="space-between" align="flex-start" wrap="nowrap">
                              <Text fw={600} size="sm" style={{ flex: 1 }} lineClamp={2}>
                                {task.templateName}
                              </Text>
                              <Group gap={6} align="center" wrap="nowrap">
                                <Badge
                                  size="xs"
                                  color={STATUS_COLORS[task.status]}
                                  variant="light"
                                >
                                  {task.status}
                                </Badge>
                                {canDeleteLogs && onDeleteLog && (
                                  <ActionIcon
                                    size="sm"
                                    variant="light"
                                    color="red"
                                    loading={deletingLogId === task.source.id}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      onDeleteLog(task.source);
                                    }}
                                    aria-label={`Delete task ${task.templateName}`}
                                  >
                                    <IconTrash size={14} />
                                  </ActionIcon>
                                )}
                              </Group>
                            </Group>

                            <Group gap={6} wrap="wrap">
                              <Badge size="xs" variant="outline">
                                {formatTaskTimeRange(task)}
                              </Badge>
                              <Badge
                                size="xs"
                                color={PRIORITY_META[task.priority].color}
                                variant="light"
                              >
                                {PRIORITY_META[task.priority].label}
                              </Badge>
                              {task.manual && (
                                <Badge size="xs" color="grape" variant="light">
                                  Manual
                                </Badge>
                              )}
                              {hasConflict && (
                                <Badge size="xs" color="red" variant="light">
                                  Needs attention
                                </Badge>
                              )}
                            </Group>
                          </Stack>
                        </Paper>
                      );
                    })}
                  </Stack>
                </Stack>
              </Paper>
            ))}
          </Stack>
        ) : (
          <Center py="xl">
            <Text size="sm" c="dimmed">
              No tasks
            </Text>
          </Center>
        )}
      </Stack>
    </Paper>
  );
};

const DayTaskBucketsBoard = ({
  logs,
  templates,
  onSelectLog,
  canDeleteLogs,
  deletingLogId,
  onDeleteLog,
}: {
  logs: AssistantManagerTaskLog[];
  templates: AssistantManagerTaskTemplate[];
  onSelectLog?: (log: AssistantManagerTaskLog) => void;
  canDeleteLogs?: boolean;
  deletingLogId?: number | null;
  onDeleteLog?: (log: AssistantManagerTaskLog) => void;
}) => {
  const templateMap = useMemo(
    () => new Map(templates.map((template) => [template.id, template])),
    [templates],
  );

  const buckets = useMemo(() => {
    const pending: AssistantManagerTaskLog[] = [];
    const completed: AssistantManagerTaskLog[] = [];
    const missed: AssistantManagerTaskLog[] = [];

    logs.forEach((log) => {
      if (log.status === 'pending') {
        pending.push(log);
        return;
      }
      if (log.status === 'completed') {
        completed.push(log);
        return;
      }
      missed.push(log);
    });

    const sortByTime = (left: AssistantManagerTaskLog, right: AssistantManagerTaskLog) =>
      compareLogsByTime(left, right, templateMap);

    return {
      pending: pending.sort(sortByTime),
      completed: completed.sort(sortByTime),
      missed: missed.sort(sortByTime),
    };
  }, [logs, templateMap]);

  const renderBucket = (
    title: string,
    color: string,
    headerBackground: string,
    entries: AssistantManagerTaskLog[],
    emptyText: string,
    showCount: boolean,
  ) => (
    <Paper
      withBorder
      radius="xl"
      style={{ height: '100%', overflow: 'hidden', borderColor: 'rgba(15, 23, 42, 0.08)' }}
    >
      <Stack gap={0} style={{ height: '100%' }}>
        <Box
          px="md"
          py="sm"
          style={{
            background: headerBackground,
            borderBottom: '1px solid rgba(15, 23, 42, 0.08)',
          }}
        >
          <Group justify="center" align="center" wrap="wrap">
            <Text fw={700} ta="center">
              {title}
            </Text>
            {showCount && (
              <Badge color={color} variant="light">
                {entries.length}
              </Badge>
            )}
          </Group>
        </Box>

        <Box p="md" pt="sm" style={{ flex: 1 }}>
          {entries.length === 0 ? (
            <Center style={{ height: '100%' }}>
              <Text size="sm" c="dimmed">
                {emptyText}
              </Text>
            </Center>
          ) : (
            <Stack gap="xs">
              {entries.map((log) => {
                const owner = log.userName ?? `User #${log.userId}`;
                const template = templateMap.get(log.templateId);
                const scheduleConfig = (template?.scheduleConfig ?? {}) as Record<string, unknown>;
                const meta = (log.meta ?? {}) as AssistantManagerTaskLogMeta;
                const priority = normalizePriority(meta.priority ?? scheduleConfig.priority);
                const startHour = getLogStartHour(log, templateMap);
                const durationValue =
                  typeof meta.durationHours === 'number'
                    ? meta.durationHours
                    : Number(meta.durationHours ?? scheduleConfig.durationHours ?? 1);
                const durationHours =
                  Number.isFinite(durationValue) && durationValue > 0 ? durationValue : 1;
                const startHourInt = Math.floor(startHour);
                const startMinutes = Math.round((startHour - startHourInt) * 60);
                const startDateTime = dayjs()
                  .startOf('day')
                  .hour(startHourInt)
                  .minute(startMinutes);
                const startTime = startDateTime.format('h:mm A');
                const endTime = startDateTime
                  .add(Math.round(durationHours * 60), 'minute')
                  .format('h:mm A');

                return (
                  <Paper
                    key={log.id}
                    withBorder
                    radius="md"
                    p="sm"
                    onClick={onSelectLog ? () => onSelectLog(log) : undefined}
                    style={{
                      cursor: onSelectLog ? 'pointer' : 'default',
                      borderColor: 'rgba(15, 23, 42, 0.08)',
                    }}
                  >
                    <Stack gap={4}>
                      <Group justify="space-between" align="flex-start" wrap="nowrap">
                        <Text fw={600} size="sm" lineClamp={2} style={{ flex: 1 }}>
                          {log.templateName ?? `Template #${log.templateId}`}
                        </Text>
                        <Group gap={6} align="center" wrap="nowrap">
                          <Badge size="xs" color={STATUS_COLORS[log.status]} variant="light">
                            {log.status}
                          </Badge>
                          {canDeleteLogs && onDeleteLog && (
                            <ActionIcon
                              size="sm"
                              variant="light"
                              color="red"
                              loading={deletingLogId === log.id}
                              onClick={(event) => {
                                event.stopPropagation();
                                onDeleteLog(log);
                              }}
                              aria-label={`Delete task ${log.templateName ?? `Template #${log.templateId}`}`}
                            >
                              <IconTrash size={14} />
                            </ActionIcon>
                          )}
                        </Group>
                      </Group>
                      <Group gap={6} wrap="wrap">
                        <Badge size="xs" variant="outline">
                          {`${startTime} - ${endTime}`}
                        </Badge>
                        <Badge size="xs" color={PRIORITY_META[priority].color} variant="light">
                          {PRIORITY_META[priority].label}
                        </Badge>
                        <Text size="xs" c="dimmed">
                          {owner}
                        </Text>
                      </Group>
                    </Stack>
                  </Paper>
                );
              })}
            </Stack>
          )}
        </Box>
      </Stack>
    </Paper>
  );

  return (
    <SimpleGrid cols={{ base: 1, md: 3 }} spacing="md">
      {renderBucket(
        'Pending Tasks',
        'blue',
        'linear-gradient(180deg, rgba(219, 234, 254, 0.9) 0%, rgba(255, 255, 255, 0.8) 100%)',
        buckets.pending,
        'No pending tasks',
        false,
      )}
      {renderBucket(
        'Completed Tasks',
        'teal',
        'linear-gradient(180deg, rgba(209, 250, 229, 0.9) 0%, rgba(255, 255, 255, 0.8) 100%)',
        buckets.completed,
        'No completed tasks',
        false,
      )}
      {renderBucket(
        'Missed / Not Completed',
        'red',
        'linear-gradient(180deg, rgba(254, 226, 226, 0.92) 0%, rgba(255, 255, 255, 0.82) 100%)',
        buckets.missed,
        'No missed tasks',
        true,
      )}
    </SimpleGrid>
  );
};

const WeeklyTaskPlannerBoard = ({
  logs,
  templates,
  rangeStart,
  rangeEnd,
  onSelectLog,
  canDeleteLogs,
  deletingLogId,
  onDeleteLog,
}: {
  logs: AssistantManagerTaskLog[];
  templates: AssistantManagerTaskTemplate[];
  rangeStart: Date | null;
  rangeEnd: Date | null;
  onSelectLog?: (log: AssistantManagerTaskLog) => void;
  canDeleteLogs?: boolean;
  deletingLogId?: number | null;
  onDeleteLog?: (log: AssistantManagerTaskLog) => void;
}) => {
  const theme = useMantineTheme();
  const isMobile = useMediaQuery(`(max-width: ${theme.breakpoints.sm})`);
  const templateMap = useMemo(
    () => new Map(templates.map((template) => [template.id, template])),
    [templates],
  );
  const visibleRangeStart = useMemo(() => {
    if (rangeStart) {
      return dayjs(rangeStart).startOf('day');
    }
    return startOfPlannerWeek(new Date());
  }, [rangeStart]);
  const visibleDayCount = useMemo(() => {
    if (!rangeStart || !rangeEnd) {
      return DEFAULT_PLANNER_DAYS;
    }
    const start = dayjs(rangeStart).startOf('day');
    const end = dayjs(rangeEnd).startOf('day');
    if (!start.isValid() || !end.isValid() || end.isBefore(start, 'day')) {
      return DEFAULT_PLANNER_DAYS;
    }
    return Math.max(1, end.diff(start, 'day') + 1);
  }, [rangeEnd, rangeStart]);
  const days = useMemo(
    () => Array.from({ length: visibleDayCount }, (_, index) => visibleRangeStart.add(index, 'day')),
    [visibleDayCount, visibleRangeStart],
  );
  const totalGridHeight = (PLANNER_END_HOUR - PLANNER_START_HOUR) * PLANNER_SLOT_HEIGHT;

  const plannerTasks = useMemo(
    () => buildPlannerTasks({ logs, templateMap, rangeStart: visibleRangeStart, dayCount: visibleDayCount }),
    [logs, templateMap, visibleDayCount, visibleRangeStart],
  );

  const tasksByDay = useMemo(
    () =>
      Array.from({ length: visibleDayCount }, (_, dayIndex) =>
        plannerTasks
          .filter((task) => task.dayIndex === dayIndex)
          .sort((left, right) =>
            left.startHour === right.startHour ? left.id - right.id : left.startHour - right.startHour,
          ),
      ),
    [plannerTasks, visibleDayCount],
  );
  const dayProgressByIndex = useMemo(
    () =>
      tasksByDay.map((dayTasks) => {
        const totalPoints = dayTasks.reduce((sum, task) => {
          const points = Number.isFinite(task.points) && task.points >= 0 ? task.points : 1;
          return sum + points;
        }, 0);
        if (totalPoints <= 0) {
          return 0;
        }
        const completedPoints = dayTasks
          .filter((task) => task.status === 'completed')
          .reduce((sum, task) => {
            const points = Number.isFinite(task.points) && task.points >= 0 ? task.points : 1;
            return sum + points;
          }, 0);
        return Math.round((completedPoints / totalPoints) * 100);
      }),
    [tasksByDay],
  );
  const ownerCount = useMemo(
    () => new Set(plannerTasks.map((task) => task.ownerName)).size,
    [plannerTasks],
  );
  const maxOverlapColumns = useMemo(
    () => plannerTasks.reduce((max, task) => Math.max(max, task.columnCount), 1),
    [plannerTasks],
  );
  const shouldUseDesktopAgendaLayout = ownerCount > 1 || maxOverlapColumns > 2;

  if (isMobile) {
    return (
      <Stack gap="md">
        <Stack gap="md">
          {days.map((date, dayIndex) => (
            <MobilePlannerDayCard
              key={date.toString()}
              date={date}
              tasks={tasksByDay[dayIndex]}
              progressPercent={dayProgressByIndex[dayIndex] ?? 0}
              onSelectLog={onSelectLog}
              canDeleteLogs={canDeleteLogs}
              deletingLogId={deletingLogId}
              onDeleteLog={onDeleteLog}
            />
          ))}
        </Stack>
      </Stack>
    );
  }

  if (shouldUseDesktopAgendaLayout) {
    return (
      <Stack gap="md">
        <ScrollArea offsetScrollbars type="auto">
          <Group align="stretch" gap="md" wrap="nowrap" style={{ minWidth: visibleDayCount * 280 }}>
            {days.map((date, dayIndex) => (
              <DesktopOwnerGroupedDayColumn
                key={date.toString()}
                date={date}
                tasks={tasksByDay[dayIndex]}
                progressPercent={dayProgressByIndex[dayIndex] ?? 0}
                onSelectLog={onSelectLog}
                canDeleteLogs={canDeleteLogs}
                deletingLogId={deletingLogId}
                onDeleteLog={onDeleteLog}
              />
            ))}
          </Group>
        </ScrollArea>
      </Stack>
    );
  }

  return (
    <Stack gap="md">
      <ScrollArea offsetScrollbars type="auto">
        <Box
          style={{
            minWidth: Math.max(1080, 88 + visibleDayCount * 170),
            border: '1px solid rgba(15, 23, 42, 0.08)',
            borderRadius: 24,
            overflow: 'hidden',
          }}
        >
          <Box
            style={{
              display: 'grid',
              gridTemplateColumns: `88px repeat(${visibleDayCount}, minmax(0, 1fr))`,
              background:
                'linear-gradient(180deg, rgba(248, 250, 252, 1) 0%, rgba(241, 245, 249, 0.92) 100%)',
              borderBottom: '1px solid rgba(15, 23, 42, 0.08)',
            }}
          >
            <Box />
            {days.map((date, dayIndex) => (
              <Box key={date.toString()} style={{ padding: '14px 0', textAlign: 'center' }}>
                <Text size="sm" fw={700}>
                  {date.format('ddd')}
                </Text>
                <Text fw={700}>{dayProgressByIndex[dayIndex] ?? 0}%</Text>
                <Text size="xs" c="dimmed">
                  {date.format('MMM D')}
                </Text>
              </Box>
            ))}
          </Box>

          <Box style={{ display: 'grid', gridTemplateColumns: `88px repeat(${visibleDayCount}, minmax(0, 1fr))` }}>
            <Box
              style={{
                borderRight: '1px solid rgba(15, 23, 42, 0.08)',
                background: '#ffffff',
              }}
            >
              {Array.from(
                { length: PLANNER_END_HOUR - PLANNER_START_HOUR },
                (_, index) => PLANNER_START_HOUR + index,
              ).map((hour) => (
                <Box
                  key={`hour-${hour}`}
                  style={{
                    height: PLANNER_SLOT_HEIGHT,
                    borderBottom: '1px solid rgba(15, 23, 42, 0.05)',
                    display: 'flex',
                    justifyContent: 'flex-end',
                    alignItems: 'flex-start',
                    paddingRight: 10,
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
              const dayTasks = tasksByDay[columnIndex];

              return (
                <Box
                  key={`planner-day-${date.toString()}`}
                  style={{
                    position: 'relative',
                    minHeight: totalGridHeight,
                    borderRight:
                      columnIndex === days.length - 1
                        ? 'none'
                        : '1px solid rgba(15, 23, 42, 0.08)',
                    backgroundImage:
                      'linear-gradient(transparent calc(100% - 1px), rgba(15, 23, 42, 0.04) 1px), linear-gradient(90deg, rgba(15, 23, 42, 0.025) 1px, transparent 1px)',
                    backgroundSize: `100% ${PLANNER_SLOT_HEIGHT}px`,
                    backgroundColor: '#ffffff',
                  }}
                >
                  {dayTasks.map((task) => (
                    <PlannerTaskCard
                      key={task.id}
                      task={task}
                      onSelect={onSelectLog ? () => onSelectLog(task.source) : undefined}
                      canDelete={canDeleteLogs}
                      deleting={deletingLogId === task.source.id}
                      onDelete={(nextTask) => onDeleteLog?.(nextTask.source)}
                    />
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
      </ScrollArea>
    </Stack>
  );
};

const AssistantManagerTaskPlanner = () => {
  const dispatch = useAppDispatch();
  const theme = useMantineTheme();
  const isMobile = useMediaQuery(`(max-width: ${theme.breakpoints.sm})`);
  const [searchParams, setSearchParams] = useSearchParams();

  const sessionRoleSlug = useAppSelector((state) => state.session.roleSlug);
  const normalizedSessionRole = useMemo(
    () => normalizeRoleSlug(sessionRoleSlug),
    [sessionRoleSlug],
  );
  const canReadControlPanelConfig = normalizedSessionRole === 'admin';
  const loggedUserId = useAppSelector((state) => state.session.loggedUserId);
  const templateState = useAppSelector((state) => state.assistantManagerTasks.templates)[0];
  const logState = useAppSelector((state) => state.assistantManagerTasks.logs)[0];
  const userTypesState = useAppSelector((state) => state.userTypes[0]);
  const { data: shiftRolesResponse, isLoading: shiftRolesLoading, error: shiftRolesError } = useShiftRoles();
  const { data: activeUsers = [], isLoading: activeUsersLoading, error: activeUsersError } = useActiveUsers();
  const { data: plannerStartConfig } = useConfigEntry(
    canReadControlPanelConfig ? 'AM_TASK_PLANNER_START_DATE' : null,
  );
  const templates = useMemo(
    () => ((templateState.data as any)[0]?.data ?? []) as AssistantManagerTaskTemplate[],
    [templateState.data],
  );
  const logs = useMemo(
    () => ((logState.data as any)[0]?.data ?? []) as AssistantManagerTaskLog[],
    [logState.data],
  );
  const templateMap = useMemo(
    () => new Map(templates.map((template) => [template.id, template])),
    [templates],
  );
  const userTypes = useMemo(
    () => (userTypesState.data?.[0]?.data ?? []) as Partial<UserType>[],
    [userTypesState.data],
  );
  const shiftRoles = useMemo(
    () => ((shiftRolesResponse?.[0]?.data ?? []) as ShiftRole[]),
    [shiftRolesResponse],
  );
  const userTypeOptions = useMemo(
    () =>
      userTypes
        .filter((record): record is Partial<UserType> & { id: number; name: string } =>
          typeof record.id === 'number' && typeof record.name === 'string' && record.name.trim().length > 0,
        )
        .map((record) => ({
          value: String(record.id),
          label: record.name,
        })),
    [userTypes],
  );
  const shiftRoleOptions = useMemo(
    () =>
      shiftRoles.map((role) => ({
        value: String(role.id),
        label: role.name,
      })),
    [shiftRoles],
  );
  const activeUserOptions = useMemo(
    () =>
      [...activeUsers]
        .sort((left, right) => {
          const leftName = `${left.firstName} ${left.lastName}`.trim().toLowerCase();
          const rightName = `${right.firstName} ${right.lastName}`.trim().toLowerCase();
          return leftName.localeCompare(rightName);
        })
        .map((user) => {
          const displayName = `${user.firstName} ${user.lastName}`.trim() || user.email || `User ${user.id}`;
          const secondaryText = user.email ? ` - ${user.email}` : '';
          return {
            value: String(user.id),
            label: `${displayName} (#${user.id})${secondaryText}`,
          };
        }),
    [activeUsers],
  );
  const defaultAssistantManagerUserTypeId = useMemo(
    () =>
      userTypeOptions.find((option) => option.label.trim().toLowerCase() === 'assistant manager')
        ?.value ?? '',
    [userTypeOptions],
  );
  const defaultManagerShiftRoleId = useMemo(
    () =>
      shiftRoleOptions.find((option) => option.label.trim().toLowerCase() === 'manager')?.value ??
      '',
    [shiftRoleOptions],
  );
  const plannerStartDate = useMemo(() => {
    const rawValue = plannerStartConfig?.value ?? plannerStartConfig?.defaultValue ?? null;
    if (typeof rawValue !== 'string') {
      return null;
    }
    const trimmed = rawValue.trim();
    if (!trimmed || !/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return null;
    }
    const parsed = dayjs(trimmed);
    if (!parsed.isValid() || parsed.format('YYYY-MM-DD') !== trimmed) {
      return null;
    }
    return parsed.startOf('day');
  }, [plannerStartConfig?.defaultValue, plannerStartConfig?.value]);

  const access = useModuleAccess('am-task-management');
  const canViewAllTasks = useMemo(() => {
    return normalizedSessionRole != null && GLOBAL_TASK_VIEWER_ROLES.has(normalizedSessionRole);
  }, [normalizedSessionRole]);
  const canManage = canViewAllTasks && (access.canCreate || access.canUpdate || access.canDelete);
  const canDeleteTaskLogs = canViewAllTasks && access.canDelete;
  const canCreateManualTasks = canViewAllTasks && access.canCreate;
  const requestedSectionParam = searchParams.get('section');
  const requestedSection =
    requestedSectionParam === 'setup' || requestedSectionParam === 'dashboard'
      ? requestedSectionParam
      : null;
  const requestedTaskIdParam = searchParams.get('task');
  const requestedTaskId =
    requestedTaskIdParam && Number.isInteger(Number(requestedTaskIdParam)) && Number(requestedTaskIdParam) > 0
      ? Number(requestedTaskIdParam)
      : null;

  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [templateFormState, setTemplateFormState] =
    useState<TemplateFormState>(defaultTemplateFormState);
  const [templateFormError, setTemplateFormError] = useState<string | null>(null);
  const [editingTemplate, setEditingTemplate] =
    useState<AssistantManagerTaskTemplate | null>(null);
  const [templateSubmitting, setTemplateSubmitting] = useState(false);
  const [cerebroLinkOptions, setCerebroLinkOptions] = useState<AmTaskCerebroLinkOptionsResponse>({
    knowledgeEntries: [],
    policyEntries: [],
    quizzes: [],
  });
  const [cerebroLinkOptionsLoading, setCerebroLinkOptionsLoading] = useState(false);
  const [cerebroLinkOptionsError, setCerebroLinkOptionsError] = useState<string | null>(null);
  const [templateReorderBusyKey, setTemplateReorderBusyKey] = useState<string | null>(null);
  const [templateReorderDirection, setTemplateReorderDirection] = useState<'up' | 'down' | null>(null);

  const [assignmentModalOpen, setAssignmentModalOpen] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null);
  const [assignmentFormState, setAssignmentFormState] =
    useState<AssignmentFormState>(defaultAssignmentFormState);
  const [assignmentSubmitting, setAssignmentSubmitting] = useState(false);
  const [editingAssignment, setEditingAssignment] =
    useState<AssistantManagerTaskAssignment | null>(null);
  const [assignmentFormError, setAssignmentFormError] = useState<string | null>(null);
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<number[]>([]);
  const [bulkAssignmentModalOpen, setBulkAssignmentModalOpen] = useState(false);
  const [bulkAssignmentSubmitting, setBulkAssignmentSubmitting] = useState(false);
  const [bulkAssignmentError, setBulkAssignmentError] = useState<string | null>(null);
  const [syncExistingTasksModalOpen, setSyncExistingTasksModalOpen] = useState(false);
  const [syncExistingTasksDateRange, setSyncExistingTasksDateRange] = useState<
    [Date | null, Date | null]
  >([new Date(), dayjs().add(6, 'day').toDate()]);
  const [syncExistingTasksSubmitting, setSyncExistingTasksSubmitting] = useState(false);
  const [syncExistingTasksError, setSyncExistingTasksError] = useState<string | null>(null);
  const [syncExistingTasksSummary, setSyncExistingTasksSummary] =
    useState<SyncAmTaskLogsWithTemplateConfigResponse | null>(null);
  const [syncExistingTasksTemplate, setSyncExistingTasksTemplate] =
    useState<AssistantManagerTaskTemplate | null>(null);

  const getThisWeekRange = useCallback((): [Date, Date] => {
    const weekStart = startOfPlannerWeek(new Date());
    const effectiveStart =
      plannerStartDate && weekStart.isBefore(plannerStartDate, 'day')
        ? plannerStartDate.clone()
        : weekStart;
    return [effectiveStart.toDate(), effectiveStart.add(6, 'day').toDate()];
  }, [plannerStartDate]);
  const getTodayRange = useCallback((): [Date, Date] => {
    const today = dayjs().startOf('day');
    const effectiveDay =
      plannerStartDate && today.isBefore(plannerStartDate, 'day')
        ? plannerStartDate.clone()
        : today;
    return [effectiveDay.toDate(), effectiveDay.toDate()];
  }, [plannerStartDate]);
  const [logDateWindowMode, setLogDateWindowMode] =
    useState<PlannerDateWindowMode>(canViewAllTasks ? 'week' : 'day');
  const [logDateRange, setLogDateRange] = useState<[Date | null, Date | null]>(() => {
    const [start, end] = canViewAllTasks ? getThisWeekRange() : getTodayRange();
    return [start, end];
  });
  const [generateWeeklyTasksSubmitting, setGenerateWeeklyTasksSubmitting] =
    useState(false);
  const [generateWeeklyTasksError, setGenerateWeeklyTasksError] = useState<string | null>(null);
  const [generateWeeklyTasksSummary, setGenerateWeeklyTasksSummary] =
    useState<GenerateAmTaskLogsResponse | null>(null);
  const [generatePreviewModalOpen, setGeneratePreviewModalOpen] = useState(false);
  const [generatePreviewLoading, setGeneratePreviewLoading] = useState(false);
  const [generatePreviewError, setGeneratePreviewError] = useState<string | null>(null);
  const [generatePreviewSummary, setGeneratePreviewSummary] =
    useState<PreviewAmTaskLogsResponse | null>(null);
  const [clearWeekSubmitting, setClearWeekSubmitting] = useState(false);
  const [clearWeekError, setClearWeekError] = useState<string | null>(null);
  const [clearWeekSummary, setClearWeekSummary] =
    useState<ClearAmTaskLogsResponse | null>(null);
  const [logScope, setLogScope] = useState<'self' | 'all'>('all');
  const [logFilterStatus, setLogFilterStatus] =
    useState<TaskStatusFilterValue>('all');
  const activeSection =
    requestedSection === 'setup' && canViewAllTasks ? 'setup' : 'dashboard';

  const [manualModalOpen, setManualModalOpen] = useState(false);
  const [manualFormState, setManualFormState] =
    useState<ManualTaskFormState>(defaultManualTaskFormState);
  const [manualFormError, setManualFormError] = useState<string | null>(null);
  const [manualSubmitting, setManualSubmitting] = useState(false);

  const [selectedLog, setSelectedLog] = useState<AssistantManagerTaskLog | null>(null);
  const [logDetailModalOpen, setLogDetailModalOpen] = useState(false);
  const [logDeletePendingId, setLogDeletePendingId] = useState<number | null>(null);
  const [logDetailFormState, setLogDetailFormState] =
    useState<LogDetailFormState>(defaultLogDetailFormState);
  const [logDetailSubmitting, setLogDetailSubmitting] = useState(false);
  const [logDetailCompleting, setLogDetailCompleting] = useState(false);
  const [logDetailReopening, setLogDetailReopening] = useState(false);
  const [logDetailError, setLogDetailError] = useState<string | null>(null);
  const [evidenceUploadingRuleKey, setEvidenceUploadingRuleKey] = useState<string | null>(null);
  const [evidencePreviewLoadingItemId, setEvidencePreviewLoadingItemId] = useState<string | null>(null);
  const [activeEvidenceImagePreview, setActiveEvidenceImagePreview] =
    useState<TaskEvidenceImagePreview | null>(null);
  const [cameraCaptureState, setCameraCaptureState] = useState<CameraCaptureState>({
    opened: false,
    rule: null,
  });
  const [cameraCaptureError, setCameraCaptureError] = useState<string | null>(null);
  const [cameraCaptureLoading, setCameraCaptureLoading] = useState(false);
  const [cameraCaptureSubmitting, setCameraCaptureSubmitting] = useState(false);
  const [evidenceImageZoom, setEvidenceImageZoom] = useState(1);
  const evidencePreviewObjectUrlRef = useRef<string | null>(null);
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const cameraCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const [evidenceImageThumbs, setEvidenceImageThumbs] = useState<Record<string, string>>({});
  const [evidenceImageThumbErrors, setEvidenceImageThumbErrors] = useState<Record<string, boolean>>({});
  const evidenceImageThumbObjectUrlsRef = useRef<Record<string, string>>({});
  const evidenceImageThumbRequestedRef = useRef<Set<string>>(new Set());
  const [linkInputCounts, setLinkInputCounts] = useState<Record<string, number>>({});
  const [evidenceRuleEditModes, setEvidenceRuleEditModes] = useState<Record<string, boolean>>({});
  const notificationsSupported = typeof window !== 'undefined' && 'Notification' in window;
  const pushSupported =
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window;
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>(
    () => {
      if (typeof window === 'undefined' || !('Notification' in window)) {
        return 'denied';
      }
      return window.Notification.permission;
    },
  );
  const [pushPublicKey, setPushPublicKey] = useState<string | null>(null);
  const [pushEnabledInBackend, setPushEnabledInBackend] = useState(false);
  const [pushSubscriptionReady, setPushSubscriptionReady] = useState(false);
  const notificationTimeoutsRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const initializedEvidenceModesLogIdRef = useRef<number | null>(null);
  const [commentDraft, setCommentDraft] = useState('');
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  const [activeCerebroItem, setActiveCerebroItem] = useState<AmTaskCerebroLinkItemDetail | null>(null);
  const [cerebroItemModalOpen, setCerebroItemModalOpen] = useState(false);
  const [cerebroItemLoading, setCerebroItemLoading] = useState(false);
  const [cerebroItemError, setCerebroItemError] = useState<string | null>(null);
  const cameraCaptureSupported =
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices !== 'undefined' &&
    typeof navigator.mediaDevices.getUserMedia === 'function';

  const selectedLogComments = useMemo(
    () =>
      selectedLog && Array.isArray(selectedLog.meta?.comments)
        ? selectedLog.meta.comments ?? []
        : [],
    [selectedLog],
  );
  const selectedLogEvidenceRules = useMemo(
    () => getTemplateEvidenceRules(selectedLog ? templateMap.get(selectedLog.templateId) : null),
    [selectedLog, templateMap],
  );
  const templateKnowledgeOptions = useMemo(
    () =>
      cerebroLinkOptions.knowledgeEntries.map((entry) => ({
        value: String(entry.id),
        label: entry.title,
      })),
    [cerebroLinkOptions.knowledgeEntries],
  );
  const templatePolicyOptions = useMemo(
    () =>
      cerebroLinkOptions.policyEntries.map((entry) => ({
        value: String(entry.id),
        label: entry.title,
      })),
    [cerebroLinkOptions.policyEntries],
  );
  const templateQuizOptions = useMemo(
    () =>
      cerebroLinkOptions.quizzes.map((quiz) => ({
        value: String(quiz.id),
        label: quiz.title,
      })),
    [cerebroLinkOptions.quizzes],
  );
  const selectedLogTemplate = useMemo(
    () => (selectedLog ? templateMap.get(selectedLog.templateId) ?? null : null),
    [selectedLog, templateMap],
  );
  const selectedLogCerebroLinks = useMemo(() => {
    const templateLinks = getTemplateCerebroLinks(selectedLogTemplate);
    const knowledgeById = new Map(cerebroLinkOptions.knowledgeEntries.map((entry) => [entry.id, entry]));
    const policyById = new Map(cerebroLinkOptions.policyEntries.map((entry) => [entry.id, entry]));
    const quizById = new Map(cerebroLinkOptions.quizzes.map((quiz) => [quiz.id, quiz]));

    const knowledge = templateLinks.knowledgeEntryIds.map((id) => {
      const entry = knowledgeById.get(id);
      return {
        id,
        title: entry?.title ?? `Knowledge #${id}`,
      };
    });

    const policies = templateLinks.policyEntryIds.map((id) => {
      const entry = policyById.get(id);
      return {
        id,
        title: entry?.title ?? `Policy #${id}`,
      };
    });

    const quizzes = templateLinks.quizIds.map((id) => {
      const quiz = quizById.get(id);
      return {
        id,
        title: quiz?.title ?? `Quiz #${id}`,
      };
    });

    return { knowledge, policies, quizzes };
  }, [cerebroLinkOptions, selectedLogTemplate]);
  const selectedLogImageEvidenceItems = useMemo(() => {
    if (!selectedLog || selectedLogEvidenceRules.length === 0) {
      return [];
    }

    const items: AssistantManagerTaskEvidenceItem[] = [];
    for (const rule of selectedLogEvidenceRules) {
      if (rule.type !== 'image') {
        continue;
      }
      const ruleItems = getRuleItems(logDetailFormState.evidenceItems, rule).filter((item) =>
        hasEvidenceItemContent(item),
      );
      items.push(...ruleItems);
    }
    return items;
  }, [logDetailFormState.evidenceItems, selectedLog, selectedLogEvidenceRules]);
  const selectedLogIsCurrentDay = useMemo(() => {
    if (!selectedLog?.taskDate) {
      return false;
    }
    const taskDay = dayjs(selectedLog.taskDate);
    return taskDay.isValid() && taskDay.isSame(dayjs(), 'day');
  }, [selectedLog]);
  const selectedLogIsPastDay = useMemo(() => {
    if (!selectedLog?.taskDate) {
      return false;
    }
    const taskDay = dayjs(selectedLog.taskDate);
    return taskDay.isValid() && taskDay.isBefore(dayjs(), 'day');
  }, [selectedLog]);
  const selectedLogEvidenceReadOnly = Boolean(
    !selectedLog || selectedLog.status === 'completed' || !selectedLogIsCurrentDay,
  );
  const selectedLogCanComplete = Boolean(
    selectedLog && selectedLog.status !== 'completed' && selectedLogIsCurrentDay,
  );
  const selectedLogCanReopen = Boolean(
    selectedLog && selectedLog.status === 'completed' && selectedLogIsCurrentDay,
  );
  const selectedLogCompletionLocked = Boolean(
    selectedLog && selectedLog.status !== 'completed' && selectedLogIsPastDay,
  );
  const selectedLogMissingRequiredEvidenceLabels = useMemo(() => {
    if (!selectedLog || selectedLogEvidenceRules.length === 0) {
      return [];
    }

    const missingRules: string[] = [];

    for (const rule of selectedLogEvidenceRules) {
      const minimumRequiredItems = Math.max(rule.required === false ? 0 : 1, rule.minItems ?? 0);
      if (minimumRequiredItems <= 0) {
        continue;
      }

      const ruleItems = getRuleItems(logDetailFormState.evidenceItems, rule);
      const validItemCount =
        rule.type === 'link'
          ? ruleItems.filter((item) => {
              const value = item.value?.trim() ?? '';
              if (!value) {
                return false;
              }
              return validateEvidenceLinkValue(rule, value) == null;
            }).length
          : ruleItems.filter((item) => hasEvidenceItemContent(item)).length;

      if (validItemCount < minimumRequiredItems) {
        missingRules.push(rule.label);
      }
    }

    return missingRules;
  }, [logDetailFormState.evidenceItems, selectedLog, selectedLogEvidenceRules]);
  const selectedLogRequiredEvidenceSatisfied = selectedLogMissingRequiredEvidenceLabels.length === 0;
  const selectedTemplates = useMemo(
    () => templates.filter((template) => selectedTemplateIds.includes(template.id)),
    [selectedTemplateIds, templates],
  );

  useEffect(() => {
    dispatch(fetchAmTaskTemplates());
  }, [dispatch]);

  useEffect(() => {
    let isActive = true;
    setCerebroLinkOptionsLoading(true);
    setCerebroLinkOptionsError(null);

    fetchAmTaskCerebroLinkOptions()
      .then((options) => {
        if (!isActive) {
          return;
        }
        setCerebroLinkOptions(options);
      })
      .catch((error) => {
        if (!isActive) {
          return;
        }
        setCerebroLinkOptionsError(getErrorMessage(error, 'Failed to load Cerebro links'));
      })
      .finally(() => {
        if (!isActive) {
          return;
        }
        setCerebroLinkOptionsLoading(false);
      });

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    dispatch(fetchUserTypes()).catch((error) =>
      console.error('Failed to load user types', error),
    );
  }, [dispatch]);

  useEffect(() => {
    if (!canViewAllTasks) {
      setLogScope('self');
    }
  }, [canViewAllTasks]);

  useEffect(() => {
    if (!plannerStartDate) {
      return;
    }

    setLogDateRange((prev) => {
      const [start, end] = prev;
      if (!start) {
        return [plannerStartDate.toDate(), end];
      }

      const startDay = dayjs(start).startOf('day');
      if (!startDay.isBefore(plannerStartDate, 'day')) {
        return prev;
      }

      const nextEnd =
        end && !dayjs(end).endOf('day').isBefore(plannerStartDate, 'day')
          ? end
          : plannerStartDate.add(6, 'day').toDate();

      return [plannerStartDate.toDate(), nextEnd];
    });
  }, [plannerStartDate]);

  useEffect(() => {
    if (logDateWindowMode === 'week') {
      const [start, end] = getThisWeekRange();
      setLogDateRange([start, end]);
      return;
    }
    if (logDateWindowMode === 'day') {
      const [start, end] = getTodayRange();
      setLogDateRange([start, end]);
    }
  }, [getThisWeekRange, getTodayRange, logDateWindowMode]);

  useEffect(() => {
    if (!notificationsSupported) {
      return;
    }

    const syncPermission = () => {
      setNotificationPermission(window.Notification.permission);
    };

    syncPermission();
    window.addEventListener('focus', syncPermission);
    document.addEventListener('visibilitychange', syncPermission);

    return () => {
      window.removeEventListener('focus', syncPermission);
      document.removeEventListener('visibilitychange', syncPermission);
    };
  }, [notificationsSupported]);

  useEffect(() => {
    if (!loggedUserId) {
      setPushPublicKey(null);
      setPushEnabledInBackend(false);
      setPushSubscriptionReady(false);
      return;
    }

    fetchAmTaskPushConfig()
      .then((config) => {
        setPushPublicKey(config.publicKey);
        setPushEnabledInBackend(config.enabled);
        if (!config.enabled || !config.publicKey) {
          setPushSubscriptionReady(false);
        }
      })
      .catch((error) => {
        console.error('Failed to load task push notification config', error);
        setPushEnabledInBackend(false);
        setPushPublicKey(null);
        setPushSubscriptionReady(false);
      });
  }, [loggedUserId]);

  useEffect(() => {
    const normalizedSection =
      activeSection === 'setup' && canViewAllTasks ? 'setup' : 'dashboard';
    if (searchParams.get('section') === normalizedSection) {
      return;
    }

    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('section', normalizedSection);
    setSearchParams(nextParams, { replace: true });
  }, [activeSection, canViewAllTasks, searchParams, setSearchParams]);

  useEffect(() => {
    if (requestedTaskId == null) {
      if (selectedLog || logDetailModalOpen) {
        setSelectedLog(null);
        setLogDetailModalOpen(false);
        setLogDetailFormState(defaultLogDetailFormState);
        setLogDetailError(null);
        setEvidenceUploadingRuleKey(null);
        setEvidencePreviewLoadingItemId(null);
        setLinkInputCounts({});
        setEvidenceRuleEditModes({});
        setCommentDraft('');
        setActiveEvidenceImagePreview(null);
        setEvidenceImageZoom(1);
        setEvidenceImageThumbs({});
        setEvidenceImageThumbErrors({});
        evidenceImageThumbRequestedRef.current.clear();
        Object.values(evidenceImageThumbObjectUrlsRef.current).forEach((url) => {
          if (url) {
            URL.revokeObjectURL(url);
          }
        });
        evidenceImageThumbObjectUrlsRef.current = {};
        if (evidencePreviewObjectUrlRef.current) {
          URL.revokeObjectURL(evidencePreviewObjectUrlRef.current);
          evidencePreviewObjectUrlRef.current = null;
        }
      }
      return;
    }

    const matchingLog = logs.find((log) => log.id === requestedTaskId) ?? null;
    if (!matchingLog) {
      return;
    }

    if (selectedLog?.id === matchingLog.id && logDetailModalOpen) {
      return;
    }

    setSelectedLog(matchingLog);
    setLogDetailFormState(buildLogDetailFormStateFromLog(matchingLog));
    setLogDetailError(null);
    setEvidenceUploadingRuleKey(null);
    setEvidencePreviewLoadingItemId(null);
    setLinkInputCounts({});
    setEvidenceRuleEditModes({});
    setCommentDraft('');
    setLogDetailModalOpen(true);
    setActiveEvidenceImagePreview(null);
    setEvidenceImageZoom(1);
    setEvidenceImageThumbs({});
    setEvidenceImageThumbErrors({});
    evidenceImageThumbRequestedRef.current.clear();
    Object.values(evidenceImageThumbObjectUrlsRef.current).forEach((url) => {
      if (url) {
        URL.revokeObjectURL(url);
      }
    });
    evidenceImageThumbObjectUrlsRef.current = {};
    if (evidencePreviewObjectUrlRef.current) {
      URL.revokeObjectURL(evidencePreviewObjectUrlRef.current);
      evidencePreviewObjectUrlRef.current = null;
    }
  }, [logDetailModalOpen, logs, requestedTaskId, selectedLog]);

  const selectedLogId = selectedLog?.id ?? null;

  useEffect(() => {
    if (!selectedLogId || !selectedLog) {
      initializedEvidenceModesLogIdRef.current = null;
      setEvidenceRuleEditModes({});
      return;
    }

    if (
      initializedEvidenceModesLogIdRef.current === selectedLogId &&
      Object.keys(evidenceRuleEditModes).length > 0
    ) {
      return;
    }

    const savedItems = getNormalizedEvidenceItems(selectedLog.meta);
    const nextModes: Record<string, boolean> = {};
    for (const rule of selectedLogEvidenceRules) {
      const hasSavedData = getRuleItems(savedItems, rule).some(hasEvidenceItemContent);
      nextModes[rule.key] = !hasSavedData;
    }
    initializedEvidenceModesLogIdRef.current = selectedLogId;
    setEvidenceRuleEditModes(nextModes);
  }, [evidenceRuleEditModes, selectedLog, selectedLogEvidenceRules, selectedLogId]);

  useEffect(
    () => () => {
      Object.values(evidenceImageThumbObjectUrlsRef.current).forEach((url) => {
        if (url) {
          URL.revokeObjectURL(url);
        }
      });
      evidenceImageThumbObjectUrlsRef.current = {};
      evidenceImageThumbRequestedRef.current.clear();
      if (evidencePreviewObjectUrlRef.current) {
        URL.revokeObjectURL(evidencePreviewObjectUrlRef.current);
        evidencePreviewObjectUrlRef.current = null;
      }
    },
    [],
  );

  useEffect(() => {
    const currentIds = new Set(selectedLogImageEvidenceItems.map((item) => item.id));

    setEvidenceImageThumbs((prev) => {
      let changed = false;
      const next: Record<string, string> = {};
      Object.entries(prev).forEach(([itemId, objectUrl]) => {
        if (currentIds.has(itemId)) {
          next[itemId] = objectUrl;
          return;
        }
        changed = true;
        if (objectUrl) {
          URL.revokeObjectURL(objectUrl);
        }
        delete evidenceImageThumbObjectUrlsRef.current[itemId];
        evidenceImageThumbRequestedRef.current.delete(itemId);
      });
      return changed ? next : prev;
    });

    setEvidenceImageThumbErrors((prev) => {
      let changed = false;
      const next: Record<string, boolean> = {};
      Object.entries(prev).forEach(([itemId, hasError]) => {
        if (currentIds.has(itemId)) {
          next[itemId] = hasError;
        } else {
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [selectedLogImageEvidenceItems]);

  useEffect(() => {
    if (!selectedLogId || selectedLogImageEvidenceItems.length === 0) {
      return undefined;
    }

    let isActive = true;
    const pendingItems = selectedLogImageEvidenceItems.filter((item) => {
      if (!item.id) {
        return false;
      }
      if (evidenceImageThumbRequestedRef.current.has(item.id)) {
        return false;
      }
      if (evidenceImageThumbs[item.id] || evidenceImageThumbErrors[item.id]) {
        return false;
      }
      return true;
    });

    if (pendingItems.length === 0) {
      return () => {
        isActive = false;
      };
    }

    pendingItems.forEach((item) => {
      evidenceImageThumbRequestedRef.current.add(item.id);
      const downloadUrl = `/assistantManagerTasks/logs/${selectedLogId}/evidence-files/${encodeURIComponent(
        item.id,
      )}/download`;

      axiosInstance
        .get(downloadUrl, { responseType: 'blob', withCredentials: true })
        .then((response) => {
          if (!isActive) {
            return;
          }

          const objectUrl = URL.createObjectURL(response.data);

          setEvidenceImageThumbErrors((prev) => {
            if (!prev[item.id]) {
              return prev;
            }
            const next = { ...prev };
            delete next[item.id];
            return next;
          });

          setEvidenceImageThumbs((prev) => {
            const previousObjectUrl = prev[item.id];
            if (previousObjectUrl && previousObjectUrl !== objectUrl) {
              URL.revokeObjectURL(previousObjectUrl);
            }
            evidenceImageThumbObjectUrlsRef.current[item.id] = objectUrl;
            return { ...prev, [item.id]: objectUrl };
          });
        })
        .catch(() => {
          if (!isActive) {
            return;
          }
          setEvidenceImageThumbErrors((prev) => ({ ...prev, [item.id]: true }));
        });
    });

    return () => {
      isActive = false;
    };
  }, [evidenceImageThumbErrors, evidenceImageThumbs, selectedLogId, selectedLogImageEvidenceItems]);

  const handleSectionChange = useCallback(
    (value: string) => {
      const nextSection =
        value === 'setup' && canViewAllTasks ? 'setup' : 'dashboard';
      const nextParams = new URLSearchParams(searchParams);
      nextParams.set('section', nextSection);
      setSearchParams(nextParams, { replace: false });
    },
    [canViewAllTasks, searchParams, setSearchParams],
  );

  const handleDateWindowModeChange = useCallback(
    (value: string) => {
      const nextMode = (value as PlannerDateWindowMode) ?? 'week';
      setLogDateWindowMode(nextMode);
      if (nextMode === 'week') {
        const [start, end] = getThisWeekRange();
        setLogDateRange([start, end]);
        return;
      }
      if (nextMode === 'day') {
        const [start, end] = getTodayRange();
        setLogDateRange([start, end]);
      }
    },
    [getThisWeekRange, getTodayRange],
  );

  const handleLogDateRangeChange = useCallback((value: [Date | null, Date | null]) => {
    setLogDateRange(value);
    setLogDateWindowMode('custom');
  }, []);

  const canMoveToPreviousPeriod = useMemo(() => {
    if (!plannerStartDate) {
      return true;
    }
    const [start] = logDateRange;
    if (!start) {
      return false;
    }
    return dayjs(start).startOf('day').isAfter(plannerStartDate, 'day');
  }, [logDateRange, plannerStartDate]);

  const shiftLogDateRange = useCallback(
    (direction: 'previous' | 'next') => {
      const [start, end] = logDateRange;
      if (!start || !end) {
        return;
      }

      const currentStart = dayjs(start).startOf('day');
      const currentEnd = dayjs(end).startOf('day');
      const customSpanDays = Math.max(1, currentEnd.diff(currentStart, 'day') + 1);
      const stepDays =
        logDateWindowMode === 'day'
          ? 1
          : logDateWindowMode === 'week'
            ? 7
            : customSpanDays;
      const shift = direction === 'previous' ? -stepDays : stepDays;

      let nextStart = currentStart.add(shift, 'day');
      let nextEnd = currentEnd.add(shift, 'day');

      if (plannerStartDate && nextStart.isBefore(plannerStartDate, 'day')) {
        const clampShift = plannerStartDate.diff(nextStart, 'day');
        nextStart = nextStart.add(clampShift, 'day');
        nextEnd = nextEnd.add(clampShift, 'day');
      }

      setLogDateRange([nextStart.toDate(), nextEnd.toDate()]);
    },
    [logDateRange, logDateWindowMode, plannerStartDate],
  );

  const syncPushSubscription = useCallback(async () => {
    if (
      !pushSupported ||
      notificationPermission !== 'granted' ||
      !pushEnabledInBackend ||
      !pushPublicKey
    ) {
      setPushSubscriptionReady(false);
      return false;
    }
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      if (!registration) {
        setPushSubscriptionReady(false);
        return false;
      }
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: decodeBase64UrlToArrayBuffer(pushPublicKey),
        });
      }

      await saveAmTaskPushSubscription(subscription.toJSON());
      setPushSubscriptionReady(true);
      return true;
    } catch (error) {
      console.error('Failed to sync task push subscription', error);
      setPushSubscriptionReady(false);
      return false;
    }
  }, [
    notificationPermission,
    pushEnabledInBackend,
    pushPublicKey,
    pushSupported,
  ]);

  const removePushSubscription = useCallback(async () => {
    if (!pushSupported) {
      setPushSubscriptionReady(false);
      return;
    }
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      if (!registration) {
        return;
      }
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        const endpoint = subscription.endpoint;
        await subscription.unsubscribe().catch(() => undefined);
        if (endpoint) {
          await removeAmTaskPushSubscription(endpoint).catch(() => undefined);
        }
      }
    } catch (error) {
      console.error('Failed to remove task push subscription', error);
    } finally {
      setPushSubscriptionReady(false);
    }
  }, [pushSupported]);

  useEffect(() => {
    if (notificationPermission !== 'granted') {
      setPushSubscriptionReady(false);
      if (notificationPermission === 'denied') {
        removePushSubscription().catch((error) =>
          console.error('Failed to clear push subscription after deny', error),
        );
      }
      return;
    }
    syncPushSubscription().catch((error) =>
      console.error('Failed to auto-sync push subscription', error),
    );
  }, [notificationPermission, removePushSubscription, syncPushSubscription]);

  useEffect(() => {
    setSelectedTemplateIds((prev) => prev.filter((id) => templates.some((template) => template.id === id)));
  }, [templates]);

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

  useEffect(() => {
    setGenerateWeeklyTasksError(null);
    setGenerateWeeklyTasksSummary(null);
    setGeneratePreviewError(null);
    setGeneratePreviewSummary(null);
    setGeneratePreviewModalOpen(false);
    setClearWeekError(null);
    setClearWeekSummary(null);
  }, [logDateRange]);

  useEffect(() => {
    notificationTimeoutsRef.current.forEach((timerId) => {
      clearTimeout(timerId);
    });
    notificationTimeoutsRef.current = [];

    if (
      !notificationsSupported ||
      notificationPermission !== 'granted' ||
      !loggedUserId ||
      pushSubscriptionReady
    ) {
      return undefined;
    }

    const now = dayjs();
    const nowMs = now.valueOf();
    const maxTimeoutMs = 2_147_483_647;
    const staleThresholdMs = 5 * 60 * 1000;

    const selfPendingLogs = logs.filter(
      (log) => log.userId === loggedUserId && log.status === 'pending',
    );

    selfPendingLogs.forEach((log) => {
      const taskStart = parseTaskStartDateTime(log, templateMap);
      if (!taskStart) {
        return;
      }

      const templateDefaults = resolveTemplateDefaults(templateMap.get(log.templateId));
      const reminderMinutes =
        templateDefaults.reminderMinutesBeforeStart != null &&
        templateDefaults.reminderMinutesBeforeStart > 0
          ? templateDefaults.reminderMinutesBeforeStart
          : null;
      const events: Array<{
        type: 'reminder' | 'start';
        at: dayjs.Dayjs;
        title: string;
        body: string;
      }> = [];

      if (reminderMinutes != null) {
        events.push({
          type: 'reminder',
          at: taskStart.subtract(reminderMinutes, 'minute'),
          title: `Task reminder: ${log.templateName ?? `Task #${log.id}`}`,
          body: `Starts in ${reminderMinutes} minute(s) at ${taskStart.format(
            'HH:mm',
          )}.`,
        });
      }

      if (templateDefaults.notifyAtStart !== false) {
        events.push({
          type: 'start',
          at: taskStart,
          title: `Task starting now: ${log.templateName ?? `Task #${log.id}`}`,
          body: `Scheduled for ${taskStart.format('ddd, MMM D HH:mm')}.`,
        });
      }

      events.forEach((event) => {
        const eventTimestamp = event.at.valueOf();
        const eventKey = getTaskNotificationEventKey(log.id, event.type, eventTimestamp);
        if (hasTaskNotificationEventBeenShown(eventKey)) {
          return;
        }

        const triggerNotification = () => {
          if (window.Notification.permission !== 'granted') {
            return;
          }
          const notification = new window.Notification(event.title, {
            body: event.body,
            tag: `am-task-${log.id}-${event.type}`,
            requireInteraction: false,
          });
          notification.onclick = () => {
            notification.close();
            window.focus();
            const nextParams = new URLSearchParams(window.location.search);
            nextParams.set('section', 'dashboard');
            nextParams.set('task', String(log.id));
            setSearchParams(nextParams, { replace: false });
          };
          markTaskNotificationEventShown(eventKey);
        };

        const delayMs = eventTimestamp - nowMs;
        if (delayMs <= 0) {
          if (Math.abs(delayMs) <= staleThresholdMs) {
            triggerNotification();
          } else {
            markTaskNotificationEventShown(eventKey);
          }
          return;
        }

        if (delayMs > maxTimeoutMs) {
          return;
        }

        const timeoutId = setTimeout(() => {
          triggerNotification();
        }, delayMs);
        notificationTimeoutsRef.current.push(timeoutId);
      });
    });

    return () => {
      notificationTimeoutsRef.current.forEach((timerId) => {
        clearTimeout(timerId);
      });
      notificationTimeoutsRef.current = [];
    };
  }, [
    loggedUserId,
    logs,
    notificationPermission,
    notificationsSupported,
    pushSubscriptionReady,
    setSearchParams,
    templateMap,
  ]);

  const openTemplateModal = useCallback((template?: AssistantManagerTaskTemplate) => {
    if (template) {
      const defaults = resolveTemplateDefaults(template);
      const taxonomy = normalizeTemplateCategory(template);
      const cerebroLinks = getTemplateCerebroLinks(template);
      setEditingTemplate(template);
      setTemplateFormState({
        name: template.name,
        description: template.description ?? '',
        category: taxonomy.category,
        subgroup: taxonomy.subgroup,
        categoryOrder: String(taxonomy.categoryOrder),
        subgroupOrder: String(taxonomy.subgroupOrder),
        templateOrder: String(taxonomy.templateOrder),
        cadence: template.cadence,
        scheduleConfigText: getAdvancedScheduleConfigText(template),
        timesPerWeekPerAssignedUser:
          defaults.timesPerWeekPerAssignedUser != null
            ? String(defaults.timesPerWeekPerAssignedUser)
            : '',
        defaultTime: defaults.time ?? '',
        defaultDuration:
          defaults.durationHours != null ? String(defaults.durationHours) : '',
        defaultPriority: defaults.priority,
        defaultPoints: defaults.points != null ? String(defaults.points) : '',
        requireShift: defaults.requireShift,
        reminderMinutesBeforeStart:
          defaults.reminderMinutesBeforeStart != null
            ? String(defaults.reminderMinutesBeforeStart)
            : '',
        notifyAtStart: defaults.notifyAtStart,
        evidenceRules: buildEvidenceRuleDrafts(template),
        linkedKnowledgeEntryIds: cerebroLinks.knowledgeEntryIds.map(String),
        linkedPolicyEntryIds: cerebroLinks.policyEntryIds.map(String),
        linkedQuizIds: cerebroLinks.quizIds.map(String),
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
    setTemplateFormError(null);
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
      const durationNumeric = Number(templateFormState.defaultDuration);
      const pointsNumeric = Number(templateFormState.defaultPoints);
      const timesPerWeekNumeric = Number(templateFormState.timesPerWeekPerAssignedUser);
      const reminderMinutesNumeric = Number(templateFormState.reminderMinutesBeforeStart);
      const categoryOrderNumeric = Number(templateFormState.categoryOrder);
      const subgroupOrderNumeric = Number(templateFormState.subgroupOrder);
      const templateOrderNumeric = Number(templateFormState.templateOrder);
      const linkedKnowledgeEntryIds = templateFormState.linkedKnowledgeEntryIds
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0);
      const linkedPolicyEntryIds = templateFormState.linkedPolicyEntryIds
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0);
      const linkedQuizIds = templateFormState.linkedQuizIds
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0);

      if (
        !Number.isInteger(categoryOrderNumeric) ||
        categoryOrderNumeric < 0 ||
        !Number.isInteger(subgroupOrderNumeric) ||
        subgroupOrderNumeric < 0 ||
        !Number.isInteger(templateOrderNumeric) ||
        templateOrderNumeric < 0
      ) {
        setTemplateFormError('Category, subgroup, and template order must be whole numbers of 0 or greater');
        return;
      }

      if (trimmedTime) {
        nextScheduleConfig.time = trimmedTime;
      } else {
        delete nextScheduleConfig.time;
      }

      if (
        templateFormState.defaultDuration.trim() &&
        Number.isFinite(durationNumeric) &&
        durationNumeric > 0
      ) {
        nextScheduleConfig.durationHours = durationNumeric;
      } else {
        delete nextScheduleConfig.durationHours;
      }

      nextScheduleConfig.priority = templateFormState.defaultPriority;
      nextScheduleConfig.requireShift = templateFormState.requireShift;
      nextScheduleConfig.notifyAtStart = templateFormState.notifyAtStart;

      if (
        templateFormState.defaultPoints.trim() &&
        Number.isFinite(pointsNumeric) &&
        pointsNumeric >= 0
      ) {
        nextScheduleConfig.points = pointsNumeric;
      } else {
        delete nextScheduleConfig.points;
      }

      if (templateFormState.timesPerWeekPerAssignedUser.trim()) {
        if (!Number.isInteger(timesPerWeekNumeric) || timesPerWeekNumeric <= 0) {
          setTemplateFormError('Times per week per assigned user must be a whole number above 0');
          return;
        }
        nextScheduleConfig.timesPerWeekPerAssignedUser = timesPerWeekNumeric;
      } else {
        delete nextScheduleConfig.timesPerWeekPerAssignedUser;
      }

      if (templateFormState.reminderMinutesBeforeStart.trim()) {
        if (!Number.isInteger(reminderMinutesNumeric) || reminderMinutesNumeric <= 0) {
          setTemplateFormError('Reminder minutes before start must be a whole number above 0');
          return;
        }
        nextScheduleConfig.reminderMinutesBeforeStart = reminderMinutesNumeric;
      } else {
        delete nextScheduleConfig.reminderMinutesBeforeStart;
      }

      const evidenceRuleKeys = new Set<string>();
      const evidenceRules: AssistantManagerTaskEvidenceRule[] = [];
      for (let index = 0; index < templateFormState.evidenceRules.length; index += 1) {
        const draft = templateFormState.evidenceRules[index];
        const key = draft.key.trim();
        const label = draft.label.trim();
        if (!key) {
          setTemplateFormError(`Evidence rule ${index + 1} needs a key`);
          return;
        }
        if (!label) {
          setTemplateFormError(`Evidence rule ${index + 1} needs a label`);
          return;
        }
        if (evidenceRuleKeys.has(key)) {
          setTemplateFormError(`Evidence rule key "${key}" must be unique`);
          return;
        }
        evidenceRuleKeys.add(key);

        const minItemsRaw = draft.minItems.trim();
        const minItemsValue =
          minItemsRaw === '' ? (draft.required ? 1 : 0) : Number(minItemsRaw);
        if (!Number.isInteger(minItemsValue) || minItemsValue < 0) {
          setTemplateFormError(`Evidence rule "${label}" needs a valid minimum item count`);
          return;
        }

        const maxItemsRaw = draft.maxItems.trim();
        const maxItemsValue = maxItemsRaw === '' ? null : Number(maxItemsRaw);
        if (
          maxItemsValue != null &&
          (!Number.isInteger(maxItemsValue) || maxItemsValue <= 0)
        ) {
          setTemplateFormError(`Evidence rule "${label}" needs a valid maximum item count`);
          return;
        }
        if (!draft.multiple && maxItemsValue != null && maxItemsValue > 1) {
          setTemplateFormError(`Evidence rule "${label}" cannot allow more than one item unless multiple is enabled`);
          return;
        }
        if (maxItemsValue != null && maxItemsValue < minItemsValue) {
          setTemplateFormError(`Evidence rule "${label}" maximum items cannot be below the minimum`);
          return;
        }

        if (draft.type === 'link' && draft.regex.trim()) {
          try {
            // Validate regex before the request hits the backend.
            // eslint-disable-next-line no-new
            new RegExp(draft.regex.trim(), 'i');
          } catch {
            setTemplateFormError(`Evidence rule "${label}" has an invalid regex`);
            return;
          }
        }

        evidenceRules.push({
          key,
          label,
          type: draft.type,
          required: draft.required,
          multiple: draft.multiple,
          minItems: minItemsValue,
          maxItems: maxItemsValue,
          match:
            draft.type === 'link'
              ? {
                  hosts: splitDelimitedValues(draft.hosts),
                  contains: splitDelimitedValues(draft.contains),
                  regex: draft.regex.trim() || null,
                }
              : null,
        });
      }

      if (evidenceRules.length > 0) {
        nextScheduleConfig.evidenceRules = evidenceRules;
      } else {
        delete nextScheduleConfig.evidenceRules;
      }

      if (
        linkedKnowledgeEntryIds.length > 0 ||
        linkedPolicyEntryIds.length > 0 ||
        linkedQuizIds.length > 0
      ) {
        nextScheduleConfig[CEREBRO_LINKS_CONFIG_KEY] = {
          knowledgeEntryIds: linkedKnowledgeEntryIds,
          policyEntryIds: linkedPolicyEntryIds,
          quizIds: linkedQuizIds,
        };
      } else {
        delete nextScheduleConfig[CEREBRO_LINKS_CONFIG_KEY];
      }

      const payload = {
        name: templateFormState.name.trim(),
        description: templateFormState.description.trim() || null,
        category: templateFormState.category.trim() || 'Assistant Manager Tasks',
        subgroup: templateFormState.subgroup.trim() || 'General',
        categoryOrder: categoryOrderNumeric,
        subgroupOrder: subgroupOrderNumeric,
        templateOrder: templateOrderNumeric,
        cadence: templateFormState.cadence,
        scheduleConfig: nextScheduleConfig,
      };

      const candidateTemplate: AssistantManagerTaskTemplate = {
        id: editingTemplate?.id ?? 0,
        name: payload.name,
        description: payload.description,
        category: payload.category,
        subgroup: payload.subgroup,
        categoryOrder: categoryOrderNumeric,
        subgroupOrder: subgroupOrderNumeric,
        templateOrder: templateOrderNumeric,
        cadence: payload.cadence,
        scheduleConfig: payload.scheduleConfig,
        isActive: editingTemplate?.isActive ?? true,
        assignments: editingTemplate?.assignments ?? [],
      };
      const conflictMessage = findTemplateTimingConflict({
        candidateTemplate,
        templates,
        excludeTemplateId: editingTemplate?.id ?? null,
      });
      if (conflictMessage) {
        setTemplateFormError(conflictMessage);
        return;
      }

      if (editingTemplate) {
        await dispatch(
          updateAmTaskTemplate({ templateId: editingTemplate.id, payload }),
        ).unwrap();
      } else {
        await dispatch(createAmTaskTemplate(payload)).unwrap();
      }

      await dispatch(fetchAmTaskTemplates());
      closeTemplateModal();
    } catch (error) {
      setTemplateFormError(
        error instanceof Error ? error.message : 'Failed to save template',
      );
    } finally {
      setTemplateSubmitting(false);
    }
  }, [closeTemplateModal, dispatch, editingTemplate, templateFormState, templates]);

  const swapTemplateOrderValues = useCallback(
    async ({
      currentTemplateId,
      currentPayload,
      targetTemplateId,
      targetPayload,
      busyKey,
      direction,
    }: {
      currentTemplateId: number;
      currentPayload: Partial<AssistantManagerTaskTemplate>;
      targetTemplateId: number;
      targetPayload: Partial<AssistantManagerTaskTemplate>;
      busyKey: string;
      direction: 'up' | 'down';
    }) => {
      setTemplateReorderBusyKey(busyKey);
      setTemplateReorderDirection(direction);
      try {
        await dispatch(
          updateAmTaskTemplate({
            templateId: currentTemplateId,
            payload: currentPayload,
          }),
        ).unwrap();
        await dispatch(
          updateAmTaskTemplate({
            templateId: targetTemplateId,
            payload: targetPayload,
          }),
        ).unwrap();
        await dispatch(fetchAmTaskTemplates());
      } catch (error) {
        console.error('Failed to reorder templates', error);
      } finally {
        setTemplateReorderBusyKey(null);
        setTemplateReorderDirection(null);
      }
    },
    [dispatch],
  );

  const openAssignmentModal = useCallback(
    (template: AssistantManagerTaskTemplate, assignment?: AssistantManagerTaskAssignment) => {
      setSelectedTemplateId(template.id);

      if (assignment) {
        setEditingAssignment(assignment);
        setAssignmentFormState({
          staffProfileFilter: getStaffProfileFilterValue(assignment),
          userId: assignment.userId ? String(assignment.userId) : '',
          userTypeId: assignment.userTypeId ? String(assignment.userTypeId) : '',
          shiftRoleId: assignment.shiftRoleId ? String(assignment.shiftRoleId) : '',
          effectiveStart: assignment.effectiveStart ?? '',
          effectiveEnd: assignment.effectiveEnd ?? '',
        });
      } else {
        setEditingAssignment(null);
        setAssignmentFormState({
          ...defaultAssignmentFormState,
          userTypeId: defaultAssistantManagerUserTypeId,
          shiftRoleId: defaultManagerShiftRoleId,
        });
      }

      setAssignmentFormError(null);
      setAssignmentModalOpen(true);
    },
    [defaultAssistantManagerUserTypeId, defaultManagerShiftRoleId],
  );

  const updateTemplateSelection = useCallback((templateIds: number[], checked: boolean) => {
    setSelectedTemplateIds((prev) => {
      const next = new Set(prev);
      templateIds.forEach((templateId) => {
        if (checked) {
          next.add(templateId);
        } else {
          next.delete(templateId);
        }
      });
      return Array.from(next);
    });
  }, []);

  const toggleTemplateSelection = useCallback(
    (templateId: number, checked: boolean) => {
      updateTemplateSelection([templateId], checked);
    },
    [updateTemplateSelection],
  );

  const clearSelectedTemplates = useCallback(() => {
    setSelectedTemplateIds([]);
  }, []);

  const selectAllTemplates = useCallback(() => {
    setSelectedTemplateIds(templates.map((template) => template.id));
  }, [templates]);

  const toggleCategorySelection = useCallback(
    (templateIds: number[], checked: boolean) => {
      updateTemplateSelection(templateIds, checked);
    },
    [updateTemplateSelection],
  );

  const toggleSubgroupSelection = useCallback(
    (templateIds: number[], checked: boolean) => {
      updateTemplateSelection(templateIds, checked);
    },
    [updateTemplateSelection],
  );

  const openBulkAssignmentModal = useCallback(() => {
    if (selectedTemplateIds.length === 0) {
      return;
    }
    setEditingAssignment(null);
    setAssignmentFormState({
      ...defaultAssignmentFormState,
      userTypeId: defaultAssistantManagerUserTypeId,
      shiftRoleId: defaultManagerShiftRoleId,
    });
    setBulkAssignmentError(null);
    setBulkAssignmentModalOpen(true);
  }, [defaultAssistantManagerUserTypeId, defaultManagerShiftRoleId, selectedTemplateIds.length]);

  const closeBulkAssignmentModal = useCallback(() => {
    if (bulkAssignmentSubmitting) {
      return;
    }

    setBulkAssignmentModalOpen(false);
    setBulkAssignmentError(null);
  }, [bulkAssignmentSubmitting]);

  const openSyncExistingTasksModal = useCallback((template?: AssistantManagerTaskTemplate) => {
    const [currentStart, currentEnd] = logDateRange;
    setSyncExistingTasksDateRange([
      currentStart ?? new Date(),
      currentEnd ?? dayjs().add(6, 'day').toDate(),
    ]);
    setSyncExistingTasksTemplate(template ?? null);
    setSyncExistingTasksError(null);
    setSyncExistingTasksSummary(null);
    setSyncExistingTasksModalOpen(true);
  }, [logDateRange]);

  const closeSyncExistingTasksModal = useCallback(() => {
    if (syncExistingTasksSubmitting) {
      return;
    }
    setSyncExistingTasksModalOpen(false);
    setSyncExistingTasksError(null);
    setSyncExistingTasksTemplate(null);
  }, [syncExistingTasksSubmitting]);

  const buildAssignmentPayloadFromForm = useCallback(
    (formState: AssignmentFormState) => {
      const trimmedUserId = formState.userId.trim();
      const trimmedStaffProfileFilter = formState.staffProfileFilter.trim();
      const trimmedUserTypeId = formState.userTypeId.trim();
      const trimmedShiftRoleId = formState.shiftRoleId.trim();
      const staffProfile = parseStaffProfileFilter(trimmedStaffProfileFilter);

      if (
        !trimmedUserId &&
        !staffProfile.staffType &&
        !trimmedUserTypeId &&
        !trimmedShiftRoleId
      ) {
        return {
          error:
            'Select at least one filter: user, staff profile, user type, or shift role',
        };
      }

      let parsedUserId: number | null = null;
      if (trimmedUserId) {
        parsedUserId = Number(trimmedUserId);
        if (!Number.isInteger(parsedUserId) || parsedUserId <= 0) {
          return { error: 'Selected user is invalid' };
        }
      }

      let parsedUserTypeId: number | null = null;
      if (trimmedUserTypeId) {
        parsedUserTypeId = Number(trimmedUserTypeId);
        if (!Number.isInteger(parsedUserTypeId) || parsedUserTypeId <= 0) {
          return { error: 'User type is invalid' };
        }
      }

      let parsedShiftRoleId: number | null = null;
      if (trimmedShiftRoleId) {
        parsedShiftRoleId = Number(trimmedShiftRoleId);
        if (!Number.isInteger(parsedShiftRoleId) || parsedShiftRoleId <= 0) {
          return { error: 'Shift role is invalid' };
        }
      }

      return {
        payload: {
          staffType: staffProfile.staffType,
          livesInAccom: staffProfile.livesInAccom,
          userId: parsedUserId,
          userTypeId: parsedUserTypeId,
          shiftRoleId: parsedShiftRoleId,
          effectiveStart: formState.effectiveStart || null,
          effectiveEnd: formState.effectiveEnd || null,
        },
      };
    },
    [],
  );

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
    const result = buildAssignmentPayloadFromForm(assignmentFormState);
    if ('error' in result) {
      setAssignmentFormError(result.error ?? 'Failed to save assignment');
      return;
    }

    setAssignmentSubmitting(true);
    setAssignmentFormError(null);

    try {
      const payload = result.payload;

      if (editingAssignment) {
        await dispatch(
          updateAmTaskAssignment({
            templateId: selectedTemplateId,
            assignmentId: editingAssignment.id,
            payload,
          }),
        ).unwrap();
      } else {
        await dispatch(
          createAmTaskAssignment({ templateId: selectedTemplateId, payload }),
        ).unwrap();
      }

      await dispatch(fetchAmTaskTemplates());
      closeAssignmentModal();
    } catch (error) {
      setAssignmentFormError(
        error instanceof Error ? error.message : 'Failed to save assignment',
      );
    } finally {
      setAssignmentSubmitting(false);
    }
  }, [
    assignmentFormState,
    buildAssignmentPayloadFromForm,
    closeAssignmentModal,
    dispatch,
    editingAssignment,
    selectedTemplateId,
  ]);

  const handleBulkAssignmentSubmit = useCallback(async () => {
    if (selectedTemplateIds.length === 0) {
      setBulkAssignmentError('Select at least one template');
      return;
    }

    const result = buildAssignmentPayloadFromForm(assignmentFormState);
    if ('error' in result) {
      setBulkAssignmentError(result.error ?? 'Failed to bulk assign templates');
      return;
    }

    setBulkAssignmentSubmitting(true);
    setBulkAssignmentError(null);

    try {
      await dispatch(
        bulkCreateAmTaskAssignments({
          templateIds: selectedTemplateIds,
          payload: result.payload,
        }),
      ).unwrap();
      await dispatch(fetchAmTaskTemplates());
      setSelectedTemplateIds([]);
      closeBulkAssignmentModal();
    } catch (error) {
      setBulkAssignmentError(
        error instanceof Error ? error.message : 'Failed to bulk assign templates',
      );
    } finally {
      setBulkAssignmentSubmitting(false);
    }
  }, [
    assignmentFormState,
    buildAssignmentPayloadFromForm,
    closeBulkAssignmentModal,
    dispatch,
    selectedTemplateIds,
  ]);

  const handleSyncExistingTasksSubmit = useCallback(async () => {
    const [startDate, endDate] = syncExistingTasksDateRange;
    if (!startDate || !endDate) {
      setSyncExistingTasksError('Select a start and end date');
      return;
    }

    const start = dayjs(startDate).startOf('day');
    const end = dayjs(endDate).endOf('day');
    if (!start.isValid() || !end.isValid() || end.isBefore(start, 'day')) {
      setSyncExistingTasksError('Choose a valid date range');
      return;
    }

    setSyncExistingTasksSubmitting(true);
    setSyncExistingTasksError(null);

    try {
      const summary = await syncAmTaskLogsWithTemplateConfig({
        startDate: start.format('YYYY-MM-DD'),
        endDate: end.format('YYYY-MM-DD'),
        templateId: syncExistingTasksTemplate?.id ?? null,
      });
      setSyncExistingTasksSummary(summary);
      await refreshLogs();
    } catch (error) {
      setSyncExistingTasksError(
        getErrorMessage(error, 'Failed to update existing task logs'),
      );
    } finally {
      setSyncExistingTasksSubmitting(false);
    }
  }, [refreshLogs, syncExistingTasksDateRange, syncExistingTasksTemplate?.id]);

  const openGenerateWeeklyTasksPreview = useCallback(async () => {
    const [startDate, endDate] = logDateRange;
    if (!startDate || !endDate) {
      setGeneratePreviewError('Select a start and end date');
      setGeneratePreviewSummary(null);
      setGeneratePreviewModalOpen(true);
      return;
    }

    const start = dayjs(startDate).startOf('day');
    const end = dayjs(endDate).endOf('day');
    if (!start.isValid() || !end.isValid() || end.isBefore(start, 'day')) {
      setGeneratePreviewError('Choose a valid date range');
      setGeneratePreviewSummary(null);
      setGeneratePreviewModalOpen(true);
      return;
    }

    setGeneratePreviewModalOpen(true);
    setGeneratePreviewLoading(true);
    setGeneratePreviewError(null);
    setGeneratePreviewSummary(null);
    setGenerateWeeklyTasksError(null);
    setClearWeekError(null);
    setClearWeekSummary(null);

    try {
      const summary = await previewAmTaskLogsForRange({
        startDate: start.format('YYYY-MM-DD'),
        endDate: end.format('YYYY-MM-DD'),
      });
      setGeneratePreviewSummary(summary);
    } catch (error) {
      setGeneratePreviewError(
        getErrorMessage(error, 'Failed to preview weekly tasks'),
      );
      setGeneratePreviewSummary(null);
    } finally {
      setGeneratePreviewLoading(false);
    }
  }, [logDateRange]);

  const closeGeneratePreviewModal = useCallback(() => {
    if (generatePreviewLoading || generateWeeklyTasksSubmitting) {
      return;
    }

    setGeneratePreviewModalOpen(false);
    setGeneratePreviewError(null);
  }, [generatePreviewLoading, generateWeeklyTasksSubmitting]);

  const handleGenerateWeeklyTasks = useCallback(async () => {
    const [startDate, endDate] = logDateRange;
    if (!startDate || !endDate) {
      setGeneratePreviewError('Select a start and end date');
      return;
    }

    const start = dayjs(startDate).startOf('day');
    const end = dayjs(endDate).endOf('day');
    if (!start.isValid() || !end.isValid() || end.isBefore(start, 'day')) {
      setGeneratePreviewError('Choose a valid date range');
      return;
    }

    setGenerateWeeklyTasksSubmitting(true);
    setGenerateWeeklyTasksError(null);
    setGeneratePreviewError(null);

    try {
      const summary = await generateAmTaskLogsForRange({
        startDate: start.format('YYYY-MM-DD'),
        endDate: end.format('YYYY-MM-DD'),
      });
      setGenerateWeeklyTasksSummary(summary);
      setGeneratePreviewModalOpen(false);
      await refreshLogs();
    } catch (error) {
      setGenerateWeeklyTasksError(
        getErrorMessage(error, 'Failed to generate weekly tasks'),
      );
      setGeneratePreviewError(
        getErrorMessage(error, 'Failed to generate weekly tasks'),
      );
      setGenerateWeeklyTasksSummary(null);
    } finally {
      setGenerateWeeklyTasksSubmitting(false);
    }
  }, [logDateRange, refreshLogs]);

  const handleClearWeek = useCallback(async () => {
    const [startDate, endDate] = logDateRange;
    if (!startDate || !endDate) {
      setClearWeekError('Select a start and end date');
      setClearWeekSummary(null);
      return;
    }

    const start = dayjs(startDate).startOf('day');
    const end = dayjs(endDate).endOf('day');
    if (!start.isValid() || !end.isValid() || end.isBefore(start, 'day')) {
      setClearWeekError('Choose a valid date range');
      setClearWeekSummary(null);
      return;
    }

    const confirmed = window.confirm(
      `Clear all task logs from ${start.format('MMM D, YYYY')} to ${end.format('MMM D, YYYY')}? This removes generated, manual, completed, and pending tasks in the selected window.`,
    );
    if (!confirmed) {
      return;
    }

    setClearWeekSubmitting(true);
    setClearWeekError(null);
    setGenerateWeeklyTasksError(null);

    try {
      const summary = await clearAmTaskLogsForRange({
        startDate: start.format('YYYY-MM-DD'),
        endDate: end.format('YYYY-MM-DD'),
      });
      setClearWeekSummary(summary);
      setGenerateWeeklyTasksSummary(null);
      await refreshLogs();
    } catch (error) {
      setClearWeekError(getErrorMessage(error, 'Failed to clear weekly tasks'));
      setClearWeekSummary(null);
    } finally {
      setClearWeekSubmitting(false);
    }
  }, [logDateRange, refreshLogs]);

  const handleAssignmentDateChange = useCallback(
    (key: 'effectiveStart' | 'effectiveEnd', date: Date | null) => {
      setAssignmentFormState((prev) => ({
        ...prev,
        [key]: date ? dayjs(date).format('YYYY-MM-DD') : '',
      }));
    },
    [],
  );

  const handleAssignmentDelete = useCallback(
    async (templateId: number, assignmentId: number) => {
      if (!window.confirm('Delete this assignment?')) {
        return;
      }

      try {
        await dispatch(deleteAmTaskAssignment({ templateId, assignmentId })).unwrap();
        await dispatch(fetchAmTaskTemplates());
      } catch (error) {
        console.error('Failed to delete assignment', error);
      }
    },
    [dispatch],
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
      setManualFormError('User is required');
      return;
    }

    if (!manualFormState.taskDate) {
      setManualFormError('Task date is required');
      return;
    }

    const userId = Number(manualFormState.userId);
    if (!Number.isFinite(userId) || userId <= 0) {
      setManualFormError('Selected user is invalid');
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
      notes: manualFormState.notes.trim() || undefined,
      time: manualFormState.time.trim() || undefined,
      durationHours,
      priority: manualFormState.priority,
      points,
      tags: manualFormState.tags
        ? manualFormState.tags
            .split(',')
            .map((tag) => tag.trim())
            .filter(Boolean)
        : undefined,
      comment: manualFormState.comment.trim() || undefined,
      requireShift: manualFormState.requireShift,
    };

    setManualSubmitting(true);
    setManualFormError(null);

    try {
      await dispatch(createManualAmTaskLog(payload)).unwrap();
      await refreshLogs();
      closeManualModal();
    } catch (error) {
      setManualFormError(
        error instanceof Error ? error.message : 'Failed to create task',
      );
    } finally {
      setManualSubmitting(false);
    }
  }, [closeManualModal, dispatch, manualFormState, refreshLogs]);

  const handleLogSelect = useCallback((log: AssistantManagerTaskLog) => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('task', String(log.id));
    setSearchParams(nextParams, { replace: false });
  }, [searchParams, setSearchParams]);

  const handleCloseEvidenceImagePreview = useCallback(() => {
    setActiveEvidenceImagePreview(null);
    setEvidenceImageZoom(1);
    setEvidencePreviewLoadingItemId(null);
    if (evidencePreviewObjectUrlRef.current) {
      URL.revokeObjectURL(evidencePreviewObjectUrlRef.current);
      evidencePreviewObjectUrlRef.current = null;
    }
  }, []);

  const handleCloseCerebroItemModal = useCallback(() => {
    setCerebroItemModalOpen(false);
    setCerebroItemLoading(false);
    setCerebroItemError(null);
    setActiveCerebroItem(null);
  }, []);

  const stopCameraCaptureStream = useCallback(() => {
    const stream = cameraStreamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      cameraStreamRef.current = null;
    }
    if (cameraVideoRef.current) {
      cameraVideoRef.current.srcObject = null;
    }
  }, []);

  const closeCameraCaptureModal = useCallback(() => {
    stopCameraCaptureStream();
    setCameraCaptureState({
      opened: false,
      rule: null,
    });
    setCameraCaptureError(null);
    setCameraCaptureLoading(false);
    setCameraCaptureSubmitting(false);
  }, [stopCameraCaptureStream]);

  const openCameraCaptureModal = useCallback((rule: AssistantManagerTaskEvidenceRule) => {
    setCameraCaptureState({
      opened: true,
      rule,
    });
    setCameraCaptureError(null);
  }, []);

  const handleOpenCerebroItem = useCallback(
    async (type: AmTaskCerebroLinkItemType, id: number) => {
      setCerebroItemModalOpen(true);
      setCerebroItemLoading(true);
      setCerebroItemError(null);
      setActiveCerebroItem(null);

      try {
        const detail = await fetchAmTaskCerebroLinkItemDetail({ type, id });
        setActiveCerebroItem(detail);
      } catch (error) {
        setCerebroItemError(getErrorMessage(error, 'Failed to load Cerebro item'));
      } finally {
        setCerebroItemLoading(false);
      }
    },
    [],
  );

  const closeLogDetailModal = useCallback(() => {
    if (logDetailSubmitting || commentSubmitting) {
      return;
    }

    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('task');
    setSearchParams(nextParams, { replace: false });
    setLogDetailModalOpen(false);
    setSelectedLog(null);
    setLogDetailFormState(defaultLogDetailFormState);
    setLogDetailError(null);
    setEvidenceUploadingRuleKey(null);
    setLinkInputCounts({});
    setEvidenceRuleEditModes({});
    setCommentDraft('');
    handleCloseEvidenceImagePreview();
    handleCloseCerebroItemModal();
    closeCameraCaptureModal();
  }, [
    commentSubmitting,
    closeCameraCaptureModal,
    handleCloseCerebroItemModal,
    handleCloseEvidenceImagePreview,
    logDetailSubmitting,
    searchParams,
    setSearchParams,
  ]);

  const handleTaskLogDelete = useCallback(
    async (log: AssistantManagerTaskLog) => {
      if (!canDeleteTaskLogs) {
        return;
      }

      const taskName = log.templateName ?? `Template #${log.templateId}`;
      const taskDateLabel = dayjs(log.taskDate).isValid()
        ? dayjs(log.taskDate).format('MMM D, YYYY')
        : String(log.taskDate);
      const confirmed = window.confirm(
        `Delete "${taskName}" on ${taskDateLabel}? This also removes all saved evidence files/images from storage.`,
      );
      if (!confirmed) {
        return;
      }

      setLogDeletePendingId(log.id);
      setLogDetailError(null);

      try {
        await dispatch(deleteAmTaskLog(log.id)).unwrap();
        await refreshLogs();
        if (selectedLog?.id === log.id) {
          closeLogDetailModal();
        }
      } catch (error) {
        setLogDetailError(getErrorMessage(error, 'Failed to delete task'));
      } finally {
        setLogDeletePendingId((prev) => (prev === log.id ? null : prev));
      }
    },
    [canDeleteTaskLogs, closeLogDetailModal, dispatch, refreshLogs, selectedLog?.id],
  );

  const handleEvidenceRuleDraftChange = useCallback(
    (
      draftId: string,
      field: keyof EvidenceRuleDraft,
      value: string | boolean,
    ) => {
      setTemplateFormState((prev) => ({
        ...prev,
        evidenceRules: prev.evidenceRules.map((rule) =>
          rule.id === draftId ? ({ ...rule, [field]: value } as EvidenceRuleDraft) : rule,
        ),
      }));
    },
    [],
  );

  const addTemplateEvidenceRuleDraft = useCallback((type: 'link' | 'image') => {
    setTemplateFormState((prev) => ({
      ...prev,
      evidenceRules: [
        ...prev.evidenceRules,
        createEvidenceRuleDraft(type, {
          key: getNextEvidenceRuleKey(`${type}_rule`, prev.evidenceRules),
          label: type === 'link' ? 'Link evidence' : 'Image evidence',
        }),
      ],
    }));
  }, []);

  const addTemplateEvidencePreset = useCallback((preset: EvidenceRulePreset) => {
    setTemplateFormState((prev) => ({
      ...prev,
      evidenceRules: [
        ...prev.evidenceRules,
        createEvidenceRuleDraft(preset.draft.type, {
          ...preset.draft,
          key: getNextEvidenceRuleKey(preset.draft.key, prev.evidenceRules),
        }),
      ],
    }));
  }, []);

  const removeTemplateEvidenceRuleDraft = useCallback((draftId: string) => {
    setTemplateFormState((prev) => ({
      ...prev,
      evidenceRules: prev.evidenceRules.filter((rule) => rule.id !== draftId),
    }));
  }, []);

  const handleLinkEvidenceChange = useCallback(
    (rule: AssistantManagerTaskEvidenceRule, index: number, value: string) => {
      setLogDetailFormState((prev) => ({
        ...prev,
        evidenceItems: upsertLinkEvidenceItem(prev.evidenceItems, rule, index, value),
      }));
      setLogDetailError(null);
    },
    [],
  );

  const handleLinkEvidenceRemove = useCallback((itemId: string) => {
    setLogDetailFormState((prev) => ({
      ...prev,
      evidenceItems: prev.evidenceItems.filter((item) => item.id !== itemId),
    }));
  }, []);

  const handleAddLinkEvidenceInput = useCallback(
    (ruleKey: string, nextCount: number) => {
      setLinkInputCounts((prev) => ({
        ...prev,
        [ruleKey]: nextCount,
      }));
    },
    [],
  );

  const handleEvidenceImageSelected = useCallback(
    async (rule: AssistantManagerTaskEvidenceRule, file: File | null) => {
      if (!selectedLog || !file) {
        return;
      }

      setEvidenceUploadingRuleKey(rule.key);
      setLogDetailError(null);

      try {
        const compressedFile = await compressImageFile(file, { force: true });
        const response = (await dispatch(
          uploadAmTaskEvidenceImage({
            logId: selectedLog.id,
            ruleKey: rule.key,
            file: compressedFile,
          }),
        ).unwrap()) as UploadAmTaskEvidenceImageResponse[];
        const uploadedItem = response?.[0];

        if (uploadedItem) {
          const nextItem: AssistantManagerTaskEvidenceItem = {
            ...uploadedItem,
            valid: true,
          };
          setLogDetailFormState((prev) => ({
            ...prev,
            evidenceItems: applyUploadedEvidenceItem(prev.evidenceItems, rule, nextItem),
          }));
          setSelectedLog((prev) =>
            prev
              ? {
                  ...prev,
                  meta: {
                    ...(prev.meta ?? {}),
                    evidenceItems: applyUploadedEvidenceItem(
                      getNormalizedEvidenceItems(prev.meta),
                      rule,
                      nextItem,
                    ),
                  },
                }
              : prev,
          );
          setEvidenceRuleEditModes((prev) => ({
            ...prev,
            [rule.key]: false,
          }));
        }

        await refreshLogs();
      } catch (error) {
        setLogDetailError(getErrorMessage(error, 'Failed to upload evidence image'));
      } finally {
        setEvidenceUploadingRuleKey(null);
      }
    },
    [dispatch, refreshLogs, selectedLog],
  );

  useEffect(() => {
    if (!cameraCaptureState.opened || !cameraCaptureState.rule) {
      return undefined;
    }

    if (!cameraCaptureSupported) {
      setCameraCaptureError('Camera capture is not supported in this browser.');
      return undefined;
    }

    let cancelled = false;

    const openCamera = async () => {
      setCameraCaptureLoading(true);
      setCameraCaptureError(null);

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        cameraStreamRef.current = stream;
        if (cameraVideoRef.current) {
          cameraVideoRef.current.srcObject = stream;
          await cameraVideoRef.current.play().catch(() => undefined);
        }
      } catch (error) {
        if (!cancelled) {
          setCameraCaptureError(
            getErrorMessage(error, 'Unable to access the device camera'),
          );
        }
      } finally {
        if (!cancelled) {
          setCameraCaptureLoading(false);
        }
      }
    };

    openCamera().catch(() => undefined);

    return () => {
      cancelled = true;
      stopCameraCaptureStream();
    };
  }, [cameraCaptureState.opened, cameraCaptureState.rule, cameraCaptureSupported, stopCameraCaptureStream]);

  const handleCapturePhoto = useCallback(async () => {
    if (!cameraCaptureState.rule || !cameraVideoRef.current || !cameraCanvasRef.current) {
      return;
    }

    const video = cameraVideoRef.current;
    const canvas = cameraCanvasRef.current;
    const width = video.videoWidth;
    const height = video.videoHeight;

    if (!width || !height) {
      setCameraCaptureError('Camera preview is not ready yet.');
      return;
    }

    const context = canvas.getContext('2d');
    if (!context) {
      setCameraCaptureError('Unable to prepare image capture.');
      return;
    }

    setCameraCaptureSubmitting(true);
    setCameraCaptureError(null);

    try {
      canvas.width = width;
      canvas.height = height;
      context.drawImage(video, 0, 0, width, height);

      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, 'image/jpeg', 0.92);
      });

      if (!blob) {
        throw new Error('Unable to capture image from camera');
      }

      const timestamp = dayjs().format('YYYYMMDD_HHmmss');
      const file = new File([blob], `task_evidence_${timestamp}.jpg`, {
        type: 'image/jpeg',
        lastModified: Date.now(),
      });

      await handleEvidenceImageSelected(cameraCaptureState.rule, file);
      closeCameraCaptureModal();
    } catch (error) {
      setCameraCaptureError(getErrorMessage(error, 'Failed to capture photo'));
    } finally {
      setCameraCaptureSubmitting(false);
    }
  }, [cameraCaptureState.rule, closeCameraCaptureModal, handleEvidenceImageSelected]);

  const handleLogDetailSave = useCallback(async () => {
    if (!selectedLog) {
      return;
    }

    const payload: TaskLogMetaUpdatePayload = {
      evidenceItems: logDetailFormState.evidenceItems,
    };

    setLogDetailSubmitting(true);
    setLogDetailCompleting(true);
    setLogDetailError(null);

    try {
      const metaResponse = (await dispatch(
        updateAmTaskLogMeta({ logId: selectedLog.id, payload }),
      ).unwrap()) as ServerResponse<AssistantManagerTaskLog>;
      const metaUpdatedLog = (metaResponse?.[0]?.data as AssistantManagerTaskLog[] | undefined)?.[0];

      if (metaUpdatedLog) {
        setSelectedLog(metaUpdatedLog);
        setLogDetailFormState(buildLogDetailFormStateFromLog(metaUpdatedLog));
      }

      const statusResponse = (await dispatch(
        updateAmTaskLogStatus({ logId: selectedLog.id, payload: { status: 'completed' } }),
      ).unwrap()) as ServerResponse<AssistantManagerTaskLog>;
      const completedLog = (statusResponse?.[0]?.data as AssistantManagerTaskLog[] | undefined)?.[0];

      if (completedLog) {
        setSelectedLog(completedLog);
        setLogDetailFormState(buildLogDetailFormStateFromLog(completedLog));
      }
      await refreshLogs();
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete('task');
      setSearchParams(nextParams, { replace: false });
      setLogDetailModalOpen(false);
      setSelectedLog(null);
      setLogDetailFormState(defaultLogDetailFormState);
      setLogDetailError(null);
      setEvidenceUploadingRuleKey(null);
      setLinkInputCounts({});
      setEvidenceRuleEditModes({});
      setCommentDraft('');
    } catch (error) {
      setLogDetailError(getErrorMessage(error, 'Failed to update task'));
    } finally {
      setLogDetailCompleting(false);
      setLogDetailSubmitting(false);
    }
  }, [dispatch, logDetailFormState.evidenceItems, refreshLogs, searchParams, selectedLog, setSearchParams]);

  const handleLogDetailReopen = useCallback(async () => {
    if (!selectedLog || !selectedLogCanReopen) {
      return;
    }

    setLogDetailSubmitting(true);
    setLogDetailReopening(true);
    setLogDetailError(null);

    try {
      const statusResponse = (await dispatch(
        updateAmTaskLogStatus({ logId: selectedLog.id, payload: { status: 'pending' } }),
      ).unwrap()) as ServerResponse<AssistantManagerTaskLog>;
      const reopenedLog = (statusResponse?.[0]?.data as AssistantManagerTaskLog[] | undefined)?.[0];

      if (reopenedLog) {
        setSelectedLog(reopenedLog);
        setLogDetailFormState(buildLogDetailFormStateFromLog(reopenedLog));
      }

      await refreshLogs();
    } catch (error) {
      setLogDetailError(getErrorMessage(error, 'Failed to reopen task'));
    } finally {
      setLogDetailReopening(false);
      setLogDetailSubmitting(false);
    }
  }, [dispatch, refreshLogs, selectedLog, selectedLogCanReopen]);

  const handleLogEvidenceSaveRule = useCallback(async (rule: AssistantManagerTaskEvidenceRule) => {
    if (!selectedLog || selectedLogEvidenceReadOnly) {
      return;
    }

    const savedItems = getNormalizedEvidenceItems(selectedLog.meta);
    const currentRuleItems = getRuleItems(logDetailFormState.evidenceItems, rule);
    const payload: TaskLogMetaUpdatePayload = {
      evidenceItems: replaceRuleItems(savedItems, rule, currentRuleItems),
    };

    setLogDetailSubmitting(true);
    setLogDetailError(null);

    try {
      const metaResponse = (await dispatch(
        updateAmTaskLogMeta({ logId: selectedLog.id, payload }),
      ).unwrap()) as ServerResponse<AssistantManagerTaskLog>;
      const metaUpdatedLog = (metaResponse?.[0]?.data as AssistantManagerTaskLog[] | undefined)?.[0];

      if (metaUpdatedLog) {
        setSelectedLog(metaUpdatedLog);
        setLogDetailFormState(buildLogDetailFormStateFromLog(metaUpdatedLog));
        const savedRuleItems = getRuleItems(getNormalizedEvidenceItems(metaUpdatedLog.meta), rule);
        const hasSavedData = savedRuleItems.some(hasEvidenceItemContent);
        setEvidenceRuleEditModes((prev) => ({
          ...prev,
          [rule.key]: !hasSavedData,
        }));
      }

      await refreshLogs();
    } catch (error) {
      setLogDetailError(getErrorMessage(error, 'Failed to save evidence'));
    } finally {
      setLogDetailSubmitting(false);
    }
  }, [dispatch, logDetailFormState.evidenceItems, refreshLogs, selectedLog, selectedLogEvidenceReadOnly]);

  const handleEvidenceRuleEditStart = useCallback((ruleKey: string) => {
    setEvidenceRuleEditModes((prev) => ({
      ...prev,
      [ruleKey]: true,
    }));
    setLogDetailError(null);
  }, []);

  const handleEvidenceRuleEditCancel = useCallback(
    (rule: AssistantManagerTaskEvidenceRule) => {
      if (!selectedLog) {
        return;
      }

      const savedItems = getNormalizedEvidenceItems(selectedLog.meta);
      const savedRuleItems = getRuleItems(savedItems, rule);
      const hasSavedData = savedRuleItems.some(hasEvidenceItemContent);

      setLogDetailFormState((prev) => ({
        ...prev,
        evidenceItems: replaceRuleItems(prev.evidenceItems, rule, savedRuleItems),
      }));
      setEvidenceRuleEditModes((prev) => ({
        ...prev,
        [rule.key]: !hasSavedData,
      }));
      setLogDetailError(null);
    },
    [selectedLog],
  );

  const handleEvidenceImageDelete = useCallback(
    async (rule: AssistantManagerTaskEvidenceRule, itemId: string) => {
      if (!selectedLog || selectedLogEvidenceReadOnly) {
        return;
      }

      const savedItems = getNormalizedEvidenceItems(selectedLog.meta);
      const savedRuleItems = getRuleItems(savedItems, rule).filter((item) => item.id !== itemId);
      const payload: TaskLogMetaUpdatePayload = {
        evidenceItems: replaceRuleItems(savedItems, rule, savedRuleItems),
      };

      setLogDetailSubmitting(true);
      setLogDetailError(null);

      try {
        const metaResponse = (await dispatch(
          updateAmTaskLogMeta({ logId: selectedLog.id, payload }),
        ).unwrap()) as ServerResponse<AssistantManagerTaskLog>;
        const metaUpdatedLog = (metaResponse?.[0]?.data as AssistantManagerTaskLog[] | undefined)?.[0];

        if (metaUpdatedLog) {
          setSelectedLog(metaUpdatedLog);
          setLogDetailFormState(buildLogDetailFormStateFromLog(metaUpdatedLog));
          const hasSavedData = getRuleItems(
            getNormalizedEvidenceItems(metaUpdatedLog.meta),
            rule,
          ).some(hasEvidenceItemContent);
          setEvidenceRuleEditModes((prev) => ({
            ...prev,
            [rule.key]: !hasSavedData,
          }));
        }

        await refreshLogs();
      } catch (error) {
        setLogDetailError(getErrorMessage(error, 'Failed to delete evidence image'));
      } finally {
        setLogDetailSubmitting(false);
      }
    },
    [dispatch, refreshLogs, selectedLog, selectedLogEvidenceReadOnly],
  );

  const handleEvidenceImagePreviewOpen = useCallback(
    async (item: AssistantManagerTaskEvidenceItem) => {
      if (!selectedLog) {
        return;
      }

      const downloadHref = `/assistantManagerTasks/logs/${selectedLog.id}/evidence-files/${encodeURIComponent(
        item.id,
      )}/download`;
      const cachedThumb = evidenceImageThumbs[item.id];
      if (cachedThumb) {
        setActiveEvidenceImagePreview({
          src: cachedThumb,
          name: item.fileName ?? 'Uploaded image',
          capturedAt: item.uploadedAt ?? null,
          downloadHref: item.driveWebViewLink ?? downloadHref,
        });
        setEvidenceImageZoom(1);
        return;
      }
      setEvidencePreviewLoadingItemId(item.id);
      setLogDetailError(null);

      try {
        const response = await axiosInstance.get(downloadHref, {
          responseType: 'blob',
          withCredentials: true,
        });
        const objectUrl = URL.createObjectURL(response.data);

        if (evidencePreviewObjectUrlRef.current) {
          URL.revokeObjectURL(evidencePreviewObjectUrlRef.current);
        }
        evidencePreviewObjectUrlRef.current = objectUrl;

        setActiveEvidenceImagePreview({
          src: objectUrl,
          name: item.fileName ?? 'Uploaded image',
          capturedAt: item.uploadedAt ?? null,
          downloadHref: item.driveWebViewLink ?? downloadHref,
        });
        setEvidenceImageZoom(1);
      } catch (error) {
        if (item.driveWebViewLink) {
          setActiveEvidenceImagePreview({
            src: item.driveWebViewLink,
            name: item.fileName ?? 'Uploaded image',
            capturedAt: item.uploadedAt ?? null,
            downloadHref: item.driveWebViewLink,
          });
          setEvidenceImageZoom(1);
        } else {
          setLogDetailError(getErrorMessage(error, 'Unable to open this image preview'));
        }
      } finally {
        setEvidencePreviewLoadingItemId(null);
      }
    },
    [evidenceImageThumbs, selectedLog],
  );

  const handleEvidenceZoomIn = useCallback(() => {
    setEvidenceImageZoom((prev) => Math.min(EVIDENCE_PREVIEW_MAX_ZOOM, prev + 0.1));
  }, []);

  const handleEvidenceZoomOut = useCallback(() => {
    setEvidenceImageZoom((prev) => Math.max(EVIDENCE_PREVIEW_MIN_ZOOM, prev - 0.1));
  }, []);

  const handleEvidenceZoomReset = useCallback(() => {
    setEvidenceImageZoom(1);
  }, []);

  const handleEvidencePreviewWheel = useCallback((event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const delta = event.deltaY > 0 ? -0.1 : 0.1;
    setEvidenceImageZoom((prev) =>
      Math.min(EVIDENCE_PREVIEW_MAX_ZOOM, Math.max(EVIDENCE_PREVIEW_MIN_ZOOM, prev + delta)),
    );
  }, []);

  const handleCommentSubmit = useCallback(async () => {
    if (!selectedLog || !commentDraft.trim()) {
      return;
    }

    setCommentSubmitting(true);

    try {
      const response = (await dispatch(
        updateAmTaskLogMeta({
          logId: selectedLog.id,
          payload: { comment: commentDraft.trim() },
        }),
      ).unwrap()) as ServerResponse<AssistantManagerTaskLog>;
      const updatedLog = (response?.[0]?.data as AssistantManagerTaskLog[] | undefined)?.[0];

      if (updatedLog) {
        setSelectedLog(updatedLog);
        setLogDetailFormState(buildLogDetailFormStateFromLog(updatedLog));
      }

      await refreshLogs();
      setCommentDraft('');
    } catch (error) {
      setLogDetailError(getErrorMessage(error, 'Failed to add comment'));
    } finally {
      setCommentSubmitting(false);
    }
  }, [commentDraft, dispatch, refreshLogs, selectedLog]);

  const filteredLogs = useMemo(() => {
    if (logFilterStatus === 'all') {
      return logs;
    }
    return logs.filter((log) => log.status === logFilterStatus);
  }, [logFilterStatus, logs]);

  const orderedLogs = useMemo(
    () => [...filteredLogs].sort((left, right) => compareLogsByTime(left, right, templateMap)),
    [filteredLogs, templateMap],
  );

  const groupedLogs = useMemo(() => {
    const map = new Map<string, AssistantManagerTaskLog[]>();

    orderedLogs.forEach((log) => {
      if (!map.has(log.taskDate)) {
        map.set(log.taskDate, []);
      }
      map.get(log.taskDate)?.push(log);
    });

    return Array.from(map.entries()).sort(([left], [right]) =>
      left.localeCompare(right),
    );
  }, [orderedLogs]);

  const assignmentCount = useMemo(
    () => templates.reduce((count, template) => count + (template.assignments?.length ?? 0), 0),
    [templates],
  );

  const groupedTemplates = useMemo(() => {
    const categoryMap = new Map<
      string,
      {
        categoryOrder: number;
        subgroups: Map<
          string,
          {
            subgroupOrder: number;
            templates: AssistantManagerTaskTemplate[];
          }
        >;
      }
    >();

    templates.forEach((template) => {
      const taxonomy = normalizeTemplateCategory(template);
      if (!categoryMap.has(taxonomy.category)) {
        categoryMap.set(taxonomy.category, {
          categoryOrder: taxonomy.categoryOrder,
          subgroups: new Map(),
        });
      }
      const categoryEntry = categoryMap.get(taxonomy.category)!;
      categoryEntry.categoryOrder = Math.min(categoryEntry.categoryOrder, taxonomy.categoryOrder);
      if (!categoryEntry.subgroups.has(taxonomy.subgroup)) {
        categoryEntry.subgroups.set(taxonomy.subgroup, {
          subgroupOrder: taxonomy.subgroupOrder,
          templates: [],
        });
      }
      const subgroupEntry = categoryEntry.subgroups.get(taxonomy.subgroup)!;
      subgroupEntry.subgroupOrder = Math.min(subgroupEntry.subgroupOrder, taxonomy.subgroupOrder);
      subgroupEntry.templates.push(template);
    });

    return Array.from(categoryMap.entries())
      .sort((left, right) => {
        const orderCompare = left[1].categoryOrder - right[1].categoryOrder;
        if (orderCompare !== 0) {
          return orderCompare;
        }
        return left[0].localeCompare(right[0]);
      })
      .map(([category, categoryEntry]) => ({
        category,
        categoryOrder: categoryEntry.categoryOrder,
        subgroups: Array.from(categoryEntry.subgroups.entries())
          .sort((left, right) => {
            const orderCompare = left[1].subgroupOrder - right[1].subgroupOrder;
            if (orderCompare !== 0) {
              return orderCompare;
            }
            return left[0].localeCompare(right[0]);
          })
          .map(([subgroup, subgroupEntry]) => ({
            subgroup,
            subgroupOrder: subgroupEntry.subgroupOrder,
            templates: [...subgroupEntry.templates].sort((left, right) => {
              const leftTaxonomy = normalizeTemplateCategory(left);
              const rightTaxonomy = normalizeTemplateCategory(right);
              const orderCompare = leftTaxonomy.templateOrder - rightTaxonomy.templateOrder;
              if (orderCompare !== 0) {
                return orderCompare;
              }
              return left.name.localeCompare(right.name);
            }),
          })),
      }));
  }, [templates]);

  const handleCategoryMove = useCallback(
    async (category: string, direction: 'up' | 'down') => {
      const currentIndex = groupedTemplates.findIndex((group) => group.category === category);
      const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
      if (currentIndex < 0 || targetIndex < 0 || targetIndex >= groupedTemplates.length) {
        return;
      }

      const currentTemplate = groupedTemplates[currentIndex]?.subgroups[0]?.templates[0];
      const targetTemplate = groupedTemplates[targetIndex]?.subgroups[0]?.templates[0];
      if (!currentTemplate || !targetTemplate) {
        return;
      }

      await swapTemplateOrderValues({
        currentTemplateId: currentTemplate.id,
        currentPayload: { categoryOrder: targetTemplate.categoryOrder },
        targetTemplateId: targetTemplate.id,
        targetPayload: { categoryOrder: currentTemplate.categoryOrder },
        busyKey: `category:${category}`,
        direction,
      });
    },
    [groupedTemplates, swapTemplateOrderValues],
  );

  const handleSubgroupMove = useCallback(
    async (category: string, subgroup: string, direction: 'up' | 'down') => {
      const categoryGroup = groupedTemplates.find((group) => group.category === category);
      if (!categoryGroup) {
        return;
      }

      const currentIndex = categoryGroup.subgroups.findIndex((entry) => entry.subgroup === subgroup);
      const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
      if (currentIndex < 0 || targetIndex < 0 || targetIndex >= categoryGroup.subgroups.length) {
        return;
      }

      const currentTemplate = categoryGroup.subgroups[currentIndex]?.templates[0];
      const targetTemplate = categoryGroup.subgroups[targetIndex]?.templates[0];
      if (!currentTemplate || !targetTemplate) {
        return;
      }

      await swapTemplateOrderValues({
        currentTemplateId: currentTemplate.id,
        currentPayload: { subgroupOrder: targetTemplate.subgroupOrder },
        targetTemplateId: targetTemplate.id,
        targetPayload: { subgroupOrder: currentTemplate.subgroupOrder },
        busyKey: `subgroup:${category}:${subgroup}`,
        direction,
      });
    },
    [groupedTemplates, swapTemplateOrderValues],
  );

  const handleTemplateMove = useCallback(
    async (
      templatesInSubgroup: AssistantManagerTaskTemplate[],
      template: AssistantManagerTaskTemplate,
      direction: 'up' | 'down',
    ) => {
      const currentIndex = templatesInSubgroup.findIndex((entry) => entry.id === template.id);
      const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
      if (currentIndex < 0 || targetIndex < 0 || targetIndex >= templatesInSubgroup.length) {
        return;
      }

      const targetTemplate = templatesInSubgroup[targetIndex];
      if (!targetTemplate) {
        return;
      }

      await swapTemplateOrderValues({
        currentTemplateId: template.id,
        currentPayload: { templateOrder: targetTemplate.templateOrder },
        targetTemplateId: targetTemplate.id,
        targetPayload: { templateOrder: template.templateOrder },
        busyKey: `template:${template.id}`,
        direction,
      });
    },
    [swapTemplateOrderValues],
  );

  const dashboardSummary = useMemo(() => {
    const completedCount = orderedLogs.filter((log) => log.status === 'completed').length;
    const pendingCount = orderedLogs.filter((log) => log.status === 'pending').length;
    const manualCount = orderedLogs.filter((log) => Boolean(log.meta?.manual)).length;
    const totalPoints = orderedLogs.reduce((sum, log) => sum + getLogPoints(log, templateMap), 0);
    const completedPoints = orderedLogs
      .filter((log) => log.status === 'completed')
      .reduce((sum, log) => sum + getLogPoints(log, templateMap), 0);
    const completionRate = totalPoints > 0 ? Math.round((completedPoints / totalPoints) * 100) : 0;

    const nextPendingLog =
      orderedLogs.find((log) => log.status === 'pending') ?? null;
    const busiestDay = groupedLogs.reduce<{
      date: string | null;
      count: number;
    }>(
      (result, [date, entries]) =>
        entries.length > result.count ? { date, count: entries.length } : result,
      { date: null, count: 0 },
    );

    return {
      totalTasks: orderedLogs.length,
      completedCount,
      pendingCount,
      manualCount,
      completionRate,
      nextPendingLog,
      busiestDay,
    };
  }, [groupedLogs, orderedLogs, templateMap]);

  const setupSummary = useMemo(() => {
    const shiftAwareTemplates = templates.filter(
      (template) => resolveTemplateDefaults(template).requireShift,
    ).length;
    const subgroupCount = groupedTemplates.reduce(
      (count, group) => count + group.subgroups.length,
      0,
    );

    return {
      templateCount: templates.length,
      assignmentCount,
      shiftAwareTemplates,
      categoryCount: groupedTemplates.length,
      subgroupCount,
    };
  }, [assignmentCount, groupedTemplates, templates]);

  return (
    <Stack gap="md">
      <Paper
        withBorder
        radius="xl"
        px={isMobile ? 'md' : 'xl'}
        py="md"
        style={{
          background:
            'radial-gradient(circle at top left, rgba(14, 165, 233, 0.12), transparent 34%), radial-gradient(circle at top right, rgba(245, 158, 11, 0.12), transparent 28%), linear-gradient(180deg, #f8fafc 0%, #ffffff 100%)',
          borderColor: 'rgba(15, 23, 42, 0.08)',
        }}
      >
        <Stack gap="sm">
          <Group justify="space-between" align="flex-start" wrap="wrap">
            <Stack gap="md" style={{ flex: 1, minWidth: isMobile ? 0 : 320 }}>
              <Group gap="sm" wrap="wrap" align="center">
                {canViewAllTasks && (
                  <Paper
                    withBorder
                    radius="xl"
                    px="xs"
                    py="xs"
                    style={{
                      background:
                        'linear-gradient(135deg, rgba(255, 255, 255, 0.96) 0%, rgba(241, 245, 249, 0.96) 100%)',
                      borderColor: 'rgba(15, 23, 42, 0.08)',
                      boxShadow: '0 6px 16px rgba(15, 23, 42, 0.05)',
                    }}
                  >
                    <Group gap="xs" wrap="wrap" align="center">
                      <SegmentedControl
                        value={activeSection}
                        onChange={handleSectionChange}
                        data={[
                          { label: 'Dashboard', value: 'dashboard' },
                          { label: 'Setup', value: 'setup' },
                        ]}
                        aria-label="Task planner view"
                      />
                      {canCreateManualTasks && activeSection === 'dashboard' && (
                        <Button
                          leftSection={<IconPlus size={16} />}
                          radius="xl"
                          onClick={openManualModal}
                        >
                          New Task
                        </Button>
                      )}
                    </Group>
                  </Paper>
                )}
                {activeSection === 'dashboard' && (
                  <Paper
                    withBorder
                    radius="xl"
                    px="sm"
                    py="xs"
                    style={{
                      flex: isMobile ? '1 1 100%' : '1 1 720px',
                      minWidth: 0,
                      maxWidth: '100%',
                      background:
                        'linear-gradient(135deg, rgba(255, 255, 255, 0.96) 0%, rgba(241, 245, 249, 0.96) 100%)',
                      borderColor: 'rgba(15, 23, 42, 0.08)',
                      boxShadow: '0 10px 24px rgba(15, 23, 42, 0.05)',
                    }}
                  >
                    <Group
                      gap="xs"
                      wrap={isMobile ? 'wrap' : 'nowrap'}
                      align="center"
                      justify="center"
                    >
                      <Group
                        gap="xs"
                        wrap={isMobile ? 'wrap' : 'nowrap'}
                        align="center"
                        justify="center"
                        style={{ width: isMobile ? '100%' : 'auto', flexShrink: 0 }}
                      >
                        <Group gap="xs" wrap="wrap" align="center" justify="center">
                          <ThemeIcon
                            size={30}
                            radius="xl"
                            variant="light"
                            color="blue"
                            style={{ flexShrink: 0 }}
                          >
                            <IconCalendar size={16} />
                          </ThemeIcon>
                          <SegmentedControl
                            size="xs"
                            value={logDateWindowMode}
                            onChange={handleDateWindowModeChange}
                            data={[
                              { label: 'Day', value: 'day' },
                              { label: 'Week', value: 'week' },
                              { label: 'Custom', value: 'custom' },
                            ]}
                            aria-label="Date window mode"
                            styles={{
                              root: {
                                flexShrink: 0,
                              },
                              label: {
                                fontSize: '0.75rem',
                                fontWeight: 700,
                              },
                            }}
                          />
                          <Tooltip label="Refresh task logs">
                            <ActionIcon
                              size="lg"
                              radius="xl"
                              variant="light"
                              onClick={() => {
                                refreshLogs().catch((error) =>
                                  console.error('Failed to refresh task logs', error),
                                );
                              }}
                            >
                              <IconRefresh size={18} />
                            </ActionIcon>
                          </Tooltip>
                        </Group>
                        <Group
                          gap="xs"
                          wrap="nowrap"
                          align="center"
                          justify="center"
                          style={{ width: isMobile ? '100%' : 'auto' }}
                        >
                          <ActionIcon
                            variant="light"
                            radius="xl"
                            size="sm"
                            onClick={() => shiftLogDateRange('previous')}
                            disabled={!canMoveToPreviousPeriod}
                            aria-label="Previous period"
                          >
                            <IconChevronLeft size={14} />
                          </ActionIcon>
                          <DatePickerInput
                            type="range"
                            value={logDateRange}
                            onChange={handleLogDateRangeChange}
                            valueFormat={isMobile ? 'MMM D, YY' : 'MMM D, YYYY'}
                            minDate={plannerStartDate ? plannerStartDate.toDate() : undefined}
                            placeholder="Select date range"
                            aria-label="Current window date range"
                            allowSingleDateInRange
                            clearable={false}
                            disabled={logDateWindowMode !== 'custom'}
                            style={{
                              flex: isMobile ? '1 1 auto' : '0 0 auto',
                              width: isMobile
                                ? 'auto'
                                : logDateWindowMode === 'day'
                                  ? 280
                                  : 330,
                              minWidth: isMobile ? 210 : 240,
                              maxWidth: isMobile ? 'none' : 360,
                            }}
                            styles={{
                              input: {
                                minHeight: 34,
                                height: 34,
                                paddingLeft: 12,
                                paddingRight: 12,
                                fontSize: isMobile ? '0.8rem' : '0.9rem',
                                fontWeight: 700,
                                color: 'var(--mantine-color-dark-7)',
                                textAlign: 'center',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                background: 'rgba(255, 255, 255, 0.94)',
                                border: '1px solid rgba(15, 23, 42, 0.08)',
                                boxShadow: '0 2px 10px rgba(15, 23, 42, 0.04)',
                                cursor: logDateWindowMode !== 'custom' ? 'default' : 'pointer',
                              },
                            }}
                          />
                          <ActionIcon
                            variant="light"
                            radius="xl"
                            size="sm"
                            onClick={() => shiftLogDateRange('next')}
                            aria-label="Next period"
                          >
                            <IconChevronRight size={14} />
                          </ActionIcon>
                        </Group>
                      </Group>
                      {canViewAllTasks && logDateWindowMode !== 'day' ? (
                        <Select
                          data={[
                            { value: 'all', label: 'All task owners' },
                            { value: 'self', label: 'My tasks only' },
                          ]}
                          value={logScope}
                          onChange={(value) =>
                            setLogScope((value as 'self' | 'all') ?? 'all')
                          }
                          aria-label="Task scope"
                        placeholder="Scope"
                        checkIconPosition="right"
                        style={{
                          flex: isMobile ? '1 1 calc(50% - 4px)' : '0 0 180px',
                          minWidth: isMobile ? 160 : 180,
                        }}
                          styles={{
                            input: {
                              minHeight: 34,
                              height: 34,
                              fontSize: '0.9rem',
                              fontWeight: 600,
                              textAlign: 'center',
                              paddingLeft: 32,
                              paddingRight: 32,
                              background: 'rgba(255, 255, 255, 0.94)',
                              border: '1px solid rgba(15, 23, 42, 0.08)',
                              boxShadow: '0 2px 10px rgba(15, 23, 42, 0.04)',
                            },
                            option: {
                              display: 'flex',
                              justifyContent: 'center',
                              textAlign: 'center',
                            },
                          }}
                        />
                      ) : null}
                      {logDateWindowMode !== 'day' && (
                        <Select
                          data={STATUS_FILTER_OPTIONS}
                          value={logFilterStatus}
                          onChange={(value) =>
                            setLogFilterStatus((value as TaskStatusFilterValue) ?? 'all')
                          }
                          aria-label="Task status"
                          placeholder="Status"
                          checkIconPosition="right"
                          style={{
                            flex: isMobile ? '1 1 calc(50% - 4px)' : '0 0 170px',
                            minWidth: isMobile ? 160 : 170,
                          }}
                          styles={{
                            input: {
                              minHeight: 34,
                              height: 34,
                              fontSize: '0.9rem',
                              fontWeight: 600,
                              textAlign: 'center',
                              paddingLeft: 32,
                              paddingRight: 32,
                              background: 'rgba(255, 255, 255, 0.94)',
                              border: '1px solid rgba(15, 23, 42, 0.08)',
                              boxShadow: '0 2px 10px rgba(15, 23, 42, 0.04)',
                            },
                            option: {
                              display: 'flex',
                              justifyContent: 'center',
                              textAlign: 'center',
                            },
                          }}
                        />
                      )}
                    </Group>
                  </Paper>
                )}
                {canManage && activeSection === 'setup' && (
                  <Group gap="sm" wrap="wrap">
                    {templates.length > 0 && selectedTemplateIds.length < templates.length && (
                      <Button
                        variant="default"
                        radius="xl"
                        onClick={selectAllTemplates}
                      >
                        Select All Visible
                      </Button>
                    )}
                    {selectedTemplateIds.length > 0 && (
                      <>
                        <Button
                          variant="light"
                          radius="xl"
                          onClick={openBulkAssignmentModal}
                        >
                          Bulk Assign ({selectedTemplateIds.length})
                        </Button>
                        <Button
                          variant="default"
                          radius="xl"
                          onClick={clearSelectedTemplates}
                        >
                          Clear Selection
                        </Button>
                      </>
                    )}
                    <Button
                      leftSection={<IconAdjustments size={16} />}
                      radius="xl"
                      onClick={() => openTemplateModal()}
                    >
                      New Template
                    </Button>
                  </Group>
                )}
              </Group>
            </Stack>

          </Group>

          <SimpleGrid
            cols={{ base: 1, sm: 2, lg: canManage && activeSection === 'dashboard' ? 4 : 3 }}
            spacing="sm"
            style={{ width: '100%' }}
          >
            <PlannerStatCard
              label="Pending"
              value={String(dashboardSummary.pendingCount)}
              icon={<IconCalendar size={20} />}
              accent="linear-gradient(180deg, rgba(219, 234, 254, 0.9) 0%, rgba(255, 255, 255, 0.8) 100%)"
            />
            <PlannerStatCard
              label="Completed"
              value={String(dashboardSummary.completedCount)}
              icon={<IconCheck size={20} />}
              accent="linear-gradient(180deg, rgba(209, 250, 229, 0.8) 0%, rgba(255, 255, 255, 1) 100%)"
            />
            <PlannerCompletionByOwnerCard value={`${dashboardSummary.completionRate}%`} />
            {canManage && activeSection === 'dashboard' && (
              <PlannerActionsCard
                onGenerate={openGenerateWeeklyTasksPreview}
                onClear={handleClearWeek}
                generateLoading={generatePreviewLoading || generateWeeklyTasksSubmitting}
                clearLoading={clearWeekSubmitting}
              />
            )}
          </SimpleGrid>
        </Stack>
      </Paper>

      {activeSection === 'dashboard' ? (
        <Stack gap="sm">
          {logState.error && (
            <Alert color="red" title="Logs">
              {logState.error}
            </Alert>
          )}
          {generateWeeklyTasksError && (
            <Alert color="red" title="Weekly Generation">
              {generateWeeklyTasksError}
            </Alert>
          )}
          {clearWeekError && (
            <Alert color="red" title="Clear Week">
              {clearWeekError}
            </Alert>
          )}
          {generateWeeklyTasksSummary && (
            <Alert color="teal" title="Weekly Generation">
              Created {generateWeeklyTasksSummary.createdCount} tasks, updated{' '}
              {generateWeeklyTasksSummary.updatedCount}, and left{' '}
              {generateWeeklyTasksSummary.unchangedCount} already in place across{' '}
              {generateWeeklyTasksSummary.expectedLogCount} expected tasks.
            </Alert>
          )}
          {clearWeekSummary && (
            <Alert color="orange" title="Clear Week">
              Removed {clearWeekSummary.deletedCount} task
              {clearWeekSummary.deletedCount === 1 ? '' : 's'} from the selected window.
            </Alert>
          )}

          <Stack gap="xs">
            <Paper withBorder radius="xl" p={isMobile ? 'md' : 'lg'}>
              <Stack gap="md">
                {logDateWindowMode === 'day' ? (
                  <DayTaskBucketsBoard
                    logs={orderedLogs}
                    templates={templates}
                    onSelectLog={handleLogSelect}
                    canDeleteLogs={canDeleteTaskLogs}
                    deletingLogId={logDeletePendingId}
                    onDeleteLog={(log) => {
                      void handleTaskLogDelete(log);
                    }}
                  />
                ) : (
                  <WeeklyTaskPlannerBoard
                    logs={orderedLogs}
                    templates={templates}
                    rangeStart={logDateRange[0]}
                    rangeEnd={logDateRange[1]}
                    onSelectLog={handleLogSelect}
                    canDeleteLogs={canDeleteTaskLogs}
                    deletingLogId={logDeletePendingId}
                    onDeleteLog={(log) => {
                      void handleTaskLogDelete(log);
                    }}
                  />
                )}
              </Stack>
            </Paper>
          </Stack>

        </Stack>
      ) : (
        <Stack gap="lg">
          {templateState.error && (
            <Alert color="red" title="Templates">
              {templateState.error}
            </Alert>
          )}

          <SimpleGrid cols={{ base: 1, sm: 2, xl: 4 }} spacing="md">
            <PlannerStatCard
              label="Templates"
              value={String(setupSummary.templateCount)}
              icon={<IconAdjustments size={20} />}
              accent="linear-gradient(180deg, rgba(219, 234, 254, 0.9) 0%, rgba(255, 255, 255, 1) 100%)"
            />
            <PlannerStatCard
              label="Assignments"
              value={String(setupSummary.assignmentCount)}
              icon={<IconCalendar size={20} />}
              accent="linear-gradient(180deg, rgba(226, 232, 240, 0.72) 0%, rgba(255, 255, 255, 1) 100%)"
            />
            <PlannerStatCard
              label="Groups"
              value={String(setupSummary.subgroupCount)}
              icon={<IconBolt size={20} />}
              accent="linear-gradient(180deg, rgba(224, 231, 255, 0.92) 0%, rgba(255, 255, 255, 1) 100%)"
            />
            <PlannerStatCard
              label="Shift-aware"
              value={String(setupSummary.shiftAwareTemplates)}
              icon={<IconAlertTriangle size={20} />}
              accent="linear-gradient(180deg, rgba(255, 237, 213, 0.92) 0%, rgba(255, 255, 255, 1) 100%)"
            />
          </SimpleGrid>

          <Paper withBorder radius="xl" p={isMobile ? 'md' : 'lg'}>
            <Group justify="space-between" align="flex-start" wrap="wrap">
              <Stack gap={4} style={{ flex: 1, minWidth: 260 }}>
                <Text fw={700}>Template Library</Text>
                <Text size="sm" c="dimmed" maw={720}>
                  Templates are grouped by category and subgroup so recurring work stays easier to
                  scan, maintain, and assign.
                </Text>
              </Stack>
              {canManage && (
                <Button
                  leftSection={<IconPlus size={16} />}
                  radius="xl"
                  onClick={() => openTemplateModal()}
                >
                  Create Template
                </Button>
              )}
            </Group>
          </Paper>

          {templates.length === 0 ? (
            <EmptyPlannerState
              title="No templates configured"
              description="Start by creating a task template, then assign it to a role or a specific user."
              action={
                canManage ? (
                  <Button radius="xl" onClick={() => openTemplateModal()}>
                    Create first template
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <Accordion
              variant="separated"
              radius="xl"
              styles={{
                item: {
                  border: '1px solid rgba(15, 23, 42, 0.08)',
                  background:
                    'linear-gradient(180deg, rgba(248, 250, 252, 0.88) 0%, rgba(255, 255, 255, 1) 100%)',
                },
                control: {
                  padding: isMobile ? '14px 16px' : '18px 20px',
                },
                panel: {
                  paddingTop: 0,
                },
              }}
            >
              {groupedTemplates.map((group) => {
                const categoryTemplateIds = group.subgroups.flatMap((subgroup) =>
                  subgroup.templates.map((template) => template.id),
                );
                const selectedCategoryTemplateCount = categoryTemplateIds.filter((templateId) =>
                  selectedTemplateIds.includes(templateId),
                ).length;
                const categoryChecked =
                  categoryTemplateIds.length > 0 &&
                  selectedCategoryTemplateCount === categoryTemplateIds.length;
                const categoryIndeterminate =
                  selectedCategoryTemplateCount > 0 &&
                  selectedCategoryTemplateCount < categoryTemplateIds.length;

                return (
                  <Accordion.Item key={group.category} value={group.category}>
                    <Accordion.Control>
                      <Group justify="space-between" align="center" wrap="nowrap" pr="md">
                        <Group gap="sm" align="center" wrap="nowrap">
                          {canManage && (
                            <Box
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                              }}
                            >
                              <Checkbox
                                checked={categoryChecked}
                                indeterminate={categoryIndeterminate}
                                onChange={(event) =>
                                  toggleCategorySelection(
                                    categoryTemplateIds,
                                    event.currentTarget.checked,
                                  )
                                }
                              />
                            </Box>
                          )}
                          <Stack gap={2}>
                            <Text fw={800}>{group.category}</Text>
                            <Text size="sm" c="dimmed">
                              {group.subgroups.length} subgroup{group.subgroups.length === 1 ? '' : 's'} in this
                              category
                            </Text>
                          </Stack>
                        </Group>
                        <Group gap="xs" wrap="nowrap">
                          <Badge variant="outline" color="dark">
                            {group.subgroups.reduce((count, subgroup) => count + subgroup.templates.length, 0)}{' '}
                            templates
                          </Badge>
                          {canManage && (
                            <>
                              <Tooltip label="Move category up">
                                <ActionIcon
                                  variant="light"
                                  disabled={
                                    templateReorderBusyKey !== null ||
                                    groupedTemplates.findIndex((entry) => entry.category === group.category) === 0
                                  }
                                  loading={templateReorderBusyKey === `category:${group.category}`}
                                  onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    handleCategoryMove(group.category, 'up').catch((error) =>
                                      console.error('Failed to move category up', error),
                                    );
                                  }}
                                >
                                  <IconArrowUp size={16} />
                                </ActionIcon>
                              </Tooltip>
                              <Tooltip label="Move category down">
                                <ActionIcon
                                  variant="light"
                                  disabled={
                                    templateReorderBusyKey !== null ||
                                    groupedTemplates.findIndex((entry) => entry.category === group.category) ===
                                      groupedTemplates.length - 1
                                  }
                                  loading={templateReorderBusyKey === `category:${group.category}`}
                                  onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    handleCategoryMove(group.category, 'down').catch((error) =>
                                      console.error('Failed to move category down', error),
                                    );
                                  }}
                                >
                                  <IconArrowDown size={16} />
                                </ActionIcon>
                              </Tooltip>
                            </>
                          )}
                        </Group>
                      </Group>
                    </Accordion.Control>
                    <Accordion.Panel>
                      <Accordion
                        variant="contained"
                        radius="lg"
                        styles={{
                          item: {
                            borderColor: 'rgba(15, 23, 42, 0.08)',
                            backgroundColor: '#ffffff',
                          },
                          control: {
                            padding: isMobile ? '12px 14px' : '14px 16px',
                          },
                        }}
                      >
                        {group.subgroups.map((subgroup) => {
                          const subgroupTemplateIds = subgroup.templates.map((template) => template.id);
                          const selectedSubgroupTemplateCount = subgroupTemplateIds.filter((templateId) =>
                            selectedTemplateIds.includes(templateId),
                          ).length;
                          const subgroupChecked =
                            subgroupTemplateIds.length > 0 &&
                            selectedSubgroupTemplateCount === subgroupTemplateIds.length;
                          const subgroupIndeterminate =
                            selectedSubgroupTemplateCount > 0 &&
                            selectedSubgroupTemplateCount < subgroupTemplateIds.length;

                          return (
                            <Accordion.Item
                              key={`${group.category}-${subgroup.subgroup}`}
                              value={subgroup.subgroup}
                            >
                              <Accordion.Control>
                                <Group justify="space-between" align="center" wrap="nowrap" pr="md">
                                  <Group gap="sm" align="center" wrap="nowrap">
                                    {canManage && (
                                      <Box
                                        onClick={(event) => {
                                          event.preventDefault();
                                          event.stopPropagation();
                                        }}
                                      >
                                        <Checkbox
                                          checked={subgroupChecked}
                                          indeterminate={subgroupIndeterminate}
                                          onChange={(event) =>
                                            toggleSubgroupSelection(
                                              subgroupTemplateIds,
                                              event.currentTarget.checked,
                                            )
                                          }
                                        />
                                      </Box>
                                    )}
                                    <Group gap="xs" wrap="wrap">
                                      <Badge color="dark" variant="light">
                                        {subgroup.subgroup}
                                      </Badge>
                                      <Text size="sm" c="dimmed">
                                        {subgroup.templates.length} template
                                        {subgroup.templates.length === 1 ? '' : 's'}
                                      </Text>
                                    </Group>
                                  </Group>
                                  {canManage && (
                                    <Group gap="xs" wrap="nowrap">
                                      <Tooltip label="Move subgroup up">
                                        <ActionIcon
                                          variant="light"
                                          disabled={
                                            templateReorderBusyKey !== null ||
                                            group.subgroups.findIndex(
                                              (entry) => entry.subgroup === subgroup.subgroup,
                                            ) === 0
                                          }
                                          loading={
                                            templateReorderBusyKey ===
                                            `subgroup:${group.category}:${subgroup.subgroup}`
                                          }
                                          onClick={(event) => {
                                            event.preventDefault();
                                            event.stopPropagation();
                                            handleSubgroupMove(
                                              group.category,
                                              subgroup.subgroup,
                                              'up',
                                            ).catch((error) =>
                                              console.error('Failed to move subgroup up', error),
                                            );
                                          }}
                                        >
                                          <IconArrowUp size={16} />
                                        </ActionIcon>
                                      </Tooltip>
                                      <Tooltip label="Move subgroup down">
                                        <ActionIcon
                                          variant="light"
                                          disabled={
                                            templateReorderBusyKey !== null ||
                                            group.subgroups.findIndex(
                                              (entry) => entry.subgroup === subgroup.subgroup,
                                            ) ===
                                              group.subgroups.length - 1
                                          }
                                          loading={
                                            templateReorderBusyKey ===
                                            `subgroup:${group.category}:${subgroup.subgroup}`
                                          }
                                          onClick={(event) => {
                                            event.preventDefault();
                                            event.stopPropagation();
                                            handleSubgroupMove(
                                              group.category,
                                              subgroup.subgroup,
                                              'down',
                                            ).catch((error) =>
                                              console.error('Failed to move subgroup down', error),
                                            );
                                          }}
                                        >
                                          <IconArrowDown size={16} />
                                        </ActionIcon>
                                      </Tooltip>
                                    </Group>
                                  )}
                                </Group>
                              </Accordion.Control>
                              <Accordion.Panel>
                                <SimpleGrid cols={{ base: 1, xl: 2 }} spacing="md">
                                  {subgroup.templates.map((template, templateIndex) => (
                                    <SetupTemplateCard
                                      key={template.id}
                                      template={template}
                                      canManage={canManage}
                                      selected={selectedTemplateIds.includes(template.id)}
                                      canMoveUp={templateIndex > 0}
                                      canMoveDown={templateIndex < subgroup.templates.length - 1}
                                      reorderDisabled={
                                        templateReorderBusyKey !== null &&
                                        templateReorderBusyKey !== `template:${template.id}`
                                      }
                                      reorderLoading={
                                        templateReorderBusyKey === `template:${template.id}`
                                          ? templateReorderDirection
                                          : null
                                      }
                                      onAssign={(selectedTemplate) => openAssignmentModal(selectedTemplate)}
                                      onEdit={openTemplateModal}
                                      onMoveUp={(selectedTemplate) => {
                                        handleTemplateMove(
                                          subgroup.templates,
                                          selectedTemplate,
                                          'up',
                                        ).catch((error) =>
                                          console.error('Failed to move template up', error),
                                        );
                                      }}
                                      onMoveDown={(selectedTemplate) => {
                                        handleTemplateMove(
                                          subgroup.templates,
                                          selectedTemplate,
                                          'down',
                                        ).catch((error) =>
                                          console.error('Failed to move template down', error),
                                        );
                                      }}
                                      onUpdateExistingTasks={(selectedTemplate) =>
                                        openSyncExistingTasksModal(selectedTemplate)
                                      }
                                      onToggleSelected={toggleTemplateSelection}
                                      onEditAssignment={openAssignmentModal}
                                      onDeleteAssignment={handleAssignmentDelete}
                                    />
                                  ))}
                                </SimpleGrid>
                              </Accordion.Panel>
                            </Accordion.Item>
                          );
                        })}
                    </Accordion>
                  </Accordion.Panel>
                </Accordion.Item>
                );
              })}
            </Accordion>
          )}
        </Stack>
      )}

      <Modal
        opened={templateModalOpen}
        onClose={closeTemplateModal}
        title={editingTemplate ? 'Edit Template' : 'New Template'}
        centered
        size="lg"
        fullScreen={Boolean(isMobile)}
      >
        <Stack gap="md">
          <Paper withBorder radius="xl" p="md">
            <Stack gap="md">
              <Stack gap={2}>
                <Text fw={700}>Basics</Text>
                <Text size="sm" c="dimmed">
                  Define the task and where it belongs in the template library.
                </Text>
              </Stack>
              <TextInput
                label="Name"
                required
                value={templateFormState.name}
                onChange={(event) =>
                  setTemplateFormState((prev) => ({
                    ...prev,
                    name: event.currentTarget.value,
                  }))
                }
              />
              <Textarea
                label="Description"
                minRows={3}
                value={templateFormState.description}
                onChange={(event) =>
                  setTemplateFormState((prev) => ({
                    ...prev,
                    description: event.currentTarget.value,
                  }))
                }
              />
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                <TextInput
                  label="Category"
                  description="Top-level library grouping."
                  value={templateFormState.category}
                  onChange={(event) =>
                    setTemplateFormState((prev) => ({
                      ...prev,
                      category: event.currentTarget.value,
                    }))
                  }
                />
                <TextInput
                  label="Subgroup"
                  description="Section inside the category."
                  value={templateFormState.subgroup}
                  onChange={(event) =>
                    setTemplateFormState((prev) => ({
                      ...prev,
                      subgroup: event.currentTarget.value,
                    }))
                  }
                />
              </SimpleGrid>
            </Stack>
          </Paper>
          <Paper withBorder radius="xl" p="md">
            <Stack gap="md">
              <Stack gap={2}>
                <Text fw={700}>Schedule Defaults</Text>
                <Text size="sm" c="dimmed">
                  These values prefill generated tasks and manual logs.
                </Text>
              </Stack>
              <Select
                label="Cadence"
                data={Object.entries(CADENCE_LABELS).map(([value, label]) => ({
                  value,
                  label,
                }))}
                value={templateFormState.cadence}
                onChange={(value) =>
                  setTemplateFormState((prev) => ({
                    ...prev,
                    cadence: (value as AssistantManagerTaskCadence) ?? prev.cadence,
                  }))
                }
              />
              <TextInput
                label="Times Per Week Per Assigned User"
                placeholder="2"
                description="For weekly/biweekly person-based tasks, generate the task on each matched user's first N scheduled workdays of the week."
                value={templateFormState.timesPerWeekPerAssignedUser}
                onChange={(event) =>
                  setTemplateFormState((prev) => ({
                    ...prev,
                    timesPerWeekPerAssignedUser: event.currentTarget.value,
                  }))
                }
              />
              <TextInput
                label="Reminder Minutes Before Start"
                placeholder="30"
                description="Send a reminder notification this many minutes before the task start time."
                value={templateFormState.reminderMinutesBeforeStart}
                onChange={(event) =>
                  setTemplateFormState((prev) => ({
                    ...prev,
                    reminderMinutesBeforeStart: event.currentTarget.value,
                  }))
                }
              />
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                <TextInput
                  label="Default Start Time"
                  placeholder="08:00"
                  value={templateFormState.defaultTime}
                  onChange={(event) =>
                    setTemplateFormState((prev) => ({
                      ...prev,
                      defaultTime: event.currentTarget.value,
                    }))
                  }
                />
                <TextInput
                  label="Default Duration (hours)"
                  placeholder="1.5"
                  value={templateFormState.defaultDuration}
                  onChange={(event) =>
                    setTemplateFormState((prev) => ({
                      ...prev,
                      defaultDuration: event.currentTarget.value,
                    }))
                  }
                />
              </SimpleGrid>
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                <Select
                  label="Default Priority"
                  data={(Object.keys(PRIORITY_META) as PlannerPriority[]).map((priority) => ({
                    value: priority,
                    label: PRIORITY_META[priority].label,
                  }))}
                  value={templateFormState.defaultPriority}
                  onChange={(value) =>
                    setTemplateFormState((prev) => ({
                      ...prev,
                      defaultPriority: (value as PlannerPriority) ?? prev.defaultPriority,
                    }))
                  }
                />
                <TextInput
                  label="Default Points"
                  placeholder="1"
                  value={templateFormState.defaultPoints}
                  onChange={(event) =>
                    setTemplateFormState((prev) => ({
                      ...prev,
                      defaultPoints: event.currentTarget.value,
                    }))
                  }
                />
              </SimpleGrid>
              <Switch
                label="Notify again at task start time"
                checked={templateFormState.notifyAtStart}
                onChange={(event) =>
                  setTemplateFormState((prev) => ({
                    ...prev,
                    notifyAtStart: event.currentTarget.checked,
                  }))
                }
              />
              <Switch
                label="Require staff to be on shift by default"
                checked={templateFormState.requireShift}
                onChange={(event) =>
                  setTemplateFormState((prev) => ({
                    ...prev,
                    requireShift: event.currentTarget.checked,
                  }))
                }
              />
            </Stack>
          </Paper>
          <Paper withBorder radius="xl" p="md">
            <Stack gap="md">
              <Stack gap={2}>
                <Text fw={700}>Evidence Requirements</Text>
                <Text size="sm" c="dimmed">
                  Create one rule per required proof item. For example, use separate link rules for
                  Instagram and TikTok when both links are required.
                </Text>
              </Stack>
              <Stack gap="xs">
                <Text size="sm" fw={600}>
                  Quick Presets
                </Text>
                <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                  {EVIDENCE_RULE_PRESETS.map((preset) => (
                    <Button
                      key={preset.id}
                      variant="light"
                      color="dark"
                      fullWidth
                      onClick={() => addTemplateEvidencePreset(preset)}
                    >
                      <Box w="100%" ta="left">
                        <Text span fw={600}>
                          {preset.label}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {preset.description}
                        </Text>
                      </Box>
                    </Button>
                  ))}
                </SimpleGrid>
              </Stack>
              <Group gap="sm" wrap="wrap">
                <Button
                  variant="default"
                  leftSection={<IconPlus size={16} />}
                  onClick={() => addTemplateEvidenceRuleDraft('link')}
                >
                  Add Link Rule
                </Button>
                <Button
                  variant="default"
                  leftSection={<IconPlus size={16} />}
                  onClick={() => addTemplateEvidenceRuleDraft('image')}
                >
                  Add Image Rule
                </Button>
              </Group>
              {templateFormState.evidenceRules.length > 0 ? (
                <Stack gap="sm">
                  {templateFormState.evidenceRules.map((rule, index) => (
                    <Paper key={rule.id} withBorder radius="lg" p="md">
                      <Stack gap="md">
                        <Group justify="space-between" wrap="wrap">
                          <Group gap="xs">
                            <Badge variant="light">Rule {index + 1}</Badge>
                            <Badge color={rule.type === 'link' ? 'blue' : 'grape'} variant="light">
                              {rule.type}
                            </Badge>
                          </Group>
                          <ActionIcon
                            color="red"
                            variant="subtle"
                            onClick={() => removeTemplateEvidenceRuleDraft(rule.id)}
                            aria-label={`Remove evidence rule ${index + 1}`}
                          >
                            <IconX size={16} />
                          </ActionIcon>
                        </Group>
                        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                          <TextInput
                            label="Rule Key"
                            placeholder="instagram_post_link"
                            value={rule.key}
                            onChange={(event) =>
                              handleEvidenceRuleDraftChange(rule.id, 'key', event.currentTarget.value)
                            }
                          />
                          <TextInput
                            label="Label"
                            placeholder="Instagram post link"
                            value={rule.label}
                            onChange={(event) =>
                              handleEvidenceRuleDraftChange(rule.id, 'label', event.currentTarget.value)
                            }
                          />
                        </SimpleGrid>
                        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                          <Select
                            label="Evidence Type"
                            data={[
                              { value: 'link', label: 'Link' },
                              { value: 'image', label: 'Image' },
                            ]}
                            value={rule.type}
                            onChange={(value) =>
                              handleEvidenceRuleDraftChange(
                                rule.id,
                                'type',
                                (value as 'link' | 'image') ?? rule.type,
                              )
                            }
                          />
                          <Group grow align="flex-end">
                            <Switch
                              label="Required"
                              checked={rule.required}
                              onChange={(event) =>
                                handleEvidenceRuleDraftChange(
                                  rule.id,
                                  'required',
                                  event.currentTarget.checked,
                                )
                              }
                            />
                            <Switch
                              label="Allow Multiple"
                              checked={rule.multiple}
                              onChange={(event) =>
                                handleEvidenceRuleDraftChange(
                                  rule.id,
                                  'multiple',
                                  event.currentTarget.checked,
                                )
                              }
                            />
                          </Group>
                        </SimpleGrid>
                        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                          <TextInput
                            label="Minimum Items"
                            placeholder={rule.required ? '1' : '0'}
                            value={rule.minItems}
                            onChange={(event) =>
                              handleEvidenceRuleDraftChange(
                                rule.id,
                                'minItems',
                                event.currentTarget.value,
                              )
                            }
                          />
                          <TextInput
                            label="Maximum Items"
                            placeholder={rule.multiple ? 'Leave empty for no limit' : '1'}
                            value={rule.maxItems}
                            onChange={(event) =>
                              handleEvidenceRuleDraftChange(
                                rule.id,
                                'maxItems',
                                event.currentTarget.value,
                              )
                            }
                          />
                        </SimpleGrid>
                        {rule.type === 'link' && (
                          <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm">
                            <TextInput
                              label="Allowed Hosts"
                              description="Comma-separated hostnames."
                              placeholder="instagram.com, www.instagram.com"
                              value={rule.hosts}
                              onChange={(event) =>
                                handleEvidenceRuleDraftChange(
                                  rule.id,
                                  'hosts',
                                  event.currentTarget.value,
                                )
                              }
                            />
                            <TextInput
                              label="Required Keywords"
                              description="Comma-separated words to find in the URL."
                              placeholder="instagram, reel"
                              value={rule.contains}
                              onChange={(event) =>
                                handleEvidenceRuleDraftChange(
                                  rule.id,
                                  'contains',
                                  event.currentTarget.value,
                                )
                              }
                            />
                            <TextInput
                              label="Regex"
                              description="Optional advanced URL validation."
                              placeholder="^https://(www\\.)?instagram\\.com/"
                              value={rule.regex}
                              onChange={(event) =>
                                handleEvidenceRuleDraftChange(
                                  rule.id,
                                  'regex',
                                  event.currentTarget.value,
                                )
                              }
                            />
                          </SimpleGrid>
                        )}
                      </Stack>
                    </Paper>
                  ))}
                </Stack>
              ) : (
                <Text size="sm" c="dimmed">
                  No evidence rules yet.
                </Text>
              )}
            </Stack>
          </Paper>
          <Paper withBorder radius="xl" p="md">
            <Stack gap="md">
              <Stack gap={2}>
                <Text fw={700}>Cerebro Links</Text>
                <Text size="sm" c="dimmed">
                  Attach related knowledge, policies, and quizzes so staff can open them from task details.
                </Text>
              </Stack>
              {cerebroLinkOptionsError ? (
                <Alert color="red" title="Cerebro Links">
                  {cerebroLinkOptionsError}
                </Alert>
              ) : null}
              <MultiSelect
                label="Knowledge"
                placeholder={cerebroLinkOptionsLoading ? 'Loading knowledge...' : 'Select knowledge articles'}
                data={templateKnowledgeOptions}
                value={templateFormState.linkedKnowledgeEntryIds}
                onChange={(value) =>
                  setTemplateFormState((prev) => ({
                    ...prev,
                    linkedKnowledgeEntryIds: value,
                  }))
                }
                searchable
                clearable
                disabled={cerebroLinkOptionsLoading}
                nothingFoundMessage="No knowledge entries found"
              />
              <MultiSelect
                label="Policies"
                placeholder={cerebroLinkOptionsLoading ? 'Loading policies...' : 'Select policies'}
                data={templatePolicyOptions}
                value={templateFormState.linkedPolicyEntryIds}
                onChange={(value) =>
                  setTemplateFormState((prev) => ({
                    ...prev,
                    linkedPolicyEntryIds: value,
                  }))
                }
                searchable
                clearable
                disabled={cerebroLinkOptionsLoading}
                nothingFoundMessage="No policies found"
              />
              <MultiSelect
                label="Quizzes"
                placeholder={cerebroLinkOptionsLoading ? 'Loading quizzes...' : 'Select quizzes'}
                data={templateQuizOptions}
                value={templateFormState.linkedQuizIds}
                onChange={(value) =>
                  setTemplateFormState((prev) => ({
                    ...prev,
                    linkedQuizIds: value,
                  }))
                }
                searchable
                clearable
                disabled={cerebroLinkOptionsLoading}
                nothingFoundMessage="No quizzes found"
              />
            </Stack>
          </Paper>
          <Paper withBorder radius="xl" p="md">
            <Stack gap="md">
              <Stack gap={2}>
                <Text fw={700}>Advanced</Text>
                <Text size="sm" c="dimmed">
                  Optional cadence-specific JSON like `daysOfWeek`, `dayOfMonth`, or tags.
                </Text>
              </Stack>
              <Textarea
                label="Schedule Config (JSON)"
                minRows={4}
                value={templateFormState.scheduleConfigText}
                onChange={(event) =>
                  setTemplateFormState((prev) => ({
                    ...prev,
                    scheduleConfigText: event.currentTarget.value,
                  }))
                }
              />
            </Stack>
          </Paper>
          {templateFormError && (
            <Alert color="red" title="Unable to save">
              {templateFormError}
            </Alert>
          )}
          <Group justify="flex-end" gap="sm" wrap="wrap">
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
        size="lg"
        fullScreen={Boolean(isMobile)}
      >
        <Stack gap="md">
          <Paper withBorder radius="xl" p="md">
            <Stack gap="xs">
              <Text size="xs" tt="uppercase" fw={700} c="dimmed">
                Template
              </Text>
              <Text fw={700}>
                {selectedTemplateId
                  ? templates.find((template) => template.id === selectedTemplateId)?.name ??
                    `#${selectedTemplateId}`
                  : 'No template selected'}
              </Text>
              <Group gap="xs" wrap="wrap">
                {defaultAssistantManagerUserTypeId && (
                  <Badge color="cyan" variant="light">
                    Default user type: Assistant Manager
                  </Badge>
                )}
                {defaultManagerShiftRoleId && (
                  <Badge color="violet" variant="light">
                    Default shift role: Manager
                  </Badge>
                )}
              </Group>
            </Stack>
          </Paper>
          <Alert color="blue" title="Assignment Rules">
            Select any combination of user, user type, shift role, and staff profile. A task will
            apply only when a user matches all selected filters.
          </Alert>
          <Paper withBorder radius="xl" p="md">
            <Stack gap="md">
              <Stack gap={2}>
                <Text fw={700}>Audience Filters</Text>
                <Text size="sm" c="dimmed">
                  Use a single filter for broad assignment or combine filters to narrow down exactly who receives the task.
                </Text>
              </Stack>
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                <Select
                  label="User Type"
                  placeholder="Any user type"
                  description="Matches active users with this user type."
                  clearable
                  searchable
                  data={userTypeOptions}
                  value={assignmentFormState.userTypeId || null}
                  onChange={(value) =>
                    setAssignmentFormState((prev) => ({
                      ...prev,
                      userTypeId: value ?? '',
                    }))
                  }
                  disabled={userTypesState.loading}
                  nothingFoundMessage="No user types found"
                />
                <Select
                  label="Shift Role"
                  placeholder="Any shift role"
                  description="Matches active users linked to this shift role."
                  clearable
                  searchable
                  data={shiftRoleOptions}
                  value={assignmentFormState.shiftRoleId || null}
                  onChange={(value) =>
                    setAssignmentFormState((prev) => ({
                      ...prev,
                      shiftRoleId: value ?? '',
                    }))
                  }
                  disabled={shiftRolesLoading}
                  nothingFoundMessage="No shift roles found"
                />
                <Select
                  label="Staff Profile"
                  placeholder="Any staff profile"
                  clearable
                  searchable
                  description="Volunteer/Long Term plus whether they live in accommodation."
                  data={STAFF_PROFILE_OPTIONS}
                  value={assignmentFormState.staffProfileFilter || null}
                  onChange={(value) =>
                    setAssignmentFormState((prev) => ({
                      ...prev,
                      staffProfileFilter: value ?? '',
                    }))
                  }
                />
                <Select
                  label="User"
                  placeholder="Optional specific user"
                  description="Use alone for one person, or combine with other filters to narrow further."
                  clearable
                  searchable
                  data={activeUserOptions}
                  value={assignmentFormState.userId || null}
                  onChange={(value) =>
                    setAssignmentFormState((prev) => ({
                      ...prev,
                      userId: value ?? '',
                    }))
                  }
                  disabled={activeUsersLoading}
                  nothingFoundMessage="No active users found"
                />
              </SimpleGrid>
            </Stack>
          </Paper>
          {(userTypesState.error || shiftRolesError || activeUsersError) && (
            <Alert color="yellow" title="Reference data">
              {userTypesState.error ??
                (shiftRolesError instanceof Error
                  ? shiftRolesError.message
                  : activeUsersError instanceof Error
                    ? activeUsersError.message
                    : 'Some filter options could not be loaded')}
            </Alert>
          )}
          <Paper withBorder radius="xl" p="md">
            <Stack gap="md">
              <Stack gap={2}>
                <Text fw={700}>Effective Window</Text>
                <Text size="sm" c="dimmed">
                  Leave both dates empty to keep this assignment active with no date limit.
                </Text>
              </Stack>
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                <DatePickerInput
                  label="Effective Start"
                  value={
                    assignmentFormState.effectiveStart
                      ? dayjs(assignmentFormState.effectiveStart).toDate()
                      : null
                  }
                  onChange={(value) => handleAssignmentDateChange('effectiveStart', value)}
                  valueFormat="YYYY-MM-DD"
                  clearable
                />
                <DatePickerInput
                  label="Effective End"
                  value={
                    assignmentFormState.effectiveEnd
                      ? dayjs(assignmentFormState.effectiveEnd).toDate()
                      : null
                  }
                  onChange={(value) => handleAssignmentDateChange('effectiveEnd', value)}
                  valueFormat="YYYY-MM-DD"
                  placeholder="Leave empty for open-ended"
                  clearable
                />
              </SimpleGrid>
            </Stack>
          </Paper>
          {assignmentFormError && (
            <Alert color="red" title="Unable to save">
              {assignmentFormError}
            </Alert>
          )}
          <Group justify="flex-end" gap="sm" wrap="wrap">
            <Button
              variant="default"
              onClick={closeAssignmentModal}
              disabled={assignmentSubmitting}
            >
              Cancel
            </Button>
            <Button onClick={handleAssignmentSubmit} loading={assignmentSubmitting}>
              {editingAssignment ? 'Save Assignment' : 'Create Assignment'}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={bulkAssignmentModalOpen}
        onClose={closeBulkAssignmentModal}
        title="Bulk Assign Templates"
        centered
        size="lg"
        fullScreen={Boolean(isMobile)}
      >
        <Stack gap="md">
          <Paper withBorder radius="xl" p="md">
            <Stack gap="xs">
              <Text size="xs" tt="uppercase" fw={700} c="dimmed">
                Selected Templates
              </Text>
              <Text fw={700}>
                {selectedTemplates.length} template{selectedTemplates.length === 1 ? '' : 's'}
              </Text>
              <Group gap="xs" wrap="wrap">
                {selectedTemplates.slice(0, 8).map((template) => (
                  <Badge key={`bulk-template-${template.id}`} variant="light" color="dark">
                    {template.name}
                  </Badge>
                ))}
                {selectedTemplates.length > 8 && (
                  <Badge variant="outline">+{selectedTemplates.length - 8} more</Badge>
                )}
              </Group>
            </Stack>
          </Paper>
          <Alert color="blue" title="Bulk Assignment Rules">
            The same filters will be added to every selected template in one action.
          </Alert>
          <Paper withBorder radius="xl" p="md">
            <Stack gap="md">
              <Stack gap={2}>
                <Text fw={700}>Audience Filters</Text>
                <Text size="sm" c="dimmed">
                  Use a single filter for broad assignment or combine filters to narrow down exactly who receives the selected templates.
                </Text>
              </Stack>
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                <Select
                  label="User Type"
                  placeholder="Any user type"
                  description="Matches active users with this user type."
                  clearable
                  searchable
                  data={userTypeOptions}
                  value={assignmentFormState.userTypeId || null}
                  onChange={(value) =>
                    setAssignmentFormState((prev) => ({
                      ...prev,
                      userTypeId: value ?? '',
                    }))
                  }
                  disabled={userTypesState.loading}
                  nothingFoundMessage="No user types found"
                />
                <Select
                  label="Shift Role"
                  placeholder="Any shift role"
                  description="Matches active users linked to this shift role."
                  clearable
                  searchable
                  data={shiftRoleOptions}
                  value={assignmentFormState.shiftRoleId || null}
                  onChange={(value) =>
                    setAssignmentFormState((prev) => ({
                      ...prev,
                      shiftRoleId: value ?? '',
                    }))
                  }
                  disabled={shiftRolesLoading}
                  nothingFoundMessage="No shift roles found"
                />
                <Select
                  label="Staff Profile"
                  placeholder="Any staff profile"
                  clearable
                  searchable
                  description="Volunteer/Long Term plus whether they live in accommodation."
                  data={STAFF_PROFILE_OPTIONS}
                  value={assignmentFormState.staffProfileFilter || null}
                  onChange={(value) =>
                    setAssignmentFormState((prev) => ({
                      ...prev,
                      staffProfileFilter: value ?? '',
                    }))
                  }
                />
                <Select
                  label="User"
                  placeholder="Optional specific user"
                  description="Use alone for one person, or combine with other filters to narrow further."
                  clearable
                  searchable
                  data={activeUserOptions}
                  value={assignmentFormState.userId || null}
                  onChange={(value) =>
                    setAssignmentFormState((prev) => ({
                      ...prev,
                      userId: value ?? '',
                    }))
                  }
                  disabled={activeUsersLoading}
                  nothingFoundMessage="No active users found"
                />
              </SimpleGrid>
            </Stack>
          </Paper>
          {(userTypesState.error || shiftRolesError || activeUsersError) && (
            <Alert color="yellow" title="Reference data">
              {userTypesState.error ??
                (shiftRolesError instanceof Error
                  ? shiftRolesError.message
                  : activeUsersError instanceof Error
                    ? activeUsersError.message
                    : 'Some filter options could not be loaded')}
            </Alert>
          )}
          <Paper withBorder radius="xl" p="md">
            <Stack gap="md">
              <Stack gap={2}>
                <Text fw={700}>Effective Window</Text>
                <Text size="sm" c="dimmed">
                  Leave both dates empty to keep this assignment active with no date limit.
                </Text>
              </Stack>
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                <DatePickerInput
                  label="Effective Start"
                  value={
                    assignmentFormState.effectiveStart
                      ? dayjs(assignmentFormState.effectiveStart).toDate()
                      : null
                  }
                  onChange={(value) => handleAssignmentDateChange('effectiveStart', value)}
                  valueFormat="YYYY-MM-DD"
                  clearable
                />
                <DatePickerInput
                  label="Effective End"
                  value={
                    assignmentFormState.effectiveEnd
                      ? dayjs(assignmentFormState.effectiveEnd).toDate()
                      : null
                  }
                  onChange={(value) => handleAssignmentDateChange('effectiveEnd', value)}
                  valueFormat="YYYY-MM-DD"
                  placeholder="Leave empty for open-ended"
                  clearable
                />
              </SimpleGrid>
            </Stack>
          </Paper>
          {bulkAssignmentError && (
            <Alert color="red" title="Unable to bulk assign">
              {bulkAssignmentError}
            </Alert>
          )}
          <Group justify="flex-end" gap="sm" wrap="wrap">
            <Button
              variant="default"
              onClick={closeBulkAssignmentModal}
              disabled={bulkAssignmentSubmitting}
            >
              Cancel
            </Button>
            <Button onClick={handleBulkAssignmentSubmit} loading={bulkAssignmentSubmitting}>
              Assign Selected Templates
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={generatePreviewModalOpen}
        onClose={closeGeneratePreviewModal}
        title="Generate Weekly Tasks"
        centered
        size="lg"
        fullScreen={Boolean(isMobile)}
      >
        <Stack gap="md">
          <Paper withBorder radius="xl" p="md">
            <Stack gap="xs">
              <Text size="xs" tt="uppercase" fw={700} c="dimmed">
                Selected Window
              </Text>
              <Text fw={700}>
                {logDateRange[0] ? dayjs(logDateRange[0]).format('MMM D, YYYY') : 'Start not set'} -{' '}
                {logDateRange[1] ? dayjs(logDateRange[1]).format('MMM D, YYYY') : 'End not set'}
              </Text>
              {generatePreviewSummary && (
                <Group gap="xs" wrap="wrap">
                  <Badge variant="light" color="blue">
                    {generatePreviewSummary.templates.length} template
                    {generatePreviewSummary.templates.length === 1 ? '' : 's'}
                  </Badge>
                  <Badge variant="light" color="teal">
                    {generatePreviewSummary.expectedLogCount} planned task
                    {generatePreviewSummary.expectedLogCount === 1 ? '' : 's'}
                  </Badge>
                </Group>
              )}
            </Stack>
          </Paper>

          {generatePreviewError && (
            <Alert color="red" title="Preview">
              {generatePreviewError}
            </Alert>
          )}

          {generatePreviewLoading ? (
            <Paper withBorder radius="xl" p="lg">
              <Text c="dimmed">Loading templates for this week...</Text>
            </Paper>
          ) : generatePreviewSummary ? (
            generatePreviewSummary.templates.length > 0 ? (
              <Paper withBorder radius="xl" p="md">
                <Stack gap="md">
                  <Stack gap={2}>
                    <Text fw={700}>Templates to Generate</Text>
                    <Text size="sm" c="dimmed">
                      Review the templates and counts before creating the week's tasks.
                    </Text>
                  </Stack>
                  <ScrollArea.Autosize mah={360} offsetScrollbars>
                    <Stack gap="sm">
                      {generatePreviewSummary.templates.map((template) => (
                        <Paper
                          key={`generate-preview-template-${template.templateId}`}
                          withBorder
                          radius="lg"
                          p="sm"
                          style={{ background: 'rgba(248, 250, 252, 0.72)' }}
                        >
                          <Group justify="space-between" align="flex-start" wrap="wrap">
                            <Stack gap={2} style={{ flex: 1, minWidth: 220 }}>
                              <Text fw={700}>{template.templateName}</Text>
                              <Text size="sm" c="dimmed">
                                {CADENCE_LABELS[template.cadence as AssistantManagerTaskCadence] ?? template.cadence}
                              </Text>
                            </Stack>
                            <Group gap="xs" wrap="wrap" justify="flex-end">
                              <Badge color="teal" variant="light">
                                {template.expectedTaskCount} total
                              </Badge>
                              <Badge color="blue" variant="light">
                                {template.newTaskCount} new
                              </Badge>
                              <Badge color="gray" variant="light">
                                {template.existingTaskCount} existing
                              </Badge>
                            </Group>
                          </Group>
                        </Paper>
                      ))}
                    </Stack>
                  </ScrollArea.Autosize>
                </Stack>
              </Paper>
            ) : (
              <Paper withBorder radius="xl" p="lg">
                <Text fw={700}>No templates will generate tasks in this window.</Text>
                <Text size="sm" c="dimmed">
                  Check the date range, assignments, and template cadence rules.
                </Text>
              </Paper>
            )
          ) : null}

          <Group justify="flex-end" gap="sm" wrap="wrap">
            <Button
              variant="default"
              onClick={closeGeneratePreviewModal}
              disabled={generatePreviewLoading || generateWeeklyTasksSubmitting}
            >
              Cancel
            </Button>
            <Button
              leftSection={<IconBolt size={16} />}
              onClick={handleGenerateWeeklyTasks}
              loading={generateWeeklyTasksSubmitting}
              disabled={
                generatePreviewLoading ||
                !generatePreviewSummary ||
                generatePreviewSummary.templates.length === 0
              }
            >
              Generate
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={syncExistingTasksModalOpen}
        onClose={closeSyncExistingTasksModal}
        title={
          syncExistingTasksTemplate
            ? `Update Existing Tasks - ${syncExistingTasksTemplate.name}`
            : 'Update Existing Tasks'
        }
        centered
        size="md"
        fullScreen={Boolean(isMobile)}
      >
        <Stack gap="md">
          <Alert color="blue" title="Apply Current Template Configuration">
            {syncExistingTasksTemplate
              ? 'Pending logs for this template in the selected date range will be updated to match the current template settings.'
              : 'Pending task logs in the selected date range will be updated to match current template settings.'}
          </Alert>

          <DatePickerInput
            type="range"
            label="Date range"
            value={syncExistingTasksDateRange}
            onChange={setSyncExistingTasksDateRange}
            valueFormat="YYYY-MM-DD"
            minDate={plannerStartDate ? plannerStartDate.toDate() : undefined}
          />

          {syncExistingTasksError && (
            <Alert color="red" title="Unable to update">
              {syncExistingTasksError}
            </Alert>
          )}

          {syncExistingTasksSummary && (
            <Alert color="green" title="Existing tasks updated">
              Updated {syncExistingTasksSummary.updatedCount} of{' '}
              {syncExistingTasksSummary.totalCount} pending tasks. Unchanged:{' '}
              {syncExistingTasksSummary.unchangedCount}
              {syncExistingTasksSummary.skippedManualCount > 0
                ? `, manual skipped: ${syncExistingTasksSummary.skippedManualCount}`
                : ''}
              .
            </Alert>
          )}

          <Group justify="flex-end" gap="sm" wrap="wrap">
            <Button
              variant="default"
              onClick={closeSyncExistingTasksModal}
              disabled={syncExistingTasksSubmitting}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSyncExistingTasksSubmit}
              loading={syncExistingTasksSubmitting}
            >
              Update Existing Tasks
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={manualModalOpen}
        onClose={closeManualModal}
        title="New Task"
        centered
        size="lg"
        fullScreen={Boolean(isMobile)}
      >
        <Stack gap="md">
          <Select
            label="Template"
            required
            placeholder="Select template"
            data={templates.map((template) => ({
              value: String(template.id),
              label: template.name,
            }))}
            value={manualFormState.templateId ? String(manualFormState.templateId) : null}
            onChange={(value) =>
              setManualFormState((prev) => ({
                ...prev,
                templateId: value ? Number(value) : null,
              }))
            }
          />
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
            <Select
              label="User"
              required
              searchable
              data={activeUserOptions}
              placeholder={activeUsersLoading ? 'Loading active users...' : 'Select active user'}
              value={manualFormState.userId || null}
              onChange={(value) =>
                setManualFormState((prev) => ({
                  ...prev,
                  userId: value ?? '',
                }))
              }
              disabled={activeUsersLoading}
              nothingFoundMessage="No active users found"
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
          </SimpleGrid>
          <DatePickerInput
            label="Task Date"
            value={manualFormState.taskDate}
            onChange={(value) =>
              setManualFormState((prev) => ({
                ...prev,
                taskDate: value,
              }))
            }
            valueFormat="YYYY-MM-DD"
            required
          />
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
            <TextInput
              label="Start Time"
              placeholder="08:00"
              value={manualFormState.time}
              onChange={(event) =>
                setManualFormState((prev) => ({
                  ...prev,
                  time: event.currentTarget.value,
                }))
              }
            />
            <TextInput
              label="Duration (hours)"
              placeholder="1.5"
              value={manualFormState.durationHours}
              onChange={(event) =>
                setManualFormState((prev) => ({
                  ...prev,
                  durationHours: event.currentTarget.value,
                }))
              }
            />
          </SimpleGrid>
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
            <Select
              label="Priority"
              data={(Object.keys(PRIORITY_META) as PlannerPriority[]).map((priority) => ({
                value: priority,
                label: PRIORITY_META[priority].label,
              }))}
              value={manualFormState.priority}
              onChange={(value) =>
                setManualFormState((prev) => ({
                  ...prev,
                  priority: (value as PlannerPriority) ?? prev.priority,
                }))
              }
            />
            <TextInput
              label="Points"
              value={manualFormState.points}
              onChange={(event) =>
                setManualFormState((prev) => ({
                  ...prev,
                  points: event.currentTarget.value,
                }))
              }
            />
          </SimpleGrid>
          <TextInput
            label="Tags"
            description="Comma separated"
            value={manualFormState.tags}
            onChange={(event) =>
              setManualFormState((prev) => ({
                ...prev,
                tags: event.currentTarget.value,
              }))
            }
          />
          <Textarea
            label="Notes"
            minRows={2}
            value={manualFormState.notes}
            onChange={(event) =>
              setManualFormState((prev) => ({
                ...prev,
                notes: event.currentTarget.value,
              }))
            }
          />
          <Textarea
            label="Comment"
            minRows={2}
            value={manualFormState.comment}
            onChange={(event) =>
              setManualFormState((prev) => ({
                ...prev,
                comment: event.currentTarget.value,
              }))
            }
          />
          <Switch
            label="Require staff to be on shift"
            checked={manualFormState.requireShift}
            onChange={(event) =>
              setManualFormState((prev) => ({
                ...prev,
                requireShift: event.currentTarget.checked,
              }))
            }
          />
          {manualFormError && (
            <Alert color="red" title="Unable to save">
              {manualFormError}
            </Alert>
          )}
          <Group justify="flex-end" gap="sm" wrap="wrap">
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
        centered
        size="lg"
        fullScreen={Boolean(isMobile)}
        withCloseButton={false}
      >
        {selectedLog ? (
          <Stack gap="md">
            <Paper withBorder radius="xl" p="lg" bg="gray.0">
              <Stack gap="md">
                <Group justify="space-between" align="flex-start" wrap="wrap">
                  <Stack gap={10} align="center" style={{ flex: 1, textAlign: 'center' }}>
                    <Box w="100%" pos="relative">
                      <Group gap="xs" wrap="wrap" justify="center">
                        <Badge color={STATUS_COLORS[selectedLog.status]}>{selectedLog.status}</Badge>
                        <Badge color={PRIORITY_META[logDetailFormState.priority].color} variant="light">
                          {PRIORITY_META[logDetailFormState.priority].label}
                        </Badge>
                        <Badge color="dark" variant="outline">
                          {logDetailFormState.points || '0'} pts
                        </Badge>
                        {selectedLog.meta.manual && (
                          <Badge color="grape" variant="light">
                            Manual
                          </Badge>
                        )}
                        {selectedLog.meta.onShift === false && (
                          <Badge color="yellow" variant="light">
                            Off shift
                          </Badge>
                        )}
                      </Group>
                      <Group
                        gap={6}
                        style={{
                          position: 'absolute',
                          top: 0,
                          right: 0,
                        }}
                      >
                        {canDeleteTaskLogs && (
                          <Tooltip label="Delete task">
                            <ActionIcon
                              variant="subtle"
                              color="red"
                              onClick={() => {
                                if (selectedLog) {
                                  void handleTaskLogDelete(selectedLog);
                                }
                              }}
                              loading={logDeletePendingId === selectedLog.id}
                              aria-label="Delete task"
                            >
                              <IconTrash size={18} />
                            </ActionIcon>
                          </Tooltip>
                        )}
                        <ActionIcon
                          variant="subtle"
                          color="gray"
                          onClick={closeLogDetailModal}
                          aria-label="Close task details"
                        >
                          <IconX size={18} />
                        </ActionIcon>
                      </Group>
                    </Box>
                    <Text fw={700} size="lg">
                      {selectedLog.templateName ?? `Template #${selectedLog.templateId}`}
                    </Text>
                    <Text size="sm" c="dimmed">
                      {selectedLog.templateDescription ??
                        templateMap.get(selectedLog.templateId)?.description ??
                        'No task description provided.'}
                    </Text>
                  </Stack>
                </Group>

                <SimpleGrid cols={{ base: 1, sm: selectedLog.userId === loggedUserId ? 1 : 2 }} spacing="sm">
                  {selectedLog.userId !== loggedUserId && (
                    <Paper
                      withBorder
                      radius="lg"
                      p="sm"
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 112 }}
                    >
                      <Stack gap={6} align="center" justify="center">
                        <Text size="xs" tt="uppercase" fw={700} c="dimmed" ta="center">
                          Assigned To
                        </Text>
                        <Text fw={600} ta="center">
                          {selectedLog.userName ?? `User #${selectedLog.userId}`}
                        </Text>
                      </Stack>
                    </Paper>
                  )}
                  <Paper
                    withBorder
                    radius="lg"
                    p="sm"
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 112 }}
                  >
                    <Stack gap={6} align="center" justify="center">
                      <Text size="xs" tt="uppercase" fw={700} c="dimmed" ta="center">
                        Start Time
                      </Text>
                      <Text fw={600} ta="center">
                        {formatTaskDetailTimeRange(
                          logDetailFormState.time,
                          logDetailFormState.durationHours,
                        )}
                      </Text>
                      <Text size="sm" c="dimmed" ta="center">
                        {logDetailFormState.taskDate
                          ? dayjs(logDetailFormState.taskDate).format('dddd, MMM D, YYYY')
                          : 'No date'}
                      </Text>
                    </Stack>
                  </Paper>
                </SimpleGrid>

                {(selectedLogCerebroLinks.knowledge.length > 0 ||
                  selectedLogCerebroLinks.policies.length > 0 ||
                  selectedLogCerebroLinks.quizzes.length > 0) && (
                  <Paper withBorder radius="lg" p="sm">
                    <Stack gap="xs">
                      <Text size="xs" tt="uppercase" fw={700} c="dimmed" ta="center">
                        Cerebro
                      </Text>
                      {selectedLogCerebroLinks.knowledge.length > 0 && (
                        <Group gap="xs" wrap="wrap" justify="center">
                          <Text size="xs" c="dimmed">
                            Knowledge:
                          </Text>
                          {selectedLogCerebroLinks.knowledge.map((item) => (
                            <Button
                              key={`log-cerebro-knowledge-${item.id}`}
                              size="xs"
                              variant="light"
                              color="blue"
                              onClick={() => {
                                void handleOpenCerebroItem('knowledge', item.id);
                              }}
                            >
                              {item.title}
                            </Button>
                          ))}
                        </Group>
                      )}
                      {selectedLogCerebroLinks.policies.length > 0 && (
                        <Group gap="xs" wrap="wrap" justify="center">
                          <Text size="xs" c="dimmed">
                            Policies:
                          </Text>
                          {selectedLogCerebroLinks.policies.map((item) => (
                            <Button
                              key={`log-cerebro-policy-${item.id}`}
                              size="xs"
                              variant="light"
                              color="teal"
                              onClick={() => {
                                void handleOpenCerebroItem('policy', item.id);
                              }}
                            >
                              {item.title}
                            </Button>
                          ))}
                        </Group>
                      )}
                      {selectedLogCerebroLinks.quizzes.length > 0 && (
                        <Group gap="xs" wrap="wrap" justify="center">
                          <Text size="xs" c="dimmed">
                            Quizzes:
                          </Text>
                          {selectedLogCerebroLinks.quizzes.map((item) => (
                            <Button
                              key={`log-cerebro-quiz-${item.id}`}
                              size="xs"
                              variant="light"
                              color="orange"
                              onClick={() => {
                                void handleOpenCerebroItem('quiz', item.id);
                              }}
                            >
                              {item.title}
                            </Button>
                          ))}
                        </Group>
                      )}
                    </Stack>
                  </Paper>
                )}
              </Stack>
            </Paper>

            <Divider label="Evidence" labelPosition="center" />
            {selectedLogEvidenceRules.length > 0 ? (
              <Stack gap="sm">
                {selectedLogEvidenceRules.map((rule) => {
                  const isImageRule = rule.type === 'image';
                  const ruleItems = getRuleItems(logDetailFormState.evidenceItems, rule);
                  const savedRuleItems = selectedLog
                    ? getRuleItems(getNormalizedEvidenceItems(selectedLog.meta), rule)
                    : [];
                  const hasSavedRuleData = savedRuleItems.some(hasEvidenceItemContent);
                  const isRuleEditing = selectedLogEvidenceReadOnly
                    ? false
                    : (evidenceRuleEditModes[rule.key] ?? !hasSavedRuleData);
                  const showRuleActions = !selectedLogEvidenceReadOnly && !isImageRule;
                  const ruleReadOnly =
                    selectedLogEvidenceReadOnly ||
                    (isImageRule ? hasSavedRuleData : hasSavedRuleData && !isRuleEditing);
                  const ruleLockedWithValue = hasSavedRuleData && ruleReadOnly;
                  const minimumInputCount = Math.max(
                    rule.required === false ? 0 : 1,
                    rule.minItems ?? 0,
                  );
                  const desiredInputCount = linkInputCounts[rule.key] ?? 0;
                  const displayInputCount =
                    rule.type === 'link'
                      ? Math.min(
                          rule.maxItems ?? Number.MAX_SAFE_INTEGER,
                          Math.max(desiredInputCount, ruleItems.length, minimumInputCount, 1),
                        )
                      : 0;
                  const canAddMoreLinks =
                    rule.type === 'link' &&
                    rule.multiple &&
                    (rule.maxItems == null || displayInputCount < rule.maxItems);
                  const helperParts: string[] = [];
                  if (rule.type === 'link' && (rule.match?.hosts?.length ?? 0) > 0) {
                    helperParts.push(`Hosts: ${(rule.match?.hosts ?? []).join(', ')}`);
                  }
                  if (rule.type === 'link' && (rule.match?.contains?.length ?? 0) > 0) {
                    helperParts.push(`Keywords: ${(rule.match?.contains ?? []).join(', ')}`);
                  }
                  if (rule.type === 'link' && rule.match?.regex) {
                    helperParts.push(`Pattern: ${rule.match.regex}`);
                  }

                  return (
                    <Paper
                      key={rule.key}
                      withBorder
                      radius="lg"
                      p="md"
                      bg={ruleLockedWithValue ? 'gray.0' : undefined}
                    >
                      <Stack gap="sm">
                        <Stack gap={4} style={{ width: '100%' }}>
                          <Box
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: 8,
                              width: '100%',
                              position: 'relative',
                            }}
                          >
                            <Group
                              gap="xs"
                              wrap="wrap"
                              style={{
                                minWidth: 0,
                                justifyContent: 'center',
                                alignItems: 'center',
                                maxWidth: showRuleActions ? 'calc(100% - 88px)' : '100%',
                              }}
                            >
                              <Stack gap={4} align="center" style={{ minWidth: 0 }}>
                                <Group gap={6} wrap="nowrap" justify="center">
                                  <Text
                                    fw={600}
                                    ta="center"
                                    style={{
                                      minWidth: 0,
                                      whiteSpace: 'nowrap',
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      maxWidth: '100%',
                                    }}
                                  >
                                    {rule.label}
                                  </Text>
                                  {helperParts.length > 0 && (
                                    <Popover width={340} position="bottom" withArrow shadow="md">
                                      <Popover.Target>
                                        <ActionIcon
                                          variant="subtle"
                                          color="gray"
                                          size="sm"
                                          aria-label={`Show evidence hint for ${rule.label}`}
                                        >
                                          <IconInfoCircle size={14} />
                                        </ActionIcon>
                                      </Popover.Target>
                                      <Popover.Dropdown>
                                        <Stack gap={4}>
                                          {helperParts.map((part) => (
                                            <Text key={`${rule.key}-${part}`} size="xs" c="dimmed">
                                              {part}
                                            </Text>
                                          ))}
                                        </Stack>
                                      </Popover.Dropdown>
                                    </Popover>
                                  )}
                                </Group>
                                <Group gap={6} wrap="nowrap" justify="center">
                                  <Badge size="xs" variant="light" color={rule.type === 'link' ? 'blue' : 'grape'}>
                                    {rule.type}
                                  </Badge>
                                  <Badge size="xs" variant="outline" color={rule.required === false ? 'gray' : 'red'}>
                                    {rule.required === false ? 'Optional' : 'Required'}
                                  </Badge>
                                  {rule.multiple && (
                                    <Badge size="xs" variant="outline" color="dark">
                                      Multiple
                                    </Badge>
                                  )}
                                </Group>
                              </Stack>
                            </Group>
                            {showRuleActions && (
                              <Box
                                style={{
                                  position: 'absolute',
                                  right: 0,
                                  top: '50%',
                                  transform: 'translateY(-50%)',
                                }}
                              >
                                {!hasSavedRuleData ? (
                                <Tooltip label="Save evidence">
                                  <ActionIcon
                                    variant="light"
                                    color="blue"
                                    size="sm"
                                    aria-label={`Save evidence for ${rule.label}`}
                                    onClick={() => {
                                      void handleLogEvidenceSaveRule(rule);
                                    }}
                                    disabled={logDetailSubmitting}
                                  >
                                    <IconDeviceFloppy size={14} />
                                  </ActionIcon>
                                </Tooltip>
                              ) : isRuleEditing ? (
                                <Group gap={6} wrap="nowrap">
                                  <Tooltip label="Save evidence">
                                    <ActionIcon
                                      variant="light"
                                      color="green"
                                      size="sm"
                                      aria-label={`Save evidence for ${rule.label}`}
                                      onClick={() => {
                                        void handleLogEvidenceSaveRule(rule);
                                      }}
                                      disabled={logDetailSubmitting}
                                    >
                                      <IconCheck size={14} />
                                    </ActionIcon>
                                  </Tooltip>
                                  <Tooltip label="Cancel editing">
                                    <ActionIcon
                                      variant="light"
                                      color="red"
                                      size="sm"
                                      aria-label={`Cancel editing evidence for ${rule.label}`}
                                      onClick={() => handleEvidenceRuleEditCancel(rule)}
                                      disabled={logDetailSubmitting}
                                    >
                                      <IconX size={14} />
                                    </ActionIcon>
                                  </Tooltip>
                                </Group>
                              ) : (
                                <Tooltip label="Edit evidence">
                                  <ActionIcon
                                    variant="light"
                                    color="blue"
                                    size="sm"
                                    aria-label={`Edit evidence for ${rule.label}`}
                                    onClick={() => handleEvidenceRuleEditStart(rule.key)}
                                    disabled={logDetailSubmitting}
                                  >
                                    <IconPencil size={14} />
                                  </ActionIcon>
                                </Tooltip>
                              )}
                              </Box>
                            )}
                          </Box>
                        </Stack>

                        {rule.type === 'link' ? (
                          <Stack gap="xs">
                            {ruleReadOnly ? (
                              ruleItems.filter((item) => Boolean(item.value?.trim())).length > 0 ? (
                                ruleItems
                                  .filter((item) => Boolean(item.value?.trim()))
                                  .map((item) => (
                                    <Paper key={item.id} withBorder radius="md" p="sm">
                                      <Text
                                        size="sm"
                                        c="blue"
                                        style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}
                                      >
                                        <a
                                          href={item.value ?? '#'}
                                          target="_blank"
                                          rel="noreferrer"
                                          style={{
                                            display: 'inline-block',
                                            maxWidth: '100%',
                                            overflowWrap: 'anywhere',
                                            wordBreak: 'break-word',
                                          }}
                                        >
                                          {item.value}
                                        </a>
                                      </Text>
                                    </Paper>
                                  ))
                              ) : (
                                <Text size="sm" c="dimmed" ta="center">
                                  No links added yet.
                                </Text>
                              )
                            ) : (
                              <>
                                {Array.from({ length: displayInputCount }).map((_, index) => {
                                  const item = ruleItems[index];
                                  const linkError = item?.value
                                    ? validateEvidenceLinkValue(rule, item.value ?? '')
                                    : null;
                                  const minimumDisplayCount = Math.max(minimumInputCount, 1);
                                  const canRemoveEmptyRow =
                                    !item && displayInputCount > minimumDisplayCount;

                                  return (
                                    <Group key={`${rule.key}-${index}`} gap="xs" align="flex-end" wrap="nowrap">
                                      <TextInput
                                        style={{ flex: 1 }}
                                        label={displayInputCount > 1 ? `Link ${index + 1}` : undefined}
                                        placeholder="https://"
                                        value={item?.value ?? ''}
                                        error={linkError}
                                        onChange={(event) =>
                                          handleLinkEvidenceChange(rule, index, event.currentTarget.value)
                                        }
                                      />
                                      {(rule.multiple && item) || canRemoveEmptyRow ? (
                                        <ActionIcon
                                          mb={linkError ? 24 : 0}
                                          color="red"
                                          variant="subtle"
                                          aria-label={`Remove ${rule.label} item ${index + 1}`}
                                          onClick={() => {
                                            if (item) {
                                              handleLinkEvidenceRemove(item.id);
                                              return;
                                            }
                                            setLinkInputCounts((prev) => ({
                                              ...prev,
                                              [rule.key]: Math.max(
                                                minimumDisplayCount,
                                                (prev[rule.key] ?? displayInputCount) - 1,
                                              ),
                                            }));
                                          }}
                                        >
                                          <IconX size={16} />
                                        </ActionIcon>
                                      ) : null}
                                    </Group>
                                  );
                                })}
                                {canAddMoreLinks && (
                                  <Group justify="center">
                                    <Button
                                      variant="default"
                                      size="xs"
                                      leftSection={<IconPlus size={14} />}
                                      onClick={() =>
                                        handleAddLinkEvidenceInput(rule.key, displayInputCount + 1)
                                      }
                                    >
                                      Add Link
                                    </Button>
                                  </Group>
                                )}
                              </>
                            )}
                          </Stack>
                        ) : (
                          <Stack gap="sm">
                            {ruleItems.length > 0 ? (
                              ruleItems.map((item) => (
                                <Paper key={item.id} withBorder radius="md" p="sm">
                                  <Stack gap="sm">
                                    <Box
                                      style={{
                                        width: '100%',
                                        height: 180,
                                        borderRadius: 8,
                                        backgroundColor: '#f3f4f6',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        overflow: 'hidden',
                                        border: '1px solid #d1d5db',
                                        position: 'relative',
                                      }}
                                    >
                                      {evidenceImageThumbs[item.id] ? (
                                        <img
                                          src={evidenceImageThumbs[item.id]}
                                          alt={item.fileName ?? 'Uploaded image'}
                                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                        />
                                      ) : evidenceImageThumbErrors[item.id] ? (
                                        <Text size="xs" c="dimmed" ta="center" px="md">
                                          Preview unavailable
                                        </Text>
                                      ) : (
                                        <Text size="xs" c="dimmed">
                                          Loading preview...
                                        </Text>
                                      )}
                                      {!selectedLogEvidenceReadOnly && (
                                        <Tooltip label="Delete image">
                                          <ActionIcon
                                            variant="filled"
                                            color="red"
                                            size="sm"
                                            aria-label={`Delete image evidence for ${rule.label}`}
                                            onClick={() => {
                                              void handleEvidenceImageDelete(rule, item.id);
                                            }}
                                            disabled={logDetailSubmitting}
                                            style={{
                                              position: 'absolute',
                                              top: 8,
                                              right: 8,
                                            }}
                                          >
                                            <IconTrash size={14} />
                                          </ActionIcon>
                                        </Tooltip>
                                      )}
                                    </Box>
                                    <Text size="sm" fw={600} style={{ minWidth: 0 }}>
                                      {item.fileName ?? 'Uploaded image'}
                                    </Text>
                                    <Group gap="xs" wrap="wrap">
                                      {formatEvidenceFileSize(item.fileSize) && (
                                        <Badge variant="outline">
                                          {formatEvidenceFileSize(item.fileSize)}
                                        </Badge>
                                      )}
                                      {item.uploadedAt && (
                                        <Badge variant="light" color="gray">
                                          {dayjs(item.uploadedAt).format('MMM D, HH:mm')}
                                        </Badge>
                                      )}
                                    </Group>
                                    <Button
                                      size="xs"
                                      variant="default"
                                      loading={evidencePreviewLoadingItemId === item.id}
                                      onClick={() => {
                                        void handleEvidenceImagePreviewOpen(item);
                                      }}
                                      disabled={
                                        !item.driveWebViewLink &&
                                        !evidenceImageThumbs[item.id] &&
                                        Boolean(evidenceImageThumbErrors[item.id])
                                      }
                                    >
                                      View Full Size
                                    </Button>
                                  </Stack>
                                </Paper>
                              ))
                            ) : null}
                            {!ruleReadOnly && (
                              <Group justify="center">
                                <Group gap="sm" justify="center" wrap="wrap">
                                  <Button
                                    component="label"
                                    variant="default"
                                    loading={evidenceUploadingRuleKey === rule.key}
                                  >
                                    {rule.multiple && ruleItems.length > 0 ? 'Upload Another Image' : 'Upload Image'}
                                    <input
                                      hidden
                                      type="file"
                                      accept="image/*"
                                      onChange={(event) => {
                                        const nextFile = event.currentTarget.files?.[0] ?? null;
                                        void handleEvidenceImageSelected(rule, nextFile);
                                        event.currentTarget.value = '';
                                      }}
                                    />
                                  </Button>
                                  <Button
                                    variant="light"
                                    leftSection={<IconCamera size={16} />}
                                    onClick={() => openCameraCaptureModal(rule)}
                                    disabled={!cameraCaptureSupported || evidenceUploadingRuleKey === rule.key}
                                  >
                                    Take Photo
                                  </Button>
                                </Group>
                              </Group>
                            )}
                          </Stack>
                        )}
                      </Stack>
                    </Paper>
                  );
                })}
              </Stack>
            ) : (
              <Text size="sm" c="dimmed" ta="center">
                No evidence rules configured for this task yet.
              </Text>
            )}
            {logDetailError && (
              <Alert color="red" title="Unable to save">
                {logDetailError}
              </Alert>
            )}
            <Group justify="center" gap="sm" wrap="wrap">
              {selectedLogCanComplete ? (
                <Button
                  onClick={handleLogDetailSave}
                  loading={logDetailCompleting}
                  disabled={logDetailCompleting || !selectedLogRequiredEvidenceSatisfied}
                >
                  Complete Task
                </Button>
              ) : selectedLogCanReopen ? (
                <Button
                  variant="default"
                  onClick={handleLogDetailReopen}
                  loading={logDetailReopening}
                  disabled={logDetailReopening}
                >
                  Open Task
                </Button>
              ) : selectedLogCompletionLocked ? (
                <Paper withBorder radius="lg" px="md" py="xs" bg="red.0">
                  <Text fw={700} c="red.7">
                    Task Not Completed
                  </Text>
                </Paper>
              ) : null}
            </Group>
            {selectedLogCanComplete && !selectedLogRequiredEvidenceSatisfied && (
              <Text size="sm" c="dimmed" ta="center">
                Complete all required evidence first: {selectedLogMissingRequiredEvidenceLabels.join(', ')}.
              </Text>
            )}

            <Divider label="Comments" labelPosition="center" />

            <ScrollArea.Autosize mah={240}>
              <Stack gap="sm">
                {selectedLogComments.length > 0 ? (
                  selectedLogComments.map((comment) => (
                    <Card key={comment.id} withBorder padding="sm" radius="lg">
                      <Stack gap={4}>
                        <Group justify="space-between" wrap="wrap">
                          <Text size="sm" fw={600}>
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
                  <Text size="sm" c="dimmed" ta="center">
                    No comments yet.
                  </Text>
                )}
              </Stack>
            </ScrollArea.Autosize>

            <Box pos="relative" pt={8}>
              <Text
                size="xs"
                fw={700}
                c="dimmed"
                tt="uppercase"
                px={6}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 12,
                  backgroundColor: 'var(--mantine-color-body)',
                  zIndex: 1,
                }}
              >
                Comment
              </Text>
              <Textarea
                minRows={2}
                value={commentDraft}
                onChange={(event) => setCommentDraft(event.currentTarget.value)}
              />
            </Box>
            <Group justify="center">
              <Button
                onClick={handleCommentSubmit}
                loading={commentSubmitting}
                disabled={!commentDraft.trim()}
              >
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

      <Modal
        opened={cerebroItemModalOpen}
        onClose={handleCloseCerebroItemModal}
        fullScreen
        title={activeCerebroItem?.title ?? 'Cerebro'}
      >
        <Stack gap="md">
          {cerebroItemLoading ? (
            <Center py="xl">
              <Loader size="sm" />
            </Center>
          ) : cerebroItemError ? (
            <Alert color="red" title="Cerebro">
              {cerebroItemError}
            </Alert>
          ) : activeCerebroItem ? (
            activeCerebroItem.type === 'quiz' ? (
              <Stack gap="md">
                <Group gap="xs" wrap="wrap">
                  <Badge variant="light" color="orange">
                    Quiz
                  </Badge>
                  <Badge variant="outline">
                    Pass {activeCerebroItem.passingScore}%
                  </Badge>
                  <Badge variant="outline">
                    {activeCerebroItem.questions.length} question
                    {activeCerebroItem.questions.length === 1 ? '' : 's'}
                  </Badge>
                </Group>
                {activeCerebroItem.description && (
                  <Alert color="blue">
                    {activeCerebroItem.description}
                  </Alert>
                )}
                {activeCerebroItem.entryTitle && (
                  <Text size="sm" c="dimmed">
                    Linked article: {activeCerebroItem.entryTitle}
                  </Text>
                )}
                <Stack gap="sm">
                  {activeCerebroItem.questions.map((question, index) => (
                    <Paper key={`${activeCerebroItem.id}-${question.id}`} withBorder radius="md" p="md">
                      <Stack gap="xs">
                        <Text fw={600}>
                          {index + 1}. {question.prompt}
                        </Text>
                        <Stack gap={4}>
                          {question.options.map((option) => (
                            <Text key={`${question.id}-${option.id}`} size="sm">
                              • {option.label}
                            </Text>
                          ))}
                        </Stack>
                        {question.explanation && (
                          <Text size="sm" c="dimmed">
                            {question.explanation}
                          </Text>
                        )}
                      </Stack>
                    </Paper>
                  ))}
                </Stack>
              </Stack>
            ) : (
              <Stack gap="md">
                <Group gap="xs" wrap="wrap">
                  <Badge variant="light" color={activeCerebroItem.type === 'policy' ? 'teal' : 'blue'}>
                    {activeCerebroItem.type === 'policy' ? 'Policy' : activeCerebroItem.kind}
                  </Badge>
                  {activeCerebroItem.category && (
                    <Badge variant="outline">{activeCerebroItem.category}</Badge>
                  )}
                  {activeCerebroItem.type === 'policy' && (
                    <Badge variant="outline">
                      Version {activeCerebroItem.policyVersion ?? 'current'}
                    </Badge>
                  )}
                </Group>
                {activeCerebroItem.summary && (
                  <Alert color="blue">
                    {activeCerebroItem.summary}
                  </Alert>
                )}
                <Text style={{ whiteSpace: 'pre-wrap' }}>
                  {activeCerebroItem.body}
                </Text>
                {activeCerebroItem.checklistItems.length > 0 && (
                  <Paper withBorder radius="md" p="md">
                    <Stack gap={6}>
                      <Text fw={600}>Checklist</Text>
                      {activeCerebroItem.checklistItems.map((item) => (
                        <Text key={`${activeCerebroItem.id}-${item}`} size="sm">
                          • {item}
                        </Text>
                      ))}
                    </Stack>
                  </Paper>
                )}
                {activeCerebroItem.media.length > 0 && (
                  <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
                    {activeCerebroItem.media.map((mediaItem, index) => (
                      <Paper key={`${activeCerebroItem.id}-media-${index}`} withBorder radius="md" p="sm">
                        <Stack gap="xs">
                          <Image src={mediaItem.url} alt={mediaItem.alt ?? activeCerebroItem.title} radius="md" />
                          {mediaItem.caption && (
                            <Text size="sm" c="dimmed">
                              {mediaItem.caption}
                            </Text>
                          )}
                        </Stack>
                      </Paper>
                    ))}
                  </SimpleGrid>
                )}
              </Stack>
            )
          ) : (
            <Text size="sm" c="dimmed">
              Select a linked Cerebro item.
            </Text>
          )}
        </Stack>
      </Modal>

      <Modal
        opened={cameraCaptureState.opened}
        onClose={closeCameraCaptureModal}
        centered
        size="lg"
        fullScreen={Boolean(isMobile)}
        title={cameraCaptureState.rule ? `Take Photo: ${cameraCaptureState.rule.label}` : 'Take Photo'}
      >
        <Stack gap="md">
          {cameraCaptureError && (
            <Alert color="red" title="Camera">
              {cameraCaptureError}
            </Alert>
          )}
          <Paper withBorder radius="lg" p="md">
            <Stack gap="sm">
              <Text size="sm" c="dimmed" ta="center">
                Capture evidence directly from the device camera. On supported Android, iPhone, iPad, and desktop browsers this opens the live camera feed.
              </Text>
              <Box
                style={{
                  width: '100%',
                  aspectRatio: '4 / 3',
                  borderRadius: 12,
                  overflow: 'hidden',
                  backgroundColor: '#0f172a',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {cameraCaptureLoading ? (
                  <Loader size="sm" color="white" />
                ) : (
                  <video
                    ref={cameraVideoRef}
                    autoPlay
                    muted
                    playsInline
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                    }}
                  />
                )}
              </Box>
              <canvas ref={cameraCanvasRef} style={{ display: 'none' }} />
            </Stack>
          </Paper>
          <Group justify="center" gap="sm" wrap="wrap">
            <Button variant="default" onClick={closeCameraCaptureModal} disabled={cameraCaptureSubmitting}>
              Cancel
            </Button>
            <Button
              leftSection={<IconCamera size={16} />}
              onClick={() => {
                void handleCapturePhoto();
              }}
              loading={cameraCaptureSubmitting}
              disabled={cameraCaptureLoading || !cameraCaptureState.rule}
            >
              Capture Photo
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={Boolean(activeEvidenceImagePreview)}
        onClose={handleCloseEvidenceImagePreview}
        fullScreen
        withCloseButton={false}
        padding={0}
        styles={{
          content: { backgroundColor: '#000' },
          body: { height: '100%', padding: 0 },
        }}
      >
        {activeEvidenceImagePreview && (
          <Box
            style={{
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              backgroundColor: '#000',
              color: '#fff',
            }}
          >
            <Group justify="space-between" align="center" px="md" py="sm">
              <Stack gap={2}>
                <Text c="white" fw={600}>
                  {activeEvidenceImagePreview.name}
                </Text>
                {activeEvidenceImagePreview.capturedAt && (
                  <Text size="sm" c="gray.4">
                    {dayjs(activeEvidenceImagePreview.capturedAt).format('MMM D, YYYY h:mm A')}
                  </Text>
                )}
              </Stack>
              <ActionIcon
                onClick={handleCloseEvidenceImagePreview}
                aria-label="Close image preview"
                variant="light"
                color="gray"
              >
                <IconX size={18} />
              </ActionIcon>
            </Group>

            <Box
              onWheel={handleEvidencePreviewWheel}
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'auto',
                padding: 24,
              }}
            >
              <img
                src={activeEvidenceImagePreview.src}
                alt={activeEvidenceImagePreview.name}
                style={{
                  maxWidth: '100%',
                  maxHeight: '100%',
                  objectFit: 'contain',
                  transform: `scale(${evidenceImageZoom})`,
                  transformOrigin: 'center',
                  transition: 'transform 120ms ease',
                  userSelect: 'none',
                }}
              />
            </Box>

            <Group justify="space-between" align="center" px="md" py="sm">
              <Group gap="xs">
                <Tooltip label="Zoom out">
                  <ActionIcon
                    onClick={handleEvidenceZoomOut}
                    disabled={evidenceImageZoom <= EVIDENCE_PREVIEW_MIN_ZOOM + 0.001}
                    variant="light"
                    color="gray"
                  >
                    <IconMinus size={16} />
                  </ActionIcon>
                </Tooltip>
                <Text c="white" fw={600}>
                  {Math.round(evidenceImageZoom * 100)}%
                </Text>
                <Tooltip label="Zoom in">
                  <ActionIcon
                    onClick={handleEvidenceZoomIn}
                    disabled={evidenceImageZoom >= EVIDENCE_PREVIEW_MAX_ZOOM - 0.001}
                    variant="light"
                    color="gray"
                  >
                    <IconPlus size={16} />
                  </ActionIcon>
                </Tooltip>
                <Button variant="subtle" color="gray" onClick={handleEvidenceZoomReset}>
                  Reset
                </Button>
              </Group>
              {activeEvidenceImagePreview.downloadHref && (
                <Button
                  component="a"
                  href={activeEvidenceImagePreview.downloadHref}
                  target="_blank"
                  rel="noreferrer"
                  variant="light"
                  color="blue"
                >
                  Download
                </Button>
              )}
            </Group>
          </Box>
        )}
      </Modal>
    </Stack>
  );
};

export default AssistantManagerTaskPlanner;
