import { NextFunction, Response } from 'express';
import { AuthenticatedRequest } from '../types/AuthenticatedRequest';
import RoleModulePermission from '../models/RoleModulePermission.js';
import Module from '../models/Module.js';
import Action from '../models/Action.js';

const buildPermissionCache = async (userTypeId: number): Promise<Map<string, Set<string>>> => {
  const permissions = await RoleModulePermission.findAll({
    where: { userTypeId, allowed: true, status: true },
    include: [
      { model: Module, as: 'module', attributes: ['slug', 'status'] },
      { model: Action, as: 'action', attributes: ['key'] },
    ],
  });

  const cache = new Map<string, Set<string>>();

  permissions.forEach(permission => {
    const moduleInstance = (permission as unknown as { module?: Module }).module;
    const actionInstance = (permission as unknown as { action?: Action }).action;

    if (!moduleInstance || moduleInstance.status === false || !moduleInstance.slug) {
      return;
    }

    if (!actionInstance || !actionInstance.key) {
      return;
    }

    const actions = cache.get(moduleInstance.slug) ?? new Set<string>();
    actions.add(actionInstance.key);
    cache.set(moduleInstance.slug, actions);
  });

  return cache;
};

export const authorizeModuleAction = (moduleSlug: string, actionKey: string) => {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const context = req.authContext;
      if (!context || context.userTypeId == null) {
        res.status(403).json([{ message: 'Forbidden' }]);
        return;
      }

      if (!req.permissionCache || req.permissionCache.size === 0) {
        req.permissionCache = await buildPermissionCache(context.userTypeId);
      }

      const actions = req.permissionCache.get(moduleSlug);
      if (!actions || !actions.has(actionKey)) {
        res.status(403).json([{ message: 'Forbidden' }]);
        return;
      }

      next();
    } catch (error) {
      res.status(500).json([{ message: (error as Error).message }]);
    }
  };
};

const normalizeRole = (value: string): string => {
  const trimmed = value.trim().toLowerCase();
  const withHyphens = trimmed.replace(/[\s_]+/g, '-');
  const collapsed = withHyphens.replace(/-/g, '');

  if (collapsed === 'administrator') {
    return 'admin';
  }
  if (collapsed === 'assistantmanager') {
    return 'assistant-manager';
  }
  if (collapsed === 'assistmanager') {
    return 'assistant-manager';
  }
  if (collapsed === 'mgr' || collapsed === 'manager') {
    return 'manager';
  }

  return withHyphens;
};

export const requireRoles = (roleSlugs: readonly string[]) => {
  const allowedRoles = new Set(roleSlugs.map((role) => normalizeRole(role)));

  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    const context = req.authContext;
    if (!context || !context.roleSlug) {
      res.status(403).json([{ message: 'Forbidden' }]);
      return;
    }

    const normalizedRole = normalizeRole(context.roleSlug);

    if (!allowedRoles.has(normalizedRole)) {
      res.status(403).json([{ message: 'Forbidden' }]);
      return;
    }
    next();
  };
};

