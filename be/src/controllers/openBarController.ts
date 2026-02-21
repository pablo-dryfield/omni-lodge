import type { Response } from 'express';
import { fn, col, Op, type Transaction } from 'sequelize';
import dayjs from 'dayjs';
import HttpError from '../errors/HttpError.js';
import type { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';
import OpenBarIngredient, {
  type OpenBarIngredientUnit,
  type OpenBarCupType,
} from '../models/OpenBarIngredient.js';
import OpenBarIngredientCategory from '../models/OpenBarIngredientCategory.js';
import OpenBarRecipe, { type OpenBarDrinkLabelDisplayMode, type OpenBarDrinkType } from '../models/OpenBarRecipe.js';
import OpenBarRecipeIngredient, { type OpenBarRecipeIngredientLineType } from '../models/OpenBarRecipeIngredient.js';
import OpenBarSession, { type OpenBarSessionStatus } from '../models/OpenBarSession.js';
import OpenBarSessionMembership from '../models/OpenBarSessionMembership.js';
import OpenBarSessionType from '../models/OpenBarSessionType.js';
import OpenBarDrinkIssue from '../models/OpenBarDrinkIssue.js';
import OpenBarDrinkLabelSetting from '../models/OpenBarDrinkLabelSetting.js';
import OpenBarDelivery from '../models/OpenBarDelivery.js';
import OpenBarDeliveryItem from '../models/OpenBarDeliveryItem.js';
import OpenBarInventoryMovement, { type OpenBarMovementType } from '../models/OpenBarInventoryMovement.js';
import OpenBarIngredientVariant from '../models/OpenBarIngredientVariant.js';
import User from '../models/User.js';
import Venue from '../models/Venue.js';

const INGREDIENT_UNITS: OpenBarIngredientUnit[] = ['ml', 'unit'];
const DRINK_TYPES: OpenBarDrinkType[] = ['classic', 'cocktail', 'beer', 'soft', 'custom'];
const SESSION_STATUSES: OpenBarSessionStatus[] = ['draft', 'active', 'closed'];
const ADJUSTMENT_TYPES: OpenBarMovementType[] = ['adjustment', 'waste', 'correction'];
const RECIPE_LINE_TYPES: OpenBarRecipeIngredientLineType[] = ['fixed_ingredient', 'category_selector'];
const ISSUE_STRENGTHS = ['single', 'double'] as const;
const CUP_TYPES: OpenBarCupType[] = ['disposable', 'reusable'];
const DEFAULT_OPEN_BAR_CATEGORY_SLUG = 'other';
const STOCK_EPSILON = 0.000001;
const DEFAULT_ICE_CUBES_PER_DRINK = 3;
const ICE_CUBE_VOLUME_ML = 25;
const DRINK_LABEL_MODES: OpenBarDrinkLabelDisplayMode[] = ['recipe_name', 'recipe_with_ingredients', 'ingredients_only'];
const DEFAULT_DRINK_LABEL_MODE_BY_TYPE: Record<OpenBarDrinkType, OpenBarDrinkLabelDisplayMode> = {
  classic: 'recipe_with_ingredients',
  cocktail: 'recipe_name',
  beer: 'recipe_name',
  soft: 'recipe_name',
  custom: 'recipe_name',
};
type OpenBarRealtimeEventType = 'drink_issue_created' | 'drink_issue_deleted';
type OpenBarRealtimeEventPayload = {
  sessionId: number;
  issueId: number;
  actorId: number | null;
  occurredAt: string;
};

const openBarEventStreamClientsBySession = new Map<number, Set<Response>>();

const writeOpenBarSseEvent = (
  response: Response,
  eventType: OpenBarRealtimeEventType | 'connected',
  payload: Record<string, unknown>,
): void => {
  response.write(`event: ${eventType}\n`);
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
};

const registerOpenBarEventClient = (sessionId: number, response: Response): (() => void) => {
  const current = openBarEventStreamClientsBySession.get(sessionId) ?? new Set<Response>();
  current.add(response);
  openBarEventStreamClientsBySession.set(sessionId, current);

  return () => {
    const clients = openBarEventStreamClientsBySession.get(sessionId);
    if (!clients) {
      return;
    }
    clients.delete(response);
    if (clients.size === 0) {
      openBarEventStreamClientsBySession.delete(sessionId);
    }
  };
};

const broadcastOpenBarRealtimeEvent = (
  eventType: OpenBarRealtimeEventType,
  payload: OpenBarRealtimeEventPayload,
): void => {
  const clients = openBarEventStreamClientsBySession.get(payload.sessionId);
  if (!clients || clients.size === 0) {
    return;
  }

  const staleClients: Response[] = [];
  clients.forEach((response) => {
    try {
      writeOpenBarSseEvent(response, eventType, payload);
    } catch {
      staleClients.push(response);
    }
  });

  if (staleClients.length > 0) {
    staleClients.forEach((response) => clients.delete(response));
    if (clients.size === 0) {
      openBarEventStreamClientsBySession.delete(payload.sessionId);
    }
  }
};

const parseNumber = (value: unknown, fallback = 0): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
};

const parseInteger = (value: unknown): number | null => {
  const parsed = parseNumber(value, Number.NaN);
  if (!Number.isInteger(parsed)) {
    return null;
  }
  return parsed;
};

const normalizeDateOnly = (value: unknown, fallback?: string): string => {
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = dayjs(value, 'YYYY-MM-DD', true);
    if (!parsed.isValid()) {
      throw new HttpError(400, 'Date must be in YYYY-MM-DD format');
    }
    return parsed.format('YYYY-MM-DD');
  }
  if (fallback) {
    return fallback;
  }
  return dayjs().format('YYYY-MM-DD');
};

const normalizeDateTime = (value: unknown, fallback = new Date()): Date => {
  if (value == null || value === '') {
    return fallback;
  }
  if (value instanceof Date && !Number.isNaN(value.valueOf())) {
    return value;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.valueOf())) {
      return parsed;
    }
  }
  throw new HttpError(400, 'Invalid datetime value');
};

const toBoolean = (value: unknown, fallback: boolean): boolean => {
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

const getActorId = (req: AuthenticatedRequest): number | null => req.authContext?.id ?? null;
const requireActorId = (req: AuthenticatedRequest): number => {
  const actorId = getActorId(req);
  if (actorId == null) {
    throw new HttpError(401, 'Authenticated user required');
  }
  return actorId;
};

const OPEN_BAR_PRIVILEGED_ROLE_SLUGS = new Set(['admin', 'administrator', 'owner', 'manager', 'assistant-manager']);

const normalizeRoleSlug = (value?: string | null): string | null => {
  if (!value) {
    return null;
  }
  const trimmed = value.trim().toLowerCase().replace(/[\s_]+/g, '-');
  const collapsed = trimmed.replace(/-/g, '');
  if (collapsed === 'administrator') {
    return 'admin';
  }
  if (collapsed === 'assistantmanager' || collapsed === 'assistmanager') {
    return 'assistant-manager';
  }
  if (collapsed === 'mgr' || collapsed === 'manager') {
    return 'manager';
  }
  if (collapsed === 'bartender' || collapsed === 'barman' || collapsed === 'barmaid') {
    return 'bartender';
  }
  return trimmed;
};

const hasOpenBarManagerOverrideAccess = (req: AuthenticatedRequest): boolean => {
  const roleSlug = normalizeRoleSlug(req.authContext?.roleSlug ?? req.authContext?.userTypeSlug ?? null);
  const shiftRoleSlugs = new Set(
    (req.authContext?.shiftRoleSlugs ?? [])
      .map((value) => normalizeRoleSlug(value))
      .filter((value): value is string => Boolean(value)),
  );
  const isManagerShift = shiftRoleSlugs.has('manager');
  const isPrivilegedRole = roleSlug != null && OPEN_BAR_PRIVILEGED_ROLE_SLUGS.has(roleSlug);
  return isManagerShift || isPrivilegedRole;
};

const disconnectUserFromActiveSessions = async (
  userId: number,
  transaction?: Transaction,
  excludeSessionId?: number | null,
): Promise<void> => {
  const where: Record<string, unknown> = {
    userId,
    isActive: true,
  };
  if (excludeSessionId != null) {
    where.sessionId = { [Op.ne]: excludeSessionId };
  }
  await OpenBarSessionMembership.update(
    {
      isActive: false,
      leftAt: new Date(),
      updatedAt: new Date(),
    },
    {
      where,
      transaction,
    },
  );
};

const connectUserToSession = async (
  userId: number,
  sessionId: number,
  transaction?: Transaction,
): Promise<OpenBarSessionMembership> => {
  await disconnectUserFromActiveSessions(userId, transaction, sessionId);

  const now = new Date();
  const existing = await OpenBarSessionMembership.findOne({
    where: {
      sessionId,
      userId,
    },
    transaction,
  });

  if (existing) {
    await existing.update(
      {
        isActive: true,
        joinedAt: now,
        leftAt: null,
      },
      { transaction },
    );
    return existing;
  }

  return OpenBarSessionMembership.create(
    {
      sessionId,
      userId,
      isActive: true,
      joinedAt: now,
      leftAt: null,
    },
    { transaction },
  );
};

const leaveUserSession = async (
  userId: number,
  sessionId: number,
  transaction?: Transaction,
): Promise<boolean> => {
  const [affected] = await OpenBarSessionMembership.update(
    {
      isActive: false,
      leftAt: new Date(),
      updatedAt: new Date(),
    },
    {
      where: {
        userId,
        sessionId,
        isActive: true,
      },
      transaction,
    },
  );
  return affected > 0;
};

const getUserSessionMembershipContext = async (
  userId: number,
  options?: { businessDate?: string; transaction?: Transaction },
): Promise<{ joinedSessionIds: Set<number>; activeJoinedSessionIds: Set<number> }> => {
  const memberships = await OpenBarSessionMembership.findAll({
    where: { userId },
    attributes: ['sessionId', 'isActive'],
    include: [
      {
        model: OpenBarSession,
        as: 'session',
        attributes: ['id', 'businessDate'],
        where: options?.businessDate ? { businessDate: options.businessDate } : undefined,
        required: options?.businessDate != null,
      },
    ],
    transaction: options?.transaction,
  });

  const joinedSessionIds = new Set<number>();
  const activeJoinedSessionIds = new Set<number>();

  memberships.forEach((membership) => {
    if (options?.businessDate && !membership.session) {
      return;
    }
    if (membership.isActive) {
      joinedSessionIds.add(membership.sessionId);
      activeJoinedSessionIds.add(membership.sessionId);
    }
  });

  return {
    joinedSessionIds,
    activeJoinedSessionIds,
  };
};

const buildSessionVisibilityFilter = (
  actorId: number,
  joinedSessionIds: Set<number>,
): Record<string | symbol, unknown> => {
  const visibilityFilters: Array<Record<string, unknown>> = [{ createdBy: actorId }];
  const joinedIds = Array.from(joinedSessionIds.values());
  if (joinedIds.length > 0) {
    visibilityFilters.push({
      id: {
        [Op.in]: joinedIds,
      },
    });
  }
  return { [Op.or]: visibilityFilters };
};

const normalizeCategorySlug = (value: unknown, field = 'category'): string => {
  if (typeof value !== 'string') {
    throw new HttpError(400, `${field} must be a string`);
  }
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');

  if (!normalized) {
    throw new HttpError(400, `${field} is invalid`);
  }
  return normalized;
};

const resolveCategorySortOrder = (value: unknown, fallback = 0): number => {
  if (value == null || value === '') {
    return fallback;
  }
  const parsed = parseInteger(value);
  if (parsed == null || parsed < 0) {
    throw new HttpError(400, 'sortOrder must be a non-negative integer');
  }
  return parsed;
};

const resolveIngredientCategoryId = async (
  value: unknown,
  fallbackCategoryId: number | null,
  options?: { includeInactive?: boolean; transaction?: Transaction },
): Promise<number> => {
  if (value == null || value === '') {
    if (fallbackCategoryId != null) {
      return fallbackCategoryId;
    }

    const defaultCategory = await OpenBarIngredientCategory.findOne({
      where: options?.includeInactive ? { slug: DEFAULT_OPEN_BAR_CATEGORY_SLUG } : { slug: DEFAULT_OPEN_BAR_CATEGORY_SLUG, isActive: true },
      order: [['sortOrder', 'ASC']],
      transaction: options?.transaction,
    });
    if (defaultCategory) {
      return defaultCategory.id;
    }

    const firstCategory = await OpenBarIngredientCategory.findOne({
      where: options?.includeInactive ? undefined : { isActive: true },
      order: [['sortOrder', 'ASC'], ['name', 'ASC']],
      transaction: options?.transaction,
    });
    if (!firstCategory) {
      throw new HttpError(400, 'No ingredient categories available');
    }
    return firstCategory.id;
  }

  const numeric = parseInteger(value);
  if (numeric != null && numeric > 0) {
    const category = await OpenBarIngredientCategory.findOne({
      where: options?.includeInactive ? { id: numeric } : { id: numeric, isActive: true },
      transaction: options?.transaction,
    });
    if (!category) {
      throw new HttpError(400, `Unknown ingredient category id: ${numeric}`);
    }
    return category.id;
  }

  const slug = normalizeCategorySlug(value, 'category');
  const category = await OpenBarIngredientCategory.findOne({
    where: options?.includeInactive ? { slug } : { slug, isActive: true },
    transaction: options?.transaction,
  });
  if (!category) {
    throw new HttpError(400, `Unknown ingredient category: ${slug}`);
  }
  return category.id;
};

const resolveUnit = (value: unknown, fallback: OpenBarIngredientUnit): OpenBarIngredientUnit => {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (INGREDIENT_UNITS.includes(normalized as OpenBarIngredientUnit)) {
    return normalized as OpenBarIngredientUnit;
  }
  return fallback;
};

const resolveDrinkType = (value: unknown, fallback: OpenBarDrinkType): OpenBarDrinkType => {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (DRINK_TYPES.includes(normalized as OpenBarDrinkType)) {
    return normalized as OpenBarDrinkType;
  }
  return fallback;
};

const resolveDrinkLabelMode = (
  value: unknown,
  fallback: OpenBarDrinkLabelDisplayMode | null,
  options?: { allowNull?: boolean },
): OpenBarDrinkLabelDisplayMode | null => {
  if (value == null || value === '') {
    if (options?.allowNull) {
      return null;
    }
    return fallback;
  }
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (DRINK_LABEL_MODES.includes(normalized as OpenBarDrinkLabelDisplayMode)) {
    return normalized as OpenBarDrinkLabelDisplayMode;
  }
  throw new HttpError(400, `labelDisplayMode must be one of: ${DRINK_LABEL_MODES.join(', ')}`);
};

const resolveSessionStatus = (value: unknown, fallback: OpenBarSessionStatus): OpenBarSessionStatus => {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (SESSION_STATUSES.includes(normalized as OpenBarSessionStatus)) {
    return normalized as OpenBarSessionStatus;
  }
  return fallback;
};

const resolveAdjustmentType = (value: unknown): OpenBarMovementType => {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!ADJUSTMENT_TYPES.includes(normalized as OpenBarMovementType)) {
    throw new HttpError(400, `movementType must be one of: ${ADJUSTMENT_TYPES.join(', ')}`);
  }
  return normalized as OpenBarMovementType;
};

const resolveRecipeLineType = (
  value: unknown,
  fallback: OpenBarRecipeIngredientLineType = 'fixed_ingredient',
): OpenBarRecipeIngredientLineType => {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (RECIPE_LINE_TYPES.includes(normalized as OpenBarRecipeIngredientLineType)) {
    return normalized as OpenBarRecipeIngredientLineType;
  }
  return fallback;
};

type IssueStrength = (typeof ISSUE_STRENGTHS)[number];

const resolveIssueStrength = (value: unknown, fallback: IssueStrength = 'single'): IssueStrength => {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (ISSUE_STRENGTHS.includes(normalized as IssueStrength)) {
    return normalized as IssueStrength;
  }
  return fallback;
};

const resolveCupType = (value: unknown, fallback: OpenBarCupType | null = null): OpenBarCupType | null => {
  if (value == null || value === '') {
    return fallback;
  }
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (CUP_TYPES.includes(normalized as OpenBarCupType)) {
    return normalized as OpenBarCupType;
  }
  throw new HttpError(400, `cupType must be one of: ${CUP_TYPES.join(', ')}`);
};

const resolveCupCapacityMl = (
  value: unknown,
  options?: { fallback?: number | null; required?: boolean },
): number | null => {
  if (value == null || value === '') {
    const fallback = options?.fallback ?? null;
    if (options?.required && fallback == null) {
      throw new HttpError(400, 'cupCapacityMl is required for cup ingredients');
    }
    return fallback;
  }

  const parsed = parseNonNegativeNumber(value, 'cupCapacityMl');
  if (parsed <= 0) {
    throw new HttpError(400, 'cupCapacityMl must be greater than zero');
  }
  return parsed;
};

const resolveRecipeIceCubes = (
  value: unknown,
  options?: { fallback?: number; required?: boolean },
): number => {
  if (value == null || value === '') {
    if (options?.fallback != null) {
      return Math.max(options.fallback, 0);
    }
    if (options?.required) {
      throw new HttpError(400, 'iceCubes is required when hasIce is true');
    }
    return DEFAULT_ICE_CUBES_PER_DRINK;
  }

  const parsed = parseInteger(value);
  if (parsed == null || parsed < 0) {
    throw new HttpError(400, 'iceCubes must be a non-negative integer');
  }
  return parsed;
};

const getIceDisplacementMl = (iceCubes: number): number => {
  if (iceCubes <= 0) {
    return 0;
  }
  return iceCubes * ICE_CUBE_VOLUME_ML;
};

const parseNonNegativeNumber = (value: unknown, field: string, fallback?: number): number => {
  if (value == null || value === '') {
    if (fallback == null) {
      throw new HttpError(400, `${field} is required`);
    }
    return fallback;
  }
  const parsed = parseNumber(value, Number.NaN);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new HttpError(400, `${field} must be a non-negative number`);
  }
  return parsed;
};

const parsePositiveInteger = (value: unknown, field: string, fallback?: number): number => {
  if (value == null || value === '') {
    if (fallback == null) {
      throw new HttpError(400, `${field} is required`);
    }
    return fallback;
  }
  const parsed = parseInteger(value);
  if (parsed == null || parsed <= 0) {
    throw new HttpError(400, `${field} must be a positive integer`);
  }
  return parsed;
};

