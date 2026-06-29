import { randomUUID } from 'crypto';
import { Op, type Transaction, type WhereOptions } from 'sequelize';
import type { Response } from 'express';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';
import timezone from 'dayjs/plugin/timezone.js';
import utc from 'dayjs/plugin/utc.js';
import AssistantManagerTaskTemplate, { type AssistantManagerTaskCadence } from '../models/AssistantManagerTaskTemplate.js';
import AssistantManagerTaskAssignment, { type AssistantManagerTaskAssignmentScope } from '../models/AssistantManagerTaskAssignment.js';
import AssistantManagerTaskLog, { type AssistantManagerTaskStatus } from '../models/AssistantManagerTaskLog.js';
import StaffProfile from '../models/StaffProfile.js';
import User from '../models/User.js';
import UserType from '../models/UserType.js';
import ShiftAssignment from '../models/ShiftAssignment.js';
import ShiftInstance from '../models/ShiftInstance.js';
import ShiftRole from '../models/ShiftRole.js';
import UserShiftRole from '../models/UserShiftRole.js';
import CerebroEntry from '../models/CerebroEntry.js';
import CerebroQuiz from '../models/CerebroQuiz.js';
import { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';
import HttpError from '../errors/HttpError.js';
import logger from '../utils/logger.js';
import {
  deleteAssistantManagerTaskEvidenceImage,
  ensureAssistantManagerTaskEvidenceStorage,
  openAssistantManagerTaskEvidenceImageStream,
  storeAssistantManagerTaskEvidenceImage,
} from '../services/assistantManagerTaskEvidenceStorageService.js';
import { getConfigValue } from '../services/configService.js';
import {
  reconcileNightReportTaskWaiversForRange,
} from '../services/assistantManagerTaskWaiverService.js';

dayjs.extend(customParseFormat);
dayjs.extend(utc);
dayjs.extend(timezone);

const CADENCE_VALUES = new Set<AssistantManagerTaskCadence>(['daily', 'weekly', 'biweekly', 'every_two_weeks', 'monthly']);
const STATUS_VALUES = new Set<AssistantManagerTaskStatus>(['pending', 'completed', 'missed', 'waived']);
const ASSIGNMENT_SCOPE_VALUES = new Set<AssistantManagerTaskAssignmentScope>(['staff_type', 'user', 'user_type', 'shift_role']);
const GLOBAL_TASK_VIEWER_ROLES = new Set(['admin', 'owner', 'manager']);
const EVIDENCE_RULE_TYPE_VALUES = new Set(['link', 'image']);
const AM_TASK_PLANNER_START_DATE_KEY = 'AM_TASK_PLANNER_START_DATE';
const SHIFT_EVIDENCE_SOURCES_CONFIG_KEY = 'shiftEvidenceSources';
const TEMPLATE_CONFIG_MANAGED_META_KEYS = [
  'manual',
  'time',
  'durationHours',
  'priority',
  'points',
  'tags',
  'requireShift',
  'onShift',
  'offDay',
  'scheduleConflict',
  'shiftInstanceId',
  'shiftAssignmentId',
  'shiftTimeStart',
  'shiftTimeEnd',
  'expectedEvidenceItems',
] as const;

const startOfPlannerWeek = (value?: string | dayjs.Dayjs | Date | null) => {
  const date = value ? dayjs(value) : dayjs();
  const dayOfWeek = date.day();
  const offset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  return date.startOf('day').subtract(offset, 'day');
};

const resolvePlannerStartDate = (): dayjs.Dayjs | null => {
  try {
    const rawValue = getConfigValue(AM_TASK_PLANNER_START_DATE_KEY);
    const value = typeof rawValue === 'string' ? rawValue.trim() : '';
    if (!value) {
      return null;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return null;
    }
    const parsed = dayjs(value);
    if (!parsed.isValid()) {
      return null;
    }
    if (parsed.format('YYYY-MM-DD') !== value) {
      return null;
    }
    return parsed.startOf('day');
  } catch {
    return null;
  }
};

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

const canViewAllTaskLogs = (req: AuthenticatedRequest): boolean => {
  const normalizedRole = normalizeRoleSlug(req.authContext?.roleSlug ?? null);
  return normalizedRole != null && GLOBAL_TASK_VIEWER_ROLES.has(normalizedRole);
};
const PRIORITY_VALUES = new Set(['high', 'medium', 'low']);
const TIME_INPUT_FORMATS = ['HH:mm', 'H:mm', 'HH:mm:ss', 'h:mm A', 'h A'];
const TASK_COMPLETION_WINDOW_MODE_VALUES = new Set(['day', 'strict']);
const DEFAULT_TASK_TIMEZONE = 'Europe/Warsaw';

type ShiftDayInfo = {
  shiftInstanceId: number;
  shiftAssignmentId: number;
  date: string;
  timeStart: string | null;
  timeEnd: string | null;
};

type ScheduledShiftCandidate = {
  userId: number;
  userName: string;
  userTypeId: number | null;
  shiftTypeId: number | null;
  shiftRoleId: number | null;
  staffType: string | null;
  livesInAccom: boolean | null;
  shiftInfo: ShiftDayInfo;
};

type ShiftEvidenceSourceConfig = {
  key: string;
  label: string;
  evidenceRuleKey: string;
  shiftTypeIds: number[];
};

type AssistantManagerTaskExpectedEvidenceItem = {
  id: string;
  sourceKey: string;
  sourceLabel: string;
  ruleKey: string;
  type: 'image';
  subjectUserId: number;
  subjectName: string;
  shiftTypeIds: number[];
};

type PlannedGeneratedLog = {
  template: AssistantManagerTaskTemplate;
  assignment: AssistantManagerTaskAssignment;
  candidate: ScheduledShiftCandidate;
  taskDate: string;
  expectedEvidenceItems: AssistantManagerTaskExpectedEvidenceItem[];
};

const buildTaskLogKey = (templateId: number, userId: number, taskDate: string) =>
  `${templateId}:${userId}:${taskDate}`;

type ManualTaskPayload = {
  templateId: number | null;
  userId: number | null;
  assignmentId: number | null;
  taskDate: string | null;
  status?: AssistantManagerTaskStatus;
  notes?: string | null;
  meta: Record<string, unknown>;
  initialComment?: string | null;
  requireShift: boolean;
};

type MetaUpdatePayload = {
  metaPatch: Record<string, unknown>;
  taskDate?: string | null;
  notes?: string | null;
  comment?: string | null;
  requireShift?: boolean | null;
};

type AssistantManagerTaskEvidenceRule = {
  key: string;
  label: string;
  type: 'link' | 'image';
  required: boolean;
  multiple: boolean;
  minItems: number;
  maxItems: number | null;
  match: {
    hosts: string[];
    contains: string[];
    regex: string | null;
  } | null;
};

type AssistantManagerTaskEvidenceItem = {
  id: string;
  ruleKey: string;
  type: 'link' | 'image';
  value?: string | null;
  valid?: boolean;
  subjectUserId?: number | null;
  subjectName?: string | null;
  fileName?: string | null;
  mimeType?: string | null;
  fileSize?: number | null;
  storagePath?: string | null;
  driveFileId?: string | null;
  driveWebViewLink?: string | null;
  uploadedAt?: string | null;
  uploadedBy?: number | null;
};

const toScheduleConfig = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object') {
    return {};
  }
  return value as Record<string, unknown>;
};

const normalizeStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter(Boolean);
};

const normalizePositiveIntArray = (value: unknown): number[] => {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  return Array.from(
    new Set(
      values
        .map((entry) => Number(entry))
        .filter((entry) => Number.isInteger(entry) && entry > 0),
    ),
  );
};

const sanitizeEvidenceRules = (value: unknown): AssistantManagerTaskEvidenceRule[] => {
  if (value == null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error('evidenceRules must be an array');
  }

  const seenKeys = new Set<string>();
  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`evidenceRules[${index}] must be an object`);
    }
    const source = entry as Record<string, unknown>;
    const key = typeof source.key === 'string' ? source.key.trim() : '';
    const label = typeof source.label === 'string' ? source.label.trim() : '';
    const type = typeof source.type === 'string' ? source.type.trim().toLowerCase() : '';
    if (!key) {
      throw new Error(`evidenceRules[${index}].key is required`);
    }
    if (seenKeys.has(key)) {
      throw new Error(`evidenceRules key "${key}" must be unique`);
    }
    seenKeys.add(key);
    if (!label) {
      throw new Error(`evidenceRules[${index}].label is required`);
    }
    if (!EVIDENCE_RULE_TYPE_VALUES.has(type)) {
      throw new Error(`evidenceRules[${index}].type must be link or image`);
    }

    const required = source.required !== false;
    const multiple = source.multiple === true;
    const minItemsRaw = Number(source.minItems ?? (required ? 1 : 0));
    const maxItemsRaw =
      source.maxItems == null || source.maxItems === ''
        ? null
        : Number(source.maxItems);
    const minItems = Number.isInteger(minItemsRaw) && minItemsRaw >= 0 ? minItemsRaw : required ? 1 : 0;
    const maxItems =
      maxItemsRaw != null && Number.isInteger(maxItemsRaw) && maxItemsRaw > 0 ? maxItemsRaw : null;
    if (!multiple && maxItems != null && maxItems > 1) {
      throw new Error(`evidenceRules[${index}].maxItems cannot exceed 1 when multiple is false`);
    }
    const rawMatch = source.match && typeof source.match === 'object' ? (source.match as Record<string, unknown>) : null;
    const match = type === 'link'
      ? {
          hosts: normalizeStringArray(rawMatch?.hosts),
          contains: normalizeStringArray(rawMatch?.contains),
          regex: typeof rawMatch?.regex === 'string' && rawMatch.regex.trim() ? rawMatch.regex.trim() : null,
        }
      : null;
    if (match?.regex) {
      try {
        // Validate regex eagerly so bad rules fail at template save time.
        // eslint-disable-next-line no-new
        new RegExp(match.regex, 'i');
      } catch {
        throw new Error(`evidenceRules[${index}].match.regex is invalid`);
      }
    }

    return {
      key,
      label,
      type: type as 'link' | 'image',
      required,
      multiple,
      minItems,
      maxItems,
      match,
    };
  });
};

const sanitizeShiftEvidenceSources = (value: unknown): ShiftEvidenceSourceConfig[] => {
  if (value == null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error('shiftEvidenceSources must be an array');
  }

  const seenKeys = new Set<string>();
  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`shiftEvidenceSources[${index}] must be an object`);
    }

    const source = entry as Record<string, unknown>;
    const key = typeof source.key === 'string' ? source.key.trim() : '';
    const label = typeof source.label === 'string' ? source.label.trim() : '';
    const evidenceRuleKey =
      typeof source.evidenceRuleKey === 'string'
        ? source.evidenceRuleKey.trim()
        : typeof source.ruleKey === 'string'
          ? source.ruleKey.trim()
          : '';
    const shiftTypeIds = normalizePositiveIntArray(source.shiftTypeIds ?? source.shiftTypeId);

    if (!key) {
      throw new Error(`shiftEvidenceSources[${index}].key is required`);
    }
    if (seenKeys.has(key)) {
      throw new Error(`shiftEvidenceSources key "${key}" must be unique`);
    }
    seenKeys.add(key);
    if (!label) {
      throw new Error(`shiftEvidenceSources[${index}].label is required`);
    }
    if (!evidenceRuleKey) {
      throw new Error(`shiftEvidenceSources[${index}].evidenceRuleKey is required`);
    }
    if (shiftTypeIds.length === 0) {
      throw new Error(`shiftEvidenceSources[${index}].shiftTypeIds must contain at least one shift type`);
    }

    return {
      key,
      label,
      evidenceRuleKey,
      shiftTypeIds,
    };
  });
};

const getEvidenceRules = (template?: AssistantManagerTaskTemplate | null): AssistantManagerTaskEvidenceRule[] => {
  if (!template) {
    return [];
  }
  try {
    return sanitizeEvidenceRules(template.scheduleConfig?.['evidenceRules']);
  } catch {
    return [];
  }
};

const getShiftEvidenceSources = (template?: AssistantManagerTaskTemplate | null): ShiftEvidenceSourceConfig[] => {
  if (!template) {
    return [];
  }
  try {
    return sanitizeShiftEvidenceSources(template.scheduleConfig?.[SHIFT_EVIDENCE_SOURCES_CONFIG_KEY]);
  } catch {
    return [];
  }
};

const sanitizeEvidenceItems = (value: unknown): AssistantManagerTaskEvidenceItem[] => {
  if (value == null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error('evidenceItems must be an array');
  }

  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`evidenceItems[${index}] must be an object`);
    }
    const source = entry as Record<string, unknown>;
    const ruleKey = typeof source.ruleKey === 'string' ? source.ruleKey.trim() : '';
    const type = typeof source.type === 'string' ? source.type.trim().toLowerCase() : '';
    if (!ruleKey) {
      throw new Error(`evidenceItems[${index}].ruleKey is required`);
    }
    if (!EVIDENCE_RULE_TYPE_VALUES.has(type)) {
      throw new Error(`evidenceItems[${index}].type must be link or image`);
    }
    return {
      id: typeof source.id === 'string' && source.id.trim() ? source.id.trim() : randomUUID(),
      ruleKey,
      type: type as 'link' | 'image',
      value: typeof source.value === 'string' ? source.value.trim() : null,
      valid: source.valid === undefined ? undefined : Boolean(source.valid),
      subjectUserId:
        source.subjectUserId == null
          ? null
          : Number.isInteger(Number(source.subjectUserId)) && Number(source.subjectUserId) > 0
            ? Number(source.subjectUserId)
            : null,
      subjectName: typeof source.subjectName === 'string' ? source.subjectName.trim() : null,
      fileName: typeof source.fileName === 'string' ? source.fileName.trim() : null,
      mimeType: typeof source.mimeType === 'string' ? source.mimeType.trim() : null,
      fileSize: source.fileSize == null ? null : Number(source.fileSize),
      storagePath: typeof source.storagePath === 'string' ? source.storagePath.trim() : null,
      driveFileId: typeof source.driveFileId === 'string' ? source.driveFileId.trim() : null,
      driveWebViewLink: typeof source.driveWebViewLink === 'string' ? source.driveWebViewLink.trim() : null,
      uploadedAt: typeof source.uploadedAt === 'string' ? source.uploadedAt.trim() : null,
      uploadedBy: source.uploadedBy == null ? null : Number(source.uploadedBy),
    };
  });
};

const validateLinkEvidenceItem = (
  item: AssistantManagerTaskEvidenceItem,
  rule: AssistantManagerTaskEvidenceRule,
): { valid: boolean; normalizedValue: string } => {
  const value = typeof item.value === 'string' ? item.value.trim() : '';
  if (!value) {
    return { valid: false, normalizedValue: value };
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { valid: false, normalizedValue: value };
  }

  const lowerValue = value.toLowerCase();
  const host = url.hostname.toLowerCase();
  const match = rule.match;

  if (match?.hosts?.length && !match.hosts.some((candidate) => host === candidate.toLowerCase())) {
    return { valid: false, normalizedValue: value };
  }
  if (match?.contains?.length && !match.contains.some((candidate) => lowerValue.includes(candidate.toLowerCase()))) {
    return { valid: false, normalizedValue: value };
  }
  if (match?.regex) {
    const regex = new RegExp(match.regex, 'i');
    if (!regex.test(value)) {
      return { valid: false, normalizedValue: value };
    }
  }

  return { valid: true, normalizedValue: value };
};

const validateEvidenceItemsAgainstRules = (
  rules: AssistantManagerTaskEvidenceRule[],
  evidenceItems: AssistantManagerTaskEvidenceItem[],
  options?: {
    enforceRequired?: boolean;
  },
) => {
  const enforceRequired = options?.enforceRequired === true;
  const errors: string[] = [];
  const normalizedItems = evidenceItems.map((item) => ({ ...item }));

  for (const rule of rules) {
    const matched = normalizedItems.filter((item) => item.ruleKey === rule.key && item.type === rule.type);
    if (!rule.multiple && matched.length > 1) {
      errors.push(`${rule.label} accepts only one evidence item`);
      continue;
    }
    if (rule.maxItems != null && matched.length > rule.maxItems) {
      errors.push(`${rule.label} accepts at most ${rule.maxItems} evidence item(s)`);
    }

    let validCount = 0;
    matched.forEach((item) => {
      if (rule.type === 'link') {
        const result = validateLinkEvidenceItem(item, rule);
        item.value = result.normalizedValue;
        item.valid = result.valid;
        if (!result.valid) {
          errors.push(`${rule.label} contains an invalid link`);
        }
        if (result.valid) {
          validCount += 1;
        }
      } else {
        const valid = Boolean(item.storagePath || item.driveFileId || item.driveWebViewLink);
        item.valid = valid;
        if (!valid) {
          errors.push(`${rule.label} contains an invalid image upload`);
        }
        if (valid) {
          validCount += 1;
        }
      }
    });

    const minRequired = Math.max(rule.required ? 1 : 0, rule.minItems ?? 0);
    if (enforceRequired && validCount < minRequired) {
      errors.push(`${rule.label} requires at least ${minRequired} valid evidence item(s)`);
    }
  }

  return {
    errors,
    normalizedItems,
  };
};

