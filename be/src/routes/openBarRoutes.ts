import { NextFunction, Response, Router } from 'express';
import authMiddleware from '../middleware/authMiddleware.js';
import type { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';
import {
  createOpenBarDelivery,
  createOpenBarDrinkIssue,
  createOpenBarIngredient,
  createOpenBarIngredientCategory,
  createOpenBarIngredientVariant,
  createOpenBarInventoryAdjustment,
  createOpenBarRecipe,
  createOpenBarSession,
  joinOpenBarSession,
  leaveOpenBarSession,
  closeOpenBarSession,
  createOpenBarSessionType,
  deleteOpenBarSession,
  deleteOpenBarDrinkIssue,
  getOpenBarBootstrap,
  getOpenBarOverview,
  listOpenBarDrinkLabelSettings,
  listOpenBarDeliveries,
  listOpenBarDrinkIssues,
  listOpenBarIngredients,
  listOpenBarIngredientCategories,
  listOpenBarIngredientVariants,
  listOpenBarRecipes,
  listOpenBarSessionTypes,
  listOpenBarSessions,
  replaceOpenBarRecipeIngredients,
  streamOpenBarEvents,
  startOpenBarSession,
  updateOpenBarSessionType,
  updateOpenBarDrinkLabelSettings,
  updateOpenBarIngredient,
  updateOpenBarIngredientCategory,
  updateOpenBarIngredientVariant,
  updateOpenBarRecipe,
} from '../controllers/openBarController.js';

const router = Router();

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

const requireOpenBarManagerAccess = (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
  const roleSlug = normalizeRoleSlug(req.authContext?.roleSlug ?? req.authContext?.userTypeSlug ?? null);
  const shiftRoleSlugs = new Set(
    (req.authContext?.shiftRoleSlugs ?? [])
      .map((value) => normalizeRoleSlug(value))
      .filter((value): value is string => Boolean(value)),
  );

  const isManagerShift = shiftRoleSlugs.has('manager');
  const isPrivilegedRole = roleSlug != null && OPEN_BAR_PRIVILEGED_ROLE_SLUGS.has(roleSlug);

  if (!isManagerShift && !isPrivilegedRole) {
    res.status(403).json([{ message: 'Manager shift-role required for this Open Bar action.' }]);
    return;
  }

  next();
};

const requireOpenBarSessionOperatorAccess = (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
  const roleSlug = normalizeRoleSlug(req.authContext?.roleSlug ?? req.authContext?.userTypeSlug ?? null);
  const shiftRoleSlugs = new Set(
    (req.authContext?.shiftRoleSlugs ?? [])
      .map((value) => normalizeRoleSlug(value))
      .filter((value): value is string => Boolean(value)),
  );

  const isOperatorShift = shiftRoleSlugs.has('manager') || shiftRoleSlugs.has('bartender');
  const isPrivilegedRole = roleSlug != null && OPEN_BAR_PRIVILEGED_ROLE_SLUGS.has(roleSlug);
  const isBartenderRole = roleSlug === 'bartender';

  if (!isOperatorShift && !isPrivilegedRole && !isBartenderRole) {
    res.status(403).json([{ message: 'Bartender or manager shift-role required for this Open Bar action.' }]);
    return;
  }

  next();
};

router.get('/overview', authMiddleware, getOpenBarOverview);
router.get('/bootstrap', authMiddleware, getOpenBarBootstrap);
router.get('/events', authMiddleware, requireOpenBarSessionOperatorAccess, streamOpenBarEvents);

router.get('/ingredients', authMiddleware, listOpenBarIngredients);
router.post('/ingredients', authMiddleware, requireOpenBarManagerAccess, createOpenBarIngredient);
router.patch('/ingredients/:id', authMiddleware, requireOpenBarManagerAccess, updateOpenBarIngredient);
router.get('/ingredient-categories', authMiddleware, listOpenBarIngredientCategories);
router.post('/ingredient-categories', authMiddleware, requireOpenBarManagerAccess, createOpenBarIngredientCategory);
router.patch('/ingredient-categories/:id', authMiddleware, requireOpenBarManagerAccess, updateOpenBarIngredientCategory);
router.get('/ingredient-variants', authMiddleware, listOpenBarIngredientVariants);
router.post('/ingredient-variants', authMiddleware, requireOpenBarManagerAccess, createOpenBarIngredientVariant);
router.patch('/ingredient-variants/:id', authMiddleware, requireOpenBarManagerAccess, updateOpenBarIngredientVariant);

router.get('/recipes', authMiddleware, listOpenBarRecipes);
router.post('/recipes', authMiddleware, requireOpenBarManagerAccess, createOpenBarRecipe);
router.patch('/recipes/:id', authMiddleware, requireOpenBarManagerAccess, updateOpenBarRecipe);
router.put('/recipes/:id/ingredients', authMiddleware, requireOpenBarManagerAccess, replaceOpenBarRecipeIngredients);

router.get('/session-types', authMiddleware, listOpenBarSessionTypes);
router.post('/session-types', authMiddleware, requireOpenBarManagerAccess, createOpenBarSessionType);
router.patch('/session-types/:id', authMiddleware, requireOpenBarManagerAccess, updateOpenBarSessionType);
router.get('/sessions', authMiddleware, listOpenBarSessions);
router.post('/sessions', authMiddleware, requireOpenBarSessionOperatorAccess, createOpenBarSession);
router.post('/sessions/:id/join', authMiddleware, requireOpenBarSessionOperatorAccess, joinOpenBarSession);
router.post('/sessions/:id/leave', authMiddleware, requireOpenBarSessionOperatorAccess, leaveOpenBarSession);
router.post('/sessions/:id/start', authMiddleware, requireOpenBarSessionOperatorAccess, startOpenBarSession);
router.post('/sessions/:id/close', authMiddleware, requireOpenBarSessionOperatorAccess, closeOpenBarSession);
router.delete('/sessions/:id', authMiddleware, requireOpenBarManagerAccess, deleteOpenBarSession);

router.get('/drink-issues', authMiddleware, listOpenBarDrinkIssues);
router.post('/drink-issues', authMiddleware, createOpenBarDrinkIssue);
router.delete('/drink-issues/:id', authMiddleware, requireOpenBarSessionOperatorAccess, deleteOpenBarDrinkIssue);
router.get('/drink-label-settings', authMiddleware, listOpenBarDrinkLabelSettings);
router.put('/drink-label-settings', authMiddleware, requireOpenBarManagerAccess, updateOpenBarDrinkLabelSettings);

router.get('/deliveries', authMiddleware, listOpenBarDeliveries);
router.post('/deliveries', authMiddleware, requireOpenBarManagerAccess, createOpenBarDelivery);

router.post('/inventory-adjustments', authMiddleware, requireOpenBarManagerAccess, createOpenBarInventoryAdjustment);

export default router;