type SessionReconciliationLine = {
  ingredientId: number;
  countedStock: number;
};

const parseSessionReconciliation = (value: unknown): SessionReconciliationLine[] => {
  if (value == null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new HttpError(400, 'reconciliation must be an array');
  }

  const lines = value.map((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      throw new HttpError(400, `reconciliation[${index}] must be an object`);
    }
    const record = entry as { ingredientId?: unknown; countedStock?: unknown };
    const ingredientId = parsePositiveInteger(record.ingredientId, `reconciliation[${index}].ingredientId`);
    const countedStock = parseNonNegativeNumber(record.countedStock, `reconciliation[${index}].countedStock`);
    return {
      ingredientId,
      countedStock,
    };
  });

  const duplicateIngredientIds = lines
    .map((line) => line.ingredientId)
    .filter((id, index, arr) => arr.indexOf(id) !== index);
  if (duplicateIngredientIds.length > 0) {
    throw new HttpError(400, 'Reconciliation contains duplicate ingredients');
  }

  return lines;
};

const sanitizeName = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new HttpError(400, `${field} is required`);
  }
  return value.trim();
};

const resolveTimeLimitMinutes = (
  value: unknown,
  fallback: number | null = null,
  options?: { strict?: boolean },
): number | null => {
  if (value == null || value === '') {
    return fallback;
  }
  const parsed = parseInteger(value);
  if (parsed == null || parsed <= 0) {
    if (options?.strict === false) {
      return fallback;
    }
    throw new HttpError(400, 'timeLimitMinutes must be a positive integer');
  }
  return parsed;
};

const getStockMap = async (
  ingredientIds?: number[],
  transaction?: Transaction,
): Promise<Map<number, number>> => {
  const where =
    ingredientIds && ingredientIds.length > 0
      ? { ingredientId: { [Op.in]: ingredientIds } }
      : undefined;
  const rows = (await OpenBarInventoryMovement.findAll({
    attributes: ['ingredientId', [fn('COALESCE', fn('SUM', col('quantity_delta')), 0), 'stock']],
    where,
    group: ['ingredientId'],
    raw: true,
    transaction,
  })) as unknown as Array<{ ingredientId: number; stock: string | number | null }>;

  const map = new Map<number, number>();
  rows.forEach((row) => {
    map.set(row.ingredientId, parseNumber(row.stock, 0));
  });
  return map;
};

const serializeIngredient = (ingredient: OpenBarIngredient, stockMap: Map<number, number>) => {
  const currentStock = stockMap.get(ingredient.id) ?? 0;
  const parLevel = parseNumber(ingredient.parLevel, 0);
  const reorderLevel = parseNumber(ingredient.reorderLevel, 0);
  return {
    id: ingredient.id,
    name: ingredient.name,
    categoryId: ingredient.categoryId,
    categorySlug: ingredient.categoryRef?.slug ?? null,
    categoryName: ingredient.categoryRef?.name ?? null,
    baseUnit: ingredient.baseUnit,
    parLevel,
    reorderLevel,
    costPerUnit: ingredient.costPerUnit == null ? null : parseNumber(ingredient.costPerUnit, 0),
    currentStock,
    neededToPar: Math.max(parLevel - currentStock, 0),
    belowReorder: currentStock <= reorderLevel,
    isActive: ingredient.isActive,
    isCup: ingredient.isCup,
    cupType: ingredient.cupType,
    cupCapacityMl: ingredient.cupCapacityMl == null ? null : parseNumber(ingredient.cupCapacityMl, 0),
    isIce: ingredient.isIce,
    createdAt: ingredient.createdAt,
    updatedAt: ingredient.updatedAt,
  };
};

const serializeIngredientCategory = (category: OpenBarIngredientCategory) => ({
  id: category.id,
  name: category.name,
  slug: category.slug,
  sortOrder: category.sortOrder,
  isActive: category.isActive,
  createdAt: category.createdAt,
  updatedAt: category.updatedAt,
});

const serializeIngredientVariant = (variant: OpenBarIngredientVariant) => ({
  id: variant.id,
  ingredientId: variant.ingredientId,
  ingredientName: variant.ingredient?.name ?? null,
  ingredientBaseUnit: variant.ingredient?.baseUnit ?? null,
  name: variant.name,
  brand: variant.brand,
  packageLabel: variant.packageLabel,
  baseQuantity: parseNumber(variant.baseQuantity, 0),
  isActive: variant.isActive,
  createdAt: variant.createdAt,
  updatedAt: variant.updatedAt,
});

const serializeSessionType = (sessionType: OpenBarSessionType) => ({
  id: sessionType.id,
  name: sessionType.name,
  slug: sessionType.slug,
  defaultTimeLimitMinutes: Math.max(parseNumber(sessionType.defaultTimeLimitMinutes, 60), 1),
  sortOrder: sessionType.sortOrder,
  isActive: sessionType.isActive,
  createdAt: sessionType.createdAt,
  updatedAt: sessionType.updatedAt,
});

const serializeDrinkLabelSetting = (drinkType: OpenBarDrinkType, displayMode: OpenBarDrinkLabelDisplayMode) => ({
  drinkType,
  displayMode,
});

const getDrinkLabelSettingMap = async (
  transaction?: Transaction,
): Promise<Map<OpenBarDrinkType, OpenBarDrinkLabelDisplayMode>> => {
  const map = new Map<OpenBarDrinkType, OpenBarDrinkLabelDisplayMode>();
  DRINK_TYPES.forEach((drinkType) => {
    map.set(drinkType, DEFAULT_DRINK_LABEL_MODE_BY_TYPE[drinkType]);
  });

  const settings = await OpenBarDrinkLabelSetting.findAll({
    attributes: ['drinkType', 'displayMode'],
    transaction,
  });
  settings.forEach((setting) => {
    const drinkType = resolveDrinkType(setting.drinkType, 'custom');
    const displayMode = resolveDrinkLabelMode(setting.displayMode, DEFAULT_DRINK_LABEL_MODE_BY_TYPE[drinkType]);
    if (displayMode) {
      map.set(drinkType, displayMode);
    }
  });

  return map;
};

const getSessionExpectedEndAt = (session: {
  openedAt: Date | null;
  timeLimitMinutes: unknown;
}): Date | null => {
  const openedAt = session.openedAt ?? null;
  const timeLimitMinutes = resolveTimeLimitMinutes(session.timeLimitMinutes, null, { strict: false });
  if (!openedAt || timeLimitMinutes == null) {
    return null;
  }
  return dayjs(openedAt).add(timeLimitMinutes, 'minute').toDate();
};

const isSessionTimeExpired = (
  session: {
    openedAt: Date | null;
    timeLimitMinutes: unknown;
  },
  now: Date = new Date(),
): boolean => {
  const expectedEndAt = getSessionExpectedEndAt(session);
  if (!expectedEndAt) {
    return false;
  }
  return dayjs(now).valueOf() >= dayjs(expectedEndAt).valueOf();
};

const serializeSession = (
  session: OpenBarSession,
  summary?: { issuesCount: number; servings: number; lastIssuedAt: Date | null },
  context?: { actorId?: number | null; joinedSessionIds?: Set<number>; activeJoinedSessionIds?: Set<number> },
) => {
  const openedAt = session.openedAt ?? null;
  const timeLimitMinutes = resolveTimeLimitMinutes(session.timeLimitMinutes, null, { strict: false });
  const expectedEndAt = getSessionExpectedEndAt(session);

  return {
    id: session.id,
    sessionName: session.sessionName,
    businessDate: session.businessDate,
    venueId: session.venueId,
    venueName: session.venue?.name ?? null,
    nightReportId: session.nightReportId,
    sessionTypeId: session.sessionTypeId,
    sessionTypeName: session.sessionType?.name ?? null,
    sessionTypeSlug: session.sessionType?.slug ?? null,
    timeLimitMinutes,
    expectedEndAt,
    status: session.status,
    openedAt,
    closedAt: session.closedAt ?? null,
    notes: session.notes,
    createdBy: session.createdBy ?? null,
    createdByName: session.createdByUser
      ? `${session.createdByUser.firstName ?? ''} ${session.createdByUser.lastName ?? ''}`.trim() || null
      : null,
    issuesCount: summary?.issuesCount ?? 0,
    servingsIssued: summary?.servings ?? 0,
    lastIssuedAt: summary?.lastIssuedAt ?? null,
    isOwnedByCurrentUser: context?.actorId != null ? session.createdBy === context.actorId : false,
    isJoinedByCurrentUser: context?.joinedSessionIds?.has(session.id) ?? false,
    isCurrentUserActiveSession: context?.activeJoinedSessionIds?.has(session.id) ?? false,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
};

const serializeRecipe = (recipe: OpenBarRecipe) => {
  const ingredients = (recipe.ingredients ?? [])
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((line) => {
      const ingredient = line.ingredient;
      const category = line.category;
      const unitCost = ingredient?.costPerUnit == null ? 0 : parseNumber(ingredient.costPerUnit, 0);
      const quantity = parseNumber(line.quantity, 0);
      const lineType = resolveRecipeLineType(line.lineType, 'fixed_ingredient');
      return {
        id: line.id,
        lineType,
        ingredientId: line.ingredientId,
        ingredientName: ingredient?.name ?? null,
        categoryId: line.categoryId,
        categoryName: category?.name ?? null,
        categorySlug: category?.slug ?? null,
        baseUnit: ingredient?.baseUnit ?? null,
        quantity,
        sortOrder: line.sortOrder,
        isOptional: line.isOptional,
        affectsStrength: line.affectsStrength,
        isTopUp: line.isTopUp,
        unitCost: ingredient?.costPerUnit == null ? null : unitCost,
        estimatedCost: line.isTopUp ? 0 : unitCost * quantity,
      };
    });

  let estimatedCostPerServing = ingredients.reduce((sum, line) => sum + line.estimatedCost, 0);
  if (recipe.cupIngredient?.isCup && recipe.cupIngredient.cupType === 'disposable' && recipe.cupIngredient.costPerUnit != null) {
    estimatedCostPerServing += parseNumber(recipe.cupIngredient.costPerUnit, 0);
  }
  const cupCapacityMl = recipe.cupIngredient?.cupCapacityMl == null ? null : parseNumber(recipe.cupIngredient.cupCapacityMl, 0);
  const iceDisplacementMl = recipe.hasIce ? getIceDisplacementMl(recipe.iceCubes) : 0;
  const availableLiquidCapacityMl =
    cupCapacityMl == null ? null : Math.max(cupCapacityMl - iceDisplacementMl, 0);

  return {
    id: recipe.id,
    name: recipe.name,
    drinkType: recipe.drinkType,
    labelDisplayMode: resolveDrinkLabelMode(recipe.labelDisplayMode, null, { allowNull: true }),
    defaultServings: recipe.defaultServings,
    instructions: recipe.instructions,
    isActive: recipe.isActive,
    askStrength: recipe.askStrength,
    cupIngredientId: recipe.cupIngredientId,
    cupIngredientName: recipe.cupIngredient?.name ?? null,
    cupType: recipe.cupIngredient?.cupType ?? null,
    cupCapacityMl,
    hasIce: recipe.hasIce,
    iceCubes: recipe.iceCubes,
    iceDisplacementMl,
    availableLiquidCapacityMl,
    estimatedCostPerServing,
    ingredients,
    createdAt: recipe.createdAt,
    updatedAt: recipe.updatedAt,
  };
};

const serializeIssue = (issue: OpenBarDrinkIssue) => ({
  id: issue.id,
  sessionId: issue.sessionId,
  recipeId: issue.recipeId,
  recipeName: issue.recipe?.name ?? null,
  displayName: issue.displayNameSnapshot ?? issue.recipe?.name ?? null,
  drinkType: issue.recipe?.drinkType ?? null,
  servings: issue.servings,
  issuedAt: issue.issuedAt,
  orderRef: issue.orderRef,
  notes: issue.notes,
  isStaffDrink: toBoolean(issue.isStaffDrink, false),
  issuedBy: issue.issuedBy,
  issuedByName: issue.issuedByUser
    ? `${issue.issuedByUser.firstName ?? ''} ${issue.issuedByUser.lastName ?? ''}`.trim()
    : null,
});

const serializeDelivery = (delivery: OpenBarDelivery) => {
  const items = (delivery.items ?? []).map((item) => ({
    id: item.id,
    ingredientId: item.ingredientId,
    ingredientName: item.ingredient?.name ?? null,
    baseUnit: item.ingredient?.baseUnit ?? null,
    variantId: item.variantId ?? null,
    variantName: item.variant?.name ?? null,
    variantBrand: item.variant?.brand ?? null,
    packageLabel: item.variant?.packageLabel ?? null,
    purchaseUnits: item.purchaseUnits == null ? null : parseNumber(item.purchaseUnits, 0),
    purchaseUnitCost: item.purchaseUnitCost == null ? null : parseNumber(item.purchaseUnitCost, 0),
    quantity: parseNumber(item.quantity, 0),
    unitCost: item.unitCost == null ? null : parseNumber(item.unitCost, 0),
  }));
  return {
    id: delivery.id,
    supplierName: delivery.supplierName,
    invoiceRef: delivery.invoiceRef,
    deliveredAt: delivery.deliveredAt,
    notes: delivery.notes,
    receivedBy: delivery.receivedBy,
    receivedByName: delivery.receivedByUser
      ? `${delivery.receivedByUser.firstName ?? ''} ${delivery.receivedByUser.lastName ?? ''}`.trim()
      : null,
    totalItems: items.length,
    totalQuantity: items.reduce((sum, item) => sum + item.quantity, 0),
    items,
  };
};

const handleError = (res: Response, error: unknown, fallbackMessage: string): void => {
  if (error instanceof HttpError) {
    res.status(error.status).json({ message: error.message, details: error.details ?? null });
    return;
  }
  const message = error instanceof Error ? error.message : fallbackMessage;
  res.status(500).json({ message });
};

type RecipeIngredientInput = {
  lineType: OpenBarRecipeIngredientLineType;
  ingredientId: number | null;
  categoryId: number | null;
  quantity: number;
  sortOrder: number;
  isOptional: boolean;
  affectsStrength: boolean;
  isTopUp: boolean;
};

const parseRecipeIngredientsPayload = (value: unknown): RecipeIngredientInput[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const parsed = value.map((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      throw new HttpError(400, `ingredients[${index}] must be an object`);
    }
    const record = entry as {
      lineType?: unknown;
      ingredientId?: unknown;
      categoryId?: unknown;
      quantity?: unknown;
      sortOrder?: unknown;
      isOptional?: unknown;
      affectsStrength?: unknown;
      isTopUp?: unknown;
    };
    const lineType = resolveRecipeLineType(record.lineType, 'fixed_ingredient');
    const isTopUp = toBoolean(record.isTopUp, false);
    if (isTopUp && lineType !== 'category_selector') {
      throw new HttpError(400, `ingredients[${index}].isTopUp is only supported for category selector lines`);
    }
    const ingredientId =
      lineType === 'fixed_ingredient'
        ? parsePositiveInteger(record.ingredientId, `ingredients[${index}].ingredientId`)
        : null;
    const categoryId =
      lineType === 'category_selector'
        ? parsePositiveInteger(record.categoryId, `ingredients[${index}].categoryId`)
        : null;
    const quantity = parseNonNegativeNumber(record.quantity, `ingredients[${index}].quantity`);
    if (!isTopUp && quantity <= 0) {
      throw new HttpError(400, `ingredients[${index}].quantity must be greater than zero`);
    }
    if (isTopUp && quantity > 0) {
      throw new HttpError(400, `ingredients[${index}].quantity must be zero for top-up lines`);
    }
    const affectsStrength = toBoolean(record.affectsStrength, false);
    if (isTopUp && affectsStrength) {
      throw new HttpError(400, `ingredients[${index}].affectsStrength cannot be enabled for top-up lines`);
    }
    const sortOrderRaw = parseInteger(record.sortOrder);
    return {
      lineType,
      ingredientId,
      categoryId,
      quantity: isTopUp ? 0 : quantity,
      sortOrder: sortOrderRaw == null ? index + 1 : sortOrderRaw,
      isOptional: toBoolean(record.isOptional, false),
      affectsStrength,
      isTopUp,
    };
  });

  const duplicateKeys = parsed
    .map((line) =>
      line.lineType === 'fixed_ingredient'
        ? `fixed:${line.ingredientId ?? 'none'}`
        : `category:${line.categoryId ?? 'none'}`,
    )
    .filter((key, index, arr) => arr.indexOf(key) !== index);
  if (duplicateKeys.length > 0) {
    throw new HttpError(400, 'Recipe contains duplicate line selectors');
  }

  return parsed;
};

const ensureIngredientIdsExist = async (
  ingredientIds: number[],
  transaction?: Transaction,
): Promise<void> => {
  if (ingredientIds.length === 0) {
    return;
  }
  const rows = await OpenBarIngredient.findAll({
    attributes: ['id'],
    where: { id: { [Op.in]: ingredientIds } },
    transaction,
  });
  const found = new Set(rows.map((row) => row.id));
  const missing = ingredientIds.filter((id) => !found.has(id));
  if (missing.length > 0) {
    throw new HttpError(400, 'Some ingredients do not exist', { missingIngredientIds: missing });
  }
};

const ensureRecipeLineIngredientIdsValid = async (
  ingredientIds: number[],
  transaction?: Transaction,
): Promise<void> => {
  if (ingredientIds.length === 0) {
    return;
  }
  const rows = await OpenBarIngredient.findAll({
    attributes: ['id', 'isCup', 'isIce'],
    where: { id: { [Op.in]: ingredientIds } },
    transaction,
  });
  const found = new Set(rows.map((row) => row.id));
  const missing = ingredientIds.filter((id) => !found.has(id));
  if (missing.length > 0) {
    throw new HttpError(400, 'Some ingredients do not exist', { missingIngredientIds: missing });
  }
  const cupIngredientIds = rows.filter((row) => row.isCup).map((row) => row.id);
  if (cupIngredientIds.length > 0) {
    throw new HttpError(400, 'Cup ingredients cannot be used as recipe lines; assign them as recipe cup', {
      cupIngredientIds,
    });
  }
  const iceIngredientIds = rows.filter((row) => row.isIce).map((row) => row.id);
  if (iceIngredientIds.length > 0) {
    throw new HttpError(400, 'Ice ingredients cannot be used as recipe lines; use recipe hasIce and iceCubes', {
      iceIngredientIds,
    });
  }
};

