import { Request, Response } from 'express';
import { Op } from 'sequelize';
import User from '../models/User.js';
import UserType from '../models/UserType.js';
import ShiftRole from '../models/ShiftRole.js';
import StaffProfile from '../models/StaffProfile.js';
import RequiredAction from '../models/RequiredAction.js';
import RequiredActionCompletion from '../models/RequiredActionCompletion.js';
import FinanceManagementRequest from '../finance/models/FinanceManagementRequest.js';
import { applyManagementRequest } from '../finance/services/managementRequestService.js';
import { recordFinanceAuditLog } from '../finance/services/auditLogService.js';
import {
  listSwapsByStatus,
  swapManagerDecision,
} from '../services/scheduleService.js';
import type { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';
import {
  recordUserAuditLog,
  sendApprovedUserBadgeToPrint,
} from './userController.js';

const REQUEST_USER_ATTRIBUTES = [
  'id',
  'username',
  'firstName',
  'lastName',
  'email',
  'phone',
  'countryOfCitizenship',
  'dateOfBirth',
  'preferredPronouns',
  'emergencyContactName',
  'emergencyContactRelationship',
  'emergencyContactPhone',
  'emergencyContactEmail',
  'arrivalDate',
  'departureDate',
  'dietaryRestrictions',
  'allergies',
  'medicalNotes',
  'whatsappHandle',
  'facebookProfileUrl',
  'instagramProfileUrl',
  'discoverySource',
  'profilePhotoPath',
  'profilePhotoUrl',
  'badgeName',
  'badgePrefixEmoji',
  'badgeSuffixEmoji',
  'requestedUserType',
  'userTypeId',
  'status',
  'approved',
  'createdAt',
  'updatedAt',
] as const;

function getActorId(req: AuthenticatedRequest): number {
  const actorId = req.authContext?.id;
  if (!actorId) {
    throw new Error('Missing authenticated user');
  }
  return actorId;
}

const normalizeBoolean = (value: unknown, fallback = false): boolean => {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y'].includes(normalized)) {
      return true;
    }
    if (['false', '0', 'no', 'n'].includes(normalized)) {
      return false;
    }
  }
  return fallback;
};

const serializeUserApprovalRequest = (user: User) => {
  const payload = user.toJSON() as Record<string, unknown> & {
    role?: UserType | null;
    shiftRoles?: ShiftRole[];
    staffProfile?: StaffProfile | null;
  };
  return {
    ...payload,
    role: payload.role
      ? {
          id: payload.role.id,
          name: payload.role.name,
          slug: payload.role.slug,
        }
      : null,
    shiftRoles: (payload.shiftRoles ?? []).map((role) => ({
      id: role.id,
      name: role.name,
      slug: role.slug,
    })),
    staffProfile: payload.staffProfile
      ? {
          staffType: payload.staffProfile.staffType,
          livesInAccom: payload.staffProfile.livesInAccom,
          active: payload.staffProfile.active,
        }
      : null,
  };
};

const findPendingUserApprovalRequests = async (): Promise<Array<ReturnType<typeof serializeUserApprovalRequest>>> => {
  const users = await User.findAll({
    where: {
      status: true,
      approved: false,
    },
    attributes: [...REQUEST_USER_ATTRIBUTES],
    include: [
      { model: UserType, as: 'role', attributes: ['id', 'name', 'slug'] },
      { model: ShiftRole, as: 'shiftRoles', attributes: ['id', 'name', 'slug'], through: { attributes: [] } },
      { model: StaffProfile, as: 'staffProfile', attributes: ['staffType', 'livesInAccom', 'active'] },
    ],
    order: [['createdAt', 'ASC']],
  });

  return users.map((user) => serializeUserApprovalRequest(user));
};

const findOpenFinanceRequests = () =>
  FinanceManagementRequest.findAll({
    where: {
      status: {
        [Op.in]: ['open', 'returned'],
      },
    },
    order: [
      ['priority', 'DESC'],
      ['createdAt', 'ASC'],
    ],
  });

const getPayloadRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
};

const normalizeNumberArray = (value: unknown): number[] | null => {
  if (!Array.isArray(value)) {
    return null;
  }
  const numbers = value
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item > 0);
  return numbers.length > 0 ? Array.from(new Set(numbers)) : null;
};

const normalizeStringArray = (value: unknown): string[] | null => {
  if (!Array.isArray(value)) {
    return null;
  }
  const strings = value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
  return strings.length > 0 ? Array.from(new Set(strings)) : null;
};

const hasFieldValue = (value: unknown): boolean => {
  if (value == null) {
    return false;
  }
  if (typeof value === 'string') {
    return value.trim().length > 0;
  }
  return true;
};

const formatRequiredActionUserName = (user: User): string => {
  const name = [user.firstName, user.lastName]
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter(Boolean)
    .join(' ');
  return name || user.username || `User #${user.id}`;
};

const getProfileFieldKeys = (action: RequiredAction): string[] => {
  const fields = getPayloadRecord(action.payload).fields;
  return Array.isArray(fields) ? fields.filter((field): field is string => typeof field === 'string' && field.trim().length > 0) : [];
};

const userHasRequestedProfileField = (user: User, field: string): boolean => {
  if (field === 'profilePhoto') {
    return hasFieldValue(user.profilePhotoPath) || hasFieldValue(user.profilePhotoUrl);
  }
  return hasFieldValue((user as unknown as Record<string, unknown>)[field]);
};

const requiredActionTargetsUser = (action: RequiredAction, user: User): boolean => {
  const targetUserIds = normalizeNumberArray(action.targetUserIds);
  const targetUserTypeIds = normalizeNumberArray(action.targetUserTypeIds);
  const targetShiftRoleIds = normalizeNumberArray(action.targetShiftRoleIds);
  const targetStaffProfileTypes = normalizeStringArray(action.targetStaffProfileTypes);
  const userShiftRoleIds = ((user as unknown as { shiftRoles?: ShiftRole[] }).shiftRoles ?? []).map((role) => role.id);
  const staffProfile = (user as User & { staffProfile?: StaffProfile | null }).staffProfile ?? null;

  if (targetUserIds?.length && !targetUserIds.includes(user.id)) {
    return false;
  }
  if (targetUserTypeIds?.length && (!user.userTypeId || !targetUserTypeIds.includes(user.userTypeId))) {
    return false;
  }
  if (targetShiftRoleIds?.length && !targetShiftRoleIds.some((id) => userShiftRoleIds.includes(id))) {
    return false;
  }
  if (targetStaffProfileTypes?.length && (!staffProfile?.staffType || !targetStaffProfileTypes.includes(staffProfile.staffType))) {
    return false;
  }
  return true;
};

const requiredActionWasSentToUser = (
  action: RequiredAction,
  user: User,
  completion: RequiredActionCompletion | undefined,
): boolean => {
  if (!requiredActionTargetsUser(action, user)) {
    return false;
  }
  if (action.type !== 'profile_fields') {
    return true;
  }
  const fields = getProfileFieldKeys(action);
  if (fields.length === 0) {
    return false;
  }
  return Boolean(completion) || fields.some((field) => !userHasRequestedProfileField(user, field));
};

