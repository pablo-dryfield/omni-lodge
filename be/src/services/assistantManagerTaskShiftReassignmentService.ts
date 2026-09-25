import { Op, type Transaction } from 'sequelize';
import AuditLog from '../models/AuditLog.js';
import AssistantManagerTaskLog from '../models/AssistantManagerTaskLog.js';
import type ShiftAssignment from '../models/ShiftAssignment.js';
import {
  applyManagerTaskOverride,
  buildAssistantManagerTaskGenerationSourceKey,
} from './assistantManagerTaskLogManagementService.js';

type ShiftAssignmentLike = Pick<
  ShiftAssignment,
  'id' | 'userId' | 'shiftInstanceId' | 'roleInShift'
> & {
  shiftRole?: { slug?: string | null; name?: string | null } | null;
  shiftInstance?: { date?: string | null } | null;
};

export type ManagerShiftTaskReassignmentInput = {
  assignment: ShiftAssignmentLike;
  fromUserId: number;
  toUserId: number;
  actorId: number | null;
  requestId: number | null;
};

export type ManagerShiftTaskReassignmentResult = {
  scannedCount: number;
  reassignedCount: number;
  skippedDuplicateCount: number;
};

const normalizeRoleIdentifier = (value: string | null | undefined): string =>
  (value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');

const isManagerShiftAssignment = (assignment: ShiftAssignmentLike): boolean => {
  const candidates = [
    assignment.shiftRole?.slug,
    assignment.shiftRole?.name,
    assignment.roleInShift,
  ];
  return candidates.some((candidate) => normalizeRoleIdentifier(candidate).includes('manager'));
};

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0;

const numberFromMeta = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === 'string' && /^\d+$/u.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
};

const normalizeTaskDate = (value: string | null | undefined): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const date = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/u.test(date) ? date : null;
};

const taskLogBelongsToShiftAssignment = (
  log: Pick<AssistantManagerTaskLog, 'meta'>,
  assignment: ShiftAssignmentLike,
): boolean => {
  const meta = log.meta ?? {};
  const metaAssignmentId = numberFromMeta(meta.shiftAssignmentId);
  if (metaAssignmentId != null) {
    return metaAssignmentId === assignment.id;
  }

  // Older generated task logs may only know the physical shift instance.
  // Only use this fallback when the precise assignment key is absent.
  return numberFromMeta(meta.shiftInstanceId) === assignment.shiftInstanceId;
};

export const reassignAssistantManagerTasksForManagerShiftOwnerChange = async (
  input: ManagerShiftTaskReassignmentInput,
  transaction: Transaction,
): Promise<ManagerShiftTaskReassignmentResult> => {
  const emptyResult: ManagerShiftTaskReassignmentResult = {
    scannedCount: 0,
    reassignedCount: 0,
    skippedDuplicateCount: 0,
  };
  const taskDate = normalizeTaskDate(input.assignment.shiftInstance?.date);
  if (
    !taskDate ||
    !isPositiveInteger(input.fromUserId) ||
    !isPositiveInteger(input.toUserId) ||
    input.fromUserId === input.toUserId ||
    !isManagerShiftAssignment(input.assignment)
  ) {
    return emptyResult;
  }

  const sourceLogs = await AssistantManagerTaskLog.findAll({
    where: {
      userId: input.fromUserId,
      taskDate,
      status: { [Op.in]: ['pending', 'missed'] },
    },
    transaction,
    lock: transaction.LOCK.UPDATE,
    order: [['id', 'ASC']],
  });
  const shiftLogs = sourceLogs.filter((log) => taskLogBelongsToShiftAssignment(log, input.assignment));
  if (shiftLogs.length === 0) {
    return { ...emptyResult, scannedCount: sourceLogs.length };
  }

  const targetLogs = await AssistantManagerTaskLog.findAll({
    where: {
      userId: input.toUserId,
      taskDate,
      templateId: { [Op.in]: Array.from(new Set(shiftLogs.map((log) => log.templateId))) },
    },
    transaction,
    lock: transaction.LOCK.UPDATE,
    attributes: ['id', 'templateId'],
  });
  const targetTemplateIds = new Set(targetLogs.map((log) => log.templateId));

  let reassignedCount = 0;
  let skippedDuplicateCount = 0;
  for (const log of shiftLogs) {
    if (targetTemplateIds.has(log.templateId)) {
      skippedDuplicateCount += 1;
      await AuditLog.create({
        actorId: input.actorId,
        action: 'assistant-manager-task.shift-swap-reassignment-skipped',
        entity: 'am_task_log',
        entityId: String(log.id),
        meta: {
          reason: 'target_task_already_exists',
          requestId: input.requestId,
          taskDate,
          templateId: log.templateId,
          fromUserId: input.fromUserId,
          toUserId: input.toUserId,
          shiftAssignmentId: input.assignment.id,
          shiftInstanceId: input.assignment.shiftInstanceId,
        },
      }, { transaction });
      continue;
    }

    const originalGenerationSourceKey = buildAssistantManagerTaskGenerationSourceKey(
      log.templateId,
      input.fromUserId,
      taskDate,
    );
    const reassignedAt = new Date().toISOString();
    const nextMeta = applyManagerTaskOverride(
      {
        ...(log.meta ?? {}),
        shiftAssignmentId: input.assignment.id,
        shiftInstanceId: input.assignment.shiftInstanceId,
        scheduleSwapReassignment: {
          requestId: input.requestId,
          taskDate,
          fromUserId: input.fromUserId,
          toUserId: input.toUserId,
          shiftAssignmentId: input.assignment.id,
          shiftInstanceId: input.assignment.shiftInstanceId,
          reassignedAt,
          reason: 'manager_shift_owner_changed',
        },
      },
      originalGenerationSourceKey,
      input.actorId,
      reassignedAt,
    );
    await log.update({
      userId: input.toUserId,
      meta: nextMeta,
      updatedBy: input.actorId,
    }, { transaction });
    reassignedCount += 1;
    targetTemplateIds.add(log.templateId);

    await AuditLog.create({
      actorId: input.actorId,
      action: 'assistant-manager-task.shift-swap-reassigned',
      entity: 'am_task_log',
      entityId: String(log.id),
      meta: {
        requestId: input.requestId,
        taskDate,
        templateId: log.templateId,
        fromUserId: input.fromUserId,
        toUserId: input.toUserId,
        shiftAssignmentId: input.assignment.id,
        shiftInstanceId: input.assignment.shiftInstanceId,
      },
    }, { transaction });
  }

  return {
    scannedCount: sourceLogs.length,
    reassignedCount,
    skippedDuplicateCount,
  };
};
