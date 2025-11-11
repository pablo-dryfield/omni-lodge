import { Op, WhereOptions } from 'sequelize';
import type { Request, Response } from 'express';
import dayjs from 'dayjs';
import CompensationComponent from '../models/CompensationComponent.js';
import CompensationComponentAssignment, { type CompensationTargetScope } from '../models/CompensationComponentAssignment.js';
import User from '../models/User.js';
import ShiftRole from '../models/ShiftRole.js';
import UserType from '../models/UserType.js';
import { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';

const CATEGORY_VALUES = new Set(['base', 'commission', 'incentive', 'bonus', 'review', 'deduction', 'adjustment']);
const CALCULATION_METHOD_VALUES = new Set(['flat', 'per_unit', 'tiered', 'percentage', 'task_score', 'hybrid']);
const TARGET_SCOPE_VALUES = new Set(['global', 'shift_role', 'user', 'user_type', 'staff_type']);

const slugify = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

const toNumber = (value: unknown, precision = 2): number => {
  if (value == null) {
    return 0;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  const factor = 10 ** precision;
  return Math.round(numeric * factor) / factor;
};

const normalizeCurrency = (value?: string | null) => {
  if (!value) {
    return 'PLN';
  }
  const trimmed = value.trim().toUpperCase();
  return trimmed.length === 3 ? trimmed : 'PLN';
};

const normalizeTaskList = (payload: unknown): Array<Record<string, unknown>> => {
  if (!payload) {
    return [];
  }
  if (Array.isArray(payload)) {
    return payload
      .map((item) => (item && typeof item === 'object' ? item : null))
      .filter((item): item is Record<string, unknown> => Boolean(item));
  }
  return [];
};

const sanitizeComponentPayload = (body: Record<string, unknown>) => {
  const next: Partial<CompensationComponent> = {};

  if (typeof body.name === 'string') {
    next.name = body.name.trim();
  }
  if (typeof body.slug === 'string' && body.slug.trim().length > 0) {
    next.slug = slugify(body.slug);
  } else if (next.name) {
    next.slug = slugify(next.name);
  }
  if (typeof body.category === 'string' && CATEGORY_VALUES.has(body.category.trim())) {
    next.category = body.category.trim() as CompensationComponent['category'];
  }
  if (typeof body.calculationMethod === 'string' && CALCULATION_METHOD_VALUES.has(body.calculationMethod.trim())) {
    next.calculationMethod = body.calculationMethod.trim() as CompensationComponent['calculationMethod'];
  }
  if (typeof body.description === 'string') {
    next.description = body.description.trim();
  } else if (body.description === null) {
    next.description = null;
  }
  if (body.config && typeof body.config === 'object') {
    next.config = body.config as Record<string, unknown>;
  }
  if (body.isActive != null) {
    next.isActive = Boolean(body.isActive);
  }
  if (body.currencyCode != null && typeof body.currencyCode === 'string') {
    next.currencyCode = normalizeCurrency(body.currencyCode);
  }
  return next;
};

const sanitizeAssignmentPayload = (body: Record<string, unknown>) => {
  const next: Partial<CompensationComponentAssignment> & {
    targetScope?: CompensationTargetScope;
    shiftRoleId?: number | null;
    userId?: number | null;
    userTypeId?: number | null;
    staffType?: string | null;
  } = {};

  if (typeof body.targetScope === 'string' && TARGET_SCOPE_VALUES.has(body.targetScope.trim())) {
    next.targetScope = body.targetScope.trim() as CompensationTargetScope;
  }
  if (body.shiftRoleId != null) {
    const numeric = Number(body.shiftRoleId);
    next.shiftRoleId = Number.isFinite(numeric) ? numeric : undefined;
  }
  if (body.userId != null) {
    const numeric = Number(body.userId);
    next.userId = Number.isFinite(numeric) ? numeric : undefined;
  }
  if (body.userTypeId != null) {
    const numeric = Number(body.userTypeId);
    next.userTypeId = Number.isFinite(numeric) ? numeric : undefined;
  }
  if (typeof body.staffType === 'string') {
    next.staffType = body.staffType.trim() || null;
  } else if (body.staffType === null) {
    next.staffType = null;
  }
  if (body.currencyCode != null && typeof body.currencyCode === 'string') {
    next.currencyCode = normalizeCurrency(body.currencyCode);
  }
  if (body.baseAmount != null) {
    next.baseAmount = toNumber(body.baseAmount, 2);
  }
  if (body.unitAmount != null) {
    next.unitAmount = toNumber(body.unitAmount, 4);
  }
  if (typeof body.unitLabel === 'string') {
    next.unitLabel = body.unitLabel.trim() || null;
  } else if (body.unitLabel === null) {
    next.unitLabel = null;
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
  if (body.taskList != null) {
    next.taskList = normalizeTaskList(body.taskList);
  }
  if (body.config && typeof body.config === 'object') {
    next.config = body.config as Record<string, unknown>;
  }
  if (body.isActive != null) {
    next.isActive = Boolean(body.isActive);
  }
  return next;
};

const formatAssignment = (
  assignment: CompensationComponentAssignment & {
    user?: User | null;
    shiftRole?: ShiftRole | null;
    userType?: UserType | null;
  },
) => ({
  id: assignment.id,
  componentId: assignment.componentId,
  targetScope: assignment.targetScope,
  shiftRoleId: assignment.shiftRoleId,
  shiftRoleName: assignment.shiftRole?.name ?? null,
  userId: assignment.userId,
  userName: assignment.user ? `${assignment.user.firstName ?? ''} ${assignment.user.lastName ?? ''}`.trim() || null : null,
  userTypeId: assignment.userTypeId,
  userTypeName: assignment.userType?.name ?? null,
  staffType: assignment.staffType ?? null,
  effectiveStart: assignment.effectiveStart,
  effectiveEnd: assignment.effectiveEnd,
  baseAmount: Number(assignment.baseAmount ?? 0),
  unitAmount: Number(assignment.unitAmount ?? 0),
  unitLabel: assignment.unitLabel ?? null,
  currencyCode: assignment.currencyCode,
  taskList: assignment.taskList ?? [],
  config: assignment.config ?? {},
  isActive: assignment.isActive ?? true,
  createdAt: assignment.createdAt?.toISOString() ?? null,
  updatedAt: assignment.updatedAt?.toISOString() ?? null,
});

const formatComponent = (
  component: CompensationComponent & {
    assignments?: CompensationComponentAssignment[];
  },
) => ({
  id: component.id,
  name: component.name,
  slug: component.slug,
  category: component.category,
  calculationMethod: component.calculationMethod,
  description: component.description ?? null,
  config: component.config ?? {},
  currencyCode: component.currencyCode,
  isActive: component.isActive ?? true,
  createdAt: component.createdAt?.toISOString() ?? null,
  updatedAt: component.updatedAt?.toISOString() ?? null,
  assignments: component.assignments
    ? component.assignments.map((assignment) =>
        formatAssignment(assignment as CompensationComponentAssignment & {
          user?: User | null;
          shiftRole?: ShiftRole | null;
          userType?: UserType | null;
        }),
      )
    : [],
});

const applyComponentFilters = (req: Request): WhereOptions => {
  const where: WhereOptions = {};
  if (typeof req.query.category === 'string' && CATEGORY_VALUES.has(req.query.category.trim())) {
    where.category = req.query.category.trim();
  }
  if (typeof req.query.isActive === 'string') {
    const normalized = req.query.isActive.trim().toLowerCase();
    if (normalized === 'true' || normalized === 'false') {
      where.isActive = normalized === 'true';
    }
  }
  if (typeof req.query.search === 'string' && req.query.search.trim().length > 0) {
    const value = `%${req.query.search.trim()}%`;
    (where as Record<PropertyKey, unknown>)[Op.or as unknown as PropertyKey] = [
      { name: { [Op.iLike]: value } },
      { slug: { [Op.iLike]: value } },
      { description: { [Op.iLike]: value } },
    ];
  }
  return where;
};

const getActorId = (req: AuthenticatedRequest) => req.authContext?.id ?? null;

const ensureComponentExists = async (id: number) => {
  const component = await CompensationComponent.findByPk(id);
  if (!component) {
    throw new Error('COMPONENT_NOT_FOUND');
  }
  return component;
};

const ensureAssignmentExists = async (componentId: number, assignmentId: number) => {
  const assignment = await CompensationComponentAssignment.findOne({ where: { id: assignmentId, componentId } });
  if (!assignment) {
    throw new Error('ASSIGNMENT_NOT_FOUND');
  }
  return assignment;
};

export const listCompensationComponents = async (req: Request, res: Response): Promise<void> => {
  try {
    const where = applyComponentFilters(req);
    const includeAssignments = req.query.includeAssignments !== 'false';

    const components = await CompensationComponent.findAll({
      where,
      include: includeAssignments
        ? [
            {
              model: CompensationComponentAssignment,
              as: 'assignments',
              include: [
                { model: User, as: 'user', attributes: ['id', 'firstName', 'lastName'] },
                { model: ShiftRole, as: 'shiftRole', attributes: ['id', 'name'] },
                { model: UserType, as: 'userType', attributes: ['id', 'name'] },
              ],
            },
          ]
        : [],
      order: [
        ['category', 'ASC'],
        ['name', 'ASC'],
      ],
    });

    res.status(200).json([
      {
        data: components.map((component) =>
          formatComponent(component as CompensationComponent & { assignments?: CompensationComponentAssignment[] }),
        ),
        columns: [],
      },
    ]);
  } catch (error) {
    console.error('Failed to list compensation components', error);
    res.status(500).json([{ message: 'Failed to list compensation components' }]);
  }
};

export const createCompensationComponent = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const actorId = getActorId(req);
    const payload = sanitizeComponentPayload(req.body ?? {});
    if (!payload.name || !payload.slug) {
      res.status(400).json([{ message: 'Name (and slug) are required' }]);
      return;
    }
    if (!payload.category || !CATEGORY_VALUES.has(payload.category)) {
      res.status(400).json([{ message: 'Invalid category provided' }]);
      return;
    }
    if (!payload.calculationMethod || !CALCULATION_METHOD_VALUES.has(payload.calculationMethod)) {
      res.status(400).json([{ message: 'Invalid calculationMethod provided' }]);
      return;
    }
    payload.createdBy = actorId;
    payload.updatedBy = actorId;

    const created = await CompensationComponent.create(payload);
    const refreshed = await CompensationComponent.findByPk(created.id, {
      include: [{ model: CompensationComponentAssignment, as: 'assignments' }],
    });
    res.status(201).json([
      {
        data: refreshed ? [formatComponent(refreshed as CompensationComponent & { assignments?: CompensationComponentAssignment[] })] : [],
      },
    ]);
  } catch (error) {
    console.error('Failed to create compensation component', error);
    res.status(500).json([{ message: 'Failed to create compensation component' }]);
  }
};

export const updateCompensationComponent = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json([{ message: 'Invalid component id' }]);
      return;
    }
    const actorId = getActorId(req);
    const payload = sanitizeComponentPayload(req.body ?? {});
    payload.updatedBy = actorId;

    const [updated] = await CompensationComponent.update(payload, { where: { id } });
    if (!updated) {
      res.status(404).json([{ message: 'Compensation component not found' }]);
      return;
    }

    const refreshed = await CompensationComponent.findByPk(id, {
      include: [{ model: CompensationComponentAssignment, as: 'assignments' }],
    });
    res.status(200).json([
      {
        data: refreshed ? [formatComponent(refreshed as CompensationComponent & { assignments?: CompensationComponentAssignment[] })] : [],
      },
    ]);
  } catch (error) {
    console.error('Failed to update compensation component', error);
    res.status(500).json([{ message: 'Failed to update compensation component' }]);
  }
};