const serializePopupRequestAudits = async () => {
  const actions = await RequiredAction.findAll({
    order: [['createdAt', 'DESC']],
    limit: 50,
  });
  if (actions.length === 0) {
    return [];
  }

  const actionIds = actions.map((action) => action.id);
  const [users, completions] = await Promise.all([
    User.findAll({
      where: { status: true },
      attributes: [...REQUEST_USER_ATTRIBUTES],
      include: [
        { model: ShiftRole, as: 'shiftRoles', attributes: ['id', 'name', 'slug'], through: { attributes: [] } },
        { model: StaffProfile, as: 'staffProfile', attributes: ['staffType', 'livesInAccom', 'active'], required: false },
      ],
      order: [['firstName', 'ASC'], ['lastName', 'ASC']],
    }),
    RequiredActionCompletion.findAll({
      where: { requiredActionId: { [Op.in]: actionIds } },
    }),
  ]);

  const completionByActionUser = new Map<string, RequiredActionCompletion>();
  completions.forEach((completion) => {
    completionByActionUser.set(`${completion.requiredActionId}:${completion.userId}`, completion);
  });

  return actions.map((action) => {
    const recipients = users
      .map((user) => {
        const completion = completionByActionUser.get(`${action.id}:${user.id}`);
        if (!requiredActionWasSentToUser(action, user, completion)) {
          return null;
        }
        const status =
          completion?.status === 'completed' || completion?.status === 'dismissed'
            ? completion.status
            : completion?.promptedAt || completion?.lastPromptedAt
              ? 'prompted'
              : 'not_opened';
        return {
          userId: user.id,
          name: formatRequiredActionUserName(user),
          email: user.email,
          status,
          promptedAt: completion?.promptedAt ?? null,
          lastPromptedAt: completion?.lastPromptedAt ?? null,
          promptCount: completion?.promptCount ?? 0,
          completedAt: completion?.completedAt ?? null,
          response: completion?.responseJson ?? {},
        };
      })
      .filter((recipient): recipient is NonNullable<typeof recipient> => Boolean(recipient));

    return {
      id: action.id,
      type: action.type,
      title: action.title,
      body: action.body,
      status: action.status,
      requiresSignature: action.requiresSignature,
      createdAt: action.createdAt,
      sentCount: recipients.length,
      notOpenedCount: recipients.filter((recipient) => recipient.status === 'not_opened').length,
      promptedCount: recipients.filter((recipient) => recipient.status === 'prompted').length,
      completedCount: recipients.filter((recipient) => recipient.status === 'completed').length,
      dismissedCount: recipients.filter((recipient) => recipient.status === 'dismissed').length,
      recipients,
    };
  });
};

export const listRequests = async (_req: Request, res: Response): Promise<void> => {
  try {
    const [userApprovals, scheduleSwaps, financeRequests, popupRequests] = await Promise.all([
      findPendingUserApprovalRequests(),
      listSwapsByStatus('pending_manager'),
      findOpenFinanceRequests(),
      serializePopupRequestAudits(),
    ]);

    res.status(200).json({
      userApprovals,
      scheduleSwaps,
      financeRequests,
      popupRequests,
      summary: {
        total: userApprovals.length + scheduleSwaps.length + financeRequests.length,
        userApprovals: userApprovals.length,
        scheduleSwaps: scheduleSwaps.length,
        financeRequests: financeRequests.length,
        popupRequests: popupRequests.length,
      },
    });
  } catch (error) {
    res.status(500).json([{ message: (error as Error).message }]);
  }
};

export const approveUserRequest = async (req: Request, res: Response): Promise<void> => {
  try {
    const actorId = getActorId(req as AuthenticatedRequest);
    const user = await User.findByPk(req.params.id);
    if (!user) {
      res.status(404).json([{ message: 'User approval request not found' }]);
      return;
    }

    const userTypeId = req.body?.userTypeId != null ? Number(req.body.userTypeId) : user.userTypeId;
    if (!Number.isInteger(userTypeId) || userTypeId <= 0) {
      res.status(400).json([{ message: 'A user type is required before approving the user.' }]);
      return;
    }

    const role = await UserType.findByPk(userTypeId, { attributes: ['id', 'name', 'slug'] });
    if (!role) {
      res.status(400).json([{ message: 'Selected user type does not exist.' }]);
      return;
    }

    const previous = {
      approved: Boolean(user.approved),
      status: Boolean(user.status),
      userTypeId: user.userTypeId ?? null,
    };
    const now = new Date();

    user.userTypeId = userTypeId;
    user.approved = true;
    user.status = true;
    if (!previous.approved) {
      user.approvedAt = now;
      user.approvedBy = actorId;
    }
    if (!previous.status) {
      user.reactivatedAt = now;
      user.reactivatedBy = actorId;
    }
    user.updatedBy = actorId;
    await user.save();

    await recordUserAuditLog({
      actorId,
      action: 'user.approved',
      userId: user.id,
      meta: {
        source: 'requests_page',
        previous,
        next: {
          approved: true,
          status: true,
          userTypeId,
        },
      },
    });

    if (!previous.approved) {
      await sendApprovedUserBadgeToPrint({
        user,
        role,
        actorId,
      }).catch(async (error) => {
        await recordUserAuditLog({
          actorId,
          action: 'user.badge_print_failed',
          userId: user.id,
          meta: {
            trigger: 'requests_page_approval',
            error: error instanceof Error ? error.message : 'Unable to send badge to print',
          },
        }).catch(() => {});
      });
    }

    res.status(200).json(serializeUserApprovalRequest(user));
  } catch (error) {
    res.status(400).json([{ message: (error as Error).message }]);
  }
};