const sanitizeTemplatePayload = (body: Record<string, unknown>) => {
  const next: Partial<AssistantManagerTaskTemplate> & { scheduleConfig?: Record<string, unknown> } = {};
  if (typeof body.name === 'string') {
    next.name = body.name.trim();
  }
  if (typeof body.description === 'string') {
    next.description = body.description.trim();
  } else if (body.description === null) {
    next.description = null;
  }
  if (typeof body.category === 'string') {
    next.category = body.category.trim();
  }
  if (typeof body.subgroup === 'string') {
    next.subgroup = body.subgroup.trim();
  }
  if (body.categoryOrder != null) {
    const numeric = Number(body.categoryOrder);
    if (Number.isInteger(numeric) && numeric >= 0) {
      next.categoryOrder = numeric;
    }
  }
  if (body.subgroupOrder != null) {
    const numeric = Number(body.subgroupOrder);
    if (Number.isInteger(numeric) && numeric >= 0) {
      next.subgroupOrder = numeric;
    }
  }
  if (body.templateOrder != null) {
    const numeric = Number(body.templateOrder);
    if (Number.isInteger(numeric) && numeric >= 0) {
      next.templateOrder = numeric;
    }
  }
  if (typeof body.cadence === 'string' && CADENCE_VALUES.has(body.cadence.trim() as AssistantManagerTaskCadence)) {
    next.cadence = body.cadence.trim() as AssistantManagerTaskCadence;
  }
  if (body.scheduleConfig != null) {
    next.scheduleConfig = toScheduleConfig(body.scheduleConfig);
    if ('time' in next.scheduleConfig) {
      const normalizedTime = normalizeTimeValue(next.scheduleConfig.time);
      if (next.scheduleConfig.time != null && next.scheduleConfig.time !== '' && !normalizedTime) {
        throw new HttpError(400, 'scheduleConfig.time is invalid');
      }
      if (normalizedTime) {
        next.scheduleConfig.time = normalizedTime;
      } else {
        delete next.scheduleConfig.time;
      }
    }
    if ('hour' in next.scheduleConfig) {
      delete next.scheduleConfig.hour;
    }
    if ('evidenceRules' in next.scheduleConfig) {
      next.scheduleConfig.evidenceRules = sanitizeEvidenceRules(next.scheduleConfig.evidenceRules);
    }
    if (SHIFT_EVIDENCE_SOURCES_CONFIG_KEY in next.scheduleConfig) {
      next.scheduleConfig[SHIFT_EVIDENCE_SOURCES_CONFIG_KEY] = sanitizeShiftEvidenceSources(
        next.scheduleConfig[SHIFT_EVIDENCE_SOURCES_CONFIG_KEY],
      );
    }
  }
  if (body.isActive != null) {
    next.isActive = Boolean(body.isActive);
  }
  return next;
};

const sanitizeAssignmentPayload = (body: Record<string, unknown>) => {
  const next: Partial<AssistantManagerTaskAssignment> & { targetScope?: AssistantManagerTaskAssignmentScope } = {};
  if (typeof body.targetScope === 'string' && ASSIGNMENT_SCOPE_VALUES.has(body.targetScope.trim() as AssistantManagerTaskAssignmentScope)) {
    next.targetScope = body.targetScope.trim() as AssistantManagerTaskAssignmentScope;
  }
  if (typeof body.staffType === 'string') {
    next.staffType = body.staffType.trim() || null;
  } else if (body.staffType === null) {
    next.staffType = null;
  }
  if (typeof body.livesInAccom === 'boolean') {
    next.livesInAccom = body.livesInAccom;
  } else if (typeof body.livesInAccom === 'string') {
    const normalized = body.livesInAccom.trim().toLowerCase();
    if (normalized === 'true') {
      next.livesInAccom = true;
    } else if (normalized === 'false') {
      next.livesInAccom = false;
    }
  } else if (body.livesInAccom === null) {
    next.livesInAccom = null;
  }
  if (body.userId != null) {
    const numeric = Number(body.userId);
    if (Number.isFinite(numeric) && numeric > 0) {
      next.userId = numeric;
    }
  } else if (body.userId === null) {
    next.userId = null;
  }
  if (body.userTypeId != null) {
    const numeric = Number(body.userTypeId);
    if (Number.isFinite(numeric) && numeric > 0) {
      next.userTypeId = numeric;
    }
  } else if (body.userTypeId === null) {
    next.userTypeId = null;
  }
  if (body.shiftRoleId != null) {
    const numeric = Number(body.shiftRoleId);
    if (Number.isFinite(numeric) && numeric > 0) {
      next.shiftRoleId = numeric;
    }
  } else if (body.shiftRoleId === null) {
    next.shiftRoleId = null;
  }
  if (typeof body.effectiveStart === 'string' && body.effectiveStart.trim()) {
    next.effectiveStart = body.effectiveStart.trim();
  } else if (body.effectiveStart === null) {
    next.effectiveStart = null;
  }
  if (typeof body.effectiveEnd === 'string' && body.effectiveEnd.trim()) {
    next.effectiveEnd = body.effectiveEnd.trim();
  } else if (body.effectiveEnd === null) {
    next.effectiveEnd = null;
  }
  if (body.isActive != null) {
    next.isActive = Boolean(body.isActive);
  }
  return next;
};

const resolveAssignmentTargetScope = (
  payload: Partial<AssistantManagerTaskAssignment> & { targetScope?: AssistantManagerTaskAssignmentScope },
) => {
  if (payload.userId) {
    return 'user';
  }
  if (payload.shiftRoleId) {
    return 'shift_role';
  }
  if (payload.userTypeId) {
    return 'user_type';
  }
  if (payload.staffType) {
    return 'staff_type';
  }
  return payload.targetScope ?? 'staff_type';
};

const getAssignmentTargetValidationMessage = (
  payload: Partial<AssistantManagerTaskAssignment> & { targetScope?: AssistantManagerTaskAssignmentScope },
) => {
  if (!payload.userId && !payload.staffType && !payload.userTypeId && !payload.shiftRoleId) {
    return 'At least one assignment filter is required';
  }
  if (payload.livesInAccom != null && !payload.staffType) {
    return 'staffType is required when filtering by accommodation';
  }
  return null;
};

const intersectUserIdGroups = (groups: number[][]) => {
  if (groups.length === 0) {
    return [];
  }
  let result = Array.from(new Set(groups[0]));
  for (let index = 1; index < groups.length; index += 1) {
    const allowed = new Set(groups[index]);
    result = result.filter((userId) => allowed.has(userId));
    if (result.length === 0) {
      break;
    }
  }
  return result;
};

const parsePositiveInt = (value: unknown): number | null => {
  if (value == null) {
    return null;
  }
  const numeric = Number(value);
  if (Number.isInteger(numeric) && numeric > 0) {
    return numeric;
  }
  return null;
};

const sanitizeTaskDate = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = dayjs(trimmed);
  if (!parsed.isValid()) {
    return null;
  }
  return parsed.format('YYYY-MM-DD');
};

const normalizeTimeValue = (value: unknown): string | null => {
  if (value == null) {
    return null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const hours = Math.max(0, Math.min(23, Math.floor(value)));
    const minutes = Math.max(0, Math.min(59, Math.round((value - hours) * 60)));
    return dayjs().hour(hours).minute(minutes).second(0).format('HH:mm');
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const parsed = dayjs(trimmed, TIME_INPUT_FORMATS, true);
    if (parsed.isValid()) {
      return parsed.format('HH:mm');
    }
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) {
      const hours = Math.max(0, Math.min(23, Math.floor(numeric)));
      const minutes = Math.max(0, Math.min(59, Math.round((numeric - hours) * 60)));
      return dayjs().hour(hours).minute(minutes).second(0).format('HH:mm');
    }
  }
  return null;
};

const resolveTaskPlannerTimezone = (): string =>
  (getConfigValue('SCHED_TZ') as string) ?? DEFAULT_TASK_TIMEZONE;

const normalizeTaskCompletionWindowMode = (value: unknown): 'day' | 'strict' => {
  if (typeof value !== 'string') {
    return 'day';
  }
  const normalized = value.trim().toLowerCase();
  return TASK_COMPLETION_WINDOW_MODE_VALUES.has(normalized) && normalized === 'strict'
    ? 'strict'
    : 'day';
};

const resolveTaskCompletionWindowMode = (
  template?: Pick<AssistantManagerTaskTemplate, 'scheduleConfig'> | null,
  meta?: Record<string, unknown> | null,
): 'day' | 'strict' => {
  const metaValue = meta?.completionWindowMode;
  if (typeof metaValue === 'string') {
    const normalized = metaValue.trim().toLowerCase();
    if (TASK_COMPLETION_WINDOW_MODE_VALUES.has(normalized)) {
      return normalizeTaskCompletionWindowMode(normalized);
    }
  }

  const scheduleConfig = toScheduleConfig(template?.scheduleConfig);
  return normalizeTaskCompletionWindowMode(scheduleConfig.completionWindowMode);
};

const resolveTaskLogDurationHours = (
  log: Pick<AssistantManagerTaskLog, 'meta'> & { template?: Pick<AssistantManagerTaskTemplate, 'scheduleConfig'> | null },
): number | null => {
  const meta = (log.meta ?? {}) as Record<string, unknown>;
  const scheduleConfig = toScheduleConfig(log.template?.scheduleConfig);
  const durationValue =
    typeof meta.durationHours === 'number'
      ? meta.durationHours
      : Number(meta.durationHours ?? scheduleConfig.durationHours ?? NaN);

  if (!Number.isFinite(durationValue) || durationValue <= 0) {
    return null;
  }

  return durationValue;
};

const getTaskLogStrictCompletionDeadline = (
  log: Pick<AssistantManagerTaskLog, 'taskDate' | 'meta'> & { template?: Pick<AssistantManagerTaskTemplate, 'scheduleConfig'> | null },
  timezoneName = resolveTaskPlannerTimezone(),
): dayjs.Dayjs | null => {
  if (resolveTaskCompletionWindowMode(log.template, (log.meta ?? {}) as Record<string, unknown>) !== 'strict') {
    return null;
  }

  const meta = (log.meta ?? {}) as Record<string, unknown>;
  const scheduleConfig = toScheduleConfig(log.template?.scheduleConfig);
  const normalizedTime = normalizeTimeValue(
    meta.time ?? meta.shiftTimeStart ?? scheduleConfig.time ?? scheduleConfig.hour,
  );
  const durationHours = resolveTaskLogDurationHours(log);
  if (!normalizedTime || durationHours == null) {
    return null;
  }

  const startAt = dayjs.tz(`${log.taskDate} ${normalizedTime}`, 'YYYY-MM-DD HH:mm', timezoneName);
  if (!startAt.isValid()) {
    return null;
  }

  return startAt.add(Math.round(durationHours * 60), 'minute');
};

const parseOptionalTime = (value: unknown, fieldName: string): string | null | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || (typeof value === 'string' && value.trim() === '')) {
    return null;
  }
  const normalized = normalizeTimeValue(value);
  if (!normalized) {
    throw new Error(`${fieldName} is invalid`);
  }
  return normalized;
};

const parseOptionalNumber = (value: unknown, fieldName: string, options?: { min?: number }): number | null | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || value === '') {
    return null;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new Error(`${fieldName} must be numeric`);
  }
  if (options?.min != null && numeric < options.min) {
    throw new Error(`${fieldName} must be at least ${options.min}`);
  }
  return numeric;
};

const parseOptionalPriority = (value: unknown, fieldName: string): string | null | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || (typeof value === 'string' && value.trim() === '')) {
    return null;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (PRIORITY_VALUES.has(normalized)) {
      return normalized;
    }
  }
  throw new Error(`${fieldName} must be one of high, medium, or low`);
};

const parseOptionalStringArray = (value: unknown, fieldName: string): string[] | null | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return [];
  }
  let values: unknown[] = [];
  if (Array.isArray(value)) {
    values = value;
  } else if (typeof value === 'string') {
    values = value
      .split(',')
      .map((token) => token.trim())
      .filter(Boolean);
  } else {
    throw new Error(`${fieldName} must be an array or comma separated string`);
  }
  return values
    .map((entry) => (typeof entry === 'string' ? entry.trim() : null))
    .filter((entry): entry is string => Boolean(entry));
};

const sanitizePlannerMetaInput = (source: Record<string, unknown>) => {
  const meta: Record<string, unknown> = {};
  if ('time' in source) {
    const parsed = parseOptionalTime(source.time, 'time');
    if (parsed !== undefined) {
      meta.time = parsed;
    }
  }
  if ('durationHours' in source) {
    const parsed = parseOptionalNumber(source.durationHours, 'durationHours', { min: 0.25 });
    if (parsed !== undefined) {
      meta.durationHours = parsed;
    }
  }
  if ('priority' in source) {
    const parsed = parseOptionalPriority(source.priority, 'priority');
    if (parsed !== undefined) {
      meta.priority = parsed;
    }
  }
  if ('points' in source) {
    const parsed = parseOptionalNumber(source.points, 'points', { min: 0 });
    if (parsed !== undefined) {
      meta.points = parsed;
    }
  }
  if ('tags' in source) {
    const parsed = parseOptionalStringArray(source.tags, 'tags');
    if (parsed !== undefined) {
      meta.tags = parsed;
    }
  }
  if ('evidence' in source) {
    const parsed = parseOptionalStringArray(source.evidence, 'evidence');
    if (parsed !== undefined) {
      meta.evidence = parsed;
    }
  }
  if ('evidenceItems' in source) {
    meta.evidenceItems = sanitizeEvidenceItems(source.evidenceItems);
  } else if ('attachments' in source) {
    const parsed = parseOptionalStringArray(source.attachments, 'attachments');
    if (parsed !== undefined) {
      meta.evidence = parsed;
    }
  }
  if ('manual' in source) {
    meta.manual = Boolean(source.manual);
  }
  return meta;
};

const sanitizeScheduleConfigMeta = (config: Record<string, unknown>, shiftTime?: string | null) => {
  const meta: Record<string, unknown> = {};
  const timeRaw = config.time ?? config.timeSlot ?? config.hour ?? config.startTime ?? null;
  const normalizedTime = normalizeTimeValue(timeRaw);
  if (normalizedTime) {
    meta.time = normalizedTime;
  } else if (shiftTime) {
    meta.time = shiftTime;
  }
  const durationRaw = Number(config.durationHours ?? config.duration ?? 1);
  if (Number.isFinite(durationRaw) && durationRaw > 0) {
    meta.durationHours = durationRaw;
  }
  if (typeof config.priority === 'string' && PRIORITY_VALUES.has(config.priority.toLowerCase())) {
    meta.priority = config.priority.toLowerCase();
  }
  const pointsRaw = Number(config.points ?? config.pointValue ?? 1);
  if (Number.isFinite(pointsRaw) && pointsRaw >= 0) {
    meta.points = pointsRaw;
  }
  if (Array.isArray(config.tags)) {
    meta.tags = config.tags.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
  }
  return meta;
};

const getRequireShiftFlag = (template: AssistantManagerTaskTemplate): boolean => {
  const config = template.scheduleConfig ?? {};
  if (config.requireShift === false || config.allowOffDays === true || config.requireScheduledShift === false) {
    return false;
  }
  return true;
};

const getTimesPerWeekPerAssignedUser = (template: AssistantManagerTaskTemplate): number | null => {
  const config = template.scheduleConfig ?? {};
  const raw = Number(
    config.timesPerWeekPerAssignedUser ??
      config.times_per_week_per_assigned_user ??
      config.perWeekPerAssignedUser ??
      NaN,
  );

  if (!Number.isInteger(raw) || raw <= 0) {
    return null;
  }

  return raw;
};

const buildShiftMeta = (shiftInfo: ShiftDayInfo | null, requireShift: boolean) => {
  const shiftStart = shiftInfo?.timeStart ? normalizeTimeValue(shiftInfo.timeStart) : null;
  const shiftEnd = shiftInfo?.timeEnd ? normalizeTimeValue(shiftInfo.timeEnd) : null;
  return {
    requireShift,
    onShift: Boolean(shiftInfo),
    offDay: !shiftInfo,
    scheduleConflict: requireShift && !shiftInfo,
    shiftInstanceId: shiftInfo?.shiftInstanceId ?? null,
    shiftAssignmentId: shiftInfo?.shiftAssignmentId ?? null,
    shiftTimeStart: shiftStart,
    shiftTimeEnd: shiftEnd,
  };
};