const ensureIngredientCategoryIdsExist = async (
  categoryIds: number[],
  transaction?: Transaction,
): Promise<void> => {
  if (categoryIds.length === 0) {
    return;
  }
  const rows = await OpenBarIngredientCategory.findAll({
    attributes: ['id'],
    where: { id: { [Op.in]: categoryIds } },
    transaction,
  });
  const found = new Set(rows.map((row) => row.id));
  const missing = categoryIds.filter((id) => !found.has(id));
  if (missing.length > 0) {
    throw new HttpError(400, 'Some ingredient categories do not exist', { missingCategoryIds: missing });
  }
};

const resolveRecipeCupIngredientId = async (
  value: unknown,
  transaction?: Transaction,
  options?: { required?: boolean },
): Promise<number | null> => {
  if (value == null || value === '') {
    if (options?.required) {
      throw new HttpError(400, 'cupIngredientId is required');
    }
    return null;
  }

  const cupIngredientId = parsePositiveInteger(value, 'cupIngredientId');
  const ingredient = await OpenBarIngredient.findByPk(cupIngredientId, { transaction });
  if (!ingredient) {
    throw new HttpError(400, 'Cup ingredient not found');
  }
  if (!ingredient.isCup) {
    throw new HttpError(400, 'Selected cup ingredient is not marked as a cup');
  }
  if (!ingredient.isActive) {
    throw new HttpError(400, 'Selected cup ingredient is inactive');
  }
  if (ingredient.baseUnit !== 'unit') {
    throw new HttpError(400, 'Cup ingredients must use base unit "unit"');
  }
  const cupCapacityMl = ingredient.cupCapacityMl == null ? null : parseNumber(ingredient.cupCapacityMl, 0);
  if (cupCapacityMl == null || cupCapacityMl <= 0) {
    throw new HttpError(400, 'Selected cup ingredient must define cupCapacityMl greater than zero');
  }
  return ingredient.id;
};

const loadRecipeById = async (id: number, transaction?: Transaction): Promise<OpenBarRecipe | null> => {
  return OpenBarRecipe.findByPk(id, {
    include: [
      { model: OpenBarIngredient, as: 'cupIngredient', attributes: ['id', 'name', 'baseUnit', 'isCup', 'cupType', 'cupCapacityMl', 'costPerUnit', 'isActive'] },
      {
        model: OpenBarRecipeIngredient,
        as: 'ingredients',
        include: [
          { model: OpenBarIngredient, as: 'ingredient' },
          { model: OpenBarIngredientCategory, as: 'category' },
        ],
      },
    ],
    transaction,
  });
};

const loadIssueById = async (id: number, transaction?: Transaction): Promise<OpenBarDrinkIssue | null> =>
  OpenBarDrinkIssue.findByPk(id, {
    include: [
      { model: OpenBarRecipe, as: 'recipe', attributes: ['id', 'name', 'drinkType'] },
      { model: User, as: 'issuedByUser', attributes: ['id', 'firstName', 'lastName'] },
    ],
    transaction,
  });

export const listOpenBarIngredientCategories = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const includeInactive = toBoolean(req.query.includeInactive, false);
    const categories = await OpenBarIngredientCategory.findAll({
      where: includeInactive ? undefined : { isActive: true },
      order: [['sortOrder', 'ASC'], ['name', 'ASC']],
    });
    res.status(200).json({
      categories: categories.map((category) => serializeIngredientCategory(category)),
    });
  } catch (error) {
    handleError(res, error, 'Failed to list ingredient categories');
  }
};

export const createOpenBarIngredientCategory = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const actorId = requireActorId(req);
    const name = sanitizeName(req.body?.name, 'name');
    const slug = req.body?.slug ? normalizeCategorySlug(req.body.slug, 'slug') : normalizeCategorySlug(name, 'name');
    const sortOrder = resolveCategorySortOrder(req.body?.sortOrder, 0);
    const isActive = toBoolean(req.body?.isActive, true);

    const existing = await OpenBarIngredientCategory.findOne({
      where: {
        [Op.or]: [{ slug }, { name }],
      },
    });
    if (existing) {
      throw new HttpError(409, 'Ingredient category with the same name or slug already exists');
    }

    const category = await OpenBarIngredientCategory.create({
      name,
      slug,
      sortOrder,
      isActive,
      createdBy: actorId,
      updatedBy: actorId,
    });

    res.status(201).json({
      category: serializeIngredientCategory(category),
    });
  } catch (error) {
    handleError(res, error, 'Failed to create ingredient category');
  }
};

export const updateOpenBarIngredientCategory = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const actorId = requireActorId(req);
    const categoryId = parsePositiveInteger(req.params.id, 'id');
    const category = await OpenBarIngredientCategory.findByPk(categoryId);
    if (!category) {
      throw new HttpError(404, 'Ingredient category not found');
    }

    const updates: Record<string, unknown> = {};

    const nextName = req.body?.name !== undefined ? sanitizeName(req.body.name, 'name') : category.name;
    const nextSlug =
      req.body?.slug !== undefined
        ? normalizeCategorySlug(req.body.slug, 'slug')
        : category.slug;

    if (nextName !== category.name) {
      updates.name = nextName;
    }
    if (nextSlug !== category.slug) {
      updates.slug = nextSlug;
    }
    if (req.body?.sortOrder !== undefined) {
      updates.sortOrder = resolveCategorySortOrder(req.body.sortOrder, category.sortOrder);
    }
    if (req.body?.isActive !== undefined) {
      updates.isActive = toBoolean(req.body.isActive, category.isActive);
    }

    if (Object.keys(updates).length === 0) {
      res.status(200).json({ message: 'No changes applied' });
      return;
    }

    const conflict = await OpenBarIngredientCategory.findOne({
      where: {
        id: { [Op.ne]: category.id },
        [Op.or]: [{ slug: nextSlug }, { name: nextName }],
      },
    });
    if (conflict) {
      throw new HttpError(409, 'Ingredient category with the same name or slug already exists');
    }

    updates.updatedBy = actorId;
    await category.update(updates);

    res.status(200).json({
      category: serializeIngredientCategory(category),
    });
  } catch (error) {
    handleError(res, error, 'Failed to update ingredient category');
  }
};

export const listOpenBarIngredientVariants = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const includeInactive = toBoolean(req.query.includeInactive, false);
    const where: Record<string, unknown> = includeInactive ? {} : { isActive: true };
    if (req.query.ingredientId != null && req.query.ingredientId !== '') {
      where.ingredientId = parsePositiveInteger(req.query.ingredientId, 'ingredientId');
    }

    const variants = await OpenBarIngredientVariant.findAll({
      where,
      include: [{ model: OpenBarIngredient, as: 'ingredient', attributes: ['id', 'name', 'baseUnit'] }],
      order: [
        ['ingredientId', 'ASC'],
        ['name', 'ASC'],
      ],
    });

    res.status(200).json({
      variants: variants.map((variant) => serializeIngredientVariant(variant)),
    });
  } catch (error) {
    handleError(res, error, 'Failed to list ingredient variants');
  }
};

export const createOpenBarIngredientVariant = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const actorId = requireActorId(req);
    const ingredientId = parsePositiveInteger(req.body?.ingredientId, 'ingredientId');
    const ingredient = await OpenBarIngredient.findByPk(ingredientId);
    if (!ingredient) {
      throw new HttpError(404, 'Ingredient not found');
    }

    const name = sanitizeName(req.body?.name, 'name');
    const brand = req.body?.brand == null || String(req.body.brand).trim() === '' ? null : String(req.body.brand).trim();
    const packageLabel =
      req.body?.packageLabel == null || String(req.body.packageLabel).trim() === ''
        ? null
        : String(req.body.packageLabel).trim();
    const baseQuantity = parseNonNegativeNumber(req.body?.baseQuantity, 'baseQuantity');
    if (baseQuantity <= 0) {
      throw new HttpError(400, 'baseQuantity must be greater than zero');
    }
    const isActive = toBoolean(req.body?.isActive, true);

    const existing = await OpenBarIngredientVariant.findOne({
      where: {
        ingredientId,
        name,
      },
    });
    if (existing) {
      throw new HttpError(409, 'Variant with the same name already exists for this ingredient');
    }

    const variant = await OpenBarIngredientVariant.create({
      ingredientId,
      name,
      brand,
      packageLabel,
      baseQuantity,
      isActive,
      createdBy: actorId,
      updatedBy: actorId,
    });

    const fresh = await OpenBarIngredientVariant.findByPk(variant.id, {
      include: [{ model: OpenBarIngredient, as: 'ingredient', attributes: ['id', 'name', 'baseUnit'] }],
    });

    res.status(201).json({
      variant: fresh ? serializeIngredientVariant(fresh) : serializeIngredientVariant(variant),
    });
  } catch (error) {
    handleError(res, error, 'Failed to create ingredient variant');
  }
};

export const updateOpenBarIngredientVariant = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const actorId = requireActorId(req);
    const variantId = parsePositiveInteger(req.params.id, 'id');
    const variant = await OpenBarIngredientVariant.findByPk(variantId, {
      include: [{ model: OpenBarIngredient, as: 'ingredient', attributes: ['id', 'name', 'baseUnit'] }],
    });
    if (!variant) {
      throw new HttpError(404, 'Ingredient variant not found');
    }

    const updates: Record<string, unknown> = {};
    const nextIngredientId =
      req.body?.ingredientId !== undefined
        ? parsePositiveInteger(req.body.ingredientId, 'ingredientId')
        : variant.ingredientId;
    if (nextIngredientId !== variant.ingredientId) {
      const ingredient = await OpenBarIngredient.findByPk(nextIngredientId);
      if (!ingredient) {
        throw new HttpError(404, 'Ingredient not found');
      }
      updates.ingredientId = nextIngredientId;
    }

    const nextName = req.body?.name !== undefined ? sanitizeName(req.body.name, 'name') : variant.name;
    if (nextName !== variant.name) {
      updates.name = nextName;
    }

    if (req.body?.brand !== undefined) {
      updates.brand = req.body.brand == null || String(req.body.brand).trim() === '' ? null : String(req.body.brand).trim();
    }

    if (req.body?.packageLabel !== undefined) {
      updates.packageLabel =
        req.body.packageLabel == null || String(req.body.packageLabel).trim() === ''
          ? null
          : String(req.body.packageLabel).trim();
    }

    if (req.body?.baseQuantity !== undefined) {
      const nextBaseQuantity = parseNonNegativeNumber(req.body.baseQuantity, 'baseQuantity');
      if (nextBaseQuantity <= 0) {
        throw new HttpError(400, 'baseQuantity must be greater than zero');
      }
      const currentBaseQuantity = parseNumber(variant.baseQuantity, 0);
      const baseQuantityChanged = Math.abs(currentBaseQuantity - nextBaseQuantity) > STOCK_EPSILON;
      if (baseQuantityChanged) {
        const usageCount = await OpenBarDeliveryItem.count({ where: { variantId: variant.id } });
        if (usageCount > 0) {
          throw new HttpError(409, 'Cannot change base quantity for a variant with delivery history. Create a new variant instead.');
        }
      }
      updates.baseQuantity = nextBaseQuantity;
    }

    if (req.body?.isActive !== undefined) {
      updates.isActive = toBoolean(req.body.isActive, variant.isActive);
    }

    if (Object.keys(updates).length === 0) {
      res.status(200).json({ message: 'No changes applied' });
      return;
    }

    const conflict = await OpenBarIngredientVariant.findOne({
      where: {
        id: { [Op.ne]: variant.id },
        ingredientId: updates.ingredientId ?? variant.ingredientId,
        name: updates.name ?? variant.name,
      },
    });
    if (conflict) {
      throw new HttpError(409, 'Variant with the same name already exists for this ingredient');
    }

    updates.updatedBy = actorId;
    await variant.update(updates);

    const fresh = await OpenBarIngredientVariant.findByPk(variant.id, {
      include: [{ model: OpenBarIngredient, as: 'ingredient', attributes: ['id', 'name', 'baseUnit'] }],
    });

    res.status(200).json({
      variant: fresh ? serializeIngredientVariant(fresh) : serializeIngredientVariant(variant),
    });
  } catch (error) {
    handleError(res, error, 'Failed to update ingredient variant');
  }
};

const startOfBusinessDate = (businessDate: string): Date => dayjs(businessDate).startOf('day').toDate();
const endOfBusinessDateExclusive = (businessDate: string): Date =>
  dayjs(businessDate).add(1, 'day').startOf('day').toDate();

export const listOpenBarIngredients = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const includeInactive = toBoolean(req.query.includeInactive, false);
    const ingredients = await OpenBarIngredient.findAll({
      where: includeInactive ? undefined : { isActive: true },
      include: [{ model: OpenBarIngredientCategory, as: 'categoryRef', attributes: ['id', 'name', 'slug', 'isActive'] }],
      order: [['name', 'ASC']],
    });
    const stockMap = await getStockMap();
    res.status(200).json({
      ingredients: ingredients.map((ingredient) => serializeIngredient(ingredient, stockMap)),
    });
  } catch (error) {
    handleError(res, error, 'Failed to list ingredients');
  }
};

export const createOpenBarIngredient = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const transaction = await OpenBarIngredient.sequelize?.transaction();
  if (!transaction) {
    res.status(500).json({ message: 'Database transaction unavailable' });
    return;
  }
  try {
    const actorId = getActorId(req);
    const name = sanitizeName(req.body?.name, 'name');
    const categoryId = await resolveIngredientCategoryId(req.body?.categoryId ?? req.body?.category, null, { transaction });
    const baseUnit = resolveUnit(req.body?.baseUnit, 'ml');
    const parLevel = parseNonNegativeNumber(req.body?.parLevel, 'parLevel', 0);
    const reorderLevel = parseNonNegativeNumber(req.body?.reorderLevel, 'reorderLevel', 0);
    const ingredientIsActive = toBoolean(req.body?.isActive, true);
    const isCup = toBoolean(req.body?.isCup, false);
    const isIce = toBoolean(req.body?.isIce, false);
    const cupType = isCup ? resolveCupType(req.body?.cupType, 'disposable') : null;
    const cupCapacityMl = isCup ? resolveCupCapacityMl(req.body?.cupCapacityMl, { required: true }) : null;
    const costPerUnitRaw = req.body?.costPerUnit;
    const costPerUnit =
      costPerUnitRaw == null || costPerUnitRaw === ''
        ? null
        : parseNonNegativeNumber(costPerUnitRaw, 'costPerUnit');

    if (isCup && baseUnit !== 'unit') {
      throw new HttpError(400, 'Cup ingredients must use base unit "unit"');
    }
    if (isCup && isIce) {
      throw new HttpError(400, 'Ingredient cannot be both cup and ice');
    }

    const ingredient = await OpenBarIngredient.create(
      {
        name,
        categoryId,
        baseUnit,
        parLevel,
        reorderLevel,
        costPerUnit,
        isActive: ingredientIsActive,
        isCup,
        cupType,
        cupCapacityMl,
        isIce,
        createdBy: actorId,
        updatedBy: actorId,
      },
      { transaction },
    );

    // Keep delivery UX seamless: every new ingredient starts with a default product variant.
    await OpenBarIngredientVariant.create(
      {
        ingredientId: ingredient.id,
        name: 'Generic',
        brand: null,
        packageLabel: 'Generic',
        baseQuantity: 1,
        isActive: ingredientIsActive,
        createdBy: actorId,
        updatedBy: actorId,
      },
      { transaction },
    );

    const fresh = await OpenBarIngredient.findByPk(ingredient.id, {
      include: [{ model: OpenBarIngredientCategory, as: 'categoryRef', attributes: ['id', 'name', 'slug', 'isActive'] }],
      transaction,
    });

    await transaction.commit();
    res.status(201).json({
      ingredient: serializeIngredient(fresh ?? ingredient, new Map([[ingredient.id, 0]])),
    });
  } catch (error) {
    await transaction.rollback();
    handleError(res, error, 'Failed to create ingredient');
  }
};