export const deleteCompensationComponent = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json([{ message: 'Invalid component id' }]);
      return;
    }
    const deleted = await CompensationComponent.destroy({ where: { id } });
    if (!deleted) {
      res.status(404).json([{ message: 'Compensation component not found' }]);
      return;
    }
    res.status(204).send();
  } catch (error) {
    console.error('Failed to delete compensation component', error);
    res.status(500).json([{ message: 'Failed to delete compensation component' }]);
  }
};

export const listCompensationComponentAssignments = async (req: Request, res: Response): Promise<void> => {
  try {
    const componentId = Number(req.params.id);
    if (!Number.isInteger(componentId) || componentId <= 0) {
      res.status(400).json([{ message: 'Invalid component id' }]);
      return;
    }
    await ensureComponentExists(componentId);

    const assignments = await CompensationComponentAssignment.findAll({
      where: { componentId },
      include: [
        { model: User, as: 'user', attributes: ['id', 'firstName', 'lastName'] },
        { model: ShiftRole, as: 'shiftRole', attributes: ['id', 'name'] },
        { model: UserType, as: 'userType', attributes: ['id', 'name'] },
      ],
      order: [
        ['targetScope', 'ASC'],
        ['createdAt', 'DESC'],
      ],
    });

    res.status(200).json([{ data: assignments.map((assignment) => formatAssignment(assignment as CompensationComponentAssignment & { user?: User | null; shiftRole?: ShiftRole | null; userType?: UserType | null })), columns: [] }]);
  } catch (error) {
    if ((error as Error).message === 'COMPONENT_NOT_FOUND') {
      res.status(404).json([{ message: 'Compensation component not found' }]);
      return;
    }
    console.error('Failed to list compensation assignments', error);
    res.status(500).json([{ message: 'Failed to list compensation assignments' }]);
  }
};

