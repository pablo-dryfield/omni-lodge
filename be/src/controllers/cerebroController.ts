import { Response } from 'express';
import { DataType } from 'sequelize-typescript';
import type { Request } from 'express';
import Action from '../models/Action.js';
import CerebroAcknowledgement from '../models/CerebroAcknowledgement.js';
import CerebroEntry, { type CerebroEntryKind, type CerebroMediaItem } from '../models/CerebroEntry.js';
import CerebroQuiz, { type CerebroQuizQuestion } from '../models/CerebroQuiz.js';
import CerebroQuizAttempt from '../models/CerebroQuizAttempt.js';
import CerebroSection from '../models/CerebroSection.js';
import Module from '../models/Module.js';
import RoleModulePermission from '../models/RoleModulePermission.js';
import UserType from '../models/UserType.js';
import slugify from '../utils/slugify.js';
import type { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';
import type { ErrorWithMessage } from '../types/ErrorWithMessage.js';

const ENTRY_KINDS: CerebroEntryKind[] = ['faq', 'tutorial', 'playbook', 'policy'];

const buildColumns = (model: { getAttributes: () => Record<string, { type: unknown }> }) => {
  const attributes = model.getAttributes();
  return Object.entries(attributes).map(([key, attribute]) => ({
    header: key.charAt(0).toUpperCase() + key.slice(1),
    accessorKey: key,
    type: attribute.type instanceof DataType.DATE ? 'date' : 'text',
  }));
};

const parseInteger = (value: unknown, fallback = 0): number => {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
};

const parseBoolean = (value: unknown, fallback = false): boolean => {
  if (typeof value === 'boolean') {
    return value;
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
  if (typeof value === 'number') {
    return value !== 0;
  }
  return fallback;
};

const parseString = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const parseStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0);
};

const parseIdArray = (value: unknown): number[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(
    new Set(
      value
        .map((item) => Number(item))
        .filter((item): item is number => Number.isInteger(item) && item > 0),
    ),
  );
};

const parseMedia = (value: unknown): CerebroMediaItem[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return null;
      }
      const record = item as Record<string, unknown>;
      const url = parseString(record.url);
      const type = parseString(record.type);
      if (!url || (type !== 'image' && type !== 'gif')) {
        return null;
      }
      return {
        type,
        url,
        caption: parseString(record.caption),
        alt: parseString(record.alt),
      } as CerebroMediaItem;
    })
    .filter((item): item is CerebroMediaItem => Boolean(item));
};

const parseQuestions = (value: unknown): CerebroQuizQuestion[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  const questions: CerebroQuizQuestion[] = [];

  value.forEach((item, index) => {
    if (!item || typeof item !== 'object') {
      return;
    }

    const record = item as Record<string, unknown>;
    const prompt = parseString(record.prompt);
    const rawOptions = Array.isArray(record.options) ? record.options : [];
    const options: Array<{ id: string; label: string }> = [];

    rawOptions.forEach((option, optionIndex) => {
      if (!option || typeof option !== 'object') {
        return;
      }
      const optionRecord = option as Record<string, unknown>;
      const label = parseString(optionRecord.label);
      if (!label) {
        return;
      }
      const id = parseString(optionRecord.id) ?? `option-${index + 1}-${optionIndex + 1}`;
      options.push({ id, label });
    });

    const correctOptionId = parseString(record.correctOptionId);
    if (!prompt || options.length < 2 || !correctOptionId || !options.some((option) => option.id === correctOptionId)) {
      return;
    }

    questions.push({
      id: parseString(record.id) ?? `question-${index + 1}`,
      prompt,
      options,
      correctOptionId,
      explanation: parseString(record.explanation) ?? undefined,
    });
  });

  return questions;
};

const matchesAudience = (targetUserTypeIds: number[] | null | undefined, userTypeId: number | null | undefined) => {
  if (!targetUserTypeIds || targetUserTypeIds.length === 0) {
    return true;
  }
  if (!userTypeId) {
    return false;
  }
  return targetUserTypeIds.includes(userTypeId);
};

