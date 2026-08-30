import type { Response } from 'express';
import { Op, type WhereOptions } from 'sequelize';
import sequelize from '../../config/database.js';
import HttpError from '../../errors/HttpError.js';
import CompensationComponent from '../../models/CompensationComponent.js';
import CompensationSettlementRule from '../../models/CompensationSettlementRule.js';
import User from '../../models/User.js';
import type { AuthenticatedRequest } from '../../types/AuthenticatedRequest.js';
import VolunteerFund from '../models/VolunteerFund.js';
import {
  createSettlementRule,
  deactivateSettlementRule,
  updateSettlementRule,
} from '../services/compensationSettlementRuleService.js';

const requireActorId = (req: AuthenticatedRequest): number => {
  const actorId = req.authContext?.id;
  if (!actorId) {
    throw new HttpError(401, 'Unauthorized');
  }
  return actorId;
};

const parseId = (value: unknown, field = 'id'): number => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new HttpError(400, `${field} must be a positive integer.`);
  }
  return parsed;
};

const handleError = (res: Response, error: unknown): void => {
  if (error instanceof HttpError) {
    res.status(error.status).json([{ message: error.message }]);
    return;
  }
  const code = (error as { original?: { code?: string }; parent?: { code?: string } })?.original?.code
    ?? (error as { parent?: { code?: string } })?.parent?.code;
  if (code === '23505') {
    res.status(409).json([{ message: 'A matching active settlement rule already exists.' }]);
    return;
  }
  console.error('Settlement rule request failed', error);
  res.status(500).json([{ message: 'Unable to process settlement rule request.' }]);
};

const ruleIncludes = [
  { model: User, as: 'targetUser', attributes: ['id', 'firstName', 'lastName'] },
  { model: CompensationComponent, as: 'component', attributes: ['id', 'name', 'slug', 'category'] },
  { model: VolunteerFund, as: 'fund', attributes: ['id', 'name', 'slug', 'currency', 'isActive'] },
];

export const listSettlementRules = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const where: WhereOptions = {};
    if (req.query.active !== undefined) {
      const normalized = String(req.query.active).trim().toLowerCase();
      if (normalized !== 'true' && normalized !== 'false') {
        throw new HttpError(400, 'active must be true or false.');
      }
      where.isActive = normalized === 'true';
    }
    if (req.query.targetScope) {
      where.targetScope = String(req.query.targetScope).trim();
    }
    if (req.query.staffType) {
      where.staffType = String(req.query.staffType).trim().toLowerCase();
    }
    if (req.query.userId) {
      where.userId = parseId(req.query.userId, 'userId');
    }
    if (req.query.matchKind) {
      where.matchKind = String(req.query.matchKind).trim();
    }
    if (req.query.destination) {
      where.destination = String(req.query.destination).trim();
    }
    if (req.query.effectiveOn) {
      const effectiveOn = String(req.query.effectiveOn).trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveOn)) {
        throw new HttpError(400, 'effectiveOn must use YYYY-MM-DD.');
      }
      where[Op.and as unknown as keyof WhereOptions] = [
        { [Op.or]: [{ effectiveStart: null }, { effectiveStart: { [Op.lte]: effectiveOn } }] },
        { [Op.or]: [{ effectiveEnd: null }, { effectiveEnd: { [Op.gte]: effectiveOn } }] },
      ] as never;
    }

    const rules = await CompensationSettlementRule.findAll({
      where,
      include: ruleIncludes,
      order: [
        ['targetScope', 'ASC'],
        ['staffType', 'ASC'],
        ['userId', 'ASC'],
        ['matchKind', 'ASC'],
        ['matchKey', 'ASC'],
        ['effectiveStart', 'ASC'],
        ['id', 'ASC'],
      ],
    });
    res.status(200).json(rules);
  } catch (error) {
    handleError(res, error);
  }
};

export const getSettlementRule = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = parseId(req.params.id);
    const rule = await CompensationSettlementRule.findByPk(id, { include: ruleIncludes });
    if (!rule) {
      throw new HttpError(404, 'Settlement rule not found.');
    }
    res.status(200).json(rule);
  } catch (error) {
    handleError(res, error);
  }
};

export const createSettlementRuleHandler = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const created = await createSettlementRule(req.body ?? {}, requireActorId(req));
    const hydrated = await CompensationSettlementRule.findByPk(created.id, { include: ruleIncludes });
    res.status(201).json(hydrated ?? created);
  } catch (error) {
    handleError(res, error);
  }
};

export const updateSettlementRuleHandler = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const id = parseId(req.params.id);
    const updated = await updateSettlementRule(id, req.body ?? {}, requireActorId(req));
    const hydrated = await CompensationSettlementRule.findByPk(updated.id, { include: ruleIncludes });
    res.status(200).json(hydrated ?? updated);
  } catch (error) {
    handleError(res, error);
  }
};

export const bulkUpdateSettlementRules = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const actorId = requireActorId(req);
    if (!Array.isArray(req.body?.ruleIds)) {
      throw new HttpError(400, 'ruleIds must be an array.');
    }
    const rawRuleIds = req.body.ruleIds as unknown[];
    const ruleIds: number[] = Array.from(
      new Set<number>(rawRuleIds.map((value) => parseId(value, 'ruleId'))),
    );
    if (ruleIds.length === 0 || ruleIds.length > 200) {
      throw new HttpError(400, 'Select between 1 and 200 settlement rules.');
    }
    if (!req.body.changes || typeof req.body.changes !== 'object' || Array.isArray(req.body.changes)) {
      throw new HttpError(400, 'changes must be an object.');
    }
    const changes = req.body.changes as Record<string, unknown>;
    const updatedIds = await sequelize.transaction(async (transaction) => {
      const ids: number[] = [];
      for (const id of ruleIds) {
        const updated = await updateSettlementRule(id, changes, actorId, transaction);
        ids.push(updated.id);
      }
      return ids;
    });
    const rules = await CompensationSettlementRule.findAll({
      where: { id: { [Op.in]: updatedIds } },
      include: ruleIncludes,
      order: [['id', 'ASC']],
    });
    res.status(200).json(rules);
  } catch (error) {
    handleError(res, error);
  }
};

export const deleteSettlementRuleHandler = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const rule = await deactivateSettlementRule(parseId(req.params.id), requireActorId(req));
    res.status(200).json(rule);
  } catch (error) {
    handleError(res, error);
  }
};