const validateAssignmentTargets = async (
  componentId: number,
  payload: Partial<CompensationComponentAssignment> & {
    targetScope?: CompensationTargetScope;
  },
) => {
  const scope = (payload.targetScope ?? 'global') as CompensationTargetScope;
  if (!TARGET_SCOPE_VALUES.has(scope)) {
    throw new Error('INVALID_TARGET_SCOPE');
  }
  if (scope === 'shift_role') {
    if (!payload.shiftRoleId) {
      throw new Error('SHIFT_ROLE_REQUIRED');
    }
    const shiftRole = await ShiftRole.findByPk(payload.shiftRoleId);
    if (!shiftRole) {
      throw new Error('SHIFT_ROLE_NOT_FOUND');
    }
  } else if (scope === 'user') {
    if (!payload.userId) {
      throw new Error('USER_REQUIRED');
    }
    const user = await User.findByPk(payload.userId);
    if (!user) {
      throw new Error('USER_NOT_FOUND');
    }
  } else if (scope === 'user_type') {
    if (!payload.userTypeId) {
      throw new Error('USER_TYPE_REQUIRED');
    }
    const userType = await UserType.findByPk(payload.userTypeId);
    if (!userType) {
      throw new Error('USER_TYPE_NOT_FOUND');
    }
  } else if (scope === 'staff_type') {
    if (!payload.staffType) {
      throw new Error('STAFF_TYPE_REQUIRED');
    }
  }

  if (payload.effectiveStart && payload.effectiveEnd) {
    const start = dayjs(payload.effectiveStart);
    const end = dayjs(payload.effectiveEnd);
    if (start.isValid() && end.isValid() && end.isBefore(start)) {
      throw new Error('INVALID_DATE_RANGE');
    }
  }

  const overlapWhere: WhereOptions = { componentId, targetScope: scope };
  if (scope === 'shift_role') {
    overlapWhere.shiftRoleId = payload.shiftRoleId ?? null;
  } else if (scope === 'user') {
    overlapWhere.userId = payload.userId ?? null;
  } else if (scope === 'user_type') {
    overlapWhere.userTypeId = payload.userTypeId ?? null;
  } else if (scope === 'staff_type') {
    overlapWhere.staffType = payload.staffType ?? null;
  }
  return overlapWhere;
};

