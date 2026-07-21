import { Request, Response } from 'express';
import { Op } from 'sequelize';
import User from '../models/User.js';
import ShiftRole from '../models/ShiftRole.js';
import RequiredAction from '../models/RequiredAction.js';
import RequiredActionCompletion from '../models/RequiredActionCompletion.js';
import CerebroAcknowledgement from '../models/CerebroAcknowledgement.js';
import CerebroEntry from '../models/CerebroEntry.js';
import CerebroQuiz from '../models/CerebroQuiz.js';
import CerebroQuizAttempt from '../models/CerebroQuizAttempt.js';
import type { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';
import { listSwapsForUser, swapPartnerResponse } from '../services/scheduleService.js';

type UserFieldKey =
  | 'phone'
  | 'countryOfCitizenship'
  | 'dateOfBirth'
  | 'preferredPronouns'
  | 'emergencyContactName'
  | 'emergencyContactRelationship'
  | 'emergencyContactPhone'
  | 'emergencyContactEmail'
  | 'arrivalDate'
  | 'departureDate'
  | 'dietaryRestrictions'
  | 'allergies'
  | 'medicalNotes'
  | 'whatsappHandle'
  | 'facebookProfileUrl'
  | 'instagramProfileUrl';

const USER_FIELD_SPECS: Record<UserFieldKey, { label: string; inputType: 'text' | 'date' | 'email' | 'tel' | 'textarea' }> = {
  phone: { label: 'Phone number', inputType: 'tel' },
  countryOfCitizenship: { label: 'Country', inputType: 'text' },
  dateOfBirth: { label: 'Date of birth', inputType: 'date' },
  preferredPronouns: { label: 'Preferred pronouns', inputType: 'text' },
  emergencyContactName: { label: 'Emergency contact name', inputType: 'text' },
  emergencyContactRelationship: { label: 'Emergency contact relationship', inputType: 'text' },
  emergencyContactPhone: { label: 'Emergency contact phone', inputType: 'tel' },
  emergencyContactEmail: { label: 'Emergency contact email', inputType: 'email' },
  arrivalDate: { label: 'Arrival date', inputType: 'date' },
  departureDate: { label: 'Departure date', inputType: 'date' },
  dietaryRestrictions: { label: 'Dietary restrictions', inputType: 'textarea' },
  allergies: { label: 'Allergies', inputType: 'textarea' },
  medicalNotes: { label: 'Medical notes', inputType: 'textarea' },
  whatsappHandle: { label: 'WhatsApp number', inputType: 'tel' },
  facebookProfileUrl: { label: 'Facebook user', inputType: 'text' },
  instagramProfileUrl: { label: 'Instagram user', inputType: 'text' },
};

const isUserFieldKey = (value: unknown): value is UserFieldKey =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(USER_FIELD_SPECS, value);

const normalizeNumberArray = (value: unknown): number[] | null => {
  if (!Array.isArray(value)) {
    return null;
  }
  const numbers = value
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item > 0);
  return numbers.length > 0 ? Array.from(new Set(numbers)) : null;
};

const getActorId = (req: AuthenticatedRequest): number => {
  const actorId = req.authContext?.id;
  if (!actorId) {
    throw new Error('Missing authenticated user');
  }
  return actorId;
};

const normalizeRequiredActionPayload = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
};

const normalizePositiveInteger = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const hasValue = (value: unknown): boolean => {
  if (value == null) {
    return false;
  }
  if (typeof value === 'string') {
    return value.trim().length > 0;
  }
  return true;
};

const getProfileFieldKeys = (action: RequiredAction): UserFieldKey[] => {
  const payload = normalizeRequiredActionPayload(action.payload);
  const fields = Array.isArray(payload.fields) ? payload.fields : [];
  return fields.filter(isUserFieldKey);
};