const buildShiftAvailabilityMap = async (
  userId: number,
  rangeStart: dayjs.Dayjs,
  rangeEnd: dayjs.Dayjs,
  timezoneName = resolveTaskPlannerTimezone(),
) => {
  const assignments = await ShiftAssignment.findAll({
    where: { userId },
    include: [
      {
        model: ShiftInstance,
        as: 'shiftInstance',
        attributes: ['id', 'date', 'shiftTypeId', 'timeStart', 'timeEnd'],
        required: true,
        where: {
          date: {
            [Op.between]: [rangeStart.format('YYYY-MM-DD'), rangeEnd.format('YYYY-MM-DD')],
          },
        },
      },
    ],
  });
  const map = new Map<string, ShiftDayInfo>();
  assignments.forEach((assignment) => {
    const instance = assignment.shiftInstance;
    if (instance?.date) {
      const dateKey = dayjs(instance.date).tz(timezoneName).format('YYYY-MM-DD');
      map.set(dateKey, {
        shiftInstanceId: instance.id,
        shiftAssignmentId: assignment.id,
        date: dateKey,
        timeStart: instance.timeStart ?? null,
        timeEnd: instance.timeEnd ?? null,
      });
    }
  });
  return map;
};

const getShiftInfoForUserOnDate = async (
  userId: number,
  taskDate: string,
  rangeStart: dayjs.Dayjs,
  rangeEnd: dayjs.Dayjs,
  cache?: Map<number, Map<string, ShiftDayInfo>>,
  timezoneName = resolveTaskPlannerTimezone(),
): Promise<ShiftDayInfo | null> => {
  const store = cache ?? new Map<number, Map<string, ShiftDayInfo>>();
  let userMap = store.get(userId);
  if (!userMap) {
    userMap = await buildShiftAvailabilityMap(userId, rangeStart, rangeEnd, timezoneName);
    store.set(userId, userMap);
  }
  return userMap.get(taskDate) ?? null;
};

const buildScheduledShiftCandidateMap = async (
  rangeStart: dayjs.Dayjs,
  rangeEnd: dayjs.Dayjs,
  timezoneName = resolveTaskPlannerTimezone(),
) => {
  const assignments = await ShiftAssignment.findAll({
    include: [
      {
        model: ShiftInstance,
        as: 'shiftInstance',
        attributes: ['id', 'date', 'shiftTypeId', 'timeStart', 'timeEnd'],
        required: true,
        where: {
          date: {
            [Op.between]: [rangeStart.format('YYYY-MM-DD'), rangeEnd.format('YYYY-MM-DD')],
          },
        },
      },
      {
        model: User,
        as: 'assignee',
        attributes: ['id', 'firstName', 'lastName', 'userTypeId', 'status'],
        required: true,
        where: { status: true },
        include: [{ model: StaffProfile, as: 'staffProfile', attributes: ['staffType', 'livesInAccom'], required: false }],
      },
    ],
  });

  const map = new Map<string, ScheduledShiftCandidate[]>();

  assignments.forEach((assignment) => {
    const instance = assignment.shiftInstance;
    const assignee = assignment.assignee as
      | (User & { staffProfile?: StaffProfile | null })
      | null
      | undefined;

    if (!instance?.date || !assignee?.id) {
      return;
    }

    const dateKey = dayjs(instance.date).tz(timezoneName).format('YYYY-MM-DD');
    const userName =
      `${assignee.firstName ?? ''} ${assignee.lastName ?? ''}`.trim() ||
      `User #${assignee.id}`;

    const candidates = map.get(dateKey) ?? [];
    candidates.push({
      userId: assignee.id,
      userName,
      userTypeId: assignee.userTypeId ?? null,
      shiftTypeId: instance.shiftTypeId ?? null,
      shiftRoleId: assignment.shiftRoleId ?? null,
      staffType: assignee.staffProfile?.staffType ?? null,
      livesInAccom: assignee.staffProfile?.livesInAccom ?? null,
      shiftInfo: {
        shiftInstanceId: instance.id,
        shiftAssignmentId: assignment.id,
        date: dateKey,
        timeStart: instance.timeStart ?? null,
        timeEnd: instance.timeEnd ?? null,
      },
    });
    map.set(dateKey, candidates);
  });

  return map;
};

const buildExpectedEvidenceItemsForDate = (
  template: AssistantManagerTaskTemplate,
  taskDate: string,
  scheduledShiftCandidatesByDate: Map<string, ScheduledShiftCandidate[]>,
) => {
  const sources = getShiftEvidenceSources(template);
  if (sources.length === 0) {
    return [];
  }

  const candidatesForDate = scheduledShiftCandidatesByDate.get(taskDate) ?? [];
  if (candidatesForDate.length === 0) {
    return [];
  }

  const seen = new Set<string>();
  const expectedItems: AssistantManagerTaskExpectedEvidenceItem[] = [];

  for (const source of sources) {
    const sourceTypeIds = new Set(source.shiftTypeIds);
    const matchingCandidates = candidatesForDate.filter((candidate) =>
      sourceTypeIds.has(candidate.shiftTypeId ?? 0),
    );

    for (const candidate of matchingCandidates) {
      const dedupeKey = `${source.key}:${candidate.userId}`;
      if (seen.has(dedupeKey)) {
        continue;
      }
      seen.add(dedupeKey);

      expectedItems.push({
        id: randomUUID(),
        sourceKey: source.key,
        sourceLabel: source.label,
        ruleKey: source.evidenceRuleKey,
        type: 'image',
        subjectUserId: candidate.userId,
        subjectName: candidate.userName,
        shiftTypeIds: source.shiftTypeIds,
      });
    }
  }

  return expectedItems;
};

const matchesScheduledShiftCandidate = (
  assignment: AssistantManagerTaskAssignment,
  candidate: ScheduledShiftCandidate,
) => {
  if (assignment.userId && assignment.userId !== candidate.userId) {
    return false;
  }
  if (assignment.userTypeId && assignment.userTypeId !== candidate.userTypeId) {
    return false;
  }
  if (assignment.shiftRoleId && assignment.shiftRoleId !== candidate.shiftRoleId) {
    return false;
  }
  if (assignment.staffType && assignment.staffType !== candidate.staffType) {
    return false;
  }
  if (
    assignment.livesInAccom != null &&
    assignment.livesInAccom !== candidate.livesInAccom
  ) {
    return false;
  }

  return true;
};

const sanitizeManualTaskPayload = (body: Record<string, unknown>): ManualTaskPayload => {
  const templateId = parsePositiveInt(body.templateId);
  const userId = parsePositiveInt(body.userId);
  const assignmentId = parsePositiveInt(body.assignmentId);
  const taskDate = sanitizeTaskDate(body.taskDate);
  const status =
    typeof body.status === 'string' && STATUS_VALUES.has(body.status.trim() as AssistantManagerTaskStatus)
      ? (body.status.trim() as AssistantManagerTaskStatus)
      : undefined;
  const metaPatch = sanitizePlannerMetaInput(body);
  const nestedPatch =
    body.meta && typeof body.meta === 'object' ? sanitizePlannerMetaInput(body.meta as Record<string, unknown>) : {};
  const requireShift = body.requireShift === true || body.enforceShift === true;
  return {
    templateId,
    userId,
    assignmentId,
    taskDate,
    status,
    notes:
      typeof body.notes === 'string'
        ? body.notes.trim()
        : body.notes === null
          ? null
          : undefined,
    meta: { ...metaPatch, ...nestedPatch },
    initialComment: typeof body.comment === 'string' && body.comment.trim() ? body.comment.trim() : undefined,
    requireShift,
  };
};

const sanitizeLogMetaPayload = (body: Record<string, unknown>): MetaUpdatePayload => {
  const metaPatch = sanitizePlannerMetaInput(body);
  if (body.meta && typeof body.meta === 'object') {
    Object.assign(metaPatch, sanitizePlannerMetaInput(body.meta as Record<string, unknown>));
  }
  const payload: MetaUpdatePayload = { metaPatch };
  if ('taskDate' in body) {
    const nextDate = sanitizeTaskDate(body.taskDate);
    if (!nextDate) {
      throw new Error('taskDate is invalid');
    }
    payload.taskDate = nextDate;
  }
  if ('notes' in body) {
    if (typeof body.notes === 'string') {
      payload.notes = body.notes.trim();
    } else if (body.notes === null) {
      payload.notes = null;
    } else {
      throw new Error('notes must be a string or null');
    }
  }
  if (typeof body.comment === 'string' && body.comment.trim()) {
    payload.comment = body.comment.trim();
  }
  if ('requireShift' in body || 'enforceShift' in body) {
    payload.requireShift = Boolean(body.requireShift ?? body.enforceShift);
  }
  return payload;
};

const appendCommentEntry = (
  meta: Record<string, unknown>,
  comment: string,
  authorId: number | null,
  authorName: string | null,
) => {
  const existing = Array.isArray(meta['comments']) ? (meta['comments'] as unknown[]) : [];
  meta['comments'] = [
    ...existing,
    {
      id: randomUUID(),
      body: comment,
      authorId,
      authorName,
      createdAt: new Date().toISOString(),
    },
  ];
};

const getActorIdentity = async (actorId: number | null): Promise<string | null> => {
  if (!actorId) {
    return 'System';
  }
  const actor = await User.findByPk(actorId, { attributes: ['id', 'firstName', 'lastName', 'username'] });
  if (!actor) {
    return `User #${actorId}`;
  }
  const fullName = `${actor.firstName ?? ''} ${actor.lastName ?? ''}`.trim();
  return fullName || actor.username || `User #${actorId}`;
};

const requireActorId = (req: AuthenticatedRequest): number => {
  const actorId = getActorId(req);
  if (!actorId) {
    throw new HttpError(401, 'Authentication required');
  }
  return actorId;
};

const ensureEvidenceRequirementsSatisfied = (
  template: AssistantManagerTaskTemplate | null | undefined,
  meta: Record<string, unknown>,
) => {
  const rules = getEvidenceRules(template);
  if (rules.length === 0) {
    return {
      normalizedItems: sanitizeEvidenceItems(meta['evidenceItems']),
    };
  }

  const { errors, normalizedItems } = validateEvidenceItemsAgainstRules(
    rules,
    sanitizeEvidenceItems(meta['evidenceItems']),
    { enforceRequired: true },
  );

  if (errors.length > 0) {
    throw new HttpError(400, errors.join(' '));
  }

  return { normalizedItems };
};

const formatTemplate = (
  template: AssistantManagerTaskTemplate & { assignments?: AssistantManagerTaskAssignment[] },
) => ({
  id: template.id,
  name: template.name,
  description: template.description ?? null,
  category: template.category ?? 'Assistant Manager Tasks',
  subgroup: template.subgroup ?? 'General',
  categoryOrder: template.categoryOrder ?? 100,
  subgroupOrder: template.subgroupOrder ?? 100,
  templateOrder: template.templateOrder ?? 100,
  cadence: template.cadence,
  scheduleConfig: template.scheduleConfig ?? {},
  isActive: template.isActive ?? true,
  createdAt: template.createdAt?.toISOString() ?? null,
  updatedAt: template.updatedAt?.toISOString() ?? null,
  assignments: template.assignments
    ? template.assignments.map((assignment) =>
        formatAssignment(
          assignment as AssistantManagerTaskAssignment & {
            user?: User | null;
            userType?: UserType | null;
            shiftRole?: ShiftRole | null;
          },
        ),
      )
    : [],
});

const formatAssignment = (
  assignment: AssistantManagerTaskAssignment & {
    user?: User | null;
    userType?: UserType | null;
    shiftRole?: ShiftRole | null;
  },
) => ({
  id: assignment.id,
  templateId: assignment.templateId,
  targetScope: assignment.targetScope,
  staffType: assignment.staffType ?? null,
  livesInAccom: assignment.livesInAccom ?? null,
  userId: assignment.userId ?? null,
  userTypeId: assignment.userTypeId ?? null,
  userTypeName: assignment.userType?.name ?? null,
  shiftRoleId: assignment.shiftRoleId ?? null,
  shiftRoleName: assignment.shiftRole?.name ?? null,
  userName: assignment.user ? `${assignment.user.firstName ?? ''} ${assignment.user.lastName ?? ''}`.trim() || null : null,
  effectiveStart: assignment.effectiveStart ?? null,
  effectiveEnd: assignment.effectiveEnd ?? null,
  isActive: assignment.isActive ?? true,
  createdAt: assignment.createdAt?.toISOString() ?? null,
  updatedAt: assignment.updatedAt?.toISOString() ?? null,
});

const formatLog = (
  log: AssistantManagerTaskLog & { template?: AssistantManagerTaskTemplate | null; user?: User | null },
) => ({
  id: log.id,
  templateId: log.templateId,
  templateName: log.template?.name ?? null,
  templateDescription: log.template?.description ?? null,
  userId: log.userId,
  userName: log.user ? `${log.user.firstName ?? ''} ${log.user.lastName ?? ''}`.trim() || null : null,
  taskDate: dayjs(log.taskDate).tz(resolveTaskPlannerTimezone()).format('YYYY-MM-DD'),
  status: log.status,
  completedAt: log.completedAt?.toISOString() ?? null,
  notes: log.notes ?? null,
  meta: log.meta ?? {},
  createdAt: log.createdAt?.toISOString() ?? null,
  updatedAt: log.updatedAt?.toISOString() ?? null,
});

const getNormalizedExpectedEvidenceItems = (
  value: unknown,
): AssistantManagerTaskExpectedEvidenceItem[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is AssistantManagerTaskExpectedEvidenceItem => Boolean(entry && typeof entry === 'object'))
    .map((entry) => ({
      id: typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim() : randomUUID(),
      sourceKey: typeof entry.sourceKey === 'string' ? entry.sourceKey.trim() : '',
      sourceLabel: typeof entry.sourceLabel === 'string' ? entry.sourceLabel.trim() : '',
      ruleKey: typeof entry.ruleKey === 'string' ? entry.ruleKey.trim() : '',
      type: entry.type,
      subjectUserId: Number(entry.subjectUserId),
      subjectName: typeof entry.subjectName === 'string' ? entry.subjectName.trim() : '',
      shiftTypeIds: Array.isArray(entry.shiftTypeIds)
        ? entry.shiftTypeIds
            .map((value) => Number(value))
            .filter((value) => Number.isInteger(value) && value > 0)
        : [],
    }))
    .filter(
      (entry) =>
        Boolean(entry.sourceKey && entry.sourceLabel && entry.ruleKey && entry.subjectName) &&
        Number.isInteger(entry.subjectUserId) &&
        entry.subjectUserId > 0 &&
        entry.type === 'image',
    );
};

const resolveLogExpectedEvidenceItems = (
  log: AssistantManagerTaskLog & { template?: AssistantManagerTaskTemplate | null },
  scheduledShiftCandidatesByDate?: Map<string, ScheduledShiftCandidate[]>,
) => {
  const storedExpected = getNormalizedExpectedEvidenceItems((log.meta ?? {})['expectedEvidenceItems']);
  if (storedExpected.length > 0) {
    return storedExpected;
  }
  if (!log.template) {
    return [];
  }

  const map = scheduledShiftCandidatesByDate ?? new Map<string, ScheduledShiftCandidate[]>();
  const taskDateKey = dayjs(log.taskDate).tz(resolveTaskPlannerTimezone()).format('YYYY-MM-DD');
  return buildExpectedEvidenceItemsForDate(log.template, taskDateKey, map);
};

const formatLogWithLiveExpectedEvidenceItems = (
  log: AssistantManagerTaskLog & { template?: AssistantManagerTaskTemplate | null; user?: User | null },
  scheduledShiftCandidatesByDate?: Map<string, ScheduledShiftCandidate[]>,
) => {
  const expectedEvidenceItems = resolveLogExpectedEvidenceItems(log, scheduledShiftCandidatesByDate);
  const meta = { ...(log.meta ?? {}) } as Record<string, unknown>;
  if (expectedEvidenceItems.length > 0) {
    meta.expectedEvidenceItems = expectedEvidenceItems;
  } else {
    delete meta.expectedEvidenceItems;
  }

  const plainLog =
    typeof (log as AssistantManagerTaskLog & { toJSON?: () => Record<string, unknown> }).toJSON ===
    'function'
      ? (log as AssistantManagerTaskLog & { toJSON: () => Record<string, unknown> }).toJSON()
      : (log as unknown as Record<string, unknown>);

  return formatLog({
    ...(plainLog as Record<string, unknown>),
    meta,
  } as AssistantManagerTaskLog & { template?: AssistantManagerTaskTemplate | null; user?: User | null });
};

const getActorId = (req: AuthenticatedRequest) => req.authContext?.id ?? null;

const isTaskLogOnCurrentDay = (
  log: Pick<AssistantManagerTaskLog, 'taskDate'>,
  timezoneName = resolveTaskPlannerTimezone(),
): boolean => {
  const taskDay = dayjs.tz(log.taskDate, 'YYYY-MM-DD', timezoneName);
  const today = dayjs().tz(timezoneName);
  return taskDay.isValid() && taskDay.isSame(today, 'day');
};

const canEditTaskLogEvidence = (
  log: Pick<AssistantManagerTaskLog, 'taskDate' | 'status'>,
): boolean => log.status !== 'completed' && isTaskLogOnCurrentDay(log);

const syncTemplateGroupOrderValues = async (
  template: AssistantManagerTaskTemplate,
  actorId: number | null,
) => {
  if (template.category) {
    await AssistantManagerTaskTemplate.update(
      {
        categoryOrder: template.categoryOrder ?? 100,
        updatedBy: actorId,
      },
      { where: { category: template.category } },
    );
  }

  if (template.category && template.subgroup) {
    await AssistantManagerTaskTemplate.update(
      {
        subgroupOrder: template.subgroupOrder ?? 100,
        updatedBy: actorId,
      },
      {
        where: {
          category: template.category,
          subgroup: template.subgroup,
        },
      },
    );
  }
};

