import type { AuthenticatedRequest } from '../../types/AuthenticatedRequest.js';
import type { Response, NextFunction } from 'express';
import { workspaceConfiguration } from './config.js';
import { WorkspaceError, type ExecutionMode } from './types.js';
import { loadWorkspaceAccount, loadWorkspaceAuthority } from './appMetadata.js';

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
const requestAuthority = new WeakMap<
  AuthenticatedRequest,
  ReturnType<typeof loadWorkspaceAuthority>
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
  let pending = requestAuthority.get(req);
  if (!pending) {
    pending = loadWorkspaceAuthority(req.authContext.userTypeId || 0);
    requestAuthority.set(req, pending);
  }
  const authority = await pending;
  if (!authority.page)
    throw new WorkspaceError(
      403,
      'CAPABILITY_REQUIRED',
      'Your Database Workspace page permission is disabled.',
    );
  if (!authority.actions.includes('view'))
    throw new WorkspaceError(
      403,
      'CAPABILITY_REQUIRED',
      'Your Database Workspace view permission is disabled.',
    );
  if (!authority.actions.includes(action))
    throw new WorkspaceError(
      403,
      'CAPABILITY_REQUIRED',
      `Your Database Workspace ${action} permission is disabled or this action is inactive.`,
    );
  return req.authContext.id;
}
export async function reauthorizeExecution(
  actorId: number,
  mode: ExecutionMode,
  policyHash: string,
  additional?: WorkspaceAction,
): Promise<void> {
  const user = await loadWorkspaceAccount(actorId),
    role = user?.role;
  if (
    !user?.status ||
    !user.approved ||
    !user.userTypeId ||
    !role?.status ||
    !admin(role.slug)
  )
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