const actionTargetsUser = (action: RequiredAction, user: User, shiftRoleIds: number[]): boolean => {
  const targetUserIds = normalizeNumberArray(action.targetUserIds);
  const targetUserTypeIds = normalizeNumberArray(action.targetUserTypeIds);
  const targetShiftRoleIds = normalizeNumberArray(action.targetShiftRoleIds);

  if (targetUserIds?.length && !targetUserIds.includes(user.id)) {
    return false;
  }
  if (targetUserTypeIds?.length && (!user.userTypeId || !targetUserTypeIds.includes(user.userTypeId))) {
    return false;
  }
  if (targetShiftRoleIds?.length && !targetShiftRoleIds.some((id) => shiftRoleIds.includes(id))) {
    return false;
  }
  return true;
};

const matchesAudience = (targetUserTypeIds: unknown, userTypeId: number | null | undefined): boolean => {
  const targets = normalizeNumberArray(targetUserTypeIds);
  return !targets?.length || (Boolean(userTypeId) && targets.includes(Number(userTypeId)));
};

const getPolicyAcceptedVersion = (entry: CerebroEntry): string =>
  entry.policyVersion ?? entry.updatedAt?.toISOString() ?? entry.createdAt.toISOString();

const serializeStoredAction = async (action: RequiredAction, user: User) => {
  const payload = normalizeRequiredActionPayload(action.payload);
  if (action.type === 'profile_fields') {
    const fieldKeys = getProfileFieldKeys(action);
    const missingFields = fieldKeys.filter((field) => !hasValue((user as unknown as Record<string, unknown>)[field]));
    if (missingFields.length === 0) {
      return null;
    }
    return {
      id: `required:${action.id}`,
      source: 'required_action',
      recordId: action.id,
      type: action.type,
      title: action.title,
      body: action.body,
      blocking: action.requiresCompletion,
      dueAt: action.dueAt,
      payload: {
        ...payload,
        fields: missingFields.map((field) => ({
          key: field,
          label: USER_FIELD_SPECS[field].label,
          inputType: USER_FIELD_SPECS[field].inputType,
          currentValue: (user as unknown as Record<string, unknown>)[field] ?? '',
        })),
      },
    };
  }

  if (action.type === 'policy_consent') {
    const entryId = normalizePositiveInteger(payload.cerebroEntryId);
    if (!entryId) {
      return null;
    }
    const entry = await CerebroEntry.findByPk(entryId);
    if (!entry || !entry.status || !entry.requiresAcknowledgement || !matchesAudience(entry.targetUserTypeIds, user.userTypeId)) {
      return null;
    }
    const requiredVersion = getPolicyAcceptedVersion(entry);
    const acknowledgement = await CerebroAcknowledgement.findOne({
      where: {
        entryId: entry.id,
        userId: user.id,
        versionAccepted: requiredVersion,
      },
    });
    if (acknowledgement) {
      return null;
    }

    return {
      id: `required:${action.id}`,
      source: 'required_action',
      recordId: action.id,
      type: action.type,
      title: action.title || entry.title,
      body: action.body ?? entry.summary,
      blocking: action.requiresCompletion,
      dueAt: action.dueAt,
      payload: {
        ...payload,
        cerebroEntry: {
          id: entry.id,
          title: entry.title,
          summary: entry.summary,
          body: entry.body,
          policyVersion: entry.policyVersion,
          requiredVersion,
          estimatedReadMinutes: entry.estimatedReadMinutes,
        },
      },
    };
  }

  if (action.type === 'quiz') {
    const quizId = normalizePositiveInteger(payload.cerebroQuizId);
    if (!quizId) {
      return null;
    }
    const quiz = await CerebroQuiz.findByPk(quizId);
    if (!quiz || !quiz.status || !matchesAudience(quiz.targetUserTypeIds, user.userTypeId)) {
      return null;
    }
    const passedAttempt = await CerebroQuizAttempt.findOne({
      where: {
        quizId: quiz.id,
        userId: user.id,
        passed: true,
      },
      order: [['submittedAt', 'DESC']],
    });
    if (passedAttempt) {
      return null;
    }

    return {
      id: `required:${action.id}`,
      source: 'required_action',
      recordId: action.id,
      type: action.type,
      title: action.title || quiz.title,
      body: action.body ?? quiz.description,
      blocking: action.requiresCompletion,
      dueAt: action.dueAt,
      payload: {
        ...payload,
        cerebroQuiz: {
          id: quiz.id,
          title: quiz.title,
          description: quiz.description,
          passingScore: quiz.passingScore,
          questions: Array.isArray(quiz.questions)
            ? quiz.questions.map((question) => ({
                id: question.id,
                prompt: question.prompt,
                options: question.options,
              }))
            : [],
        },
      },
    };
  }

  return {
    id: `required:${action.id}`,
    source: 'required_action',
    recordId: action.id,
    type: action.type,
    title: action.title,
    body: action.body,
    blocking: action.requiresCompletion,
    dueAt: action.dueAt,
    payload,
  };
};