export const rejectUserRequest = async (req: Request, res: Response): Promise<void> => {
  try {
    const actorId = getActorId(req as AuthenticatedRequest);
    const user = await User.findByPk(req.params.id);
    if (!user) {
      res.status(404).json([{ message: 'User approval request not found' }]);
      return;
    }

    const previous = {
      approved: Boolean(user.approved),
      status: Boolean(user.status),
      userTypeId: user.userTypeId ?? null,
    };
    const now = new Date();
    user.approved = false;
    user.status = false;
    user.deactivatedAt = now;
    user.deactivatedBy = actorId;
    user.updatedBy = actorId;
    await user.save();

    await recordUserAuditLog({
      actorId,
      action: 'user.signup_rejected',
      userId: user.id,
      meta: {
        source: 'requests_page',
        decisionNote: typeof req.body?.decisionNote === 'string' ? req.body.decisionNote.trim() : null,
        previous,
        next: {
          approved: false,
          status: false,
          userTypeId: user.userTypeId ?? null,
        },
      },
    });

    res.status(200).json(serializeUserApprovalRequest(user));
  } catch (error) {
    res.status(400).json([{ message: (error as Error).message }]);
  }
};

export const decideScheduleSwapRequest = async (req: Request, res: Response): Promise<void> => {
  try {
    const actorId = getActorId(req as AuthenticatedRequest);
    const approve = normalizeBoolean(req.body?.approve, false);
    const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;
    const swap = await swapManagerDecision(Number(req.params.id), actorId, approve, reason);
    res.status(200).json(swap);
  } catch (error) {
    res.status((error as { status?: number }).status ?? 400).json([{ message: (error as Error).message }]);
  }
};

export const decideFinanceRequest = async (req: Request, res: Response): Promise<void> => {
  try {
    const actorId = getActorId(req as AuthenticatedRequest);
    const action = req.params.action;
    const request = await FinanceManagementRequest.findByPk(req.params.id);
    if (!request) {
      res.status(404).json([{ message: 'Management request not found' }]);
      return;
    }

    if (action === 'approve') {
      if (request.status !== 'open' && request.status !== 'returned') {
        res.status(400).json([{ message: 'Request already processed' }]);
        return;
      }
      await applyManagementRequest(request, actorId);
      request.status = 'approved';
    } else if (action === 'return') {
      request.status = 'returned';
    } else if (action === 'reject') {
      request.status = 'rejected';
    } else {
      res.status(400).json([{ message: 'Unsupported request action' }]);
      return;
    }

    request.managerId = actorId;
    request.decisionNote = req.body?.decisionNote ?? null;
    await request.save();

    await recordFinanceAuditLog({
      entity: 'finance_management_request',
      entityId: request.id,
      action: action === 'approve' ? 'approved' : action === 'return' ? 'returned' : 'rejected',
      performedBy: actorId,
      metadata: {
        decisionNote: request.decisionNote,
        source: 'requests_page',
      },
    });

    res.status(200).json(request);
  } catch (error) {
    res.status(400).json([{ message: (error as Error).message }]);
  }
};