const taskAssignmentInclude = [
  { model: User, as: 'user', attributes: ['id', 'firstName', 'lastName'] },
  { model: UserType, as: 'userType', attributes: ['id', 'name', 'slug'] },
  { model: ShiftRole, as: 'shiftRole', attributes: ['id', 'name', 'slug'] },
];

const resolveStaffTypeUsers = async (
  staffType: string,
  livesInAccom: boolean | null,
  cache: Map<string, number[]>,
) => {
  if (!staffType) {
    return [];
  }
  const cacheKey = `${staffType}:${livesInAccom == null ? 'any' : String(livesInAccom)}`;
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey) ?? [];
  }
  const profiles = await StaffProfile.findAll({
    where: {
      staffType,
      active: true,
      ...(livesInAccom == null ? {} : { livesInAccom }),
    },
    attributes: ['userId'],
  });
  const userIds = profiles.map((profile) => profile.userId);
  cache.set(cacheKey, userIds);
  return userIds;
};

const resolveUserTypeUsers = async (userTypeId: number, cache: Map<number, number[]>) => {
  if (!userTypeId) {
    return [];
  }
  if (cache.has(userTypeId)) {
    return cache.get(userTypeId) ?? [];
  }
  const users = await User.findAll({
    where: { userTypeId, status: true },
    attributes: ['id'],
  });
  const userIds = users.map((user) => user.id);
  cache.set(userTypeId, userIds);
  return userIds;
};

const resolveShiftRoleUsers = async (shiftRoleId: number, cache: Map<number, number[]>) => {
  if (!shiftRoleId) {
    return [];
  }
  if (cache.has(shiftRoleId)) {
    return cache.get(shiftRoleId) ?? [];
  }
  const links = await UserShiftRole.findAll({
    where: { shiftRoleId },
    attributes: ['userId'],
  });
  const candidateUserIds = Array.from(new Set(links.map((link) => link.userId)));
  if (candidateUserIds.length === 0) {
    cache.set(shiftRoleId, []);
    return [];
  }
  const users = await User.findAll({
    where: { id: candidateUserIds, status: true },
    attributes: ['id'],
  });
  const userIds = users.map((user) => user.id);
  cache.set(shiftRoleId, userIds);
  return userIds;
};

const resolveAssignmentUsers = async (
  assignment: AssistantManagerTaskAssignment,
  caches: {
    staffTypeCache: Map<string, number[]>;
    userTypeCache: Map<number, number[]>;
    shiftRoleCache: Map<number, number[]>;
  },
) => {
  const groups: number[][] = [];

  if (assignment.userId) {
    groups.push([assignment.userId]);
  }
  if (assignment.staffType) {
    groups.push(
      await resolveStaffTypeUsers(
        assignment.staffType,
        assignment.livesInAccom ?? null,
        caches.staffTypeCache,
      ),
    );
  }
  if (assignment.userTypeId) {
    groups.push(await resolveUserTypeUsers(assignment.userTypeId, caches.userTypeCache));
  }
  if (assignment.shiftRoleId) {
    groups.push(await resolveShiftRoleUsers(assignment.shiftRoleId, caches.shiftRoleCache));
  }

  return intersectUserIdGroups(groups);
};

const enumerateDatesForCadence = (
  template: AssistantManagerTaskTemplate,
  assignment: AssistantManagerTaskAssignment,
  rangeStart: dayjs.Dayjs,
  rangeEnd: dayjs.Dayjs,
) => {
  const config = template.scheduleConfig ?? {};
  const dates: string[] = [];
  const effectiveStart = assignment.effectiveStart ? dayjs(assignment.effectiveStart) : null;
  const effectiveEnd = assignment.effectiveEnd ? dayjs(assignment.effectiveEnd) : null;
  const windowStart = effectiveStart && effectiveStart.isAfter(rangeStart, 'day') ? effectiveStart : rangeStart;
  const windowEnd = effectiveEnd && effectiveEnd.isBefore(rangeEnd, 'day') ? effectiveEnd : rangeEnd;
  if (windowStart.isAfter(windowEnd, 'day')) {
    return dates;
  }

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
    const daysOfWeek = Array.isArray(config.daysOfWeek)
      ? (config.daysOfWeek as number[]).map((value) => Number(value))
      : [windowStart.day()];
    let cursor = windowStart.clone().startOf('day');
    while (!cursor.isAfter(windowEnd, 'day')) {
      if (daysOfWeek.includes(cursor.day())) {
        pushDate(cursor);
      }
      cursor = cursor.add(1, 'day');
    }
    return dates;
  }

  if (template.cadence === 'biweekly') {
    const daysOfWeek = Array.isArray(config.daysOfWeek)
      ? (config.daysOfWeek as number[]).map((value) => Number(value))
      : [1, 4];
    let cursor = windowStart.clone().startOf('day');
    while (!cursor.isAfter(windowEnd, 'day')) {
      if (daysOfWeek.includes(cursor.day())) {
        pushDate(cursor);
      }
      cursor = cursor.add(1, 'day');
    }
    return dates;
  }

  if (template.cadence === 'every_two_weeks') {
    const anchor = effectiveStart ?? rangeStart;
    let cursor = anchor.clone();
    if (cursor.isBefore(windowStart, 'day')) {
      const diff = windowStart.diff(cursor, 'day');
      const remainder = diff % 14;
      cursor = windowStart.clone().add(remainder === 0 ? 0 : 14 - remainder, 'day');
    }
    while (!cursor.isAfter(windowEnd, 'day')) {
      pushDate(cursor);
      cursor = cursor.add(14, 'day');
    }
    return dates;
  }

  if (template.cadence === 'monthly') {
    const dayOfMonth = Number(config.dayOfMonth ?? (effectiveStart ? effectiveStart.date() : 1));
    let cursor = windowStart.clone().date(Math.min(dayOfMonth, windowStart.daysInMonth()));
    if (cursor.isBefore(windowStart, 'day')) {
      cursor = cursor.add(1, 'month').date(Math.min(dayOfMonth, cursor.daysInMonth()));
    }
    while (!cursor.isAfter(windowEnd, 'day')) {
      pushDate(cursor);
      cursor = cursor.add(1, 'month').date(Math.min(dayOfMonth, cursor.daysInMonth()));
    }
    return dates;
  }

  return dates;
};

const getAssignmentWindow = (
  assignment: Pick<AssistantManagerTaskAssignment, 'effectiveStart' | 'effectiveEnd'>,
  rangeStart: dayjs.Dayjs,
  rangeEnd: dayjs.Dayjs,
) => {
  const effectiveStart = assignment.effectiveStart ? dayjs(assignment.effectiveStart) : null;
  const effectiveEnd = assignment.effectiveEnd ? dayjs(assignment.effectiveEnd) : null;
  const windowStart = effectiveStart && effectiveStart.isAfter(rangeStart, 'day') ? effectiveStart : rangeStart;
  const windowEnd = effectiveEnd && effectiveEnd.isBefore(rangeEnd, 'day') ? effectiveEnd : rangeEnd;

  if (windowStart.isAfter(windowEnd, 'day')) {
    return null;
  }

  return {
    start: windowStart.startOf('day'),
    end: windowEnd.endOf('day'),
  };
};

const getScheduleWindow = (template: AssistantManagerTaskTemplate) => {
  const scheduleMeta = sanitizeScheduleConfigMeta(template.scheduleConfig ?? {});
  const time = typeof scheduleMeta.time === 'string' ? scheduleMeta.time : null;
  const durationHours =
    typeof scheduleMeta.durationHours === 'number'
      ? scheduleMeta.durationHours
      : Number(scheduleMeta.durationHours ?? NaN);

  if (!time || !Number.isFinite(durationHours) || durationHours <= 0) {
    return null;
  }

  const parsed = dayjs(time, ['HH:mm', 'H:mm', 'HH:mm:ss', 'h:mm A'], true);
  if (!parsed.isValid()) {
    return null;
  }

  const startMinutes = parsed.hour() * 60 + parsed.minute();
  const endMinutes = startMinutes + Math.round(durationHours * 60);

  return {
    startMinutes,
    endMinutes,
    label: `${parsed.format('HH:mm')} for ${durationHours}h`,
  };
};

const scheduleWindowsOverlap = (
  left: ReturnType<typeof getScheduleWindow>,
  right: ReturnType<typeof getScheduleWindow>,
) => {
  if (!left || !right) {
    return false;
  }
  return left.startMinutes < right.endMinutes && right.startMinutes < left.endMinutes;
};

const filtersCanIntersect = <T>(left: T | null | undefined, right: T | null | undefined) => {
  if (left == null || right == null) {
    return true;
  }
  return left === right;
};

const assignmentsCanIntersect = (
  left: Partial<AssistantManagerTaskAssignment>,
  right: Partial<AssistantManagerTaskAssignment>,
) => (
  filtersCanIntersect(left.userId ?? null, right.userId ?? null) &&
  filtersCanIntersect(left.userTypeId ?? null, right.userTypeId ?? null) &&
  filtersCanIntersect(left.shiftRoleId ?? null, right.shiftRoleId ?? null) &&
  filtersCanIntersect(left.staffType ?? null, right.staffType ?? null) &&
  filtersCanIntersect(left.livesInAccom ?? null, right.livesInAccom ?? null)
);

const getAssignmentAnalysisWindow = (
  left: Partial<AssistantManagerTaskAssignment>,
  right: Partial<AssistantManagerTaskAssignment>,
) => {
  const today = dayjs().startOf('day');
  const leftStart = left.effectiveStart ? dayjs(left.effectiveStart).startOf('day') : null;
  const rightStart = right.effectiveStart ? dayjs(right.effectiveStart).startOf('day') : null;
  const leftEnd = left.effectiveEnd ? dayjs(left.effectiveEnd).endOf('day') : null;
  const rightEnd = right.effectiveEnd ? dayjs(right.effectiveEnd).endOf('day') : null;

  let start = today;
  if (leftStart && leftStart.isAfter(start)) {
    start = leftStart;
  }
  if (rightStart && rightStart.isAfter(start)) {
    start = rightStart;
  }

  let end = start.clone().add(400, 'day').endOf('day');
  if (leftEnd && leftEnd.isBefore(end)) {
    end = leftEnd;
  }
  if (rightEnd && rightEnd.isBefore(end)) {
    end = rightEnd;
  }

  if (end.isBefore(start, 'day')) {
    return null;
  }

  return { start, end };
};

const assignmentsCanOccurOnSameDay = (
  leftTemplate: AssistantManagerTaskTemplate,
  leftAssignment: Partial<AssistantManagerTaskAssignment>,
  rightTemplate: AssistantManagerTaskTemplate,
  rightAssignment: Partial<AssistantManagerTaskAssignment>,
) => {
  const window = getAssignmentAnalysisWindow(leftAssignment, rightAssignment);
  if (!window) {
    return false;
  }

  const leftDates = enumerateDatesForCadence(
    leftTemplate,
    leftAssignment as AssistantManagerTaskAssignment,
    window.start,
    window.end,
  );
  if (leftDates.length === 0) {
    return false;
  }

  const rightDates = new Set(
    enumerateDatesForCadence(
      rightTemplate,
      rightAssignment as AssistantManagerTaskAssignment,
      window.start,
      window.end,
    ),
  );

  return leftDates.some((date) => rightDates.has(date));
};

const templatesCanOccurOnSameDay = (
  leftTemplate: AssistantManagerTaskTemplate,
  rightTemplate: AssistantManagerTaskTemplate,
) =>
  assignmentsCanOccurOnSameDay(
    leftTemplate,
    {} as AssistantManagerTaskAssignment,
    rightTemplate,
    {} as AssistantManagerTaskAssignment,
  );

const findTemplateTimingConflict = async ({
  candidateTemplate,
  excludeTemplateId,
}: {
  candidateTemplate: AssistantManagerTaskTemplate;
  excludeTemplateId?: number | null;
}) => {
  if (candidateTemplate.isActive === false) {
    return null;
  }

  const candidateWindow = getScheduleWindow(candidateTemplate);
  if (!candidateWindow) {
    return null;
  }

  const existingTemplates = await AssistantManagerTaskTemplate.findAll({
    where: {
      isActive: true,
      ...(excludeTemplateId ? { id: { [Op.ne]: excludeTemplateId } } : {}),
    },
  });

  for (const existingTemplate of existingTemplates) {
    if (!templatesCanOccurOnSameDay(candidateTemplate, existingTemplate)) {
      continue;
    }

    const existingWindow = getScheduleWindow(existingTemplate);
    if (!scheduleWindowsOverlap(candidateWindow, existingWindow)) {
      continue;
    }

    return `Schedule conflict: "${candidateTemplate.name}" overlaps with "${existingTemplate.name}". Choose a different start time or duration.`;
  }

  return null;
};

const describeAssignmentAudience = (assignment: Partial<AssistantManagerTaskAssignment>) => {
  const labels: string[] = [];
  if (assignment.userId) {
    labels.push(`user #${assignment.userId}`);
  }
  if (assignment.userTypeId) {
    labels.push(`user type #${assignment.userTypeId}`);
  }
  if (assignment.shiftRoleId) {
    labels.push(`shift role #${assignment.shiftRoleId}`);
  }
  if (assignment.staffType) {
    if (assignment.livesInAccom == null) {
      labels.push(assignment.staffType);
    } else {
      labels.push(`${assignment.staffType}, ${assignment.livesInAccom ? 'lives in accommodation' : 'not in accommodation'}`);
    }
  }
  return labels.join(' + ') || 'matching assignments';
};

const findTemplateAssignmentConflict = async ({
  candidateTemplate,
  candidateAssignments,
  excludeTemplateId,
  transaction,
}: {
  candidateTemplate: AssistantManagerTaskTemplate;
  candidateAssignments: Array<Partial<AssistantManagerTaskAssignment>>;
  excludeTemplateId?: number | null;
  transaction?: Transaction | null;
}) => {
  if (candidateTemplate.isActive === false) {
    return null;
  }

  const candidateWindow = getScheduleWindow(candidateTemplate);
  if (!candidateWindow) {
    return null;
  }

  const activeCandidateAssignments = candidateAssignments.filter((assignment) => assignment.isActive !== false);
  if (activeCandidateAssignments.length === 0) {
    return null;
  }

  const existingAssignments = await AssistantManagerTaskAssignment.findAll({
    where: {
      isActive: true,
      ...(excludeTemplateId ? { templateId: { [Op.ne]: excludeTemplateId } } : {}),
    },
    transaction: transaction ?? undefined,
    include: [
      {
        model: AssistantManagerTaskTemplate,
        as: 'template',
        where: { isActive: true },
        required: true,
      },
    ],
  });

  for (const candidateAssignment of activeCandidateAssignments) {
    for (const existingAssignment of existingAssignments) {
      const existingTemplate = existingAssignment.template;
      if (!existingTemplate) {
        continue;
      }
      if (!assignmentsCanIntersect(candidateAssignment, existingAssignment)) {
        continue;
      }
      if (!assignmentsCanOccurOnSameDay(candidateTemplate, candidateAssignment, existingTemplate, existingAssignment)) {
        continue;
      }
      const existingWindow = getScheduleWindow(existingTemplate);
      if (!scheduleWindowsOverlap(candidateWindow, existingWindow)) {
        continue;
      }
      return `Schedule conflict: "${candidateTemplate.name}" overlaps with "${existingTemplate.name}" for ${describeAssignmentAudience(candidateAssignment)}.`;
    }
  }

  return null;
};