export const updateOpenBarIngredient = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const transaction = await OpenBarIngredient.sequelize?.transaction();
  if (!transaction) {
    res.status(500).json({ message: 'Database transaction unavailable' });
    return;
  }
  try {
    const actorId = getActorId(req);
    const ingredientId = parsePositiveInteger(req.params.id, 'id');
    const ingredient = await OpenBarIngredient.findByPk(ingredientId, { transaction });
    if (!ingredient) {
      throw new HttpError(404, 'Ingredient not found');
    }

    const updates: Record<string, unknown> = {};
    if (req.body?.name !== undefined) {
      updates.name = sanitizeName(req.body.name, 'name');
    }
    if (req.body?.categoryId !== undefined || req.body?.category !== undefined) {
      updates.categoryId = await resolveIngredientCategoryId(
        req.body?.categoryId ?? req.body?.category,
        ingredient.categoryId,
        { includeInactive: true, transaction },
      );
    }
    const nextBaseUnit =
      req.body?.baseUnit !== undefined
        ? resolveUnit(req.body.baseUnit, ingredient.baseUnit)
        : ingredient.baseUnit;
    const baseUnitChanged = nextBaseUnit !== ingredient.baseUnit;
    if (baseUnitChanged) {
      updates.baseUnit = nextBaseUnit;
    }
    const nextIsCup =
      req.body?.isCup !== undefined
        ? toBoolean(req.body.isCup, ingredient.isCup)
        : ingredient.isCup;
    const nextIsIce =
      req.body?.isIce !== undefined
        ? toBoolean(req.body.isIce, ingredient.isIce)
        : ingredient.isIce;
    const nextCupType = nextIsCup
      ? resolveCupType(req.body?.cupType, ingredient.cupType ?? 'disposable')
      : null;
    const nextCupCapacityMl = nextIsCup
      ? resolveCupCapacityMl(req.body?.cupCapacityMl, {
          fallback: ingredient.cupCapacityMl == null ? null : parseNumber(ingredient.cupCapacityMl, 0),
          required: !ingredient.isCup || req.body?.isCup !== undefined,
        })
      : null;

    if (nextIsCup && nextBaseUnit !== 'unit') {
      throw new HttpError(400, 'Cup ingredients must use base unit "unit"');
    }
    if (nextIsCup && nextIsIce) {
      throw new HttpError(400, 'Ingredient cannot be both cup and ice');
    }

    if (!nextIsCup && ingredient.isCup) {
      const recipeCupUsage = await OpenBarRecipe.count({
        where: { cupIngredientId: ingredient.id },
        transaction,
      });
      if (recipeCupUsage > 0) {
        throw new HttpError(409, 'Cannot disable cup flag while ingredient is assigned as recipe cup');
      }
    }

    if (nextIsCup !== ingredient.isCup) {
      updates.isCup = nextIsCup;
    }
    if (nextIsIce !== ingredient.isIce) {
      updates.isIce = nextIsIce;
    }
    if (nextCupType !== ingredient.cupType) {
      updates.cupType = nextCupType;
    }
    const currentCupCapacityMl = ingredient.cupCapacityMl == null ? null : parseNumber(ingredient.cupCapacityMl, 0);
    if (nextCupCapacityMl !== currentCupCapacityMl) {
      updates.cupCapacityMl = nextCupCapacityMl;
    }
    if (req.body?.parLevel !== undefined) {
      updates.parLevel = parseNonNegativeNumber(req.body.parLevel, 'parLevel');
    }
    if (req.body?.reorderLevel !== undefined) {
      updates.reorderLevel = parseNonNegativeNumber(req.body.reorderLevel, 'reorderLevel');
    }
    if (req.body?.costPerUnit !== undefined) {
      updates.costPerUnit =
        req.body.costPerUnit == null || req.body.costPerUnit === ''
          ? null
          : parseNonNegativeNumber(req.body.costPerUnit, 'costPerUnit');
    }
    if (req.body?.isActive !== undefined) {
      updates.isActive = toBoolean(req.body.isActive, ingredient.isActive);
    }

    if (baseUnitChanged) {
      const stockMap = await getStockMap([ingredient.id], transaction);
      const currentStock = stockMap.get(ingredient.id) ?? 0;
      const movementCount = await OpenBarInventoryMovement.count({
        where: { ingredientId: ingredient.id },
        transaction,
      });
      const recipeLineCount = await OpenBarRecipeIngredient.count({
        where: { ingredientId: ingredient.id },
        transaction,
      });
      const deliveryLineCount = await OpenBarDeliveryItem.count({
        where: { ingredientId: ingredient.id },
        transaction,
      });

      const hasHistoricalQuantities =
        Math.abs(currentStock) > STOCK_EPSILON ||
        movementCount > 0 ||
        recipeLineCount > 0 ||
        deliveryLineCount > 0;

      const conversionFactorRaw = req.body?.unitConversionFactor;
      const hasConversionFactor =
        conversionFactorRaw !== undefined && conversionFactorRaw !== null && conversionFactorRaw !== '';

      if (hasHistoricalQuantities && !hasConversionFactor) {
        throw new HttpError(
          400,
          'Changing base unit requires unitConversionFactor because this ingredient already has quantity history',
          {
            ingredientId: ingredient.id,
            fromUnit: ingredient.baseUnit,
            toUnit: nextBaseUnit,
            currentStock,
            movementCount,
            recipeLineCount,
            deliveryLineCount,
          },
        );
      }

      if (hasConversionFactor) {
        const conversionFactor = parseNonNegativeNumber(conversionFactorRaw, 'unitConversionFactor');
        if (conversionFactor <= 0) {
          throw new HttpError(400, 'unitConversionFactor must be greater than zero');
        }

        const sequelize = OpenBarIngredient.sequelize;
        if (!sequelize) {
          throw new HttpError(500, 'Database connection unavailable');
        }

        await sequelize.query(
          `
          UPDATE open_bar_recipe_ingredients
          SET quantity = quantity * :conversionFactor,
              updated_at = NOW()
          WHERE ingredient_id = :ingredientId
          `,
          { replacements: { ingredientId: ingredient.id, conversionFactor }, transaction },
        );

        await sequelize.query(
          `
          UPDATE open_bar_delivery_items
          SET quantity = quantity * :conversionFactor,
              unit_cost = CASE
                WHEN unit_cost IS NULL THEN NULL
                ELSE unit_cost / :conversionFactor
              END,
              updated_at = NOW()
          WHERE ingredient_id = :ingredientId
          `,
          { replacements: { ingredientId: ingredient.id, conversionFactor }, transaction },
        );

        await sequelize.query(
          `
          UPDATE open_bar_inventory_movements
          SET quantity_delta = quantity_delta * :conversionFactor,
              updated_at = NOW()
          WHERE ingredient_id = :ingredientId
          `,
          { replacements: { ingredientId: ingredient.id, conversionFactor }, transaction },
        );

        await sequelize.query(
          `
          UPDATE open_bar_ingredient_variants
          SET base_quantity = base_quantity * :conversionFactor,
              updated_at = NOW()
          WHERE ingredient_id = :ingredientId
          `,
          { replacements: { ingredientId: ingredient.id, conversionFactor }, transaction },
        );

        if (req.body?.parLevel === undefined) {
          updates.parLevel = parseNumber(ingredient.parLevel, 0) * conversionFactor;
        }
        if (req.body?.reorderLevel === undefined) {
          updates.reorderLevel = parseNumber(ingredient.reorderLevel, 0) * conversionFactor;
        }
        if (req.body?.costPerUnit === undefined && ingredient.costPerUnit != null) {
          updates.costPerUnit = parseNumber(ingredient.costPerUnit, 0) / conversionFactor;
        }
      }
    }

    if (Object.keys(updates).length === 0) {
      await transaction.commit();
      res.status(200).json({ message: 'No changes applied' });
      return;
    }

    updates.updatedBy = actorId;
    await ingredient.update(updates, { transaction });
    const fresh = await OpenBarIngredient.findByPk(ingredient.id, {
      include: [{ model: OpenBarIngredientCategory, as: 'categoryRef', attributes: ['id', 'name', 'slug', 'isActive'] }],
      transaction,
    });
    const stockMap = await getStockMap([ingredient.id], transaction);
    await transaction.commit();
    res.status(200).json({ ingredient: serializeIngredient(fresh ?? ingredient, stockMap) });
  } catch (error) {
    await transaction.rollback();
    handleError(res, error, 'Failed to update ingredient');
  }
};

export const listOpenBarRecipes = async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const recipes = await OpenBarRecipe.findAll({
      include: [
        { model: OpenBarIngredient, as: 'cupIngredient', attributes: ['id', 'name', 'baseUnit', 'isCup', 'cupType', 'cupCapacityMl', 'costPerUnit', 'isActive'] },
        {
          model: OpenBarRecipeIngredient,
          as: 'ingredients',
          include: [
            { model: OpenBarIngredient, as: 'ingredient' },
            { model: OpenBarIngredientCategory, as: 'category' },
          ],
        },
      ],
      order: [
        ['name', 'ASC'],
        [{ model: OpenBarRecipeIngredient, as: 'ingredients' }, 'sortOrder', 'ASC'],
      ],
    });
    res.status(200).json({
      recipes: recipes.map((recipe) => serializeRecipe(recipe)),
    });
  } catch (error) {
    handleError(res, error, 'Failed to list recipes');
  }
};

export const createOpenBarRecipe = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const transaction = await OpenBarRecipe.sequelize?.transaction();
  if (!transaction) {
    res.status(500).json({ message: 'Database transaction unavailable' });
    return;
  }
  try {
    const actorId = getActorId(req);
    const name = sanitizeName(req.body?.name, 'name');
    const drinkType = resolveDrinkType(req.body?.drinkType, 'custom');
    const defaultServings = parsePositiveInteger(req.body?.defaultServings, 'defaultServings', 1);
    const instructions =
      req.body?.instructions == null || req.body.instructions === ''
        ? null
        : String(req.body.instructions);
    const isActive = toBoolean(req.body?.isActive, true);
    const askStrength = toBoolean(req.body?.askStrength, false);
    const labelDisplayMode = resolveDrinkLabelMode(req.body?.labelDisplayMode, null, { allowNull: true });
    const hasIce = toBoolean(req.body?.hasIce, false);
    const iceCubes = hasIce ? resolveRecipeIceCubes(req.body?.iceCubes, { required: true }) : 0;
    if (hasIce && iceCubes <= 0) {
      throw new HttpError(400, 'iceCubes must be greater than zero when hasIce is true');
    }
    const cupIngredientId = await resolveRecipeCupIngredientId(req.body?.cupIngredientId, transaction, { required: true });
    const ingredients = parseRecipeIngredientsPayload(req.body?.ingredients);
    await ensureRecipeLineIngredientIdsValid(
      ingredients
        .map((line) => line.ingredientId)
        .filter((ingredientId): ingredientId is number => ingredientId != null),
      transaction,
    );
    await ensureIngredientCategoryIdsExist(
      ingredients
        .map((line) => line.categoryId)
        .filter((categoryId): categoryId is number => categoryId != null),
      transaction,
    );

    const recipe = await OpenBarRecipe.create(
      {
        name,
        drinkType,
        defaultServings,
        labelDisplayMode,
        instructions,
        isActive,
        askStrength,
        hasIce,
        iceCubes,
        cupIngredientId,
        createdBy: actorId,
        updatedBy: actorId,
      },
      { transaction },
    );

    if (ingredients.length > 0) {
      await OpenBarRecipeIngredient.bulkCreate(
        ingredients.map((line) => ({
          recipeId: recipe.id,
          ingredientId: line.ingredientId,
          categoryId: line.categoryId,
          lineType: line.lineType,
          quantity: line.quantity,
          sortOrder: line.sortOrder,
          isOptional: line.isOptional,
          affectsStrength: line.affectsStrength,
          isTopUp: line.isTopUp,
        })),
        { transaction },
      );
    }

    const fresh = await loadRecipeById(recipe.id, transaction);
    await transaction.commit();
    res.status(201).json({
      recipe: fresh ? serializeRecipe(fresh) : null,
    });
  } catch (error) {
    await transaction.rollback();
    handleError(res, error, 'Failed to create recipe');
  }
};

export const updateOpenBarRecipe = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const actorId = getActorId(req);
    const recipeId = parsePositiveInteger(req.params.id, 'id');
    const recipe = await OpenBarRecipe.findByPk(recipeId);
    if (!recipe) {
      throw new HttpError(404, 'Recipe not found');
    }

    const updates: Record<string, unknown> = {};
    if (req.body?.name !== undefined) {
      updates.name = sanitizeName(req.body.name, 'name');
    }
    if (req.body?.drinkType !== undefined) {
      updates.drinkType = resolveDrinkType(req.body.drinkType, recipe.drinkType);
    }
    if (req.body?.defaultServings !== undefined) {
      updates.defaultServings = parsePositiveInteger(req.body.defaultServings, 'defaultServings');
    }
    if (req.body?.instructions !== undefined) {
      updates.instructions =
        req.body.instructions == null || req.body.instructions === ''
          ? null
          : String(req.body.instructions);
    }
    if (req.body?.isActive !== undefined) {
      updates.isActive = toBoolean(req.body.isActive, recipe.isActive);
    }
    if (req.body?.askStrength !== undefined) {
      updates.askStrength = toBoolean(req.body.askStrength, recipe.askStrength);
    }
    if (req.body?.labelDisplayMode !== undefined) {
      updates.labelDisplayMode = resolveDrinkLabelMode(req.body.labelDisplayMode, recipe.labelDisplayMode, { allowNull: true });
    }
    const nextHasIce =
      req.body?.hasIce !== undefined
        ? toBoolean(req.body.hasIce, recipe.hasIce)
        : recipe.hasIce;
    const nextIceCubes = nextHasIce
      ? resolveRecipeIceCubes(req.body?.iceCubes, {
          fallback: recipe.hasIce ? recipe.iceCubes : DEFAULT_ICE_CUBES_PER_DRINK,
          required: req.body?.hasIce !== undefined && nextHasIce,
        })
      : 0;
    if (nextHasIce && nextIceCubes <= 0) {
      throw new HttpError(400, 'iceCubes must be greater than zero when hasIce is true');
    }
    if (nextHasIce !== recipe.hasIce) {
      updates.hasIce = nextHasIce;
    }
    if (nextIceCubes !== recipe.iceCubes) {
      updates.iceCubes = nextIceCubes;
    }
    const nextCupIngredientId =
      req.body?.cupIngredientId !== undefined
        ? await resolveRecipeCupIngredientId(req.body.cupIngredientId, undefined, { required: true })
        : recipe.cupIngredientId;
    if (nextCupIngredientId == null) {
      throw new HttpError(400, 'Recipe must have an assigned cup');
    }
    if (req.body?.cupIngredientId !== undefined) {
      updates.cupIngredientId = nextCupIngredientId;
    }

    if (Object.keys(updates).length === 0) {
      res.status(200).json({ message: 'No changes applied' });
      return;
    }

    updates.updatedBy = actorId;
    await recipe.update(updates);
    const fresh = await loadRecipeById(recipe.id);
    res.status(200).json({ recipe: fresh ? serializeRecipe(fresh) : null });
  } catch (error) {
    handleError(res, error, 'Failed to update recipe');
  }
};

export const replaceOpenBarRecipeIngredients = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const transaction = await OpenBarRecipe.sequelize?.transaction();
  if (!transaction) {
    res.status(500).json({ message: 'Database transaction unavailable' });
    return;
  }
  try {
    const recipeId = parsePositiveInteger(req.params.id, 'id');
    const recipe = await OpenBarRecipe.findByPk(recipeId, { transaction });
    if (!recipe) {
      throw new HttpError(404, 'Recipe not found');
    }

    const ingredients = parseRecipeIngredientsPayload(req.body?.ingredients);
    await ensureRecipeLineIngredientIdsValid(
      ingredients
        .map((line) => line.ingredientId)
        .filter((ingredientId): ingredientId is number => ingredientId != null),
      transaction,
    );
    await ensureIngredientCategoryIdsExist(
      ingredients
        .map((line) => line.categoryId)
        .filter((categoryId): categoryId is number => categoryId != null),
      transaction,
    );

    await OpenBarRecipeIngredient.destroy({
      where: { recipeId },
      transaction,
    });

    if (ingredients.length > 0) {
      await OpenBarRecipeIngredient.bulkCreate(
        ingredients.map((line) => ({
          recipeId,
          ingredientId: line.ingredientId,
          categoryId: line.categoryId,
          lineType: line.lineType,
          quantity: line.quantity,
          sortOrder: line.sortOrder,
          isOptional: line.isOptional,
          affectsStrength: line.affectsStrength,
          isTopUp: line.isTopUp,
        })),
        { transaction },
      );
    }

    const fresh = await loadRecipeById(recipeId, transaction);
    await transaction.commit();
    res.status(200).json({ recipe: fresh ? serializeRecipe(fresh) : null });
  } catch (error) {
    await transaction.rollback();
    handleError(res, error, 'Failed to replace recipe ingredients');
  }
};

type DrinkLabelSettingPayload = {
  drinkType: OpenBarDrinkType;
  displayMode: OpenBarDrinkLabelDisplayMode;
};

const parseDrinkLabelSettingsPayload = (value: unknown): DrinkLabelSettingPayload[] => {
  if (!Array.isArray(value) || value.length === 0) {
    throw new HttpError(400, 'settings must be a non-empty array');
  }

  const parsed = value.map((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      throw new HttpError(400, `settings[${index}] must be an object`);
    }
    const record = entry as { drinkType?: unknown; displayMode?: unknown };
    return {
      drinkType: resolveDrinkType(record.drinkType, 'custom'),
      displayMode: resolveDrinkLabelMode(record.displayMode, 'recipe_name') ?? 'recipe_name',
    };
  });

  const duplicateDrinkTypes = parsed
    .map((entry) => entry.drinkType)
    .filter((drinkType, index, arr) => arr.indexOf(drinkType) !== index);
  if (duplicateDrinkTypes.length > 0) {
    throw new HttpError(400, 'settings contains duplicate drinkType values', { duplicateDrinkTypes });
  }

  return parsed;
};

export const listOpenBarDrinkLabelSettings = async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const map = await getDrinkLabelSettingMap();
    res.status(200).json({
      settings: DRINK_TYPES.map((drinkType) =>
        serializeDrinkLabelSetting(drinkType, map.get(drinkType) ?? DEFAULT_DRINK_LABEL_MODE_BY_TYPE[drinkType]),
      ),
    });
  } catch (error) {
    handleError(res, error, 'Failed to list drink label settings');
  }
};

export const updateOpenBarDrinkLabelSettings = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const transaction = await OpenBarDrinkLabelSetting.sequelize?.transaction();
  if (!transaction) {
    res.status(500).json({ message: 'Database transaction unavailable' });
    return;
  }

  try {
    const actorId = getActorId(req);
    const payload = parseDrinkLabelSettingsPayload(req.body?.settings);
    const existing = await OpenBarDrinkLabelSetting.findAll({ transaction });
    const byDrinkType = new Map<OpenBarDrinkType, OpenBarDrinkLabelSetting>();
    existing.forEach((setting) => {
      byDrinkType.set(resolveDrinkType(setting.drinkType, 'custom'), setting);
    });

    for (const row of payload) {
      const current = byDrinkType.get(row.drinkType);
      if (current) {
        await current.update(
          {
            displayMode: row.displayMode,
            updatedBy: actorId,
          },
          { transaction },
        );
      } else {
        await OpenBarDrinkLabelSetting.create(
          {
            drinkType: row.drinkType,
            displayMode: row.displayMode,
            createdBy: actorId,
            updatedBy: actorId,
          },
          { transaction },
        );
      }
    }

    const map = await getDrinkLabelSettingMap(transaction);
    await transaction.commit();
    res.status(200).json({
      settings: DRINK_TYPES.map((drinkType) =>
        serializeDrinkLabelSetting(drinkType, map.get(drinkType) ?? DEFAULT_DRINK_LABEL_MODE_BY_TYPE[drinkType]),
      ),
    });
  } catch (error) {
    await transaction.rollback();
    handleError(res, error, 'Failed to update drink label settings');
  }
};