const ensureEntryPayload = (payload: Record<string, unknown>) => {
  const title = parseString(payload.title);
  if (!title) {
    throw new Error('Entry title is required.');
  }
  const sectionId = parseInteger(payload.sectionId);
  if (sectionId <= 0) {
    throw new Error('A valid section is required.');
  }
  const kindCandidate = parseString(payload.kind) ?? 'faq';
  const kind = ENTRY_KINDS.includes(kindCandidate as CerebroEntryKind)
    ? (kindCandidate as CerebroEntryKind)
    : 'faq';

  return {
    sectionId,
    slug: slugify(parseString(payload.slug) ?? title),
    title,
    category: parseString(payload.category),
    kind,
    summary: parseString(payload.summary),
    body: parseString(payload.body) ?? '',
    media: parseMedia(payload.media),
    checklistItems: parseStringArray(payload.checklistItems),
    targetUserTypeIds: parseIdArray(payload.targetUserTypeIds),
    requiresAcknowledgement: parseBoolean(payload.requiresAcknowledgement, false),
    policyVersion: parseString(payload.policyVersion),
    estimatedReadMinutes: (() => {
      const parsed = parseInteger(payload.estimatedReadMinutes, 0);
      return parsed > 0 ? parsed : null;
    })(),
    sortOrder: parseInteger(payload.sortOrder, 0),
    status: parseBoolean(payload.status, true),
  };
};

const ensureQuizPayload = (payload: Record<string, unknown>) => {
  const title = parseString(payload.title);
  if (!title) {
    throw new Error('Quiz title is required.');
  }
  const questions = parseQuestions(payload.questions);
  if (questions.length === 0) {
    throw new Error('At least one valid quiz question is required.');
  }

  return {
    entryId: parseInteger(payload.entryId, 0) || null,
    slug: slugify(parseString(payload.slug) ?? title),
    title,
    description: parseString(payload.description),
    targetUserTypeIds: parseIdArray(payload.targetUserTypeIds),
    passingScore: Math.min(100, Math.max(1, parseInteger(payload.passingScore, 80))),
    questions,
    sortOrder: parseInteger(payload.sortOrder, 0),
    status: parseBoolean(payload.status, true),
  };
};

const hasModulePermission = async (params: {
  userTypeId: number | null | undefined;
  moduleSlug: string;
  actionKey: string;
}): Promise<boolean> => {
  const { userTypeId, moduleSlug, actionKey } = params;
  if (!userTypeId) {
    return false;
  }

  const permission = await RoleModulePermission.findOne({
    where: {
      userTypeId,
      allowed: true,
      status: true,
    },
    include: [
      { model: Module, as: 'module', attributes: [], where: { slug: moduleSlug, status: true } },
      { model: Action, as: 'action', attributes: [], where: { key: actionKey } },
    ],
  });

  return Boolean(permission);
};

const serializeEntry = (entry: CerebroEntry) => ({
  id: entry.id,
  sectionId: entry.sectionId,
  slug: entry.slug,
  title: entry.title,
  category: entry.category,
  kind: entry.kind,
  summary: entry.summary,
  body: entry.body,
  media: Array.isArray(entry.media) ? entry.media : [],
  checklistItems: Array.isArray(entry.checklistItems) ? entry.checklistItems : [],
  targetUserTypeIds: Array.isArray(entry.targetUserTypeIds) ? entry.targetUserTypeIds : [],
  requiresAcknowledgement: entry.requiresAcknowledgement,
  policyVersion: entry.policyVersion,
  estimatedReadMinutes: entry.estimatedReadMinutes,
  sortOrder: entry.sortOrder,
  status: entry.status,
  createdAt: entry.createdAt,
  updatedAt: entry.updatedAt,
});

const serializeQuiz = (quiz: CerebroQuiz) => ({
  id: quiz.id,
  entryId: quiz.entryId,
  slug: quiz.slug,
  title: quiz.title,
  description: quiz.description,
  targetUserTypeIds: Array.isArray(quiz.targetUserTypeIds) ? quiz.targetUserTypeIds : [],
  passingScore: quiz.passingScore,
  questions: Array.isArray(quiz.questions) ? quiz.questions : [],
  sortOrder: quiz.sortOrder,
  status: quiz.status,
  createdAt: quiz.createdAt,
  updatedAt: quiz.updatedAt,
});