const planGeneratedLogsForAssignments = async (
  assignments: AssistantManagerTaskAssignment[],
  rangeStart: dayjs.Dayjs,
  rangeEnd: dayjs.Dayjs,
) => {
  const plannedEntries = new Map<string, PlannedGeneratedLog>();
  const scheduledShiftCandidatesByDate = await buildScheduledShiftCandidateMap(
    rangeStart,
    rangeEnd,
  );

  const queueGeneratedLog = ({
    template,
    assignment,
    candidate,
    taskDate,
  }: {
    template: AssistantManagerTaskTemplate;
    assignment: AssistantManagerTaskAssignment;
    candidate: ScheduledShiftCandidate;
    taskDate: string;
  }) => {
    const key = buildTaskLogKey(template.id, candidate.userId, taskDate);
    plannedEntries.set(key, {
      template,
      assignment,
      candidate,
      taskDate,
      expectedEvidenceItems: buildExpectedEvidenceItemsForDate(
        template,
        taskDate,
        scheduledShiftCandidatesByDate,
      ),
    });
  };

  for (const assignment of assignments) {
    const template = assignment.template;
    if (!template || template.isActive === false || assignment.isActive === false) {
      continue;
    }
    const weeklyQuota = getTimesPerWeekPerAssignedUser(template);

    if (
      weeklyQuota &&
      (template.cadence === 'weekly' || template.cadence === 'biweekly')
    ) {
      const assignmentWindow = getAssignmentWindow(assignment, rangeStart, rangeEnd);
      if (!assignmentWindow) {
        continue;
      }

      let weekCursor = startOfPlannerWeek(assignmentWindow.start);
      const finalWeek = startOfPlannerWeek(assignmentWindow.end);

      while (!weekCursor.isAfter(finalWeek, 'day')) {
        const weekStart = weekCursor.startOf('day');
        const weekEnd = weekCursor.add(6, 'day').endOf('day');
        const boundedWeekStart = weekStart.isBefore(assignmentWindow.start, 'day')
          ? assignmentWindow.start
          : weekStart;
        const boundedWeekEnd = weekEnd.isAfter(assignmentWindow.end, 'day')
          ? assignmentWindow.end
          : weekEnd;

        const candidatesByUser = new Map<number, ScheduledShiftCandidate[]>();
        let dateCursor = boundedWeekStart.clone();

        while (!dateCursor.isAfter(boundedWeekEnd, 'day')) {
          const taskDate = dateCursor.format('YYYY-MM-DD');
          const matchingCandidates = (scheduledShiftCandidatesByDate.get(taskDate) ?? []).filter(
            (candidate) => matchesScheduledShiftCandidate(assignment, candidate),
          );
          const uniqueMatchingCandidates = Array.from(
            new Map(matchingCandidates.map((candidate) => [candidate.userId, candidate])).values(),
          );

          uniqueMatchingCandidates.forEach((candidate) => {
            const entries = candidatesByUser.get(candidate.userId) ?? [];
            entries.push(candidate);
            candidatesByUser.set(candidate.userId, entries);
          });

          dateCursor = dateCursor.add(1, 'day');
        }

        for (const candidates of candidatesByUser.values()) {
          const selectedCandidates = Array.from(
            new Map(
              candidates
                .sort((left, right) => left.shiftInfo.date.localeCompare(right.shiftInfo.date))
                .map((candidate) => [candidate.shiftInfo.date, candidate]),
            ).values(),
          )
            .slice(0, weeklyQuota);

          for (const candidate of selectedCandidates) {
            queueGeneratedLog({
              template,
              assignment,
              candidate,
              taskDate: candidate.shiftInfo.date,
            });
          }
        }

        weekCursor = weekCursor.add(7, 'day');
      }

      continue;
    }

    const dates = enumerateDatesForCadence(template, assignment, rangeStart, rangeEnd);
    if (dates.length === 0) {
      continue;
    }

    for (const taskDate of dates) {
      const candidatesForDate = (scheduledShiftCandidatesByDate.get(taskDate) ?? []).filter(
        (candidate) => matchesScheduledShiftCandidate(assignment, candidate),
      );
      const uniqueCandidatesForDate = Array.from(
        new Map(candidatesForDate.map((candidate) => [candidate.userId, candidate])).values(),
      );

      if (uniqueCandidatesForDate.length === 0) {
        continue;
      }

      for (const candidate of uniqueCandidatesForDate) {
        queueGeneratedLog({
          template,
          assignment,
          candidate,
          taskDate,
        });
      }
    }
  }

  return Array.from(plannedEntries.values()).sort((left, right) => {
    if (left.taskDate !== right.taskDate) {
      return left.taskDate.localeCompare(right.taskDate);
    }
    if (left.template.id !== right.template.id) {
      return left.template.id - right.template.id;
    }
    return left.candidate.userId - right.candidate.userId;
  });
};

const summarizePlannedLogsForRange = async (
  plannedEntries: PlannedGeneratedLog[],
  rangeStart: dayjs.Dayjs,
  rangeEnd: dayjs.Dayjs,
) => {
  const templateIds = Array.from(
    new Set(plannedEntries.map((entry) => entry.template.id)),
  );
  const summaries = new Map<
    number,
    {
      templateId: number;
      templateName: string;
      cadence: AssistantManagerTaskCadence;
      expectedTaskCount: number;
      newTaskCount: number;
      existingTaskCount: number;
    }
  >();

  let existingKeySet = new Set<string>();
  if (templateIds.length > 0) {
    const existingLogs = await AssistantManagerTaskLog.findAll({
      where: {
        templateId: { [Op.in]: templateIds },
        taskDate: {
          [Op.between]: [rangeStart.format('YYYY-MM-DD'), rangeEnd.format('YYYY-MM-DD')],
        },
      },
      attributes: ['templateId', 'userId', 'taskDate'],
    });

    existingKeySet = new Set(
      existingLogs.map((log) => buildTaskLogKey(log.templateId, log.userId, log.taskDate)),
    );
  }

  plannedEntries.forEach((entry) => {
    const templateId = entry.template.id;
    const current =
      summaries.get(templateId) ??
      {
        templateId,
        templateName: entry.template.name,
        cadence: entry.template.cadence,
        expectedTaskCount: 0,
        newTaskCount: 0,
        existingTaskCount: 0,
      };

    current.expectedTaskCount += 1;
    if (existingKeySet.has(buildTaskLogKey(templateId, entry.candidate.userId, entry.taskDate))) {
      current.existingTaskCount += 1;
    } else {
      current.newTaskCount += 1;
    }
    summaries.set(templateId, current);
  });

  return Array.from(summaries.values()).sort((left, right) => {
    if (right.expectedTaskCount !== left.expectedTaskCount) {
      return right.expectedTaskCount - left.expectedTaskCount;
    }
    return left.templateName.localeCompare(right.templateName);
  });
};

const generateLogsForAssignments = async (
  assignments: AssistantManagerTaskAssignment[],
  rangeStart: dayjs.Dayjs,
  rangeEnd: dayjs.Dayjs,
  actorId: number | null,
) => {
  const plannedEntries = await planGeneratedLogsForAssignments(
    assignments,
    rangeStart,
    rangeEnd,
  );
  const expectedLogKeys = new Set(
    plannedEntries.map((entry) =>
      buildTaskLogKey(entry.template.id, entry.candidate.userId, entry.taskDate),
    ),
  );
  let createdCount = 0;
  let updatedCount = 0;
  let unchangedCount = 0;

  for (const entry of plannedEntries) {
    const { template, assignment, candidate, taskDate, expectedEvidenceItems } = entry;
    const requireShift = getRequireShiftFlag(template);
    const shiftInfo = candidate.shiftInfo;
    const shiftTime = shiftInfo?.timeStart ? normalizeTimeValue(shiftInfo.timeStart) : null;
    const scheduleMeta = sanitizeScheduleConfigMeta(template.scheduleConfig ?? {}, shiftTime);
    const baseMeta: Record<string, unknown> = {
      manual: false,
      ...scheduleMeta,
    };
    if (expectedEvidenceItems.length > 0) {
      baseMeta.expectedEvidenceItems = expectedEvidenceItems;
    }
    if (!Object.prototype.hasOwnProperty.call(baseMeta, 'priority')) {
      baseMeta.priority = 'medium';
    }
    if (!Object.prototype.hasOwnProperty.call(baseMeta, 'points')) {
      baseMeta.points = 1;
    }
    if (!Object.prototype.hasOwnProperty.call(baseMeta, 'durationHours')) {
      baseMeta.durationHours = 1;
    }
    if (!Object.prototype.hasOwnProperty.call(baseMeta, 'time') && shiftTime) {
      baseMeta.time = shiftTime;
    }
    const shiftMeta = buildShiftMeta(shiftInfo, requireShift);
    Object.assign(baseMeta, shiftMeta);
    const [log, created] = await AssistantManagerTaskLog.findOrCreate({
      where: {
        templateId: template.id,
        userId: candidate.userId,
        taskDate,
      },
      defaults: {
        assignmentId: assignment.id,
        status: 'pending',
        meta: baseMeta,
        createdBy: actorId,
        updatedBy: actorId,
      },
    });
    if (created) {
      createdCount += 1;
      continue;
    }

    const existingMeta = (log.meta ?? {}) as Record<string, unknown>;
    let shouldUpdateMeta = false;
    Object.entries(shiftMeta).forEach(([key, value]) => {
      if (existingMeta[key] !== value) {
        existingMeta[key] = value;
        shouldUpdateMeta = true;
      }
    });
    const updatePayload: Partial<AssistantManagerTaskLog> = {};
    if (shouldUpdateMeta) {
      updatePayload.meta = existingMeta;
    }
    if (log.assignmentId !== assignment.id) {
      updatePayload.assignmentId = assignment.id;
    }
    if (Object.keys(updatePayload).length > 0) {
      updatePayload.updatedBy = actorId;
      await AssistantManagerTaskLog.update(updatePayload, { where: { id: log.id } });
      updatedCount += 1;
      continue;
    }

    unchangedCount += 1;
  }

  return {
    expectedLogKeys,
    createdCount,
    updatedCount,
    unchangedCount,
  };
};

export const listTaskTemplates = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const includeAssignments =
      req.query.includeAssignments !== 'false' && canViewAllTaskLogs(req);
    const templates = await AssistantManagerTaskTemplate.findAll({
      include: includeAssignments
        ? [{ model: AssistantManagerTaskAssignment, as: 'assignments', include: taskAssignmentInclude }]
        : [],
      order: [
        ['isActive', 'DESC'],
        ['categoryOrder', 'ASC'],
        ['category', 'ASC'],
        ['subgroupOrder', 'ASC'],
        ['subgroup', 'ASC'],
        ['templateOrder', 'ASC'],
        ['name', 'ASC'],
      ],
    });
    res.status(200).json([{ data: templates.map((template) => formatTemplate(template as AssistantManagerTaskTemplate & { assignments?: AssistantManagerTaskAssignment[] })), columns: [] }]);
  } catch (error) {
    console.error('Failed to list assistant manager task templates', error);
    res.status(500).json([{ message: 'Failed to list assistant manager tasks' }]);
  }
};

export const getTaskCerebroLinkOptions = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!canViewAllTaskLogs(req)) {
      res.status(403).json([{ message: 'Forbidden' }]);
      return;
    }

    const [entries, quizzes] = await Promise.all([
      CerebroEntry.findAll({
        where: { status: true },
        attributes: ['id', 'slug', 'title', 'kind', 'requiresAcknowledgement', 'policyVersion', 'sortOrder'],
        order: [['sortOrder', 'ASC'], ['title', 'ASC']],
      }),
      CerebroQuiz.findAll({
        where: { status: true },
        attributes: ['id', 'slug', 'title', 'entryId', 'sortOrder'],
        order: [['sortOrder', 'ASC'], ['title', 'ASC']],
      }),
    ]);

    const knowledgeEntries = entries
      .filter((entry) => entry.kind !== 'policy')
      .map((entry) => ({
        id: entry.id,
        slug: entry.slug,
        title: entry.title,
        kind: entry.kind,
      }));

    const policyEntries = entries
      .filter((entry) => entry.kind === 'policy' || entry.requiresAcknowledgement)
      .map((entry) => ({
        id: entry.id,
        slug: entry.slug,
        title: entry.title,
        policyVersion: entry.policyVersion ?? null,
      }));

    const quizOptions = quizzes.map((quiz) => ({
      id: quiz.id,
      slug: quiz.slug,
      title: quiz.title,
      entryId: quiz.entryId ?? null,
    }));

    res.status(200).json([{
      data: {
        knowledgeEntries,
        policyEntries,
        quizzes: quizOptions,
      },
    }]);
  } catch (error) {
    logger.error('Failed to list Cerebro link options for assistant manager tasks', error);
    res.status(500).json([{ message: 'Failed to load Cerebro link options' }]);
  }
};

export const getTaskCerebroLinkItemDetail = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!canViewAllTaskLogs(req)) {
      res.status(403).json([{ message: 'Forbidden' }]);
      return;
    }

    const type = typeof req.query.type === 'string' ? req.query.type.trim().toLowerCase() : '';
    const id = Number(req.query.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json([{ message: 'A valid item id is required' }]);
      return;
    }
    if (type !== 'knowledge' && type !== 'policy' && type !== 'quiz') {
      res.status(400).json([{ message: 'A valid item type is required' }]);
      return;
    }

    if (type === 'quiz') {
      const quiz = await CerebroQuiz.findOne({
        where: { id, status: true },
        attributes: ['id', 'slug', 'title', 'description', 'passingScore', 'questions', 'entryId'],
      });
      if (!quiz) {
        res.status(404).json([{ message: 'Quiz not found' }]);
        return;
      }

      const linkedEntry = quiz.entryId
        ? await CerebroEntry.findByPk(quiz.entryId, { attributes: ['id', 'title'] })
        : null;

      res.status(200).json([{
        data: {
          type: 'quiz',
          id: quiz.id,
          slug: quiz.slug,
          title: quiz.title,
          description: quiz.description ?? null,
          passingScore: quiz.passingScore,
          questions: Array.isArray(quiz.questions) ? quiz.questions : [],
          entryId: quiz.entryId ?? null,
          entryTitle: linkedEntry?.title ?? null,
        },
      }]);
      return;
    }

    const entry = await CerebroEntry.findOne({
      where: { id, status: true },
      attributes: [
        'id',
        'slug',
        'title',
        'kind',
        'summary',
        'body',
        'category',
        'checklistItems',
        'media',
        'requiresAcknowledgement',
        'policyVersion',
      ],
    });

    if (!entry) {
      res.status(404).json([{ message: 'Cerebro entry not found' }]);
      return;
    }

    const isPolicy = entry.kind === 'policy' || entry.requiresAcknowledgement;
    if (type === 'knowledge' && isPolicy) {
      res.status(400).json([{ message: 'This item is a policy, not a knowledge article' }]);
      return;
    }
    if (type === 'policy' && !isPolicy) {
      res.status(400).json([{ message: 'This item is not a policy' }]);
      return;
    }

    res.status(200).json([{
      data: {
        type,
        id: entry.id,
        slug: entry.slug,
        title: entry.title,
        kind: entry.kind,
        summary: entry.summary ?? null,
        body: entry.body ?? '',
        category: entry.category ?? null,
        checklistItems: Array.isArray(entry.checklistItems) ? entry.checklistItems : [],
        media: Array.isArray(entry.media) ? entry.media : [],
        requiresAcknowledgement: Boolean(entry.requiresAcknowledgement),
        policyVersion: entry.policyVersion ?? null,
      },
    }]);
  } catch (error) {
    logger.error('Failed to load Cerebro link item detail for assistant manager tasks', error);
    res.status(500).json([{ message: 'Failed to load Cerebro link item detail' }]);
  }
};

export const createTaskTemplate = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!canViewAllTaskLogs(req)) {
      res.status(403).json([{ message: 'Forbidden' }]);
      return;
    }
    const payload = sanitizeTemplatePayload(req.body ?? {});
    if (!payload.name) {
      res.status(400).json([{ message: 'name is required' }]);
      return;
    }
    if (!payload.cadence || !CADENCE_VALUES.has(payload.cadence)) {
      res.status(400).json([{ message: 'cadence is invalid' }]);
      return;
    }
    const candidateTemplate = AssistantManagerTaskTemplate.build({
      ...payload,
      isActive: payload.isActive ?? true,
    });
    const scheduleConflictMessage = await findTemplateTimingConflict({
      candidateTemplate,
    });
    if (scheduleConflictMessage) {
      res.status(400).json([{ message: scheduleConflictMessage }]);
      return;
    }
    payload.createdBy = getActorId(req);
    payload.updatedBy = getActorId(req);
    const created = await AssistantManagerTaskTemplate.create(payload);
    await syncTemplateGroupOrderValues(created, getActorId(req));
    const refreshed = await AssistantManagerTaskTemplate.findByPk(created.id, {
      include: [{ model: AssistantManagerTaskAssignment, as: 'assignments', include: taskAssignmentInclude }],
    });
    res.status(201).json([{ data: refreshed ? [formatTemplate(refreshed as AssistantManagerTaskTemplate & { assignments?: AssistantManagerTaskAssignment[] })] : [] }]);
  } catch (error) {
    console.error('Failed to create assistant manager task template', error);
    res.status(500).json([{ message: 'Failed to create task template' }]);
  }
};

export const updateTaskTemplate = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!canViewAllTaskLogs(req)) {
      res.status(403).json([{ message: 'Forbidden' }]);
      return;
    }
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json([{ message: 'Invalid template id' }]);
      return;
    }
    const currentTemplate = await AssistantManagerTaskTemplate.findByPk(id, {
      include: [{ model: AssistantManagerTaskAssignment, as: 'assignments' }],
    });
    if (!currentTemplate) {
      res.status(404).json([{ message: 'Task template not found' }]);
      return;
    }
    const payload = sanitizeTemplatePayload(req.body ?? {});
    const actorId = getActorId(req);
    payload.updatedBy = actorId;
    const candidateTemplate = AssistantManagerTaskTemplate.build(
      {
        ...currentTemplate.get(),
        ...payload,
      },
      { isNewRecord: false },
    );
    const scheduleConflictMessage = await findTemplateTimingConflict({
      candidateTemplate,
      excludeTemplateId: id,
    });
    if (scheduleConflictMessage) {
      res.status(400).json([{ message: scheduleConflictMessage }]);
      return;
    }
    const conflictMessage = await findTemplateAssignmentConflict({
      candidateTemplate,
      candidateAssignments: (currentTemplate.assignments ?? []) as AssistantManagerTaskAssignment[],
      excludeTemplateId: id,
    });
    if (conflictMessage) {
      res.status(400).json([{ message: conflictMessage }]);
      return;
    }
    const [updated] = await AssistantManagerTaskTemplate.update(payload, { where: { id } });
    const updatedTemplate = await AssistantManagerTaskTemplate.findByPk(id);
    if (updatedTemplate) {
      await syncTemplateGroupOrderValues(updatedTemplate, actorId);
    }
    const refreshed = await AssistantManagerTaskTemplate.findByPk(id, {
      include: [{ model: AssistantManagerTaskAssignment, as: 'assignments', include: taskAssignmentInclude }],
    });
    res.status(200).json([{ data: refreshed ? [formatTemplate(refreshed as AssistantManagerTaskTemplate & { assignments?: AssistantManagerTaskAssignment[] })] : [] }]);
  } catch (error) {
    console.error('Failed to update assistant manager task template', error);
    res.status(500).json([{ message: 'Failed to update task template' }]);
  }
};