export const createCompensationComponentAssignment = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const componentId = Number(req.params.id);
    if (!Number.isInteger(componentId) || componentId <= 0) {
      res.status(400).json([{ message: 'Invalid component id' }]);
      return;
    }
    await ensureComponentExists(componentId);
    const actorId = getActorId(req);
    const payload = sanitizeAssignmentPayload(req.body ?? {});
    payload.targetScope = (payload.targetScope ?? 'global') as CompensationTargetScope;
    payload.componentId = componentId;
    payload.createdBy = actorId;
    payload.updatedBy = actorId;

    const overlapWhere = await validateAssignmentTargets(componentId, payload);
    payload.currencyCode = payload.currencyCode ? normalizeCurrency(payload.currencyCode) : 'PLN';

    const existing = await CompensationComponentAssignment.findAll({
      where: overlapWhere,
    });
    if (existing.length > 0) {
      const hasOverlap = existing.some((assignment) => {
        const startA = assignment.effectiveStart ? dayjs(assignment.effectiveStart) : null;
        const endA = assignment.effectiveEnd ? dayjs(assignment.effectiveEnd) : null;
        const startB = payload.effectiveStart ? dayjs(payload.effectiveStart) : null;
        const endB = payload.effectiveEnd ? dayjs(payload.effectiveEnd) : null;
        if (!startA && !endA) {
          return true;
        }
        if (!startB && !endB) {
          return true;
        }
        const startOverlap = !startA || !endB || !startA.isAfter(endB);
        const endOverlap = !endA || !startB || !endA.isBefore(startB);
        return startOverlap && endOverlap;
      });
      if (hasOverlap) {
        res.status(409).json([{ message: 'Overlapping assignment exists for this target' }]);
        return;
      }
    }

    const created = await CompensationComponentAssignment.create(payload);
    const formatted = await CompensationComponentAssignment.findByPk(created.id, {
      include: [
        { model: User, as: 'user', attributes: ['id', 'firstName', 'lastName'] },
        { model: ShiftRole, as: 'shiftRole', attributes: ['id', 'name'] },
        { model: UserType, as: 'userType', attributes: ['id', 'name'] },
      ],
    });
    res.status(201).json([{ data: formatted ? [formatAssignment(formatted as CompensationComponentAssignment & { user?: User | null; shiftRole?: ShiftRole | null; userType?: UserType | null })] : [] }]);
  } catch (error) {
    if ((error as Error).message === 'COMPONENT_NOT_FOUND') {
      res.status(404).json([{ message: 'Compensation component not found' }]);
      return;
    }
    const messageMap: Record<string, string> = {
      INVALID_TARGET_SCOPE: 'Invalid target scope',
      SHIFT_ROLE_REQUIRED: 'shiftRoleId is required for shift_role scope',
      USER_REQUIRED: 'userId is required for user scope',
      USER_TYPE_REQUIRED: 'userTypeId is required for user_type scope',
      STAFF_TYPE_REQUIRED: 'staffType is required for staff_type scope',
      SHIFT_ROLE_NOT_FOUND: 'Shift role not found',
      USER_NOT_FOUND: 'User not found',
      USER_TYPE_NOT_FOUND: 'User type not found',
      INVALID_DATE_RANGE: 'effectiveEnd must be on or after effectiveStart',
    };
    const code = (error as Error).message;
    if (code in messageMap) {
      res.status(400).json([{ message: messageMap[code] }]);
      return;
    }
    console.error('Failed to create compensation assignment', error);
    res.status(500).json([{ message: 'Failed to create assignment' }]);
  }
};