export const getCerebroSections = async (_req: Request, res: Response): Promise<void> => {
  try {
    const data = await CerebroSection.findAll({ order: [['sortOrder', 'ASC'], ['name', 'ASC']] });
    res.status(200).json([{ data, columns: buildColumns(CerebroSection) }]);
  } catch (error) {
    res.status(500).json([{ message: (error as ErrorWithMessage).message }]);
  }
};

export const getCerebroEntries = async (_req: Request, res: Response): Promise<void> => {
  try {
    const data = await CerebroEntry.findAll({ order: [['sortOrder', 'ASC'], ['title', 'ASC']] });
    res.status(200).json([{ data, columns: buildColumns(CerebroEntry) }]);
  } catch (error) {
    res.status(500).json([{ message: (error as ErrorWithMessage).message }]);
  }
};

export const getCerebroQuizzes = async (_req: Request, res: Response): Promise<void> => {
  try {
    const data = await CerebroQuiz.findAll({ order: [['sortOrder', 'ASC'], ['title', 'ASC']] });
    res.status(200).json([{ data, columns: buildColumns(CerebroQuiz) }]);
  } catch (error) {
    res.status(500).json([{ message: (error as ErrorWithMessage).message }]);
  }
};

export const getCerebroBootstrap = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.authContext?.id ?? null;
    const userTypeId = req.authContext?.userTypeId ?? null;
    const canManage = await hasModulePermission({
      userTypeId,
      moduleSlug: 'cerebro-admin',
      actionKey: 'update',
    });

    const [sections, entries, quizzes, acknowledgements, attempts, userTypes] = await Promise.all([
      CerebroSection.findAll({
        where: canManage ? undefined : { status: true },
        order: [['sortOrder', 'ASC'], ['name', 'ASC']],
      }),
      CerebroEntry.findAll({
        where: canManage ? undefined : { status: true },
        order: [['sortOrder', 'ASC'], ['title', 'ASC']],
      }),
      CerebroQuiz.findAll({
        where: canManage ? undefined : { status: true },
        order: [['sortOrder', 'ASC'], ['title', 'ASC']],
      }),
      userId ? CerebroAcknowledgement.findAll({ where: { userId }, order: [['acceptedAt', 'DESC']] }) : Promise.resolve([]),
      userId ? CerebroQuizAttempt.findAll({ where: { userId }, order: [['submittedAt', 'DESC']] }) : Promise.resolve([]),
      canManage
        ? UserType.findAll({ where: { status: true }, order: [['name', 'ASC']], attributes: ['id', 'slug', 'name'] })
        : Promise.resolve([]),
    ]);

    const filteredEntries = canManage ? entries : entries.filter((entry) => matchesAudience(entry.targetUserTypeIds, userTypeId));
    const filteredQuizzes = canManage ? quizzes : quizzes.filter((quiz) => matchesAudience(quiz.targetUserTypeIds, userTypeId));

    res.status(200).json({
      canManage,
      currentUserTypeId: userTypeId,
      sections: sections.map((section) => ({
        id: section.id,
        slug: section.slug,
        name: section.name,
        description: section.description,
        sortOrder: section.sortOrder,
        status: section.status,
      })),
      entries: filteredEntries.map(serializeEntry),
      quizzes: filteredQuizzes.map(serializeQuiz),
      acknowledgements: acknowledgements.map((acknowledgement) => ({
        id: acknowledgement.id,
        entryId: acknowledgement.entryId,
        userId: acknowledgement.userId,
        acceptedAt: acknowledgement.acceptedAt,
        versionAccepted: acknowledgement.versionAccepted,
      })),
      attempts: attempts.map((attempt) => ({
        id: attempt.id,
        quizId: attempt.quizId,
        userId: attempt.userId,
        scorePercent: Number(attempt.scorePercent),
        passed: attempt.passed,
        answers: attempt.answers,
        resultDetails: attempt.resultDetails,
        submittedAt: attempt.submittedAt,
      })),
      userTypes: userTypes.map((userType) => ({
        id: userType.id,
        slug: userType.slug,
        name: userType.name,
      })),
    });
  } catch (error) {
    res.status(500).json([{ message: (error as ErrorWithMessage).message }]);
  }
};