export const listOpenBarSessionTypes = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const includeInactive = toBoolean(req.query.includeInactive, false);
    const sessionTypes = await OpenBarSessionType.findAll({
      where: includeInactive ? undefined : { isActive: true },
      order: [
        ['sortOrder', 'ASC'],
        ['name', 'ASC'],
      ],
    });

    res.status(200).json({
      sessionTypes: sessionTypes.map((sessionType) => serializeSessionType(sessionType)),
    });
  } catch (error) {
    handleError(res, error, 'Failed to list session types');
  }
};

export const createOpenBarSessionType = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const actorId = getActorId(req);
    const name = sanitizeName(req.body?.name, 'name');
    const slug = req.body?.slug ? normalizeCategorySlug(req.body.slug, 'slug') : normalizeCategorySlug(name, 'slug');
    const defaultTimeLimitMinutes = parsePositiveInteger(req.body?.defaultTimeLimitMinutes, 'defaultTimeLimitMinutes', 60);
    const sortOrder = resolveCategorySortOrder(req.body?.sortOrder, 0);
    const isActive = toBoolean(req.body?.isActive, true);

    const existing = await OpenBarSessionType.findOne({ where: { slug } });
    if (existing) {
      throw new HttpError(409, `Session type slug already exists: ${slug}`);
    }

    const sessionType = await OpenBarSessionType.create({
      name,
      slug,
      defaultTimeLimitMinutes,
      sortOrder,
      isActive,
      createdBy: actorId,
      updatedBy: actorId,
    });

    res.status(201).json({ sessionType: serializeSessionType(sessionType) });
  } catch (error) {
    handleError(res, error, 'Failed to create session type');
  }
};

export const updateOpenBarSessionType = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const actorId = getActorId(req);
    const sessionTypeId = parsePositiveInteger(req.params.id, 'id');
    const sessionType = await OpenBarSessionType.findByPk(sessionTypeId);
    if (!sessionType) {
      throw new HttpError(404, 'Session type not found');
    }

    const updates: Partial<OpenBarSessionType> = {};
    if (req.body?.name !== undefined) {
      updates.name = sanitizeName(req.body.name, 'name');
    }
    if (req.body?.slug !== undefined) {
      updates.slug = normalizeCategorySlug(req.body.slug, 'slug');
    }
    if (req.body?.defaultTimeLimitMinutes !== undefined) {
      updates.defaultTimeLimitMinutes = parsePositiveInteger(req.body.defaultTimeLimitMinutes, 'defaultTimeLimitMinutes');
    }
    if (req.body?.sortOrder !== undefined) {
      updates.sortOrder = resolveCategorySortOrder(req.body.sortOrder, sessionType.sortOrder);
    }
    if (req.body?.isActive !== undefined) {
      updates.isActive = toBoolean(req.body.isActive, sessionType.isActive);
    }

    if (updates.slug && updates.slug !== sessionType.slug) {
      const conflicting = await OpenBarSessionType.findOne({
        where: {
          slug: updates.slug,
          id: { [Op.ne]: sessionType.id },
        },
      });
      if (conflicting) {
        throw new HttpError(409, `Session type slug already exists: ${updates.slug}`);
      }
    }

    if (Object.keys(updates).length === 0) {
      res.status(200).json({ message: 'No changes applied', sessionType: serializeSessionType(sessionType) });
      return;
    }

    updates.updatedBy = actorId;
    await sessionType.update(updates);
    res.status(200).json({ sessionType: serializeSessionType(sessionType) });
  } catch (error) {
    handleError(res, error, 'Failed to update session type');
  }
};

export const listOpenBarSessions = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const actorId = requireActorId(req);
    const managerAccess = hasOpenBarManagerOverrideAccess(req);
    const businessDate = req.query.businessDate ? normalizeDateOnly(req.query.businessDate) : null;
    const status = req.query.status ? resolveSessionStatus(req.query.status, 'draft') : null;
    const limit = Math.min(parsePositiveInteger(req.query.limit, 'limit', 30), 200);

    const membershipContext = await getUserSessionMembershipContext(actorId, {
      businessDate: businessDate ?? undefined,
    });
    const serializationContext = {
      actorId,
      joinedSessionIds: membershipContext.joinedSessionIds,
      activeJoinedSessionIds: membershipContext.activeJoinedSessionIds,
    };

    const sessionWhereClauses: Array<Record<string | symbol, unknown>> = [];
    if (status) {
      sessionWhereClauses.push({ status });
    }
    if (businessDate) {
      sessionWhereClauses.push({ businessDate });
    }
    if (!managerAccess) {
      sessionWhereClauses.push(buildSessionVisibilityFilter(actorId, membershipContext.joinedSessionIds));
    }

    const sessionWhere =
      sessionWhereClauses.length === 0
        ? undefined
        : sessionWhereClauses.length === 1
        ? sessionWhereClauses[0]
        : { [Op.and]: sessionWhereClauses };

    const sessionInclude = [
      { model: Venue, as: 'venue', attributes: ['id', 'name'] },
      { model: OpenBarSessionType, as: 'sessionType', attributes: ['id', 'name', 'slug'] },
      { model: User, as: 'createdByUser', attributes: ['id', 'firstName', 'lastName'] },
    ];

    const sessions = await OpenBarSession.findAll({
      where: sessionWhere,
      include: sessionInclude,
      order: [
        ['businessDate', 'DESC'],
        ['id', 'DESC'],
      ],
      limit,
    });

    const activeJoinedSessionIds = Array.from(membershipContext.activeJoinedSessionIds.values());
    const shouldIncludeJoinableSessions = status == null || status === 'active';
    const joinableSessionsRaw = shouldIncludeJoinableSessions
      ? await (async () => {
          const joinableWhereClauses: Array<Record<string | symbol, unknown>> = [{ status: 'active' }];
          if (businessDate) {
            joinableWhereClauses.push({ businessDate });
          }
          if (activeJoinedSessionIds.length > 0) {
            joinableWhereClauses.push({
              id: {
                [Op.notIn]: activeJoinedSessionIds,
              },
            });
          }
          return OpenBarSession.findAll({
            where: joinableWhereClauses.length === 1 ? joinableWhereClauses[0] : { [Op.and]: joinableWhereClauses },
            include: sessionInclude,
            order: [
              ['businessDate', 'DESC'],
              ['id', 'DESC'],
            ],
            limit,
          });
        })()
      : [];

    const visibleSessionIds = new Set(sessions.map((session) => session.id));
    const joinableSessions = joinableSessionsRaw.filter((session) => !visibleSessionIds.has(session.id));

    const summarySessionIds = Array.from(
      new Set([...sessions.map((session) => session.id), ...joinableSessions.map((session) => session.id)]),
    );
    const issues =
      summarySessionIds.length > 0
        ? await OpenBarDrinkIssue.findAll({
            attributes: ['sessionId', 'servings', 'issuedAt'],
            where: { sessionId: { [Op.in]: summarySessionIds } },
            raw: true,
          })
        : [];

    const summaryMap = new Map<number, { issuesCount: number; servings: number; lastIssuedAt: Date | null }>();
    issues.forEach((issue) => {
      const sessionId = Number((issue as { sessionId: number }).sessionId);
      const entry = summaryMap.get(sessionId) ?? { issuesCount: 0, servings: 0, lastIssuedAt: null };
      entry.issuesCount += 1;
      entry.servings += parseNumber((issue as { servings: unknown }).servings, 0);
      const issuedAt = normalizeDateTime((issue as { issuedAt: unknown }).issuedAt, new Date(0));
      if (!entry.lastIssuedAt || issuedAt > entry.lastIssuedAt) {
        entry.lastIssuedAt = issuedAt;
      }
      summaryMap.set(sessionId, entry);
    });

    res.status(200).json({
      sessions: sessions.map((session) =>
        serializeSession(
          session,
          summaryMap.get(session.id) ?? { issuesCount: 0, servings: 0, lastIssuedAt: null },
          serializationContext,
        ),
      ),
      joinableSessions: joinableSessions.map((session) =>
        serializeSession(
          session,
          summaryMap.get(session.id) ?? { issuesCount: 0, servings: 0, lastIssuedAt: null },
          serializationContext,
        ),
      ),
      currentUserSessionId: activeJoinedSessionIds[0] ?? null,
    });
  } catch (error) {
    handleError(res, error, 'Failed to list sessions');
  }
};

export const createOpenBarSession = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const transaction = await OpenBarSession.sequelize?.transaction();
  if (!transaction) {
    res.status(500).json({ message: 'Database transaction unavailable' });
    return;
  }
  try {
    const actorId = requireActorId(req);
    const sessionName = sanitizeName(req.body?.sessionName, 'sessionName');
    const businessDate = normalizeDateOnly(req.body?.businessDate);
    const venueId = req.body?.venueId == null || req.body.venueId === '' ? null : parsePositiveInteger(req.body.venueId, 'venueId');
    const nightReportId =
      req.body?.nightReportId == null || req.body.nightReportId === ''
        ? null
        : parsePositiveInteger(req.body.nightReportId, 'nightReportId');
    const sessionTypeId =
      req.body?.sessionTypeId == null || req.body.sessionTypeId === ''
        ? null
        : parsePositiveInteger(req.body.sessionTypeId, 'sessionTypeId');
    const status = resolveSessionStatus(req.body?.status, 'draft');
    const sessionType =
      sessionTypeId == null
        ? null
        : await OpenBarSessionType.findOne({
            where: { id: sessionTypeId, isActive: true },
            transaction,
          });
    if (sessionTypeId != null && !sessionType) {
      throw new HttpError(400, `Unknown active sessionTypeId: ${sessionTypeId}`);
    }
    const requestedTimeLimit = resolveTimeLimitMinutes(req.body?.timeLimitMinutes, null);
    const timeLimitMinutes =
      requestedTimeLimit ??
      (sessionType ? Math.max(parseNumber(sessionType.defaultTimeLimitMinutes, 60), 1) : null);

    const now = new Date();

    const session = await OpenBarSession.create({
      sessionName,
      businessDate,
      venueId,
      nightReportId,
      sessionTypeId: sessionType?.id ?? null,
      timeLimitMinutes,
      status,
      openedAt: status === 'active' ? now : null,
      notes: req.body?.notes ? String(req.body.notes) : null,
      createdBy: actorId,
      updatedBy: actorId,
    }, { transaction });

    if (status === 'active') {
      await connectUserToSession(actorId, session.id, transaction);
    }

    await transaction.commit();

    const fresh = await OpenBarSession.findByPk(session.id, {
      include: [
        { model: Venue, as: 'venue', attributes: ['id', 'name'] },
        { model: OpenBarSessionType, as: 'sessionType', attributes: ['id', 'name', 'slug'] },
        { model: User, as: 'createdByUser', attributes: ['id', 'firstName', 'lastName'] },
      ],
    });
    const context = {
      actorId,
      joinedSessionIds: status === 'active' ? new Set<number>([session.id]) : new Set<number>(),
      activeJoinedSessionIds: status === 'active' ? new Set<number>([session.id]) : new Set<number>(),
    };
    res.status(201).json({ session: fresh ? serializeSession(fresh, undefined, context) : serializeSession(session, undefined, context) });
  } catch (error) {
    await transaction.rollback().catch(() => undefined);
    handleError(res, error, 'Failed to create session');
  }
};

export const startOpenBarSession = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const transaction = await OpenBarSession.sequelize?.transaction();
  if (!transaction) {
    res.status(500).json({ message: 'Database transaction unavailable' });
    return;
  }
  try {
    const actorId = requireActorId(req);
    const sessionId = parsePositiveInteger(req.params.id, 'id');
    const session = await OpenBarSession.findByPk(sessionId, { transaction });
    if (!session) {
      throw new HttpError(404, 'Session not found');
    }
    if (session.status === 'closed') {
      throw new HttpError(400, 'Session is already closed');
    }

    await session.update({
      status: 'active',
      openedAt: session.openedAt ?? new Date(),
      updatedBy: actorId,
    }, { transaction });

    await connectUserToSession(actorId, session.id, transaction);

    await transaction.commit();

    const fresh = await OpenBarSession.findByPk(session.id, {
      include: [
        { model: Venue, as: 'venue', attributes: ['id', 'name'] },
        { model: OpenBarSessionType, as: 'sessionType', attributes: ['id', 'name', 'slug'] },
        { model: User, as: 'createdByUser', attributes: ['id', 'firstName', 'lastName'] },
      ],
    });
    const context = {
      actorId,
      joinedSessionIds: new Set<number>([session.id]),
      activeJoinedSessionIds: new Set<number>([session.id]),
    };
    res.status(200).json({ session: fresh ? serializeSession(fresh, undefined, context) : serializeSession(session, undefined, context) });
  } catch (error) {
    await transaction.rollback().catch(() => undefined);
    handleError(res, error, 'Failed to start session');
  }
};

export const joinOpenBarSession = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const transaction = await OpenBarSession.sequelize?.transaction();
  if (!transaction) {
    res.status(500).json({ message: 'Database transaction unavailable' });
    return;
  }

  try {
    const actorId = requireActorId(req);
    const sessionId = parsePositiveInteger(req.params.id, 'id');
    const session = await OpenBarSession.findByPk(sessionId, { transaction });
    if (!session) {
      throw new HttpError(404, 'Session not found');
    }
    if (session.status !== 'active') {
      throw new HttpError(400, 'Only active sessions can be joined');
    }
    if (isSessionTimeExpired(session)) {
      throw new HttpError(400, 'Open Bar Finished! Do not serve more drinks.');
    }

    await connectUserToSession(actorId, session.id, transaction);
    await transaction.commit();

    const fresh = await OpenBarSession.findByPk(session.id, {
      include: [
        { model: Venue, as: 'venue', attributes: ['id', 'name'] },
        { model: OpenBarSessionType, as: 'sessionType', attributes: ['id', 'name', 'slug'] },
        { model: User, as: 'createdByUser', attributes: ['id', 'firstName', 'lastName'] },
      ],
    });

    const context = {
      actorId,
      joinedSessionIds: new Set<number>([session.id]),
      activeJoinedSessionIds: new Set<number>([session.id]),
    };
    res.status(200).json({
      session: fresh ? serializeSession(fresh, undefined, context) : serializeSession(session, undefined, context),
      joined: true,
    });
  } catch (error) {
    await transaction.rollback().catch(() => undefined);
    handleError(res, error, 'Failed to join session');
  }
};

export const leaveOpenBarSession = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const transaction = await OpenBarSession.sequelize?.transaction();
  if (!transaction) {
    res.status(500).json({ message: 'Database transaction unavailable' });
    return;
  }

  try {
    const actorId = requireActorId(req);
    const sessionId = parsePositiveInteger(req.params.id, 'id');
    const session = await OpenBarSession.findByPk(sessionId, { transaction });
    if (!session) {
      throw new HttpError(404, 'Session not found');
    }

    const left = await leaveUserSession(actorId, sessionId, transaction);
    await transaction.commit();

    const fresh = await OpenBarSession.findByPk(session.id, {
      include: [
        { model: Venue, as: 'venue', attributes: ['id', 'name'] },
        { model: OpenBarSessionType, as: 'sessionType', attributes: ['id', 'name', 'slug'] },
        { model: User, as: 'createdByUser', attributes: ['id', 'firstName', 'lastName'] },
      ],
    });

    const membershipContext = await getUserSessionMembershipContext(actorId, { businessDate: session.businessDate });
    const context = {
      actorId,
      joinedSessionIds: membershipContext.joinedSessionIds,
      activeJoinedSessionIds: membershipContext.activeJoinedSessionIds,
    };
    res.status(200).json({
      session: fresh ? serializeSession(fresh, undefined, context) : serializeSession(session, undefined, context),
      left,
    });
  } catch (error) {
    await transaction.rollback().catch(() => undefined);
    handleError(res, error, 'Failed to leave session');
  }
};

export const closeOpenBarSession = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const transaction = await OpenBarSession.sequelize?.transaction();
  if (!transaction) {
    res.status(500).json({ message: 'Database transaction unavailable' });
    return;
  }
  try {
    const actorId = requireActorId(req);
    const hasManagerOverride = hasOpenBarManagerOverrideAccess(req);
    const sessionId = parsePositiveInteger(req.params.id, 'id');
    const session = await OpenBarSession.findByPk(sessionId, { transaction });
    if (!session) {
      throw new HttpError(404, 'Session not found');
    }
    if (!hasManagerOverride && (session.createdBy == null || session.createdBy !== actorId)) {
      throw new HttpError(403, 'Only the session creator or a manager can close this session');
    }
    const reconciliationLines = parseSessionReconciliation(req.body?.reconciliation);
    if (session.status === 'closed') {
      await OpenBarSessionMembership.update(
        {
          isActive: false,
          leftAt: new Date(),
          updatedAt: new Date(),
        },
        {
          where: {
            sessionId: session.id,
            isActive: true,
          },
          transaction,
        },
      );
      await transaction.commit();
      const freshClosed = await OpenBarSession.findByPk(session.id, {
        include: [
          { model: Venue, as: 'venue', attributes: ['id', 'name'] },
          { model: OpenBarSessionType, as: 'sessionType', attributes: ['id', 'name', 'slug'] },
          { model: User, as: 'createdByUser', attributes: ['id', 'firstName', 'lastName'] },
        ],
      });
      res.status(200).json({ session: freshClosed ? serializeSession(freshClosed) : serializeSession(session), reconciliation: [] });
      return;
    }

    const correctionSummary: Array<{
      ingredientId: number;
      ingredientName: string | null;
      baseUnit: OpenBarIngredientUnit | null;
      systemStock: number;
      countedStock: number;
      quantityDelta: number;
    }> = [];

    if (reconciliationLines.length > 0) {
      const ingredientIds = reconciliationLines.map((line) => line.ingredientId);
      await ensureIngredientIdsExist(ingredientIds, transaction);
      const stockMap = await getStockMap(ingredientIds, transaction);

      const ingredients = await OpenBarIngredient.findAll({
        attributes: ['id', 'name', 'baseUnit'],
        where: { id: { [Op.in]: ingredientIds } },
        transaction,
      });
      const ingredientMap = new Map<number, OpenBarIngredient>();
      ingredients.forEach((ingredient) => {
        ingredientMap.set(ingredient.id, ingredient);
      });

      const corrections = reconciliationLines
        .map((line) => {
          const systemStock = stockMap.get(line.ingredientId) ?? 0;
          const quantityDelta = line.countedStock - systemStock;
          const ingredient = ingredientMap.get(line.ingredientId);
          correctionSummary.push({
            ingredientId: line.ingredientId,
            ingredientName: ingredient?.name ?? null,
            baseUnit: ingredient?.baseUnit ?? null,
            systemStock,
            countedStock: line.countedStock,
            quantityDelta,
          });
          return {
            ingredientId: line.ingredientId,
            quantityDelta,
          };
        })
        .filter((line) => Math.abs(line.quantityDelta) > STOCK_EPSILON);

      if (corrections.length > 0) {
        await OpenBarInventoryMovement.bulkCreate(
          corrections.map((line) => ({
            ingredientId: line.ingredientId,
            movementType: 'correction',
            quantityDelta: line.quantityDelta,
            occurredAt: new Date(),
            sessionId: session.id,
            note: `Session close reconciliation #${session.id}`,
            createdBy: actorId,
          })),
          { transaction },
        );
      }
    }

    await session.update({
      status: 'closed',
      closedAt: new Date(),
      updatedBy: actorId,
    }, { transaction });

    await OpenBarSessionMembership.update(
      {
        isActive: false,
        leftAt: new Date(),
        updatedAt: new Date(),
      },
      {
        where: {
          sessionId: session.id,
          isActive: true,
        },
        transaction,
      },
    );

    await transaction.commit();
    const fresh = await OpenBarSession.findByPk(session.id, {
      include: [
        { model: Venue, as: 'venue', attributes: ['id', 'name'] },
        { model: OpenBarSessionType, as: 'sessionType', attributes: ['id', 'name', 'slug'] },
        { model: User, as: 'createdByUser', attributes: ['id', 'firstName', 'lastName'] },
      ],
    });
    res.status(200).json({ session: fresh ? serializeSession(fresh) : serializeSession(session), reconciliation: correctionSummary });
  } catch (error) {
    await transaction.rollback();
    handleError(res, error, 'Failed to close session');
  }
};