export const updateCompensationComponentAssignment = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const componentId = Number(req.params.id);
    const assignmentId = Number(req.params.assignmentId);
    if (!Number.isInteger(componentId) || componentId <= 0 || !Number.isInteger(assignmentId) || assignmentId <= 0) {
      res.status(400).json([{ message: 'Invalid ids provided' }]);
      return;
    }
    await ensureComponentExists(componentId);
    const existing = await ensureAssignmentExists(componentId, assignmentId);
    const actorId = getActorId(req);
    const payload = sanitizeAssignmentPayload({ ...existing.get(), ...req.body });
    payload.updatedBy = actorId;
    payload.currencyCode = payload.currencyCode ? normalizeCurrency(payload.currencyCode) : existing.currencyCode;

    const overlapWhere = await validateAssignmentTargets(componentId, payload);
    const conflicting = await CompensationComponentAssignment.findAll({
      where: {
        ...overlapWhere,
        id: { [Op.ne]: assignmentId },
      },
    });
    if (conflicting.length > 0) {
      const hasOverlap = conflicting.some((assignment) => {
        const startA = assignment.effectiveStart ? dayjs(assignment.effectiveStart) : null;
        const endA = assignment.effectiveEnd ? dayjs(assignment.effectiveEnd) : null;
        const startB = payload.effectiveStart ? dayjs(payload.effectiveStart) : null;
        const endB = payload.effectiveEnd ? dayjs(payload.effectiveEnd) : null;
        if (!startA && !endA) {
          return true;
        }
        if (!startB && !endB) {
          return true;
        }
        const startOverlap = !startA || !endB || !startA.isAfter(endB);
        const endOverlap = !endA || !startB || !endA.isBefore(startB);
        return startOverlap && endOverlap;
      });
      if (hasOverlap) {
        res.status(409).json([{ message: 'Overlapping assignment exists for this target' }]);
        return;
      }
    }

    await CompensationComponentAssignment.update(payload, { where: { id: assignmentId, componentId } });
    const refreshed = await CompensationComponentAssignment.findByPk(assignmentId, {
      include: [
        { model: User, as: 'user', attributes: ['id', 'firstName', 'lastName'] },
        { model: ShiftRole, as: 'shiftRole', attributes: ['id', 'name'] },
        { model: UserType, as: 'userType', attributes: ['id', 'name'] },
      ],
    });

    res.status(200).json([{ data: refreshed ? [formatAssignment(refreshed as CompensationComponentAssignment & { user?: User | null; shiftRole?: ShiftRole | null; userType?: UserType | null })] : [] }]);
  } catch (error) {
    const code = (error as Error).message;
    if (code === 'COMPONENT_NOT_FOUND') {
      res.status(404).json([{ message: 'Compensation component not found' }]);
      return;
    }
    if (code === 'ASSIGNMENT_NOT_FOUND') {
      res.status(404).json([{ message: 'Assignment not found' }]);
      return;
    }
    const messageMap: Record<string, string> = {
      INVALID_TARGET_SCOPE: 'Invalid target scope',
      SHIFT_ROLE_REQUIRED: 'shiftRoleId is required for shift_role scope',
      USER_REQUIRED: 'userId is required for user scope',
      USER_TYPE_REQUIRED: 'userTypeId is required for user_type scope',
      STAFF_TYPE_REQUIRED: 'staffType is required for staff_type scope',
      SHIFT_ROLE_NOT_FOUND: 'Shift role not found',
      USER_NOT_FOUND: 'User not found',
      USER_TYPE_NOT_FOUND: 'User type not found',
      INVALID_DATE_RANGE: 'effectiveEnd must be on or after effectiveStart',
    };
    if (code in messageMap) {
      res.status(400).json([{ message: messageMap[code] }]);
      return;
    }
    console.error('Failed to update compensation assignment', error);
    res.status(500).json([{ message: 'Failed to update assignment' }]);
  }
};

export const deleteCompensationComponentAssignment = async (req: Request, res: Response): Promise<void> => {
  try {
    const componentId = Number(req.params.id);
    const assignmentId = Number(req.params.assignmentId);
    if (!Number.isInteger(componentId) || componentId <= 0 || !Number.isInteger(assignmentId) || assignmentId <= 0) {
      res.status(400).json([{ message: 'Invalid ids provided' }]);
      return;
    }
    await ensureComponentExists(componentId);
    const deleted = await CompensationComponentAssignment.destroy({ where: { id: assignmentId, componentId } });
    if (!deleted) {
      res.status(404).json([{ message: 'Assignment not found' }]);
      return;
    }
    res.status(204).send();
  } catch (error) {
    const code = (error as Error).message;
    if (code === 'COMPONENT_NOT_FOUND') {
      res.status(404).json([{ message: 'Compensation component not found' }]);
      return;
    }
    console.error('Failed to delete compensation assignment', error);
    res.status(500).json([{ message: 'Failed to delete assignment' }]);
  }
};