export const createCerebroSection = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const name = parseString(req.body?.name);
    if (!name) {
      res.status(400).json([{ message: 'Section name is required.' }]);
      return;
    }

    const section = await CerebroSection.create({
      name,
      slug: slugify(parseString(req.body?.slug) ?? name),
      description: parseString(req.body?.description),
      sortOrder: parseInteger(req.body?.sortOrder, 0),
      status: parseBoolean(req.body?.status, true),
      createdBy: req.authContext?.id ?? null,
      updatedBy: req.authContext?.id ?? null,
    });

    res.status(201).json(section);
  } catch (error) {
    res.status(500).json([{ message: (error as ErrorWithMessage).message }]);
  }
};

export const updateCerebroSection = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const section = await CerebroSection.findByPk(req.params.id);
    if (!section) {
      res.status(404).json([{ message: 'Section not found.' }]);
      return;
    }
    const name = parseString(req.body?.name);
    if (!name) {
      res.status(400).json([{ message: 'Section name is required.' }]);
      return;
    }
    await section.update({
      name,
      slug: slugify(parseString(req.body?.slug) ?? name),
      description: parseString(req.body?.description),
      sortOrder: parseInteger(req.body?.sortOrder, section.sortOrder),
      status: parseBoolean(req.body?.status, section.status),
      updatedBy: req.authContext?.id ?? null,
    });
    res.status(200).json(section);
  } catch (error) {
    res.status(500).json([{ message: (error as ErrorWithMessage).message }]);
  }
};

export const createCerebroEntry = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const payload = ensureEntryPayload(req.body ?? {});
    const section = await CerebroSection.findByPk(payload.sectionId);
    if (!section) {
      res.status(400).json([{ message: 'Selected section does not exist.' }]);
      return;
    }
    const entry = await CerebroEntry.create({
      ...payload,
      createdBy: req.authContext?.id ?? null,
      updatedBy: req.authContext?.id ?? null,
    });
    res.status(201).json(entry);
  } catch (error) {
    res.status(500).json([{ message: (error as ErrorWithMessage).message }]);
  }
};

export const updateCerebroEntry = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const entry = await CerebroEntry.findByPk(req.params.id);
    if (!entry) {
      res.status(404).json([{ message: 'Entry not found.' }]);
      return;
    }
    const payload = ensureEntryPayload(req.body ?? {});
    const section = await CerebroSection.findByPk(payload.sectionId);
    if (!section) {
      res.status(400).json([{ message: 'Selected section does not exist.' }]);
      return;
    }
    await entry.update({
      ...payload,
      updatedBy: req.authContext?.id ?? null,
    });
    res.status(200).json(entry);
  } catch (error) {
    res.status(500).json([{ message: (error as ErrorWithMessage).message }]);
  }
};

export const createCerebroQuiz = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const payload = ensureQuizPayload(req.body ?? {});
    if (payload.entryId) {
      const entry = await CerebroEntry.findByPk(payload.entryId);
      if (!entry) {
        res.status(400).json([{ message: 'Linked entry does not exist.' }]);
        return;
      }
    }
    const quiz = await CerebroQuiz.create({
      ...payload,
      createdBy: req.authContext?.id ?? null,
      updatedBy: req.authContext?.id ?? null,
    });
    res.status(201).json(quiz);
  } catch (error) {
    res.status(500).json([{ message: (error as ErrorWithMessage).message }]);
  }
};

export const updateCerebroQuiz = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const quiz = await CerebroQuiz.findByPk(req.params.id);
    if (!quiz) {
      res.status(404).json([{ message: 'Quiz not found.' }]);
      return;
    }
    const payload = ensureQuizPayload(req.body ?? {});
    if (payload.entryId) {
      const entry = await CerebroEntry.findByPk(payload.entryId);
      if (!entry) {
        res.status(400).json([{ message: 'Linked entry does not exist.' }]);
        return;
      }
    }
    await quiz.update({
      ...payload,
      updatedBy: req.authContext?.id ?? null,
    });
    res.status(200).json(quiz);
  } catch (error) {
    res.status(500).json([{ message: (error as ErrorWithMessage).message }]);
  }
};