export const deleteOpenBarSession = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const transaction = await OpenBarSession.sequelize?.transaction();
  if (!transaction) {
    res.status(500).json({ message: 'Database transaction unavailable' });
    return;
  }

  try {
    const sessionId = parsePositiveInteger(req.params.id, 'id');
    const session = await OpenBarSession.findByPk(sessionId, { transaction });
    if (!session) {
      throw new HttpError(404, 'Session not found');
    }

    const deletedMovements = await OpenBarInventoryMovement.destroy({
      where: { sessionId: session.id },
      transaction,
    });

    const deletedIssues = await OpenBarDrinkIssue.destroy({
      where: { sessionId: session.id },
      transaction,
    });

    await session.destroy({ transaction });
    await transaction.commit();

    res.status(200).json({
      id: sessionId,
      deleted: true,
      deletedIssues,
      deletedMovements,
    });
  } catch (error) {
    await transaction.rollback();
    handleError(res, error, 'Failed to delete session');
  }
};

export const listOpenBarDrinkIssues = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const where: Record<string, unknown> = {};
    if (req.query.sessionId != null && req.query.sessionId !== '') {
      where.sessionId = parsePositiveInteger(req.query.sessionId, 'sessionId');
    }

    const limit = Math.min(parsePositiveInteger(req.query.limit, 'limit', 200), 1000);
    const include: any[] = [
      { model: OpenBarRecipe, as: 'recipe', attributes: ['id', 'name', 'drinkType'] },
      { model: User, as: 'issuedByUser', attributes: ['id', 'firstName', 'lastName'] },
      { model: OpenBarSession, as: 'session', attributes: ['id', 'businessDate', 'sessionName', 'status'] },
    ];

    if (req.query.businessDate) {
      const businessDate = normalizeDateOnly(req.query.businessDate);
      include[2] = {
        model: OpenBarSession,
        as: 'session',
        attributes: ['id', 'businessDate', 'sessionName', 'status'],
        where: { businessDate },
      };
    }

    const issues = await OpenBarDrinkIssue.findAll({
      where,
      include,
      order: [['issuedAt', 'DESC']],
      limit,
    });

    res.status(200).json({
      issues: issues.map((issue) => ({
        ...serializeIssue(issue),
        sessionName: issue.session?.sessionName ?? null,
        businessDate: issue.session?.businessDate ?? null,
      })),
    });
  } catch (error) {
    handleError(res, error, 'Failed to list drink issues');
  }
};

export const streamOpenBarEvents = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const actorId = requireActorId(req);
    const sessionId = parsePositiveInteger(req.query.sessionId, 'sessionId');
    const session = await OpenBarSession.findByPk(sessionId, {
      attributes: ['id', 'status'],
    });
    if (!session) {
      throw new HttpError(404, 'Session not found');
    }

    const hasManagerOverride = hasOpenBarManagerOverrideAccess(req);
    if (!hasManagerOverride) {
      const membership = await OpenBarSessionMembership.findOne({
        where: {
          sessionId,
          userId: actorId,
          isActive: true,
        },
        attributes: ['id'],
      });
      if (!membership) {
        throw new HttpError(403, 'Join this session before subscribing to events');
      }
    }

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof res.flushHeaders === 'function') {
      res.flushHeaders();
    }

    const unregister = registerOpenBarEventClient(sessionId, res);
    writeOpenBarSseEvent(res, 'connected', {
      sessionId,
      actorId,
      occurredAt: new Date().toISOString(),
    });

    const heartbeat = setInterval(() => {
      try {
        res.write(': keepalive\n\n');
      } catch {
        // Socket is closing; req close handler will clean up.
      }
    }, 25000);

    req.on('close', () => {
      clearInterval(heartbeat);
      unregister();
    });
  } catch (error) {
    handleError(res, error, 'Failed to stream open bar events');
  }
};

export const deleteOpenBarDrinkIssue = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const transaction = await OpenBarDrinkIssue.sequelize?.transaction();
  if (!transaction) {
    res.status(500).json({ message: 'Database transaction unavailable' });
    return;
  }

  try {
    const actorId = getActorId(req);
    const issueId = parsePositiveInteger(req.params.id, 'id');
    const issue = await OpenBarDrinkIssue.findByPk(issueId, {
      include: [{ model: OpenBarSession, as: 'session', attributes: ['id', 'status'] }],
      transaction,
    });
    if (!issue) {
      throw new HttpError(404, 'Drink issue not found');
    }
    if (issue.session?.status === 'closed') {
      throw new HttpError(400, 'Cannot delete issues from a closed session');
    }

    await OpenBarInventoryMovement.destroy({
      where: { issueId: issue.id },
      transaction,
    });
    await issue.destroy({ transaction });

    const sessionId = issue.sessionId;
    await transaction.commit();
    broadcastOpenBarRealtimeEvent('drink_issue_deleted', {
      sessionId,
      issueId: issue.id,
      actorId,
      occurredAt: new Date().toISOString(),
    });
    res.status(200).json({ id: issueId, deleted: true });
  } catch (error) {
    await transaction.rollback();
    handleError(res, error, 'Failed to delete drink issue');
  }
};

type IssueCategorySelectionInput = {
  recipeLineId: number;
  ingredientId: number;
};

const parseIssueCategorySelections = (value: unknown): IssueCategorySelectionInput[] => {
  if (value == null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new HttpError(400, 'categorySelections must be an array');
  }

  const parsed = value.map((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      throw new HttpError(400, `categorySelections[${index}] must be an object`);
    }
    const record = entry as { recipeLineId?: unknown; ingredientId?: unknown };
    return {
      recipeLineId: parsePositiveInteger(record.recipeLineId, `categorySelections[${index}].recipeLineId`),
      ingredientId: parsePositiveInteger(record.ingredientId, `categorySelections[${index}].ingredientId`),
    };
  });

  const duplicateLineIds = parsed
    .map((selection) => selection.recipeLineId)
    .filter((id, index, arr) => arr.indexOf(id) !== index);
  if (duplicateLineIds.length > 0) {
    throw new HttpError(400, 'categorySelections contains duplicate recipe line ids');
  }

  return parsed;
};

const buildIssueDisplayName = (
  recipeName: string,
  displayMode: OpenBarDrinkLabelDisplayMode,
  lines: OpenBarRecipeIngredient[],
  categorySelectionByLine: Map<number, number>,
  selectedIngredientMap: Map<number, OpenBarIngredient>,
): string => {
  if (displayMode === 'recipe_name') {
    return recipeName;
  }

  const ingredientParts = lines
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((line) => {
      const lineType = resolveRecipeLineType(line.lineType, 'fixed_ingredient');
      if (lineType === 'fixed_ingredient') {
        if (line.ingredient?.isCup || line.ingredient?.isIce) {
          return null;
        }
        return line.ingredient?.name ?? null;
      }

      const selectedIngredientId = categorySelectionByLine.get(line.id);
      if (selectedIngredientId != null) {
        return selectedIngredientMap.get(selectedIngredientId)?.name ?? null;
      }
      if (line.isOptional) {
        return null;
      }
      return line.category?.name ?? null;
    })
    .filter((name): name is string => Boolean(name))
    .map((name) => name.trim())
    .filter((name) => name.length > 0);

  if (ingredientParts.length === 0) {
    return recipeName;
  }

  if (displayMode === 'ingredients_only') {
    return ingredientParts.join(' + ');
  }

  return `${recipeName} (${ingredientParts.join(' + ')})`;
};

export const createOpenBarDrinkIssue = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const transaction = await OpenBarDrinkIssue.sequelize?.transaction();
  if (!transaction) {
    res.status(500).json({ message: 'Database transaction unavailable' });
    return;
  }

  try {
    const actorId = getActorId(req);
    const sessionId = parsePositiveInteger(req.body?.sessionId, 'sessionId');
    const recipeId = parsePositiveInteger(req.body?.recipeId, 'recipeId');
    const servings = parsePositiveInteger(req.body?.servings, 'servings', 1);
    const strength = resolveIssueStrength(req.body?.strength, 'single');
    const includeIceOverrideProvided = req.body?.includeIce !== undefined;
    const allowInactiveSession = toBoolean(req.body?.allowInactiveSession, false);
    const categorySelections = parseIssueCategorySelections(req.body?.categorySelections);
    if (servings > 1000) {
      throw new HttpError(400, 'servings is too large');
    }

    const session = await OpenBarSession.findByPk(sessionId, { transaction });
    if (!session) {
      throw new HttpError(404, 'Session not found');
    }
    const hasManagerOverride = hasOpenBarManagerOverrideAccess(req);
    const activeMembership = await OpenBarSessionMembership.findOne({
      where: {
        sessionId: session.id,
        userId: actorId,
        isActive: true,
      },
      transaction,
    });
    if (!activeMembership && !hasManagerOverride) {
      throw new HttpError(403, 'Join this session before issuing drinks');
    }
    if (allowInactiveSession && !hasManagerOverride) {
      throw new HttpError(403, 'Manager privileges required to override inactive session validation');
    }
    if (session.status !== 'active' && !allowInactiveSession) {
      throw new HttpError(400, 'Session must be active to issue drinks');
    }
    if (session.status === 'active' && isSessionTimeExpired(session)) {
      throw new HttpError(400, 'Open Bar Finished! Do not serve more drinks.');
    }

    const recipe = await OpenBarRecipe.findByPk(recipeId, {
      include: [
        { model: OpenBarIngredient, as: 'cupIngredient', attributes: ['id', 'name', 'baseUnit', 'isCup', 'cupType', 'cupCapacityMl', 'isActive'] },
        {
          model: OpenBarRecipeIngredient,
          as: 'ingredients',
          include: [
            { model: OpenBarIngredient, as: 'ingredient' },
            { model: OpenBarIngredientCategory, as: 'category' },
          ],
        },
      ],
      transaction,
    });
    if (!recipe) {
      throw new HttpError(404, 'Recipe not found');
    }
    if (!recipe.isActive) {
      throw new HttpError(400, 'Recipe is inactive');
    }
    if (recipe.cupIngredientId == null) {
      throw new HttpError(400, 'Recipe has no assigned cup');
    }
    if (!recipe.cupIngredient) {
      throw new HttpError(400, 'Recipe cup ingredient not found');
    }
    if (!recipe.cupIngredient.isCup) {
      throw new HttpError(400, 'Recipe cup ingredient is not marked as a cup');
    }
    if (!recipe.cupIngredient.isActive) {
      throw new HttpError(400, 'Recipe cup ingredient is inactive');
    }
    const includeIce = includeIceOverrideProvided ? toBoolean(req.body?.includeIce, recipe.hasIce) : recipe.hasIce;

    const lines = (recipe.ingredients ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder);
    if (lines.length === 0) {
      throw new HttpError(400, 'Recipe has no ingredients configured');
    }

    const categorySelectionByLine = new Map<number, number>();
    categorySelections.forEach((selection) => {
      categorySelectionByLine.set(selection.recipeLineId, selection.ingredientId);
    });

    const categorySelectorLineIds = new Set(
      lines
        .filter((line) => resolveRecipeLineType(line.lineType, 'fixed_ingredient') === 'category_selector')
        .map((line) => line.id),
    );
    const unknownLineSelections = categorySelections.filter((selection) => !categorySelectorLineIds.has(selection.recipeLineId));
    if (unknownLineSelections.length > 0) {
      throw new HttpError(400, 'categorySelections include unknown recipe lines', {
        unknownRecipeLineIds: unknownLineSelections.map((selection) => selection.recipeLineId),
      });
    }

    const selectedIngredientIds = Array.from(new Set(categorySelections.map((selection) => selection.ingredientId)));
    const selectedIngredients =
      selectedIngredientIds.length > 0
        ? await OpenBarIngredient.findAll({
            where: { id: { [Op.in]: selectedIngredientIds }, isActive: true, isCup: false, isIce: false },
            include: [{ model: OpenBarIngredientCategory, as: 'categoryRef', attributes: ['id', 'slug', 'name'] }],
            transaction,
          })
        : [];
    const selectedIngredientMap = new Map<number, OpenBarIngredient>();
    selectedIngredients.forEach((ingredient) => {
      selectedIngredientMap.set(ingredient.id, ingredient);
    });
    const unknownSelectedIngredientIds = selectedIngredientIds.filter((ingredientId) => !selectedIngredientMap.has(ingredientId));
    if (unknownSelectedIngredientIds.length > 0) {
      throw new HttpError(400, 'Some selected category ingredients do not exist or are inactive', {
        missingIngredientIds: unknownSelectedIngredientIds,
      });
    }

    type IssueLineResolved = {
      recipeLineId: number;
      ingredientId: number;
      ingredientName: string | null;
      baseUnit: OpenBarIngredientUnit | null;
      quantityPerServing: number;
      required: boolean;
      lineType: OpenBarRecipeIngredientLineType;
      isTopUp: boolean;
    };

    const resolvedLines: IssueLineResolved[] = [];
    const pendingTopUpLines: Array<Omit<IssueLineResolved, 'quantityPerServing'>> = [];
    const selectionSummary: Array<{ recipeLineId: number; categoryId: number | null; categoryName: string | null; ingredientId: number; ingredientName: string | null }> = [];
    for (const line of lines) {
      const lineType = resolveRecipeLineType(line.lineType, 'fixed_ingredient');
      const isTopUp = toBoolean(line.isTopUp, false);
      const baseQuantity = parseNumber(line.quantity, 0);
      const strengthMultiplier = line.affectsStrength && strength === 'double' ? 2 : 1;
      const quantityPerServing = baseQuantity * strengthMultiplier;

      if (lineType === 'fixed_ingredient') {
        if (isTopUp) {
          throw new HttpError(400, 'Top-up is only supported for category selector lines');
        }
        if (line.ingredientId == null) {
          throw new HttpError(400, 'Recipe has an invalid fixed ingredient line');
        }
        if (line.ingredient?.isCup) {
          throw new HttpError(400, 'Recipe line contains a cup ingredient. Assign cups using recipe cup setting.');
        }
        if (line.ingredient?.isIce) {
          throw new HttpError(400, 'Recipe line contains an ice ingredient. Configure ice via recipe hasIce setting.');
        }
        if (quantityPerServing <= 0) {
          continue;
        }
        resolvedLines.push({
          recipeLineId: line.id,
          ingredientId: line.ingredientId,
          ingredientName: line.ingredient?.name ?? null,
          baseUnit: line.ingredient?.baseUnit ?? null,
          quantityPerServing,
          required: !line.isOptional,
          lineType,
          isTopUp: false,
        });
        continue;
      }

      const selectedIngredientId = categorySelectionByLine.get(line.id);
      if (selectedIngredientId == null) {
        if (line.isOptional) {
          continue;
        }
        throw new HttpError(400, 'Missing category ingredient selection', {
          recipeLineId: line.id,
          categoryId: line.categoryId,
          categoryName: line.category?.name ?? null,
        });
      }

      const selectedIngredient = selectedIngredientMap.get(selectedIngredientId);
      if (!selectedIngredient) {
        throw new HttpError(400, 'Selected category ingredient is invalid', {
          recipeLineId: line.id,
          ingredientId: selectedIngredientId,
        });
      }

      if (line.categoryId == null || selectedIngredient.categoryId !== line.categoryId) {
        throw new HttpError(400, 'Selected ingredient does not belong to recipe line category', {
          recipeLineId: line.id,
          categoryId: line.categoryId,
          ingredientId: selectedIngredientId,
          selectedIngredientCategoryId: selectedIngredient.categoryId,
        });
      }

      if (isTopUp) {
        if (selectedIngredient.baseUnit !== 'ml') {
          throw new HttpError(400, 'Top-up ingredient must use ml base unit', {
            recipeLineId: line.id,
            ingredientId: selectedIngredient.id,
            ingredientName: selectedIngredient.name,
            ingredientBaseUnit: selectedIngredient.baseUnit,
          });
        }
        pendingTopUpLines.push({
          recipeLineId: line.id,
          ingredientId: selectedIngredientId,
          ingredientName: selectedIngredient.name,
          baseUnit: selectedIngredient.baseUnit,
          required: !line.isOptional,
          lineType,
          isTopUp: true,
        });
      } else {
        if (quantityPerServing <= 0) {
          continue;
        }
        resolvedLines.push({
          recipeLineId: line.id,
          ingredientId: selectedIngredientId,
          ingredientName: selectedIngredient.name,
          baseUnit: selectedIngredient.baseUnit,
          quantityPerServing,
          required: !line.isOptional,
          lineType,
          isTopUp: false,
        });
      }
      selectionSummary.push({
        recipeLineId: line.id,
        categoryId: line.categoryId,
        categoryName: line.category?.name ?? null,
        ingredientId: selectedIngredientId,
        ingredientName: selectedIngredient.name,
      });
    }

    if (recipe.cupIngredientId != null) {
      const cupIngredient = recipe.cupIngredient;
      if (!cupIngredient) {
        throw new HttpError(400, 'Recipe cup ingredient not found');
      }
      if (!cupIngredient.isCup) {
        throw new HttpError(400, 'Recipe cup ingredient is not marked as a cup');
      }
      if (cupIngredient.cupType === 'disposable') {
        resolvedLines.push({
          recipeLineId: 0,
          ingredientId: cupIngredient.id,
          ingredientName: cupIngredient.name,
          baseUnit: cupIngredient.baseUnit,
          quantityPerServing: 1,
          required: true,
          lineType: 'fixed_ingredient',
          isTopUp: false,
        });
      }
    }

    if (recipe.cupIngredientId != null) {
      const cupCapacityMl = recipe.cupIngredient?.cupCapacityMl == null ? null : parseNumber(recipe.cupIngredient.cupCapacityMl, 0);
      if (cupCapacityMl == null || cupCapacityMl <= 0) {
        throw new HttpError(400, 'Assigned recipe cup has no valid capacity');
      }
      const iceDisplacementMl = includeIce ? getIceDisplacementMl(recipe.iceCubes) : 0;
      const availableLiquidCapacityMl = Math.max(cupCapacityMl - iceDisplacementMl, 0);
      const nonTopUpLiquidPerServingMl = resolvedLines
        .filter((line) => line.baseUnit === 'ml')
        .reduce((sum, line) => sum + line.quantityPerServing, 0);
      if (nonTopUpLiquidPerServingMl - availableLiquidCapacityMl > STOCK_EPSILON) {
        throw new HttpError(400, 'Recipe volume exceeds assigned cup capacity', {
          cupIngredientId: recipe.cupIngredientId,
          cupName: recipe.cupIngredient?.name ?? null,
          cupCapacityMl,
          iceDisplacementMl,
          availableLiquidCapacityMl,
          recipeLiquidPerServingMl: nonTopUpLiquidPerServingMl,
        });
      }

      if (pendingTopUpLines.length > 1) {
        throw new HttpError(400, 'Only one top-up line is supported per recipe', {
          recipeId: recipe.id,
          topUpLineIds: pendingTopUpLines.map((line) => line.recipeLineId),
        });
      }

      if (pendingTopUpLines.length === 1) {
        const topUpQuantityPerServing = Math.max(availableLiquidCapacityMl - nonTopUpLiquidPerServingMl, 0);
        const topUpLine = pendingTopUpLines[0];
        if (topUpQuantityPerServing <= STOCK_EPSILON) {
          if (topUpLine.required) {
            throw new HttpError(400, 'No remaining cup capacity for required top-up line', {
              recipeLineId: topUpLine.recipeLineId,
              availableLiquidCapacityMl,
              fixedLiquidPerServingMl: nonTopUpLiquidPerServingMl,
            });
          }
        } else {
          resolvedLines.push({
            ...topUpLine,
            quantityPerServing: topUpQuantityPerServing,
          });
        }
      }
    }

    if (resolvedLines.length === 0) {
      throw new HttpError(400, 'Recipe selection produced no ingredient consumption');
    }

    const aggregatedRequired = new Map<number, { ingredientId: number; ingredientName: string | null; requiredQuantity: number }>();
    resolvedLines
      .filter((line) => line.required)
      .forEach((line) => {
        const current = aggregatedRequired.get(line.ingredientId) ?? {
          ingredientId: line.ingredientId,
          ingredientName: line.ingredientName,
          requiredQuantity: 0,
        };
        current.requiredQuantity += line.quantityPerServing * servings;
        aggregatedRequired.set(line.ingredientId, current);
      });

    const ingredientIds = Array.from(new Set(resolvedLines.map((line) => line.ingredientId)));
    const stockMap = await getStockMap(ingredientIds, transaction);
    const shortages = Array.from(aggregatedRequired.values())
      .map((line) => {
        const required = line.requiredQuantity;
        const available = stockMap.get(line.ingredientId) ?? 0;
        return {
          ingredientId: line.ingredientId,
          ingredientName: line.ingredientName,
          required,
          available,
          missing: Math.max(required - available, 0),
        };
      })
      .filter((entry) => entry.missing > 0.000001);

    if (shortages.length > 0) {
      throw new HttpError(400, 'Insufficient ingredient stock for this issue', { shortages });
    }

    const issuedAt = normalizeDateTime(req.body?.issuedAt, new Date());
    const baseNotes = req.body?.notes ? String(req.body.notes) : null;
    const isStaffDrink = toBoolean(req.body?.isStaffDrink, false);
    const composedNotes: string[] = [];
    if (baseNotes) {
      composedNotes.push(baseNotes);
    }
    if (recipe.askStrength) {
      composedNotes.push(`Strength: ${strength}`);
    }
    if (recipe.hasIce) {
      composedNotes.push(`Ice: ${includeIce ? `Yes (${recipe.iceCubes} cubes)` : 'No'}`);
    }
    if (selectionSummary.length > 0) {
      const selectionLabel = selectionSummary
        .map((selection) => `${selection.categoryName ?? 'Category'}=${selection.ingredientName ?? `#${selection.ingredientId}`}`)
        .join(', ');
      composedNotes.push(`Selections: ${selectionLabel}`);
    }

    const drinkLabelSettingMap = await getDrinkLabelSettingMap(transaction);
    const defaultDisplayMode = drinkLabelSettingMap.get(recipe.drinkType) ?? DEFAULT_DRINK_LABEL_MODE_BY_TYPE[recipe.drinkType];
    const recipeDisplayMode = resolveDrinkLabelMode(recipe.labelDisplayMode, null, { allowNull: true });
    const effectiveDisplayMode = recipeDisplayMode ?? defaultDisplayMode;
    const displayNameSnapshot = buildIssueDisplayName(
      recipe.name,
      effectiveDisplayMode,
      lines,
      categorySelectionByLine,
      selectedIngredientMap,
    );

    const issue = await OpenBarDrinkIssue.create(
      {
        sessionId: session.id,
        recipeId: recipe.id,
        servings,
        issuedAt,
        orderRef: req.body?.orderRef ? String(req.body.orderRef) : null,
        displayNameSnapshot,
        notes: composedNotes.length > 0 ? composedNotes.join(' | ') : null,
        isStaffDrink,
        issuedBy: actorId,
      },
      { transaction },
    );

    const movementByIngredient = new Map<number, number>();
    resolvedLines.forEach((line) => {
      const quantityDelta = -line.quantityPerServing * servings;
      const current = movementByIngredient.get(line.ingredientId) ?? 0;
      movementByIngredient.set(line.ingredientId, current + quantityDelta);
    });

    await OpenBarInventoryMovement.bulkCreate(
      Array.from(movementByIngredient.entries()).map(([ingredientId, quantityDelta]) => ({
        ingredientId,
        movementType: 'issue',
        quantityDelta,
        occurredAt: issuedAt,
        sessionId: session.id,
        issueId: issue.id,
        note: `Recipe issue: ${recipe.name}`,
        createdBy: actorId,
      })),
      { transaction },
    );

    const fresh = await loadIssueById(issue.id, transaction);
    await transaction.commit();
    broadcastOpenBarRealtimeEvent('drink_issue_created', {
      sessionId: session.id,
      issueId: issue.id,
      actorId,
      occurredAt: issuedAt.toISOString(),
    });
    res.status(201).json({ issue: fresh ? serializeIssue(fresh) : null });
  } catch (error) {
    await transaction.rollback();
    handleError(res, error, 'Failed to create drink issue');
  }
};