export const deleteTaskTemplate = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!canViewAllTaskLogs(req)) {
      res.status(403).json([{ message: 'Forbidden' }]);
      return;
    }
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json([{ message: 'Invalid template id' }]);
      return;
    }
    const deleted = await AssistantManagerTaskTemplate.destroy({ where: { id } });
    if (!deleted) {
      res.status(404).json([{ message: 'Task template not found' }]);
      return;
    }
    res.status(204).send();
  } catch (error) {
    console.error('Failed to delete task template', error);
    res.status(500).json([{ message: 'Failed to delete task template' }]);
  }
};

export const syncTaskLogsWithCurrentTemplateConfig = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    if (!canViewAllTaskLogs(req)) {
      res.status(403).json([{ message: 'Forbidden' }]);
      return;
    }

    const startDate = sanitizeTaskDate(req.body?.startDate);
    const endDate = sanitizeTaskDate(req.body?.endDate);
    const templateId = parsePositiveInt(req.body?.templateId);
    if (!startDate || !endDate) {
      res.status(400).json([{ message: 'startDate and endDate are required (YYYY-MM-DD)' }]);
      return;
    }

    const start = dayjs(startDate).startOf('day');
    const end = dayjs(endDate).endOf('day');
    if (!start.isValid() || !end.isValid() || end.isBefore(start, 'day')) {
      res.status(400).json([{ message: 'Invalid date range provided' }]);
      return;
    }

    const plannerStartDate = resolvePlannerStartDate();
    const effectiveStart =
      plannerStartDate && start.isBefore(plannerStartDate, 'day')
        ? plannerStartDate
        : start;
    if (end.isBefore(effectiveStart, 'day')) {
      res.status(200).json([
        {
          data: {
            startDate: effectiveStart.format('YYYY-MM-DD'),
            endDate: end.format('YYYY-MM-DD'),
            templateId: templateId ?? null,
            totalCount: 0,
            updatedCount: 0,
            unchangedCount: 0,
            skippedManualCount: 0,
            skippedMissingTemplateCount: 0,
            skippedInvalidDateCount: 0,
          },
          columns: [],
        },
      ]);
      return;
    }

    if (templateId) {
      const template = await AssistantManagerTaskTemplate.findByPk(templateId, {
        attributes: ['id'],
      });
      if (!template) {
        res.status(404).json([{ message: 'Task template not found' }]);
        return;
      }
    }

    const logs = await AssistantManagerTaskLog.findAll({
      where: {
        status: 'pending',
        ...(templateId ? { templateId } : {}),
        taskDate: {
          [Op.between]: [effectiveStart.format('YYYY-MM-DD'), end.format('YYYY-MM-DD')],
        },
      },
      include: [
        {
          model: AssistantManagerTaskTemplate,
          as: 'template',
          attributes: ['id', 'name', 'scheduleConfig', 'isActive'],
          required: false,
        },
      ],
      order: [['taskDate', 'ASC'], ['id', 'ASC']],
    });

    const actorId = getActorId(req);
    const shiftAvailabilityCache = new Map<number, Map<string, ShiftDayInfo>>();
    const scheduledShiftCandidatesByDate = await buildScheduledShiftCandidateMap(effectiveStart, end);
    let updatedCount = 0;
    let unchangedCount = 0;
    let skippedManualCount = 0;
    let skippedMissingTemplateCount = 0;
    let skippedInvalidDateCount = 0;

    for (const log of logs) {
      const existingMeta = { ...(log.meta ?? {}) } as Record<string, unknown>;
      if (Boolean(existingMeta.manual)) {
        skippedManualCount += 1;
        continue;
      }

      const template =
        ((log as unknown as { template?: AssistantManagerTaskTemplate | null }).template ??
          null) as AssistantManagerTaskTemplate | null;
      if (!template) {
        skippedMissingTemplateCount += 1;
        continue;
      }

      const taskDate = dayjs(log.taskDate).format('YYYY-MM-DD');
      if (!dayjs(taskDate).isValid()) {
        skippedInvalidDateCount += 1;
        continue;
      }

      const shiftInfo = await getShiftInfoForUserOnDate(
        log.userId,
        taskDate,
        effectiveStart.startOf('day'),
        end.endOf('day'),
        shiftAvailabilityCache,
      );
      const shiftTime = shiftInfo?.timeStart ? normalizeTimeValue(shiftInfo.timeStart) : null;
      const scheduleMeta = sanitizeScheduleConfigMeta(template.scheduleConfig ?? {}, shiftTime);
      const nextManagedMeta: Record<string, unknown> = {
        manual: false,
        ...scheduleMeta,
      };
      if (!Object.prototype.hasOwnProperty.call(nextManagedMeta, 'priority')) {
        nextManagedMeta.priority = 'medium';
      }
      if (!Object.prototype.hasOwnProperty.call(nextManagedMeta, 'points')) {
        nextManagedMeta.points = 1;
      }
      if (!Object.prototype.hasOwnProperty.call(nextManagedMeta, 'durationHours')) {
        nextManagedMeta.durationHours = 1;
      }
      if (!Object.prototype.hasOwnProperty.call(nextManagedMeta, 'time') && shiftTime) {
        nextManagedMeta.time = shiftTime;
      }
      const expectedEvidenceItems = buildExpectedEvidenceItemsForDate(
        template,
        taskDate,
        scheduledShiftCandidatesByDate,
      );
      if (expectedEvidenceItems.length > 0) {
        nextManagedMeta.expectedEvidenceItems = expectedEvidenceItems;
      } else {
        delete nextManagedMeta.expectedEvidenceItems;
      }
      Object.assign(nextManagedMeta, buildShiftMeta(shiftInfo, getRequireShiftFlag(template)));

      const unmanagedMeta = { ...existingMeta };
      TEMPLATE_CONFIG_MANAGED_META_KEYS.forEach((key) => {
        delete unmanagedMeta[key];
      });
      const nextMeta = { ...unmanagedMeta, ...nextManagedMeta };
      const previousTime = normalizeTimeValue(existingMeta.time);
      const nextTime = normalizeTimeValue(nextMeta.time);
      if (previousTime !== nextTime) {
        delete nextMeta.pushNotificationEvents;
      }

      if (JSON.stringify(existingMeta) === JSON.stringify(nextMeta)) {
        unchangedCount += 1;
        continue;
      }

      await AssistantManagerTaskLog.update(
        {
          meta: nextMeta,
          updatedBy: actorId,
        },
        { where: { id: log.id } },
      );
      updatedCount += 1;
    }

    await reconcileNightReportTaskWaiversForRange(effectiveStart, end);

    res.status(200).json([
      {
        data: {
          startDate: effectiveStart.format('YYYY-MM-DD'),
          endDate: end.format('YYYY-MM-DD'),
          templateId: templateId ?? null,
          totalCount: logs.length,
          updatedCount,
          unchangedCount,
          skippedManualCount,
          skippedMissingTemplateCount,
          skippedInvalidDateCount,
        },
        columns: [],
      },
    ]);
  } catch (error) {
    console.error('Failed to sync existing task logs with template config', error);
    res.status(500).json([{ message: 'Failed to update existing task logs' }]);
  }
};

export const generateTaskLogsForRange = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    if (!canViewAllTaskLogs(req)) {
      res.status(403).json([{ message: 'Forbidden' }]);
      return;
    }

    const startDate = sanitizeTaskDate(req.body?.startDate);
    const endDate = sanitizeTaskDate(req.body?.endDate);
    const templateId = parsePositiveInt(req.body?.templateId);
    if (!startDate || !endDate) {
      res.status(400).json([{ message: 'startDate and endDate are required (YYYY-MM-DD)' }]);
      return;
    }

    const start = dayjs(startDate).startOf('day');
    const end = dayjs(endDate).endOf('day');
    if (!start.isValid() || !end.isValid() || end.isBefore(start, 'day')) {
      res.status(400).json([{ message: 'Invalid date range provided' }]);
      return;
    }

    const plannerStartDate = resolvePlannerStartDate();
    const effectiveStart =
      plannerStartDate && start.isBefore(plannerStartDate, 'day')
        ? plannerStartDate
        : start;
    if (end.isBefore(effectiveStart, 'day')) {
      res.status(200).json([
        {
          data: {
            startDate: effectiveStart.format('YYYY-MM-DD'),
            endDate: end.format('YYYY-MM-DD'),
            templateId: templateId ?? null,
            assignmentCount: 0,
            expectedLogCount: 0,
            createdCount: 0,
            updatedCount: 0,
            unchangedCount: 0,
          },
          columns: [],
        },
      ]);
      return;
    }

    if (templateId) {
      const template = await AssistantManagerTaskTemplate.findByPk(templateId, {
        attributes: ['id'],
      });
      if (!template) {
        res.status(404).json([{ message: 'Task template not found' }]);
        return;
      }
    }

    const assignments = await AssistantManagerTaskAssignment.findAll({
      where: {
        isActive: true,
        ...(templateId ? { templateId } : {}),
      },
      include: [{ model: AssistantManagerTaskTemplate, as: 'template', where: { isActive: true }, required: true }],
    });

    const actorId = getActorId(req);
    const generationSummary = await generateLogsForAssignments(
      assignments,
      effectiveStart,
      end,
      actorId,
    );
    await reconcileNightReportTaskWaiversForRange(effectiveStart, end);

    res.status(200).json([
      {
        data: {
          startDate: effectiveStart.format('YYYY-MM-DD'),
          endDate: end.format('YYYY-MM-DD'),
          templateId: templateId ?? null,
          assignmentCount: assignments.length,
          expectedLogCount: generationSummary.expectedLogKeys.size,
          createdCount: generationSummary.createdCount,
          updatedCount: generationSummary.updatedCount,
          unchangedCount: generationSummary.unchangedCount,
        },
        columns: [],
      },
    ]);
  } catch (error) {
    console.error('Failed to generate assistant manager task logs', error);
    res.status(500).json([{ message: 'Failed to generate weekly tasks' }]);
  }
};

export const previewTaskLogsForRange = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    if (!canViewAllTaskLogs(req)) {
      res.status(403).json([{ message: 'Forbidden' }]);
      return;
    }

    const startDate = sanitizeTaskDate(req.body?.startDate);
    const endDate = sanitizeTaskDate(req.body?.endDate);
    const templateId = parsePositiveInt(req.body?.templateId);
    if (!startDate || !endDate) {
      res.status(400).json([{ message: 'startDate and endDate are required (YYYY-MM-DD)' }]);
      return;
    }

    const start = dayjs(startDate).startOf('day');
    const end = dayjs(endDate).endOf('day');
    if (!start.isValid() || !end.isValid() || end.isBefore(start, 'day')) {
      res.status(400).json([{ message: 'Invalid date range provided' }]);
      return;
    }

    const plannerStartDate = resolvePlannerStartDate();
    const effectiveStart =
      plannerStartDate && start.isBefore(plannerStartDate, 'day')
        ? plannerStartDate
        : start;
    if (end.isBefore(effectiveStart, 'day')) {
      res.status(200).json([
        {
          data: {
            startDate: effectiveStart.format('YYYY-MM-DD'),
            endDate: end.format('YYYY-MM-DD'),
            templateId: templateId ?? null,
            assignmentCount: 0,
            expectedLogCount: 0,
            templates: [],
          },
          columns: [],
        },
      ]);
      return;
    }

    if (templateId) {
      const template = await AssistantManagerTaskTemplate.findByPk(templateId, {
        attributes: ['id'],
      });
      if (!template) {
        res.status(404).json([{ message: 'Task template not found' }]);
        return;
      }
    }

    const assignments = await AssistantManagerTaskAssignment.findAll({
      where: {
        isActive: true,
        ...(templateId ? { templateId } : {}),
      },
      include: [{ model: AssistantManagerTaskTemplate, as: 'template', where: { isActive: true }, required: true }],
    });

    const plannedEntries = await planGeneratedLogsForAssignments(
      assignments,
      effectiveStart,
      end,
    );
    const templates = await summarizePlannedLogsForRange(
      plannedEntries,
      effectiveStart,
      end,
    );

    res.status(200).json([
      {
        data: {
          startDate: effectiveStart.format('YYYY-MM-DD'),
          endDate: end.format('YYYY-MM-DD'),
          templateId: templateId ?? null,
          assignmentCount: assignments.length,
          expectedLogCount: plannedEntries.length,
          templates,
        },
        columns: [],
      },
    ]);
  } catch (error) {
    console.error('Failed to preview assistant manager task logs', error);
    res.status(500).json([{ message: 'Failed to preview weekly tasks' }]);
  }
};

export const clearTaskLogsForRange = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    if (!canViewAllTaskLogs(req)) {
      res.status(403).json([{ message: 'Forbidden' }]);
      return;
    }

    const startDate = sanitizeTaskDate(req.body?.startDate);
    const endDate = sanitizeTaskDate(req.body?.endDate);
    if (!startDate || !endDate) {
      res.status(400).json([{ message: 'startDate and endDate are required (YYYY-MM-DD)' }]);
      return;
    }

    const start = dayjs(startDate).startOf('day');
    const end = dayjs(endDate).endOf('day');
    if (!start.isValid() || !end.isValid() || end.isBefore(start, 'day')) {
      res.status(400).json([{ message: 'Invalid date range provided' }]);
      return;
    }

    const plannerStartDate = resolvePlannerStartDate();
    const effectiveStart =
      plannerStartDate && start.isBefore(plannerStartDate, 'day')
        ? plannerStartDate
        : start;
    if (end.isBefore(effectiveStart, 'day')) {
      res.status(200).json([
        {
          data: {
            startDate: effectiveStart.format('YYYY-MM-DD'),
            endDate: end.format('YYYY-MM-DD'),
            totalCount: 0,
            deletedCount: 0,
          },
          columns: [],
        },
      ]);
      return;
    }

    const where = {
      taskDate: {
        [Op.between]: [effectiveStart.format('YYYY-MM-DD'), end.format('YYYY-MM-DD')],
      },
    };

    const totalCount = await AssistantManagerTaskLog.count({ where });
    const deletedCount = await AssistantManagerTaskLog.destroy({ where });

    res.status(200).json([
      {
        data: {
          startDate: effectiveStart.format('YYYY-MM-DD'),
          endDate: end.format('YYYY-MM-DD'),
          totalCount,
          deletedCount,
        },
        columns: [],
      },
    ]);
  } catch (error) {
    console.error('Failed to clear assistant manager task logs', error);
    res.status(500).json([{ message: 'Failed to clear weekly tasks' }]);
  }
};

export const listTaskAssignments = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!canViewAllTaskLogs(req)) {
      res.status(403).json([{ message: 'Forbidden' }]);
      return;
    }
    const templateId = Number(req.params.id);
    if (!Number.isInteger(templateId) || templateId <= 0) {
      res.status(400).json([{ message: 'Invalid template id' }]);
      return;
    }
    const assignments = await AssistantManagerTaskAssignment.findAll({
      where: { templateId },
      include: taskAssignmentInclude,
      order: [
        ['isActive', 'DESC'],
        ['id', 'ASC'],
      ],
    });
    res.status(200).json([
      {
        data: assignments.map((assignment) =>
          formatAssignment(
            assignment as AssistantManagerTaskAssignment & {
              user?: User | null;
              userType?: UserType | null;
              shiftRole?: ShiftRole | null;
            },
          ),
        ),
        columns: [],
      },
    ]);
  } catch (error) {
    console.error('Failed to list task assignments', error);
    res.status(500).json([{ message: 'Failed to list task assignments' }]);
  }
};