const describeAssignment = (assignment: Record<string, unknown> | null | undefined) => {
  const shiftInstance = assignment?.shiftInstance as Record<string, unknown> | undefined;
  const shiftType = shiftInstance?.shiftType as Record<string, unknown> | undefined;
  return {
    date: shiftInstance?.date ?? null,
    timeStart: shiftInstance?.timeStart ?? null,
    timeEnd: shiftInstance?.timeEnd ?? null,
    shiftTypeName: shiftType?.name ?? null,
    roleInShift: assignment?.roleInShift ?? null,
  };
};

export const listMyRequiredActions = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getActorId(req as AuthenticatedRequest);
    const user = await User.findByPk(userId, {
      include: [{ model: ShiftRole, as: 'shiftRoles', attributes: ['id'], through: { attributes: [] } }],
    });
    if (!user) {
      res.status(404).json([{ message: 'User not found' }]);
      return;
    }

    const userShiftRoleIds = ((user as unknown as { shiftRoles?: ShiftRole[] }).shiftRoles ?? []).map((role) => role.id);
    const now = new Date();
    const [storedActions, completions, swaps] = await Promise.all([
      RequiredAction.findAll({
        where: {
          status: true,
          [Op.and]: [
            { [Op.or]: [{ startsAt: null }, { startsAt: { [Op.lte]: now } }] },
            { [Op.or]: [{ expiresAt: null }, { expiresAt: { [Op.gt]: now } }] },
          ],
        },
        order: [['createdAt', 'ASC']],
      }),
      RequiredActionCompletion.findAll({ where: { userId }, attributes: ['requiredActionId'] }),
      listSwapsForUser(userId),
    ]);

    const completedActionIds = new Set(completions.map((completion) => completion.requiredActionId));
    const candidateStoredActions = storedActions
      .filter((action) => action.requiresCompletion)
      .filter((action) => !completedActionIds.has(action.id))
      .filter((action) => actionTargetsUser(action, user, userShiftRoleIds));
    const actionItems = (
      await Promise.all(candidateStoredActions.map((action) => serializeStoredAction(action, user)))
    ).filter((action): action is NonNullable<typeof action> => Boolean(action));

    const swapItems = swaps
      .filter((swap) => swap.status === 'pending_partner' && swap.partnerId === userId)
      .map((swap) => ({
        id: `swap:${swap.id}`,
        source: 'schedule_swap',
        recordId: swap.id,
        type: 'schedule_swap_partner',
        title: 'Shift swap approval needed',
        body: `${swap.requester?.firstName ?? 'A teammate'} wants to swap shifts with you.`,
        blocking: true,
        dueAt: null,
        payload: {
          requester: swap.requester,
          partner: swap.partner,
          fromAssignment: describeAssignment((swap as unknown as Record<string, unknown>).fromAssignment as Record<string, unknown> | null),
          toAssignment: describeAssignment((swap as unknown as Record<string, unknown>).toAssignment as Record<string, unknown> | null),
        },
      }));

    const actions = [...swapItems, ...actionItems];
    res.status(200).json({
      actions,
      summary: {
        total: actions.length,
        blocking: actions.filter((action) => action.blocking).length,
      },
    });
  } catch (error) {
    res.status(500).json([{ message: (error as Error).message }]);
  }
};