export const listOpenBarDeliveries = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const limit = Math.min(parsePositiveInteger(req.query.limit, 'limit', 100), 300);
    const where: Record<string, unknown> = {};

    if (req.query.businessDate) {
      const businessDate = normalizeDateOnly(req.query.businessDate);
      where.deliveredAt = {
        [Op.gte]: startOfBusinessDate(businessDate),
        [Op.lt]: endOfBusinessDateExclusive(businessDate),
      };
    }

    const deliveries = await OpenBarDelivery.findAll({
      where,
      include: [
        {
          model: OpenBarDeliveryItem,
          as: 'items',
          include: [
            { model: OpenBarIngredient, as: 'ingredient', attributes: ['id', 'name', 'baseUnit'] },
            { model: OpenBarIngredientVariant, as: 'variant', attributes: ['id', 'name', 'brand', 'packageLabel', 'baseQuantity'] },
          ],
        },
        { model: User, as: 'receivedByUser', attributes: ['id', 'firstName', 'lastName'] },
      ],
      order: [['deliveredAt', 'DESC']],
      limit,
    });

    res.status(200).json({
      deliveries: deliveries.map((delivery) => serializeDelivery(delivery)),
    });
  } catch (error) {
    handleError(res, error, 'Failed to list deliveries');
  }
};

type DeliveryItemPayloadInput =
  | {
      mode: 'variant';
      variantId: number;
      purchaseUnits: number;
      purchaseUnitCost: number | null;
    }
  | {
      mode: 'ingredient';
      ingredientId: number;
      quantity: number;
      unitCost: number | null;
    };

type DeliveryItemInput = {
  ingredientId: number;
  quantity: number;
  unitCost: number | null;
  variantId: number | null;
  purchaseUnits: number | null;
  purchaseUnitCost: number | null;
  variantName: string | null;
};

const parseDeliveryItems = (value: unknown): DeliveryItemPayloadInput[] => {
  if (!Array.isArray(value) || value.length === 0) {
    throw new HttpError(400, 'items must be a non-empty array');
  }

  const parsed = value.map((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      throw new HttpError(400, `items[${index}] must be an object`);
    }
    const record = entry as {
      variantId?: unknown;
      purchaseUnits?: unknown;
      purchaseUnitCost?: unknown;
      ingredientId?: unknown;
      quantity?: unknown;
      unitCost?: unknown;
    };

    if (record.variantId != null && record.variantId !== '') {
      const variantId = parsePositiveInteger(record.variantId, `items[${index}].variantId`);
      const purchaseUnits = parseNonNegativeNumber(
        record.purchaseUnits ?? record.quantity,
        `items[${index}].purchaseUnits`,
      );
      if (purchaseUnits <= 0) {
        throw new HttpError(400, `items[${index}].purchaseUnits must be greater than zero`);
      }
      const purchaseUnitCostRaw = record.purchaseUnitCost ?? record.unitCost;
      const purchaseUnitCost =
        purchaseUnitCostRaw == null || purchaseUnitCostRaw === ''
          ? null
          : parseNonNegativeNumber(purchaseUnitCostRaw, `items[${index}].purchaseUnitCost`);
      return {
        mode: 'variant' as const,
        variantId,
        purchaseUnits,
        purchaseUnitCost,
      };
    }

    const ingredientId = parsePositiveInteger(record.ingredientId, `items[${index}].ingredientId`);
    const quantity = parseNonNegativeNumber(record.quantity, `items[${index}].quantity`);
    if (quantity <= 0) {
      throw new HttpError(400, `items[${index}].quantity must be greater than zero`);
    }
    const unitCost =
      record.unitCost == null || record.unitCost === ''
        ? null
        : parseNonNegativeNumber(record.unitCost, `items[${index}].unitCost`);
    return {
      mode: 'ingredient' as const,
      ingredientId,
      quantity,
      unitCost,
    };
  });

  const duplicateKeys = parsed
    .map((line) => (line.mode === 'variant' ? `variant:${line.variantId}` : `ingredient:${line.ingredientId}`))
    .filter((key, index, arr) => arr.indexOf(key) !== index);
  if (duplicateKeys.length > 0) {
    throw new HttpError(400, 'Duplicate delivery lines are not allowed');
  }

  return parsed;
};

export const createOpenBarDelivery = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const transaction = await OpenBarDelivery.sequelize?.transaction();
  if (!transaction) {
    res.status(500).json({ message: 'Database transaction unavailable' });
    return;
  }

  try {
    const actorId = getActorId(req);
    const payloadItems = parseDeliveryItems(req.body?.items);

    const variantIds = payloadItems
      .filter((item): item is Extract<DeliveryItemPayloadInput, { mode: 'variant' }> => item.mode === 'variant')
      .map((item) => item.variantId);

    const variants =
      variantIds.length === 0
        ? []
        : await OpenBarIngredientVariant.findAll({
            where: { id: { [Op.in]: variantIds } },
            include: [{ model: OpenBarIngredient, as: 'ingredient', attributes: ['id', 'baseUnit'] }],
            transaction,
          });
    const variantMap = new Map<number, OpenBarIngredientVariant>();
    variants.forEach((variant) => {
      variantMap.set(variant.id, variant);
    });

    const normalizedItems: DeliveryItemInput[] = payloadItems.map((item) => {
      if (item.mode === 'ingredient') {
        return {
          ingredientId: item.ingredientId,
          quantity: item.quantity,
          unitCost: item.unitCost,
          variantId: null,
          purchaseUnits: null,
          purchaseUnitCost: null,
          variantName: null,
        };
      }

      const variant = variantMap.get(item.variantId);
      if (!variant) {
        throw new HttpError(400, `Unknown ingredient variant id: ${item.variantId}`);
      }
      const baseQuantity = parseNumber(variant.baseQuantity, 0);
      if (baseQuantity <= 0) {
        throw new HttpError(400, `Variant ${variant.id} has invalid base quantity`);
      }

      const quantity = item.purchaseUnits * baseQuantity;
      const unitCost = item.purchaseUnitCost == null ? null : item.purchaseUnitCost / baseQuantity;
      return {
        ingredientId: variant.ingredientId,
        quantity,
        unitCost,
        variantId: variant.id,
        purchaseUnits: item.purchaseUnits,
        purchaseUnitCost: item.purchaseUnitCost,
        variantName: variant.name,
      };
    });

    const ingredientIds = Array.from(new Set(normalizedItems.map((item) => item.ingredientId)));
    await ensureIngredientIdsExist(ingredientIds, transaction);
    const preDeliveryStockMap = await getStockMap(ingredientIds, transaction);

    const receivedBy =
      req.body?.receivedBy == null || req.body.receivedBy === ''
        ? actorId
        : parsePositiveInteger(req.body.receivedBy, 'receivedBy');
    const deliveredAt = normalizeDateTime(req.body?.deliveredAt, new Date());

    const delivery = await OpenBarDelivery.create(
      {
        supplierName: req.body?.supplierName ? String(req.body.supplierName) : null,
        invoiceRef: req.body?.invoiceRef ? String(req.body.invoiceRef) : null,
        deliveredAt,
        notes: req.body?.notes ? String(req.body.notes) : null,
        receivedBy,
      },
      { transaction },
    );

    await OpenBarDeliveryItem.bulkCreate(
      normalizedItems.map((item) => ({
        deliveryId: delivery.id,
        ingredientId: item.ingredientId,
        quantity: item.quantity,
        unitCost: item.unitCost,
        variantId: item.variantId,
        purchaseUnits: item.purchaseUnits,
        purchaseUnitCost: item.purchaseUnitCost,
      })),
      { transaction },
    );

    await OpenBarInventoryMovement.bulkCreate(
      normalizedItems.map((item) => ({
        ingredientId: item.ingredientId,
        movementType: 'delivery',
        quantityDelta: item.quantity,
        occurredAt: deliveredAt,
        deliveryId: delivery.id,
        note: item.variantName ? `Delivery #${delivery.id} - ${item.variantName}` : `Delivery #${delivery.id}`,
        createdBy: actorId,
      })),
      { transaction },
    );

    const ingredients = await OpenBarIngredient.findAll({
      where: { id: { [Op.in]: ingredientIds } },
      transaction,
    });
    const ingredientMap = new Map<number, OpenBarIngredient>();
    ingredients.forEach((ingredient) => {
      ingredientMap.set(ingredient.id, ingredient);
    });

    const incomingByIngredient = new Map<number, { quantity: number; totalValue: number }>();
    normalizedItems.forEach((item) => {
      if (item.unitCost == null) {
        return;
      }
      const current = incomingByIngredient.get(item.ingredientId) ?? { quantity: 0, totalValue: 0 };
      current.quantity += item.quantity;
      current.totalValue += item.quantity * item.unitCost;
      incomingByIngredient.set(item.ingredientId, current);
    });

    for (const [ingredientId, incoming] of incomingByIngredient.entries()) {
      if (incoming.quantity <= 0) {
        continue;
      }
      const ingredient = ingredientMap.get(ingredientId);
      if (!ingredient) {
        continue;
      }

      const currentStock = Math.max(preDeliveryStockMap.get(ingredientId) ?? 0, 0);
      const currentCost = ingredient.costPerUnit == null ? null : parseNumber(ingredient.costPerUnit, 0);
      const nextCost =
        currentCost == null || currentStock <= 0
          ? incoming.totalValue / incoming.quantity
          : (currentCost * currentStock + incoming.totalValue) / (currentStock + incoming.quantity);

      await ingredient.update(
        {
          costPerUnit: nextCost,
          updatedBy: actorId,
        },
        { transaction },
      );
    }

    const fresh = await OpenBarDelivery.findByPk(delivery.id, {
      include: [
        {
          model: OpenBarDeliveryItem,
          as: 'items',
          include: [
            { model: OpenBarIngredient, as: 'ingredient', attributes: ['id', 'name', 'baseUnit'] },
            { model: OpenBarIngredientVariant, as: 'variant', attributes: ['id', 'name', 'brand', 'packageLabel', 'baseQuantity'] },
          ],
        },
        { model: User, as: 'receivedByUser', attributes: ['id', 'firstName', 'lastName'] },
      ],
      transaction,
    });

    await transaction.commit();
    res.status(201).json({ delivery: fresh ? serializeDelivery(fresh) : null });
  } catch (error) {
    await transaction.rollback();
    handleError(res, error, 'Failed to create delivery');
  }
};