export const createTaskAssignment = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!canViewAllTaskLogs(req)) {
      res.status(403).json([{ message: 'Forbidden' }]);
      return;
    }
    const templateId = Number(req.params.id);
    if (!Number.isInteger(templateId) || templateId <= 0) {
      res.status(400).json([{ message: 'Invalid template id' }]);
      return;
    }
    const template = await AssistantManagerTaskTemplate.findByPk(templateId);
    if (!template) {
      res.status(404).json([{ message: 'Task template not found' }]);
      return;
    }
    const payload = sanitizeAssignmentPayload(req.body ?? {});
    payload.templateId = templateId;
    payload.createdBy = getActorId(req);
    payload.updatedBy = getActorId(req);
    payload.targetScope = resolveAssignmentTargetScope(payload);
    const validationMessage = getAssignmentTargetValidationMessage(payload);
    if (validationMessage) {
      res.status(400).json([{ message: validationMessage }]);
      return;
    }
    const conflictMessage = await findTemplateAssignmentConflict({
      candidateTemplate: template,
      candidateAssignments: [{ ...payload, isActive: payload.isActive ?? true }],
      excludeTemplateId: templateId,
    });
    if (conflictMessage) {
      res.status(400).json([{ message: conflictMessage }]);
      return;
    }
    const created = await AssistantManagerTaskAssignment.create(payload);
    const refreshed = await AssistantManagerTaskAssignment.findByPk(created.id, {
      include: taskAssignmentInclude,
    });
    res.status(201).json([
      {
        data: refreshed
          ? [
              formatAssignment(
                refreshed as AssistantManagerTaskAssignment & {
                  user?: User | null;
                  userType?: UserType | null;
                  shiftRole?: ShiftRole | null;
                },
              ),
            ]
          : [],
      },
    ]);
  } catch (error) {
    console.error('Failed to create task assignment', error);
    res.status(500).json([{ message: 'Failed to create task assignment' }]);
  }
};

export const bulkCreateTaskAssignments = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    if (!canViewAllTaskLogs(req)) {
      res.status(403).json([{ message: 'Forbidden' }]);
      return;
    }

    const templateIdsRaw: unknown[] = Array.isArray(req.body?.templateIds) ? req.body.templateIds : [];
    const templateIds = Array.from(
      new Set(
        templateIdsRaw
          .map((value: unknown) => Number(value))
          .filter((value: number): value is number => Number.isInteger(value) && value > 0),
      ),
    );

    if (templateIds.length === 0) {
      res.status(400).json([{ message: 'At least one templateId is required' }]);
      return;
    }

    const payload = sanitizeAssignmentPayload(req.body?.payload ?? {});
    payload.createdBy = getActorId(req);
    payload.updatedBy = getActorId(req);
    payload.targetScope = resolveAssignmentTargetScope(payload);
    const validationMessage = getAssignmentTargetValidationMessage(payload);
    if (validationMessage) {
      res.status(400).json([{ message: validationMessage }]);
      return;
    }

    const sequelize = AssistantManagerTaskAssignment.sequelize;
    if (!sequelize) {
      res.status(500).json([{ message: 'Database connection is not available' }]);
      return;
    }

    await sequelize.transaction(async (transaction) => {
      const templates = await AssistantManagerTaskTemplate.findAll({
        where: { id: templateIds },
        transaction,
      });

      if (templates.length !== templateIds.length) {
        throw new Error('One or more selected templates were not found');
      }

      for (const template of templates) {
        const conflictMessage = await findTemplateAssignmentConflict({
          candidateTemplate: template,
          candidateAssignments: [{ ...payload, isActive: payload.isActive ?? true }],
          excludeTemplateId: template.id,
          transaction,
        });
        if (conflictMessage) {
          throw new Error(`${template.name}: ${conflictMessage}`);
        }

        await AssistantManagerTaskAssignment.create(
          {
            ...payload,
            templateId: template.id,
          },
          { transaction },
        );
      }
    });

    const refreshedTemplates = await AssistantManagerTaskTemplate.findAll({
      where: { id: templateIds },
      include: [{ model: AssistantManagerTaskAssignment, as: 'assignments', include: taskAssignmentInclude }],
      order: [['id', 'ASC']],
    });

    res.status(201).json([
      {
        data: refreshedTemplates.map((template) =>
          formatTemplate(
            template as AssistantManagerTaskTemplate & {
              assignments?: AssistantManagerTaskAssignment[];
            },
          ),
        ),
        columns: [],
      },
    ]);
  } catch (error) {
    console.error('Failed to bulk create task assignments', error);
    res.status(error instanceof Error ? 400 : 500).json([
      {
        message:
          error instanceof Error ? error.message : 'Failed to bulk create task assignments',
      },
    ]);
  }
};

export const updateTaskAssignment = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!canViewAllTaskLogs(req)) {
      res.status(403).json([{ message: 'Forbidden' }]);
      return;
    }
    const templateId = Number(req.params.id);
    const assignmentId = Number(req.params.assignmentId);
    if (!Number.isInteger(templateId) || templateId <= 0 || !Number.isInteger(assignmentId) || assignmentId <= 0) {
      res.status(400).json([{ message: 'Invalid ids provided' }]);
      return;
    }
    const assignment = await AssistantManagerTaskAssignment.findOne({ where: { id: assignmentId, templateId } });
    if (!assignment) {
      res.status(404).json([{ message: 'Assignment not found' }]);
      return;
    }
    const template = await AssistantManagerTaskTemplate.findByPk(templateId);
    if (!template) {
      res.status(404).json([{ message: 'Task template not found' }]);
      return;
    }
    const payload = sanitizeAssignmentPayload({ ...assignment.get(), ...req.body });
    payload.updatedBy = getActorId(req);
    payload.targetScope = resolveAssignmentTargetScope(payload);
    const validationMessage = getAssignmentTargetValidationMessage(payload);
    if (validationMessage) {
      res.status(400).json([{ message: validationMessage }]);
      return;
    }
    const conflictMessage = await findTemplateAssignmentConflict({
      candidateTemplate: template,
      candidateAssignments: [{ ...payload, isActive: payload.isActive ?? true }],
      excludeTemplateId: templateId,
    });
    if (conflictMessage) {
      res.status(400).json([{ message: conflictMessage }]);
      return;
    }
    await AssistantManagerTaskAssignment.update(payload, { where: { id: assignmentId, templateId } });
    const refreshed = await AssistantManagerTaskAssignment.findByPk(assignmentId, {
      include: taskAssignmentInclude,
    });
    res.status(200).json([
      {
        data: refreshed
          ? [
              formatAssignment(
                refreshed as AssistantManagerTaskAssignment & {
                  user?: User | null;
                  userType?: UserType | null;
                  shiftRole?: ShiftRole | null;
                },
              ),
            ]
          : [],
      },
    ]);
  } catch (error) {
    console.error('Failed to update task assignment', error);
    res.status(500).json([{ message: 'Failed to update task assignment' }]);
  }
};

export const deleteTaskAssignment = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!canViewAllTaskLogs(req)) {
      res.status(403).json([{ message: 'Forbidden' }]);
      return;
    }
    const templateId = Number(req.params.id);
    const assignmentId = Number(req.params.assignmentId);
    if (!Number.isInteger(templateId) || templateId <= 0 || !Number.isInteger(assignmentId) || assignmentId <= 0) {
      res.status(400).json([{ message: 'Invalid ids provided' }]);
      return;
    }
    const deleted = await AssistantManagerTaskAssignment.destroy({ where: { id: assignmentId, templateId } });
    if (!deleted) {
      res.status(404).json([{ message: 'Assignment not found' }]);
      return;
    }
    res.status(204).send();
  } catch (error) {
    console.error('Failed to delete task assignment', error);
    res.status(500).json([{ message: 'Failed to delete task assignment' }]);
  }
};

export const listTaskLogs = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { startDate, endDate, scope, userId } = req.query;
    const start =
      typeof startDate === 'string' && startDate.trim()
        ? dayjs(startDate)
        : startOfPlannerWeek();
    const end = typeof endDate === 'string' && endDate.trim() ? dayjs(endDate) : start.add(6, 'day');
    if (!start.isValid() || !end.isValid()) {
      res.status(400).json([{ message: 'Invalid date range provided' }]);
      return;
    }
    const plannerStartDate = resolvePlannerStartDate();
    const effectiveStart =
      plannerStartDate && start.isBefore(plannerStartDate, 'day')
        ? plannerStartDate
        : start.startOf('day');
    const effectiveEnd = end.endOf('day');
    if (effectiveEnd.isBefore(effectiveStart, 'day')) {
      res.status(200).json([
        {
          data: [],
          columns: [],
        },
      ]);
      return;
    }
    const actorId = getActorId(req);
    const allowGlobalView = canViewAllTaskLogs(req);
    if (!allowGlobalView && !actorId) {
      res.status(403).json([{ message: 'Forbidden' }]);
      return;
    }

    const where: WhereOptions = {
      taskDate: {
        [Op.between]: [effectiveStart.format('YYYY-MM-DD'), effectiveEnd.format('YYYY-MM-DD')],
      },
    };

    if (!allowGlobalView) {
      where.userId = actorId;
    } else if (typeof userId === 'string' && userId.trim()) {
      const numeric = Number(userId);
      if (Number.isFinite(numeric) && numeric > 0) {
        where.userId = numeric;
      }
    } else if (scope === 'self' && actorId) {
      where.userId = actorId;
    }

    const logs = await AssistantManagerTaskLog.findAll({
      where,
      include: [
        { model: AssistantManagerTaskTemplate, as: 'template', attributes: ['id', 'name', 'description', 'cadence', 'scheduleConfig'] },
        { model: User, as: 'user', attributes: ['id', 'firstName', 'lastName'] },
      ],
      order: [
        ['taskDate', 'ASC'],
        ['userId', 'ASC'],
      ],
    });
    const scheduledShiftCandidatesByDate = await buildScheduledShiftCandidateMap(
      effectiveStart,
      effectiveEnd,
    );

    res.status(200).json([
      {
        data: logs.map((log) =>
          formatLogWithLiveExpectedEvidenceItems(
            log as AssistantManagerTaskLog & { template?: AssistantManagerTaskTemplate | null; user?: User | null },
            scheduledShiftCandidatesByDate,
          ),
        ),
        columns: [],
      },
    ]);
  } catch (error) {
    console.error('Failed to list assistant manager task logs', error);
    res.status(500).json([{ message: 'Failed to list task logs' }]);
  }
};

export const updateTaskLogStatus = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const logId = Number(req.params.id);
    if (!Number.isInteger(logId) || logId <= 0) {
      res.status(400).json([{ message: 'Invalid task log id' }]);
      return;
    }
    const log = await AssistantManagerTaskLog.findByPk(logId, {
      include: [
        { model: AssistantManagerTaskTemplate, as: 'template', attributes: ['id', 'name', 'description', 'scheduleConfig'] },
        { model: User, as: 'user', attributes: ['id', 'firstName', 'lastName'] },
      ],
    });
    if (!log) {
      res.status(404).json([{ message: 'Task log not found' }]);
      return;
    }
    const actorId = getActorId(req);
    if (!canViewAllTaskLogs(req) && actorId !== log.userId) {
      res.status(403).json([{ message: 'Forbidden' }]);
      return;
    }
    const status = typeof req.body.status === 'string' ? (req.body.status.trim() as AssistantManagerTaskStatus) : undefined;
    const notes = typeof req.body.notes === 'string' ? req.body.notes.trim() : undefined;
    if (status && !STATUS_VALUES.has(status)) {
      res.status(400).json([{ message: 'Invalid status provided' }]);
      return;
    }
    const timezoneName = resolveTaskPlannerTimezone();
    const payload: Partial<AssistantManagerTaskLog> = {};
    const nextMeta = { ...(log.meta ?? {}) } as Record<string, unknown>;
    if (status) {
      if (status === 'completed') {
        if (!isTaskLogOnCurrentDay(log, timezoneName)) {
          res.status(400).json([{ message: 'Task can only be completed on its scheduled day' }]);
          return;
        }
        const strictDeadline = getTaskLogStrictCompletionDeadline(log, timezoneName);
        if (strictDeadline && dayjs().tz(timezoneName).isAfter(strictDeadline)) {
          res.status(400).json([{ message: 'Task can no longer be completed after its scheduled end time' }]);
          return;
        }
        const { normalizedItems } = ensureEvidenceRequirementsSatisfied(log.template, nextMeta);
        nextMeta.evidenceItems = normalizedItems;
        payload.meta = nextMeta;
      }
      payload.status = status;
      payload.completedAt = status === 'completed' ? new Date() : null;
    }
    if (notes !== undefined) {
      payload.notes = notes;
    }
    payload.updatedBy = actorId;
    await AssistantManagerTaskLog.update(payload, { where: { id: logId } });
    const refreshed = await AssistantManagerTaskLog.findByPk(logId, {
      include: [
        { model: AssistantManagerTaskTemplate, as: 'template', attributes: ['id', 'name', 'description', 'cadence', 'scheduleConfig'] },
        { model: User, as: 'user', attributes: ['id', 'firstName', 'lastName'] },
      ],
    });
    const refreshedCandidates = refreshed
      ? await buildScheduledShiftCandidateMap(
          dayjs(refreshed.taskDate).startOf('day'),
          dayjs(refreshed.taskDate).endOf('day'),
        )
      : undefined;
    res.status(200).json([
      {
        data: refreshed
          ? [
              formatLogWithLiveExpectedEvidenceItems(
                refreshed as AssistantManagerTaskLog & { template?: AssistantManagerTaskTemplate | null; user?: User | null },
                refreshedCandidates,
              ),
            ]
          : [],
      },
    ]);
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json([{ message: error.message }]);
      return;
    }
    console.error('Failed to update task log status', error);
    res.status(500).json([{ message: 'Failed to update task log' }]);
  }
};

export const deleteTaskLog = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const logId = Number(req.params.id);
    if (!Number.isInteger(logId) || logId <= 0) {
      res.status(400).json([{ message: 'Invalid task log id' }]);
      return;
    }

    // Delete permission is intentionally stricter than the route guard:
    // assistant-managers can access the planner, but only admin/owner/manager can delete tasks.
    if (!canViewAllTaskLogs(req)) {
      res.status(403).json([{ message: 'Forbidden' }]);
      return;
    }

    const log = await AssistantManagerTaskLog.findByPk(logId, {
      attributes: ['id', 'meta'],
    });
    if (!log) {
      res.status(404).json([{ message: 'Task log not found' }]);
      return;
    }

    const evidenceItems = sanitizeEvidenceItems((log.meta ?? {})['evidenceItems']);
    const imageEvidenceWithStorage = evidenceItems.filter(
      (item) => item.type === 'image' && Boolean(item.storagePath || item.driveFileId),
    );

    const uniqueDeleteTargets = new Map<string, { storagePath?: string | null; driveFileId?: string | null }>();
    imageEvidenceWithStorage.forEach((item) => {
      const driveFileId = typeof item.driveFileId === 'string' ? item.driveFileId.trim() : '';
      const storagePath = typeof item.storagePath === 'string' ? item.storagePath.trim() : '';
      const dedupeKey = `${driveFileId}::${storagePath}`;
      if (!uniqueDeleteTargets.has(dedupeKey)) {
        uniqueDeleteTargets.set(dedupeKey, {
          storagePath: storagePath || null,
          driveFileId: driveFileId || null,
        });
      }
    });

    if (uniqueDeleteTargets.size > 0) {
      await Promise.all(
        Array.from(uniqueDeleteTargets.values()).map((target) =>
          deleteAssistantManagerTaskEvidenceImage({
            storagePath: target.storagePath ?? null,
            driveFileId: target.driveFileId ?? null,
          }),
        ),
      );
    }

    await AssistantManagerTaskLog.destroy({ where: { id: logId } });
    res.status(204).send();
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json([{ message: error.message }]);
      return;
    }
    console.error('Failed to delete task log', error);
    res.status(500).json([{ message: 'Failed to delete task log' }]);
  }
};