export const createRequiredAction = async (req: Request, res: Response): Promise<void> => {
  try {
    const actorId = getActorId(req as AuthenticatedRequest);
    const type = typeof req.body?.type === 'string' ? req.body.type.trim() : '';
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    if (!type || !title) {
      res.status(400).json([{ message: 'type and title are required' }]);
      return;
    }

    const action = await RequiredAction.create({
      type,
      title,
      body: typeof req.body?.body === 'string' ? req.body.body.trim() : null,
      payload: normalizeRequiredActionPayload(req.body?.payload),
      targetUserIds: normalizeNumberArray(req.body?.targetUserIds),
      targetUserTypeIds: normalizeNumberArray(req.body?.targetUserTypeIds),
      targetShiftRoleIds: normalizeNumberArray(req.body?.targetShiftRoleIds),
      requiresCompletion: req.body?.requiresCompletion !== false,
      startsAt: req.body?.startsAt ? new Date(req.body.startsAt) : null,
      dueAt: req.body?.dueAt ? new Date(req.body.dueAt) : null,
      expiresAt: req.body?.expiresAt ? new Date(req.body.expiresAt) : null,
      status: req.body?.status !== false,
      createdBy: actorId,
      updatedBy: actorId,
    });

    res.status(201).json(action);
  } catch (error) {
    res.status(400).json([{ message: (error as Error).message }]);
  }
};

export const completeRequiredAction = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getActorId(req as AuthenticatedRequest);
    const action = await RequiredAction.findByPk(req.params.id);
    if (!action || !action.status) {
      res.status(404).json([{ message: 'Required action not found' }]);
      return;
    }

    await RequiredActionCompletion.upsert({
      requiredActionId: action.id,
      userId,
      status: 'completed',
      completedAt: new Date(),
      responseJson: normalizeRequiredActionPayload(req.body?.response),
    });

    res.status(200).json({ completed: true });
  } catch (error) {
    res.status(400).json([{ message: (error as Error).message }]);
  }
};

export const completeProfileFieldsAction = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getActorId(req as AuthenticatedRequest);
    const action = await RequiredAction.findByPk(req.params.id);
    const user = await User.findByPk(userId);
    if (!action || !action.status || action.type !== 'profile_fields') {
      res.status(404).json([{ message: 'Profile field request not found' }]);
      return;
    }
    if (!user) {
      res.status(404).json([{ message: 'User not found' }]);
      return;
    }

    const fieldKeys = getProfileFieldKeys(action);
    const values = normalizeRequiredActionPayload(req.body?.values);
    const updatePayload: Record<string, unknown> = {};
    const missingLabels: string[] = [];

    fieldKeys.forEach((field) => {
      const currentValue = (user as unknown as Record<string, unknown>)[field];
      const nextValue = values[field];
      const value = hasValue(nextValue) ? nextValue : currentValue;
      if (!hasValue(value)) {
        missingLabels.push(USER_FIELD_SPECS[field].label);
        return;
      }
      updatePayload[field] = value;
    });

    if (missingLabels.length > 0) {
      res.status(400).json([{ message: `Please fill: ${missingLabels.join(', ')}` }]);
      return;
    }

    await user.update(updatePayload);
    await RequiredActionCompletion.upsert({
      requiredActionId: action.id,
      userId,
      status: 'completed',
      completedAt: new Date(),
      responseJson: { fields: fieldKeys },
    });

    res.status(200).json({ completed: true });
  } catch (error) {
    res.status(400).json([{ message: (error as Error).message }]);
  }
};

export const respondToSwapRequiredAction = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getActorId(req as AuthenticatedRequest);
    const accept = req.body?.accept === true;
    const swap = await swapPartnerResponse(Number(req.params.id), userId, accept);
    res.status(200).json(swap);
  } catch (error) {
    res.status((error as { status?: number }).status ?? 400).json([{ message: (error as Error).message }]);
  }
};