export const acknowledgeCerebroEntry = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const entry = await CerebroEntry.findByPk(req.params.id);
    if (!entry || !entry.status) {
      res.status(404).json([{ message: 'Entry not found.' }]);
      return;
    }
    if (!entry.requiresAcknowledgement) {
      res.status(400).json([{ message: 'This entry does not require acknowledgement.' }]);
      return;
    }
    const userId = req.authContext?.id ?? null;
    const userTypeId = req.authContext?.userTypeId ?? null;
    if (!userId) {
      res.status(401).json([{ message: 'You must be logged in to acknowledge a policy.' }]);
      return;
    }
    if (!matchesAudience(entry.targetUserTypeIds, userTypeId)) {
      res.status(403).json([{ message: 'This policy is not assigned to your role.' }]);
      return;
    }
    const versionAccepted = entry.policyVersion ?? entry.updatedAt?.toISOString() ?? entry.createdAt.toISOString();
    const [acknowledgement, created] = await CerebroAcknowledgement.findOrCreate({
      where: { entryId: entry.id, userId },
      defaults: { entryId: entry.id, userId, versionAccepted, acceptedAt: new Date() },
    });
    if (!created) {
      await acknowledgement.update({ versionAccepted, acceptedAt: new Date() });
    }
    res.status(200).json({
      id: acknowledgement.id,
      entryId: acknowledgement.entryId,
      userId: acknowledgement.userId,
      acceptedAt: acknowledgement.acceptedAt,
      versionAccepted: acknowledgement.versionAccepted,
    });
  } catch (error) {
    res.status(500).json([{ message: (error as ErrorWithMessage).message }]);
  }
};

export const submitCerebroQuiz = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const quiz = await CerebroQuiz.findByPk(req.params.id);
    if (!quiz || !quiz.status) {
      res.status(404).json([{ message: 'Quiz not found.' }]);
      return;
    }
    const userId = req.authContext?.id ?? null;
    const userTypeId = req.authContext?.userTypeId ?? null;
    if (!userId) {
      res.status(401).json([{ message: 'You must be logged in to submit a quiz.' }]);
      return;
    }
    if (!matchesAudience(quiz.targetUserTypeIds, userTypeId)) {
      res.status(403).json([{ message: 'This quiz is not assigned to your role.' }]);
      return;
    }
    const answersRaw = req.body?.answers;
    const answers =
      answersRaw && typeof answersRaw === 'object' && !Array.isArray(answersRaw)
        ? Object.fromEntries(
            Object.entries(answersRaw as Record<string, unknown>)
              .map(([key, value]) => [key, parseString(value)])
              .filter((entry): entry is [string, string] => Boolean(entry[1])),
          )
        : {};
    const questions = Array.isArray(quiz.questions) ? quiz.questions : [];
    if (questions.length === 0) {
      res.status(400).json([{ message: 'This quiz does not have any configured questions.' }]);
      return;
    }
    let correctCount = 0;
    const resultDetails = questions.map((question) => {
      const selectedOptionId = answers[question.id] ?? null;
      const isCorrect = selectedOptionId === question.correctOptionId;
      if (isCorrect) {
        correctCount += 1;
      }
      return {
        questionId: question.id,
        prompt: question.prompt,
        selectedOptionId,
        correctOptionId: question.correctOptionId,
        isCorrect,
        explanation: question.explanation ?? null,
      };
    });
    const scorePercent = Number(((correctCount / questions.length) * 100).toFixed(2));
    const passed = scorePercent >= quiz.passingScore;
    const attempt = await CerebroQuizAttempt.create({
      quizId: quiz.id,
      userId,
      scorePercent,
      passed,
      answers,
      resultDetails,
      submittedAt: new Date(),
    });
    res.status(201).json({
      id: attempt.id,
      quizId: quiz.id,
      scorePercent,
      passed,
      correctCount,
      totalQuestions: questions.length,
      resultDetails,
      submittedAt: attempt.submittedAt,
    });
  } catch (error) {
    res.status(500).json([{ message: (error as ErrorWithMessage).message }]);
  }
};