export const createManualTaskLog = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!canViewAllTaskLogs(req)) {
      res.status(403).json([{ message: 'Forbidden' }]);
      return;
    }
    let payload: ManualTaskPayload;
    try {
      payload = sanitizeManualTaskPayload(req.body ?? {});
    } catch (error) {
      res.status(400).json([{ message: error instanceof Error ? error.message : 'Invalid payload' }]);
      return;
    }
    if (!payload.templateId) {
      res.status(400).json([{ message: 'templateId is required' }]);
      return;
    }
    if (!payload.userId) {
      res.status(400).json([{ message: 'userId is required' }]);
      return;
    }
    if (!payload.taskDate) {
      res.status(400).json([{ message: 'taskDate is required' }]);
      return;
    }
    const template = await AssistantManagerTaskTemplate.findByPk(payload.templateId);
    if (!template) {
      res.status(404).json([{ message: 'Task template not found' }]);
      return;
    }
    if (template.isActive === false) {
      res.status(400).json([{ message: 'Template is inactive' }]);
      return;
    }
    const user = await User.findByPk(payload.userId, { attributes: ['id'] });
    if (!user) {
      res.status(404).json([{ message: 'User not found' }]);
      return;
    }
    if (payload.assignmentId) {
      const assignment = await AssistantManagerTaskAssignment.findOne({
        where: { id: payload.assignmentId, templateId: template.id },
      });
      if (!assignment) {
        res.status(400).json([{ message: 'assignmentId does not belong to template' }]);
        return;
      }
    }
    const actorId = getActorId(req);
    const taskDay = dayjs(payload.taskDate);
    const scheduledShiftCandidatesByDate = await buildScheduledShiftCandidateMap(
      taskDay.startOf('day'),
      taskDay.endOf('day'),
    );
    const shiftInfo = await getShiftInfoForUserOnDate(
      payload.userId,
      payload.taskDate,
      taskDay.startOf('day'),
      taskDay.endOf('day'),
    );
    const meta: Record<string, unknown> = { manual: true, ...payload.meta };
    if (!Object.prototype.hasOwnProperty.call(meta, 'priority') || meta['priority'] == null) {
      meta['priority'] = 'medium';
    }
    if (!Object.prototype.hasOwnProperty.call(meta, 'points') || meta['points'] == null) {
      meta['points'] = 1;
    }
    if (!Object.prototype.hasOwnProperty.call(meta, 'durationHours') || meta['durationHours'] == null) {
      meta['durationHours'] = 1;
    }
    if (
      (!Object.prototype.hasOwnProperty.call(meta, 'time') || meta['time'] == null) &&
      shiftInfo?.timeStart
    ) {
      meta['time'] = normalizeTimeValue(shiftInfo.timeStart);
    }
    const expectedEvidenceItems = buildExpectedEvidenceItemsForDate(
      template,
      payload.taskDate,
      scheduledShiftCandidatesByDate,
    );
    if (expectedEvidenceItems.length > 0) {
      meta.expectedEvidenceItems = expectedEvidenceItems;
    }
    Object.assign(meta, buildShiftMeta(shiftInfo, payload.requireShift));
    if (payload.initialComment) {
      const actorName = await getActorIdentity(actorId);
      appendCommentEntry(meta, payload.initialComment, actorId, actorName);
    }
    const created = await AssistantManagerTaskLog.create({
      templateId: template.id,
      assignmentId: payload.assignmentId,
      userId: payload.userId,
      taskDate: payload.taskDate,
      status: payload.status ?? 'pending',
      notes: payload.notes ?? null,
      meta,
      createdBy: actorId,
      updatedBy: actorId,
    });
    const refreshed = await AssistantManagerTaskLog.findByPk(created.id, {
      include: [
        { model: AssistantManagerTaskTemplate, as: 'template', attributes: ['id', 'name', 'description', 'cadence', 'scheduleConfig'] },
        { model: User, as: 'user', attributes: ['id', 'firstName', 'lastName'] },
      ],
    });
    const refreshedCandidates = await buildScheduledShiftCandidateMap(
      taskDay.startOf('day'),
      taskDay.endOf('day'),
    );
    res.status(201).json([
      {
        data: refreshed
          ? [
              formatLogWithLiveExpectedEvidenceItems(
                refreshed as AssistantManagerTaskLog & { template?: AssistantManagerTaskTemplate | null; user?: User | null },
                refreshedCandidates,
              ),
            ]
          : [],
        columns: [],
      },
    ]);
  } catch (error) {
    console.error('Failed to create manual assistant manager task log', error);
    res.status(500).json([{ message: 'Failed to create manual task log' }]);
  }
};

export const uploadTaskLogEvidenceImage = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const actorId = requireActorId(req);
    const logId = Number(req.params.id);
    if (!Number.isInteger(logId) || logId <= 0) {
      throw new HttpError(400, 'Invalid task log id');
    }

    const log = await AssistantManagerTaskLog.findByPk(logId, {
      include: [
        { model: AssistantManagerTaskTemplate, as: 'template', attributes: ['id', 'name', 'description', 'cadence', 'scheduleConfig', 'isActive'] },
        { model: User, as: 'user', attributes: ['id', 'firstName', 'lastName'] },
      ],
    });
    if (!log) {
      res.status(404).json([{ message: 'Task log not found' }]);
      return;
    }
    if (!canViewAllTaskLogs(req) && actorId !== log.userId) {
      throw new HttpError(403, 'Forbidden');
    }
    if (!canEditTaskLogEvidence(log)) {
      throw new HttpError(400, 'Evidence can only be edited for pending tasks on the current day');
    }

    const file = req.file;
    if (!file) {
      throw new HttpError(400, 'No file uploaded');
    }
    if (!file.mimetype.startsWith('image/')) {
      throw new HttpError(400, 'Only image uploads are supported');
    }

    const ruleKey =
      typeof req.body?.ruleKey === 'string' ? req.body.ruleKey.trim() : '';
    if (!ruleKey) {
      throw new HttpError(400, 'ruleKey is required');
    }
    const subjectUserIdRaw = req.body?.subjectUserId;
    const subjectUserId =
      subjectUserIdRaw == null || subjectUserIdRaw === ''
        ? null
        : Number(subjectUserIdRaw);
    const subjectName =
      typeof req.body?.subjectName === 'string' && req.body.subjectName.trim()
        ? req.body.subjectName.trim()
        : null;
    if (subjectUserId != null && (!Number.isInteger(subjectUserId) || subjectUserId <= 0)) {
      throw new HttpError(400, 'subjectUserId must be a positive integer');
    }

    const rule = getEvidenceRules(log.template).find((entry) => entry.key === ruleKey);
    if (!rule) {
      throw new HttpError(400, 'Evidence rule not found');
    }
    if (rule.type !== 'image') {
      throw new HttpError(400, 'Selected evidence rule does not accept images');
    }

    await ensureAssistantManagerTaskEvidenceStorage();
    const stored = await storeAssistantManagerTaskEvidenceImage({
      logId: log.id,
      taskDate: log.taskDate,
      ruleKey,
      originalName: file.originalname,
      mimeType: file.mimetype,
      data: file.buffer,
    });

    const meta = { ...(log.meta ?? {}) } as Record<string, unknown>;
    const evidenceItems = sanitizeEvidenceItems(meta['evidenceItems']);
    const nextItem: AssistantManagerTaskEvidenceItem = {
      id: randomUUID(),
      ruleKey,
      type: 'image',
      valid: true,
      fileName: stored.originalName,
      mimeType: stored.mimeType,
      fileSize: stored.fileSize,
      storagePath: stored.storagePath,
      driveFileId: stored.driveFileId,
      driveWebViewLink: stored.driveWebViewLink,
      uploadedAt: new Date().toISOString(),
      uploadedBy: actorId,
      subjectUserId,
      subjectName,
    };
    const removedEvidenceItems =
      rule.multiple && subjectUserId != null
        ? evidenceItems.filter(
            (item) =>
              item.ruleKey === ruleKey &&
              item.type === 'image' &&
              item.subjectUserId === subjectUserId,
          )
        : rule.multiple
          ? []
          : evidenceItems.filter((item) => !(item.ruleKey === ruleKey && item.type === 'image'));
    const remainingItems =
      rule.multiple && subjectUserId != null
        ? evidenceItems.filter(
            (item) =>
              !(
                item.ruleKey === ruleKey &&
                item.type === 'image' &&
                item.subjectUserId === subjectUserId
              ),
          )
        : rule.multiple
          ? evidenceItems
          : evidenceItems.filter((item) => !(item.ruleKey === ruleKey && item.type === 'image'));
    const nextItems = [...remainingItems, nextItem];
    const { errors, normalizedItems } = validateEvidenceItemsAgainstRules(
      getEvidenceRules(log.template),
      nextItems,
      { enforceRequired: false },
    );
    if (errors.length > 0) {
      throw new HttpError(400, errors.join(' '));
    }

    meta['evidenceItems'] = normalizedItems;
    await AssistantManagerTaskLog.update(
      {
        meta,
        updatedBy: actorId,
      },
      { where: { id: log.id } },
    );
    if (removedEvidenceItems.length > 0) {
      await Promise.all(
        removedEvidenceItems.map((item) =>
          deleteAssistantManagerTaskEvidenceImage({
            storagePath: item.storagePath ?? null,
            driveFileId: item.driveFileId ?? null,
          }),
        ),
      );
    }

    res.status(201).json([
      {
        id: nextItem.id,
        ruleKey: nextItem.ruleKey,
        type: 'image',
        fileName: nextItem.fileName,
        mimeType: nextItem.mimeType,
        fileSize: nextItem.fileSize,
        storagePath: nextItem.storagePath,
        driveFileId: nextItem.driveFileId ?? null,
        driveWebViewLink: nextItem.driveWebViewLink ?? null,
        uploadedAt: nextItem.uploadedAt,
        uploadedBy: nextItem.uploadedBy ?? null,
        subjectUserId: nextItem.subjectUserId ?? null,
        subjectName: nextItem.subjectName ?? null,
      },
    ]);
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json([{ message: error.message }]);
      return;
    }
    logger.error('Failed to upload assistant manager task evidence image', error);
    res.status(500).json([{ message: 'Failed to upload task evidence image' }]);
  }
};

export const downloadTaskLogEvidenceImage = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const logId = Number(req.params.id);
    const itemId =
      typeof req.params.itemId === 'string' ? req.params.itemId.trim() : '';

    if (!Number.isInteger(logId) || logId <= 0) {
      throw new HttpError(400, 'Invalid task log id');
    }
    if (!itemId) {
      throw new HttpError(400, 'Invalid evidence item id');
    }

    const log = await AssistantManagerTaskLog.findByPk(logId, {
      include: [
        { model: AssistantManagerTaskTemplate, as: 'template', attributes: ['id', 'name', 'description', 'cadence', 'scheduleConfig', 'isActive'] },
        { model: User, as: 'user', attributes: ['id', 'firstName', 'lastName'] },
      ],
    });

    if (!log) {
      res.status(404).json([{ message: 'Task log not found' }]);
      return;
    }

    const actorId = getActorId(req);
    if (!canViewAllTaskLogs(req) && actorId !== log.userId) {
      throw new HttpError(403, 'Forbidden');
    }

    const evidenceItems = sanitizeEvidenceItems((log.meta ?? {})['evidenceItems']);
    const item = evidenceItems.find((entry) => entry.id === itemId && entry.type === 'image');
    if (!item) {
      res.status(404).json([{ message: 'Evidence image not found' }]);
      return;
    }

    const streamResult = await openAssistantManagerTaskEvidenceImageStream({
      storagePath: item.storagePath ?? null,
      driveFileId: item.driveFileId ?? null,
    });

    res.setHeader('Content-Type', item.mimeType || streamResult.mimeType);
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${encodeURIComponent(item.fileName || `evidence-${item.id}.jpg`)}"`,
    );

    streamResult.stream.on('error', (error) => {
      logger.error('Failed to stream assistant manager task evidence image', error);
      if (!res.headersSent) {
        res.status(500).json([{ message: 'Failed to stream evidence image' }]);
      } else {
        res.end();
      }
    });

    streamResult.stream.pipe(res);
  } catch (error) {
    if (error instanceof HttpError) {
      if (!res.headersSent) {
        res.status(error.status).json([{ message: error.message }]);
      }
      return;
    }

    logger.error('Failed to download assistant manager task evidence image', error);
    if (!res.headersSent) {
      res.status(500).json([{ message: 'Failed to download evidence image' }]);
    }
  }
};

export const updateTaskLogMeta = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const logId = Number(req.params.id);
    if (!Number.isInteger(logId) || logId <= 0) {
      res.status(400).json([{ message: 'Invalid task log id' }]);
      return;
    }
    const log = await AssistantManagerTaskLog.findByPk(logId, {
      include: [
        { model: AssistantManagerTaskTemplate, as: 'template', attributes: ['id', 'name', 'description', 'cadence', 'scheduleConfig', 'isActive'] },
        { model: User, as: 'user', attributes: ['id', 'firstName', 'lastName'] },
      ],
    });
    if (!log) {
      res.status(404).json([{ message: 'Task log not found' }]);
      return;
    }
    const actorId = getActorId(req);
    if (!canViewAllTaskLogs(req) && actorId !== log.userId) {
      res.status(403).json([{ message: 'Forbidden' }]);
      return;
    }
    let payload: MetaUpdatePayload;
    try {
      payload = sanitizeLogMetaPayload(req.body ?? {});
    } catch (error) {
      res.status(400).json([{ message: error instanceof Error ? error.message : 'Invalid payload' }]);
      return;
    }
    const isEvidenceUpdate = Object.prototype.hasOwnProperty.call(payload.metaPatch, 'evidenceItems');
    if (isEvidenceUpdate && !canEditTaskLogEvidence(log)) {
      res.status(400).json([{ message: 'Evidence can only be edited for pending tasks on the current day' }]);
      return;
    }
    const previousEvidenceItems = sanitizeEvidenceItems((log.meta ?? {})['evidenceItems']);
    const meta = { ...(log.meta ?? {}) } as Record<string, unknown>;
    Object.assign(meta, payload.metaPatch);
    const { errors, normalizedItems } = validateEvidenceItemsAgainstRules(
      getEvidenceRules(log.template),
      sanitizeEvidenceItems(meta['evidenceItems']),
      { enforceRequired: false },
    );
    if (errors.length > 0) {
      res.status(400).json([{ message: errors.join(' ') }]);
      return;
    }
    meta['evidenceItems'] = normalizedItems;
    const nextImageIds = new Set(
      normalizedItems.filter((item) => item.type === 'image').map((item) => item.id),
    );
    const nextImageDriveIds = new Set(
      normalizedItems
        .filter((item) => item.type === 'image' && typeof item.driveFileId === 'string')
        .map((item) => (item.driveFileId as string).trim())
        .filter(Boolean),
    );
    const removedImageEvidenceItems = isEvidenceUpdate
      ? previousEvidenceItems.filter((item) => {
          if (item.type !== 'image') {
            return false;
          }
          const hasStoredFile = Boolean(item.storagePath || item.driveFileId);
          if (!hasStoredFile) {
            return false;
          }
          const stillPresentById = item.id ? nextImageIds.has(item.id) : false;
          const driveId = typeof item.driveFileId === 'string' ? item.driveFileId.trim() : '';
          const stillPresentByDriveId = driveId ? nextImageDriveIds.has(driveId) : false;
          return !stillPresentById && !stillPresentByDriveId;
        })
      : [];
    let nextTaskDate = log.taskDate;
    if (payload.taskDate) {
      nextTaskDate = payload.taskDate;
    }
    const day = dayjs(nextTaskDate);
    const baseRequireShift =
      typeof meta['requireShift'] === 'boolean'
        ? Boolean(meta['requireShift'])
        : log.template
          ? getRequireShiftFlag(log.template)
          : false;
    const effectiveRequireShift =
      payload.requireShift != null ? Boolean(payload.requireShift) : baseRequireShift;
    const shiftInfo = await getShiftInfoForUserOnDate(
      log.userId,
      nextTaskDate,
      day.startOf('day'),
      day.endOf('day'),
    );
    const scheduledShiftCandidatesByDate = await buildScheduledShiftCandidateMap(
      day.startOf('day'),
      day.endOf('day'),
    );
    if (log.template) {
      const expectedEvidenceItems = buildExpectedEvidenceItemsForDate(
        log.template,
        nextTaskDate,
        scheduledShiftCandidatesByDate,
      );
      if (expectedEvidenceItems.length > 0) {
        meta['expectedEvidenceItems'] = expectedEvidenceItems;
      } else {
        delete meta['expectedEvidenceItems'];
      }
    } else {
      delete meta['expectedEvidenceItems'];
    }
    Object.assign(meta, buildShiftMeta(shiftInfo, effectiveRequireShift));
    if (
      (!Object.prototype.hasOwnProperty.call(meta, 'time') || meta['time'] == null) &&
      shiftInfo?.timeStart
    ) {
      meta['time'] = normalizeTimeValue(shiftInfo.timeStart);
    }
    if (payload.comment) {
      const actorName = await getActorIdentity(actorId);
      appendCommentEntry(meta, payload.comment, actorId, actorName);
    }
    const updatePayload: Partial<AssistantManagerTaskLog> = {
      meta,
      updatedBy: actorId,
    };
    if (payload.taskDate) {
      updatePayload.taskDate = payload.taskDate;
    }
    if (payload.notes !== undefined) {
      updatePayload.notes = payload.notes;
    }
    await AssistantManagerTaskLog.update(updatePayload, { where: { id: logId } });
    if (removedImageEvidenceItems.length > 0) {
      await Promise.all(
        removedImageEvidenceItems.map((item) =>
          deleteAssistantManagerTaskEvidenceImage({
            storagePath: item.storagePath ?? null,
            driveFileId: item.driveFileId ?? null,
          }),
        ),
      );
    }
    const refreshed = await AssistantManagerTaskLog.findByPk(logId, {
      include: [
        { model: AssistantManagerTaskTemplate, as: 'template', attributes: ['id', 'name', 'description', 'cadence', 'scheduleConfig'] },
        { model: User, as: 'user', attributes: ['id', 'firstName', 'lastName'] },
      ],
    });
    const refreshedCandidates = await buildScheduledShiftCandidateMap(
      dayjs(log.taskDate).startOf('day'),
      dayjs(log.taskDate).endOf('day'),
    );
    res.status(200).json([
      {
        data: refreshed
          ? [
              formatLogWithLiveExpectedEvidenceItems(
                refreshed as AssistantManagerTaskLog & { template?: AssistantManagerTaskTemplate | null; user?: User | null },
                refreshedCandidates,
              ),
            ]
          : [],
        columns: [],
      },
    ]);
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json([{ message: error.message }]);
      return;
    }
    console.error('Failed to update assistant manager task meta', error);
    res.status(500).json([{ message: 'Failed to update task log metadata' }]);
  }
};
