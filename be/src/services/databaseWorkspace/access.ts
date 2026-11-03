import type { AuthenticatedRequest } from '../../types/AuthenticatedRequest.js';
import type { Response, NextFunction } from 'express';
import { hasModuleActionPermission } from '../../middleware/authorizationMiddleware.js';
import User from '../../models/User.js';
import UserType from '../../models/UserType.js';
import RolePagePermission from '../../models/RolePagePermission.js';
import Page from '../../models/Page.js';
import ModuleAction from '../../models/ModuleAction.js';
import Module from '../../models/Module.js';
import Action from '../../models/Action.js';
import { workspaceConfiguration } from './config.js';
import { WorkspaceError, type ExecutionMode } from './types.js';

export const WORKSPACE_ACTIONS = [
  'view',
  'read',
  'write',
  'export',
  'schema',
  'monitor',
  'session',
  'maintenance',
  'backup',
  'restore',
  'schedule',
  'audit',
  'cancelOthers',
  'terminate',
  'privileges',
  'backupDelete',
] as const;
export type WorkspaceAction = (typeof WORKSPACE_ACTIONS)[number];
const admin = (slug: string | null | undefined) =>
  ['admin', 'administrator'].includes((slug || '').trim().toLowerCase());
const pageEligibility = new WeakMap<AuthenticatedRequest, Promise<number>>();
const enabledActions = new WeakMap<
  AuthenticatedRequest,
  Map<WorkspaceAction, Promise<number>>
>();
export async function workspaceAccess(
  req: AuthenticatedRequest,
  action: WorkspaceAction,
): Promise<number> {
  if (
    !req.authContext ||
    !admin(req.authContext.roleSlug) ||
    (req.productTypeScope?.length ?? 0) > 0
  )
    throw new WorkspaceError(
      403,
      'FORBIDDEN',
      'Database Workspace requires a global administrator account.',
    );
  let eligibility = pageEligibility.get(req);
  if (!eligibility) {
    eligibility = RolePagePermission.count({
      where: {
        userTypeId: req.authContext.userTypeId,
        canView: true,
        status: true,
      },
      include: [
        {
          model: Page,
          as: 'page',
          required: true,
          where: { slug: 'settings-sql-helper', status: true },
        },
      ],
    });
    pageEligibility.set(req, eligibility);
  }
  const visible = await eligibility;
  if (!visible)
    throw new WorkspaceError(
      403,
      'CAPABILITY_REQUIRED',
      'Your Database Workspace page permission is disabled.',
    );
  if (!(await hasModuleActionPermission(req, 'database-workspace', 'view')))
    throw new WorkspaceError(
      403,
      'CAPABILITY_REQUIRED',
      'Your Database Workspace view permission is disabled.',
    );
  if (!(await hasModuleActionPermission(req, 'database-workspace', action)))
    throw new WorkspaceError(
      403,
      'CAPABILITY_REQUIRED',
      `Your Database Workspace ${action} permission is disabled.`,
    );
  let requestActions = enabledActions.get(req);
  if (!requestActions) {
    requestActions = new Map();
    enabledActions.set(req, requestActions);
  }
  let actionEnabled = requestActions.get(action);
  if (!actionEnabled) {
    actionEnabled = ModuleAction.count({
      where: { enabled: true },
      include: [
        {
          model: Module,
          as: 'module',
          required: true,
          where: { slug: 'database-workspace', status: true },
        },
        {
          model: Action,
          as: 'action',
          required: true,
          where: { key: action, status: true },
        },
      ],
    });
    requestActions.set(action, actionEnabled);
  }
  const enabled = await actionEnabled;
  if (!enabled)
    throw new WorkspaceError(
      403,
      'CAPABILITY_REQUIRED',
      'This database action is disabled.',
    );
  return req.authContext.id;
}
export async function reauthorizeExecution(
  actorId: number,
  mode: ExecutionMode,
  policyHash: string,
  additional?: WorkspaceAction,
): Promise<void> {
  const user = await User.findByPk(actorId, {
    include: [{ model: UserType, as: 'role' }],
  });
  const role = (user as unknown as { role?: UserType })?.role;
  if (!user?.status || !user.approved || !role?.status || !admin(role.slug))
    throw new WorkspaceError(
      403,
      'AUTHORITY_REVOKED',
      'The account is no longer authorized to execute database jobs.',
    );
  // Product-scoped roles cannot acquire the workspace by changing ordinary module grants.
  const { default: UserTypeProductType } = await import(
    '../../models/UserTypeProductType.js'
  );
  if (
    await UserTypeProductType.count({ where: { userTypeId: user.userTypeId } })
  )
    throw new WorkspaceError(
      403,
      'AUTHORITY_REVOKED',
      'Product-scoped accounts cannot execute database jobs.',
    );
  const req = {
    authContext: {
      id: user.id,
      userTypeId: user.userTypeId,
      roleSlug: role.slug,
    },
    permissionCache: new Map(),
  } as AuthenticatedRequest;
  await workspaceAccess(
    req,
    mode === 'read' ? 'read' : mode === 'write' ? 'write' : 'maintenance',
  );
  if (additional) await workspaceAccess(req, additional);
  const config = await workspaceConfiguration();
  if (!config.enabled || config.policyHash !== policyHash)
    throw new WorkspaceError(
      409,
      'POLICY_CHANGED',
      'The connection policy changed. Review and submit a new operation.',
    );
}
export async function workspaceViewGate(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    await workspaceAccess(req, 'view');
    next();
  } catch (error) {
    if (error instanceof WorkspaceError)
      res
        .status(error.status)
        .json({ code: error.code, message: error.message });
    else
      res.status(503).json({
        code: 'WORKSPACE_AUTHORITY_UNAVAILABLE',
        message: 'Workspace authority could not be verified.',
      });
  }
}