export const createOpenBarInventoryAdjustment = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const transaction = await OpenBarInventoryMovement.sequelize?.transaction();
  if (!transaction) {
    res.status(500).json({ message: 'Database transaction unavailable' });
    return;
  }
  try {
    const actorId = getActorId(req);
    const ingredientId = parsePositiveInteger(req.body?.ingredientId, 'ingredientId');
    const movementType = resolveAdjustmentType(req.body?.movementType);
    let quantityDelta = parseNumber(req.body?.quantityDelta, Number.NaN);
    if (!Number.isFinite(quantityDelta) || quantityDelta === 0) {
      throw new HttpError(400, 'quantityDelta must be a non-zero number');
    }
    if (movementType === 'waste' && quantityDelta > 0) {
      quantityDelta = -quantityDelta;
    }

    const ingredient = await OpenBarIngredient.findByPk(ingredientId, { transaction });
    if (!ingredient) {
      throw new HttpError(404, 'Ingredient not found');
    }

    const stockMap = await getStockMap([ingredientId], transaction);
    const currentStock = stockMap.get(ingredientId) ?? 0;
    const nextStock = currentStock + quantityDelta;
    if (nextStock < -0.000001) {
      throw new HttpError(400, 'Adjustment would make stock negative', {
        ingredientId,
        currentStock,
        quantityDelta,
      });
    }

    const movement = await OpenBarInventoryMovement.create(
      {
        ingredientId,
        movementType,
        quantityDelta,
        occurredAt: normalizeDateTime(req.body?.occurredAt, new Date()),
        note: req.body?.note ? String(req.body.note) : null,
        createdBy: actorId,
      },
      { transaction },
    );

    await transaction.commit();

    res.status(201).json({
      movement: {
        id: movement.id,
        ingredientId: movement.ingredientId,
        ingredientName: ingredient.name,
        movementType: movement.movementType,
        quantityDelta: parseNumber(movement.quantityDelta, 0),
        occurredAt: movement.occurredAt,
        note: movement.note,
      },
      stock: {
        currentStock: nextStock,
      },
    });
  } catch (error) {
    await transaction.rollback();
    handleError(res, error, 'Failed to create inventory adjustment');
  }
};

const buildOpenBarOverviewPayload = async (businessDate: string, req?: AuthenticatedRequest) => {
  const actorId = req ? getActorId(req) : null;
  const managerAccess = req ? hasOpenBarManagerOverrideAccess(req) : true;
  const membershipContext =
    actorId == null
      ? { joinedSessionIds: new Set<number>(), activeJoinedSessionIds: new Set<number>() }
      : await getUserSessionMembershipContext(actorId, { businessDate });

  const sessionWhereClauses: Array<Record<string | symbol, unknown>> = [{ businessDate }];
  if (actorId != null && !managerAccess) {
    sessionWhereClauses.push(buildSessionVisibilityFilter(actorId, membershipContext.joinedSessionIds));
  }

  const sessions = await OpenBarSession.findAll({
    where: sessionWhereClauses.length === 1 ? sessionWhereClauses[0] : { [Op.and]: sessionWhereClauses },
    include: [
      { model: Venue, as: 'venue', attributes: ['id', 'name'] },
      { model: OpenBarSessionType, as: 'sessionType', attributes: ['id', 'name', 'slug'] },
    ],
    order: [['id', 'DESC']],
  });
  const currentUserSessionId = Array.from(membershipContext.activeJoinedSessionIds.values()).find((sessionId) =>
    sessions.some((session) => session.id === sessionId),
  );
  const activeSession =
    (currentUserSessionId != null ? sessions.find((session) => session.id === currentUserSessionId) : null) ??
    sessions.find((session) => session.status === 'active') ??
    null;
  const sessionIds = sessions.map((session) => session.id);

  const issues =
    sessionIds.length === 0
      ? []
      : await OpenBarDrinkIssue.findAll({
          where: { sessionId: { [Op.in]: sessionIds } },
          include: [
            {
              model: OpenBarRecipe,
              as: 'recipe',
              attributes: ['id', 'name', 'drinkType'],
            },
            { model: User, as: 'issuedByUser', attributes: ['id', 'firstName', 'lastName'] },
          ],
          order: [['issuedAt', 'DESC']],
        });

  const issuesCount = issues.length;
  const totalServings = issues.reduce((sum, issue) => sum + parseNumber(issue.servings, 0), 0);

  const recipeUsageMap = new Map<number, { recipeId: number; recipeName: string; drinkType: string; servings: number; issues: number }>();
  const ingredientUsageMap = new Map<number, { ingredientId: number; ingredientName: string; baseUnit: string; usedQuantity: number }>();

  issues.forEach((issue) => {
    const recipe = issue.recipe;
    if (!recipe) {
      return;
    }
    const servings = parseNumber(issue.servings, 0);
    const recipeUsage = recipeUsageMap.get(recipe.id) ?? {
      recipeId: recipe.id,
      recipeName: recipe.name,
      drinkType: recipe.drinkType,
      servings: 0,
      issues: 0,
    };
    recipeUsage.servings += servings;
    recipeUsage.issues += 1;
    recipeUsageMap.set(recipe.id, recipeUsage);
  });

  const issueIds = issues.map((issue) => issue.id);
  const issueMovements =
    issueIds.length === 0
      ? []
      : await OpenBarInventoryMovement.findAll({
          where: {
            issueId: { [Op.in]: issueIds },
            movementType: 'issue',
          },
          include: [{ model: OpenBarIngredient, as: 'ingredient', attributes: ['id', 'name', 'baseUnit', 'costPerUnit'] }],
        });

  let estimatedCost = 0;
  issueMovements.forEach((movement) => {
    const ingredient = movement.ingredient;
    const usedQuantity = Math.abs(parseNumber(movement.quantityDelta, 0));
    const entry = ingredientUsageMap.get(movement.ingredientId) ?? {
      ingredientId: movement.ingredientId,
      ingredientName: ingredient?.name ?? `Ingredient #${movement.ingredientId}`,
      baseUnit: ingredient?.baseUnit ?? 'ml',
      usedQuantity: 0,
    };
    entry.usedQuantity += usedQuantity;
    ingredientUsageMap.set(movement.ingredientId, entry);

    if (ingredient?.costPerUnit != null) {
      estimatedCost += usedQuantity * parseNumber(ingredient.costPerUnit, 0);
    }
  });

  const deliveries = await OpenBarDelivery.count({
    where: {
      deliveredAt: {
        [Op.gte]: startOfBusinessDate(businessDate),
        [Op.lt]: endOfBusinessDateExclusive(businessDate),
      },
    },
  });

  const ingredients = await OpenBarIngredient.findAll({
    where: { isActive: true },
    order: [['name', 'ASC']],
  });
  const stockMap = await getStockMap();
  const lowStock = ingredients
    .map((ingredient) => serializeIngredient(ingredient, stockMap))
    .filter((ingredient) => ingredient.belowReorder)
    .sort((a, b) => a.currentStock - b.currentStock);

  const topDrinks = Array.from(recipeUsageMap.values())
    .sort((a, b) => b.servings - a.servings || b.issues - a.issues)
    .slice(0, 10);

  const ingredientUsage = Array.from(ingredientUsageMap.values())
    .sort((a, b) => b.usedQuantity - a.usedQuantity)
    .slice(0, 20);

  return {
    businessDate,
    activeSession: activeSession
      ? {
          id: activeSession.id,
          sessionName: activeSession.sessionName,
          status: activeSession.status,
          venueId: activeSession.venueId,
          venueName: activeSession.venue?.name ?? null,
          openedAt: activeSession.openedAt,
          sessionTypeId: activeSession.sessionTypeId,
          sessionTypeName: activeSession.sessionType?.name ?? null,
          sessionTypeSlug: activeSession.sessionType?.slug ?? null,
          timeLimitMinutes: resolveTimeLimitMinutes(activeSession.timeLimitMinutes, null, { strict: false }),
        }
      : null,
    totals: {
      sessions: sessions.length,
      issuesCount,
      totalServings,
      deliveriesCount: deliveries,
      activeIngredients: ingredients.length,
      lowStockCount: lowStock.length,
      estimatedCost,
    },
    topDrinks,
    ingredientUsage,
    lowStock: lowStock.slice(0, 10),
    recentIssues: issues.slice(0, 30).map((issue) => serializeIssue(issue)),
  };
};

export const getOpenBarOverview = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const businessDate = normalizeDateOnly(req.query.businessDate);
    const overview = await buildOpenBarOverviewPayload(businessDate, req);
    res.status(200).json(overview);
  } catch (error) {
    handleError(res, error, 'Failed to load open bar overview');
  }
};

export const getOpenBarBootstrap = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const actorId = requireActorId(req);
    const managerAccess = hasOpenBarManagerOverrideAccess(req);
    const businessDate = normalizeDateOnly(req.query.businessDate);
    const sessionLimit = Math.min(parsePositiveInteger(req.query.sessionLimit, 'sessionLimit', 60), 200);
    const deliveryLimit = Math.min(parsePositiveInteger(req.query.deliveryLimit, 'deliveryLimit', 100), 300);
    const sessionIssueLimit = Math.min(parsePositiveInteger(req.query.sessionIssueLimit, 'sessionIssueLimit', 300), 1000);
    const membershipContext = await getUserSessionMembershipContext(actorId, { businessDate });
    const serializationContext = {
      actorId,
      joinedSessionIds: membershipContext.joinedSessionIds,
      activeJoinedSessionIds: membershipContext.activeJoinedSessionIds,
    };

    const visibleSessionWhereClauses: Array<Record<string | symbol, unknown>> = [{ businessDate }];
    if (!managerAccess) {
      visibleSessionWhereClauses.push(buildSessionVisibilityFilter(actorId, membershipContext.joinedSessionIds));
    }
    const visibleSessionWhere =
      visibleSessionWhereClauses.length === 1
        ? visibleSessionWhereClauses[0]
        : { [Op.and]: visibleSessionWhereClauses };

    const joinableWhereClauses: Array<Record<string | symbol, unknown>> = [
      { businessDate },
      { status: 'active' },
    ];
    const activeJoinedSessionIds = Array.from(membershipContext.activeJoinedSessionIds.values());
    if (activeJoinedSessionIds.length > 0) {
      joinableWhereClauses.push({
        id: {
          [Op.notIn]: activeJoinedSessionIds,
        },
      });
    }
    const joinableSessionWhere =
      joinableWhereClauses.length === 1
        ? joinableWhereClauses[0]
        : { [Op.and]: joinableWhereClauses };

    const overviewPromise = buildOpenBarOverviewPayload(businessDate, req);
    const stockMapPromise = getStockMap();
    const drinkLabelMapPromise = getDrinkLabelSettingMap();
    const sessionInclude = [
      { model: Venue, as: 'venue', attributes: ['id', 'name'] },
      { model: OpenBarSessionType, as: 'sessionType', attributes: ['id', 'name', 'slug'] },
      { model: User, as: 'createdByUser', attributes: ['id', 'firstName', 'lastName'] },
    ];

    const [
      overview,
      stockMap,
      drinkLabelMap,
      ingredientCategories,
      ingredientVariants,
      ingredientsRaw,
      recipesRaw,
      sessionTypesCatalogRaw,
      sessionsRaw,
      joinableSessionsRaw,
      deliveriesRaw,
      venuesRaw,
    ] = await Promise.all([
      overviewPromise,
      stockMapPromise,
      drinkLabelMapPromise,
      OpenBarIngredientCategory.findAll({
        order: [
          ['sortOrder', 'ASC'],
          ['name', 'ASC'],
        ],
      }),
      OpenBarIngredientVariant.findAll({
        include: [{ model: OpenBarIngredient, as: 'ingredient', attributes: ['id', 'name', 'baseUnit'] }],
        order: [['name', 'ASC']],
      }),
      OpenBarIngredient.findAll({
        include: [{ model: OpenBarIngredientCategory, as: 'categoryRef', attributes: ['id', 'name', 'slug', 'isActive'] }],
        order: [['name', 'ASC']],
      }),
      OpenBarRecipe.findAll({
        include: [
          { model: OpenBarIngredient, as: 'cupIngredient', attributes: ['id', 'name', 'baseUnit', 'isCup', 'cupType', 'cupCapacityMl', 'costPerUnit', 'isActive'] },
          {
            model: OpenBarRecipeIngredient,
            as: 'ingredients',
            include: [
              { model: OpenBarIngredient, as: 'ingredient' },
              { model: OpenBarIngredientCategory, as: 'category' },
            ],
          },
        ],
        order: [
          ['name', 'ASC'],
          [{ model: OpenBarRecipeIngredient, as: 'ingredients' }, 'sortOrder', 'ASC'],
        ],
      }),
      OpenBarSessionType.findAll({
        order: [
          ['sortOrder', 'ASC'],
          ['name', 'ASC'],
        ],
      }),
      OpenBarSession.findAll({
        where: visibleSessionWhere,
        include: sessionInclude,
        order: [
          ['businessDate', 'DESC'],
          ['id', 'DESC'],
        ],
        limit: sessionLimit,
      }),
      OpenBarSession.findAll({
        where: joinableSessionWhere,
        include: sessionInclude,
        order: [
          ['businessDate', 'DESC'],
          ['id', 'DESC'],
        ],
        limit: sessionLimit,
      }),
      OpenBarDelivery.findAll({
        where: {
          deliveredAt: {
            [Op.gte]: startOfBusinessDate(businessDate),
            [Op.lt]: endOfBusinessDateExclusive(businessDate),
          },
        },
        include: [
          {
            model: OpenBarDeliveryItem,
            as: 'items',
            include: [
              { model: OpenBarIngredient, as: 'ingredient', attributes: ['id', 'name', 'baseUnit'] },
              { model: OpenBarIngredientVariant, as: 'variant', attributes: ['id', 'name', 'brand', 'packageLabel', 'baseQuantity'] },
            ],
          },
          { model: User, as: 'receivedByUser', attributes: ['id', 'firstName', 'lastName'] },
        ],
        order: [['deliveredAt', 'DESC']],
        limit: deliveryLimit,
      }),
      Venue.findAll({
        where: { isActive: true, allowsOpenBar: true },
        attributes: ['id', 'name', 'isActive', 'allowsOpenBar', 'sortOrder'],
        order: [
          ['sortOrder', 'ASC'],
          ['name', 'ASC'],
        ],
      }),
    ]);

    const visibleSessionIds = new Set(sessionsRaw.map((session) => session.id));
    const joinableSessionsFiltered = joinableSessionsRaw.filter((session) => !visibleSessionIds.has(session.id));
    const sessionIds = Array.from(
      new Set([...sessionsRaw.map((session) => session.id), ...joinableSessionsFiltered.map((session) => session.id)]),
    );
    const issueSummaries =
      sessionIds.length > 0
        ? await OpenBarDrinkIssue.findAll({
            attributes: ['sessionId', 'servings', 'issuedAt'],
            where: { sessionId: { [Op.in]: sessionIds } },
            raw: true,
          })
        : [];

    const sessionSummaryMap = new Map<number, { issuesCount: number; servings: number; lastIssuedAt: Date | null }>();
    issueSummaries.forEach((issue) => {
      const sessionId = Number((issue as { sessionId: number }).sessionId);
      const current = sessionSummaryMap.get(sessionId) ?? { issuesCount: 0, servings: 0, lastIssuedAt: null };
      current.issuesCount += 1;
      current.servings += parseNumber((issue as { servings: unknown }).servings, 0);
      const issuedAt = normalizeDateTime((issue as { issuedAt: unknown }).issuedAt, new Date(0));
      if (!current.lastIssuedAt || issuedAt > current.lastIssuedAt) {
        current.lastIssuedAt = issuedAt;
      }
      sessionSummaryMap.set(sessionId, current);
    });

    const sessions = sessionsRaw.map((session) =>
      serializeSession(session, sessionSummaryMap.get(session.id), serializationContext),
    );
    const joinableSessions = joinableSessionsFiltered.map((session) =>
      serializeSession(session, sessionSummaryMap.get(session.id), serializationContext),
    );
    const currentUserSession =
      sessions.find((session) => membershipContext.activeJoinedSessionIds.has(session.id)) ?? null;

    const sessionIssuesRaw =
      currentUserSession == null
        ? []
        : await OpenBarDrinkIssue.findAll({
            where: { sessionId: currentUserSession.id },
            include: [
              { model: OpenBarRecipe, as: 'recipe', attributes: ['id', 'name', 'drinkType'] },
              { model: User, as: 'issuedByUser', attributes: ['id', 'firstName', 'lastName'] },
              { model: OpenBarSession, as: 'session', attributes: ['id', 'businessDate', 'sessionName', 'status'] },
            ],
            order: [['issuedAt', 'DESC']],
            limit: sessionIssueLimit,
          });

    res.status(200).json({
      businessDate,
      overview,
      ingredients: ingredientsRaw.map((ingredient) => serializeIngredient(ingredient, stockMap)),
      ingredientCategories: ingredientCategories.map((category) => serializeIngredientCategory(category)),
      ingredientVariants: ingredientVariants.map((variant) => serializeIngredientVariant(variant)),
      recipes: recipesRaw.map((recipe) => serializeRecipe(recipe)),
      drinkLabelSettings: DRINK_TYPES.map((drinkType) =>
        serializeDrinkLabelSetting(drinkType, drinkLabelMap.get(drinkType) ?? DEFAULT_DRINK_LABEL_MODE_BY_TYPE[drinkType]),
      ),
      sessionTypes: sessionTypesCatalogRaw.filter((sessionType) => sessionType.isActive).map((sessionType) => serializeSessionType(sessionType)),
      sessionTypesCatalog: sessionTypesCatalogRaw.map((sessionType) => serializeSessionType(sessionType)),
      sessions,
      joinableSessions,
      currentUserSession,
      venues: venuesRaw.map((venue) => ({
        id: venue.id,
        name: venue.name,
        isActive: venue.isActive,
        allowsOpenBar: venue.allowsOpenBar,
        sortOrder: venue.sortOrder,
      })),
      sessionIssues: sessionIssuesRaw.map((issue) => ({
        ...serializeIssue(issue),
        sessionName: issue.session?.sessionName ?? null,
        businessDate: issue.session?.businessDate ?? null,
      })),
      deliveries: deliveriesRaw.map((delivery) => serializeDelivery(delivery)),
    });
  } catch (error) {
    handleError(res, error, 'Failed to load open bar bootstrap');
  }
};
