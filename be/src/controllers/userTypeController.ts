import { Request, Response } from 'express';
import { DataType } from 'sequelize-typescript';
import sequelize from '../config/database.js';
import UserType from '../models/UserType.js';
import Page from '../models/Page.js';
import Module from '../models/Module.js';
import Action from '../models/Action.js';
import RolePagePermission from '../models/RolePagePermission.js';
import RoleModulePermission from '../models/RoleModulePermission.js';
import { ErrorWithMessage } from '../types/ErrorWithMessage.js';
import type { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';
import type { Transaction } from 'sequelize';
import ProductType from '../models/ProductType.js';
import UserTypeProductType from '../models/UserTypeProductType.js';

const buildColumns = () => {
  const attributes = UserType.getAttributes();
  return Object.entries(attributes)
    .map(([key, attribute]) => ({
      header: key.charAt(0).toUpperCase() + key.slice(1),
      accessorKey: key,
      type: attribute.type instanceof DataType.DATE ? 'date' : 'text',
    }))
    .concat([{ header: 'Allowed Product Types', accessorKey: 'productTypeIds', type: 'text' }]);
};

const normalizeSlug = (input: string) => input.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

const ensurePayload = (payload: Record<string, unknown>) => {
  const body = { ...payload };
  if (typeof body.slug === 'string' && body.slug.trim()) {
    body.slug = normalizeSlug(body.slug);
  } else if (typeof body.name === 'string' && body.name.trim()) {
    body.slug = normalizeSlug(body.name);
  }
  return body;
};

const parseProductTypeIds = (value: unknown): number[] | undefined => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error('productTypeIds must be an array');
  const ids = [...new Set(value.map(Number))];
  if (ids.some((id) => !Number.isInteger(id) || id <= 0)) {
    throw new Error('productTypeIds must contain positive integers');
  }
  return ids;
};

const syncProductTypeScope = async (userTypeId: number, ids: number[], transaction: Transaction) => {
  if (ids.length > 0) {
    const count = await ProductType.count({ where: { id: ids }, transaction });
    if (count !== ids.length) throw new Error('One or more product types do not exist');
  }
  await UserTypeProductType.destroy({ where: { userTypeId }, transaction });
  if (ids.length > 0) {
    await UserTypeProductType.bulkCreate(ids.map((productTypeId) => ({ userTypeId, productTypeId })), { transaction });
  }
};

const serializeUserTypes = async (records: UserType[]) => {
  const ids = records.map((record) => record.id);
  const links = ids.length ? await UserTypeProductType.findAll({ where: { userTypeId: ids } }) : [];
  const byRole = new Map<number, number[]>();
  links.forEach((link) => byRole.set(link.userTypeId, [...(byRole.get(link.userTypeId) ?? []), link.productTypeId]));
  return records.map((record) => ({ ...record.get({ plain: true }), productTypeIds: byRole.get(record.id) ?? [] }));
};

const PERMISSION_ACTIONS = new Set(['add_all', 'remove_all', 'copy_from'] as const);
type PermissionAction = 'add_all' | 'remove_all' | 'copy_from';

const parsePermissionAction = (value: unknown): PermissionAction | null => {
  if (typeof value !== 'string') {
    return null;
  }
  return PERMISSION_ACTIONS.has(value as PermissionAction) ? (value as PermissionAction) : null;
};

const upsertPagePermission = async (params: {
  userTypeId: number;
  pageId: number;
  canView: boolean;
  status: boolean;
  actorId: number | null;
  transaction: Transaction;
}): Promise<void> => {
  const { userTypeId, pageId, canView, status, actorId, transaction } = params;
  const [record, created] = await RolePagePermission.findOrCreate({
    where: { userTypeId, pageId },
    defaults: {
      userTypeId,
      pageId,
      canView,
      status,
      createdBy: actorId,
      updatedBy: actorId,
    },
    transaction,
  });

  if (!created) {
    await record.update(
      {
        canView,
        status,
        updatedBy: actorId,
      },
      { transaction },
    );
  }
};

const upsertModulePermission = async (params: {
  userTypeId: number;
  moduleId: number;
  actionId: number;
  allowed: boolean;
  status: boolean;
  actorId: number | null;
  transaction: Transaction;
}): Promise<void> => {
  const { userTypeId, moduleId, actionId, allowed, status, actorId, transaction } = params;
  const [record, created] = await RoleModulePermission.findOrCreate({
    where: { userTypeId, moduleId, actionId },
    defaults: {
      userTypeId,
      moduleId,
      actionId,
      allowed,
      status,
      createdBy: actorId,
      updatedBy: actorId,
    },
    transaction,
  });

  if (!created) {
    await record.update(
      {
        allowed,
        status,
        updatedBy: actorId,
      },
      { transaction },
    );
  }
};

export const getAllUserTypes = async (req: Request, res: Response): Promise<void> => {
  try {
    const records = await UserType.findAll();
    const data = await serializeUserTypes(records);
    res.status(200).json([{ data, columns: buildColumns() }]);
  } catch (error) {
    const errorMessage = (error as ErrorWithMessage).message;
    res.status(500).json([{ message: errorMessage }]);
  }
};

export const getUserTypeById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const data = await UserType.findByPk(id);

    if (!data) {
      res.status(404).json([{ message: 'UserType not found' }]);
      return;
    }

    const [serialized] = await serializeUserTypes([data]);
    res.status(200).json([{ data: serialized, columns: buildColumns() }]);
  } catch (error) {
    const errorMessage = (error as ErrorWithMessage).message;
    res.status(500).json([{ message: errorMessage }]);
  }
};

export const createUserType = async (req: Request, res: Response): Promise<void> => {
  try {
    const productTypeIds = parseProductTypeIds(req.body?.productTypeIds) ?? [];
    const payload = ensurePayload(req.body);
    delete payload.productTypeIds;
    const newUserType = await sequelize.transaction(async (transaction) => {
      const created = await UserType.create(payload, { transaction });
      await syncProductTypeScope(created.id, productTypeIds, transaction);
      return created;
    });
    const [serialized] = await serializeUserTypes([newUserType]);
    res.status(201).json([serialized]);
  } catch (error) {
    const e = error as ErrorWithMessage;
    res.status(500).json([{ message: e.message }]);
  }
};

export const updateUserType = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const productTypeIds = parseProductTypeIds(req.body?.productTypeIds);
    const payload = ensurePayload(req.body);
    delete payload.productTypeIds;
    const updated = await sequelize.transaction(async (transaction) => {
      const [count] = await UserType.update(payload, { where: { id }, transaction });
      if (count && productTypeIds !== undefined) await syncProductTypeScope(Number(id), productTypeIds, transaction);
      return count;
    });

    if (!updated) {
      res.status(404).json([{ message: 'UserType not found' }]);
      return;
    }

    const updatedUserType = await UserType.findByPk(id);
    const [serialized] = updatedUserType ? await serializeUserTypes([updatedUserType]) : [];
    res.status(200).json([serialized]);
  } catch (error) {
    const errorMessage = (error as ErrorWithMessage).message;
    res.status(500).json([{ message: errorMessage }]);
  }
};

export const deleteUserType = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const deleted = await UserType.destroy({ where: { id } });

    if (!deleted) {
      res.status(404).json([{ message: 'UserType not found' }]);
      return;
    }

    res.status(204).send();
  } catch (error) {
    const errorMessage = (error as ErrorWithMessage).message;
    res.status(500).json([{ message: errorMessage }]);
  }
};

export const applyUserTypePermissions = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const userTypeId = Number(req.params.id);
  if (!Number.isInteger(userTypeId) || userTypeId <= 0) {
    res.status(400).json([{ message: 'UserType ID must be a positive integer' }]);
    return;
  }

  const action = parsePermissionAction(req.body?.action);
  if (!action) {
    res.status(400).json([{ message: 'Invalid permissions action' }]);
    return;
  }

  const sourceUserTypeId =
    action === 'copy_from' ? Number(req.body?.sourceUserTypeId) : null;

  if (action === 'copy_from' && (!Number.isInteger(sourceUserTypeId) || (sourceUserTypeId ?? 0) <= 0)) {
    res.status(400).json([{ message: 'sourceUserTypeId is required for copy_from' }]);
    return;
  }

  if (action === 'copy_from' && sourceUserTypeId === userTypeId) {
    res.status(400).json([{ message: 'sourceUserTypeId must be different from target user type' }]);
    return;
  }

  try {
    const targetUserType = await UserType.findByPk(userTypeId);
    if (!targetUserType) {
      res.status(404).json([{ message: 'UserType not found' }]);
      return;
    }

    if (action === 'copy_from') {
      const sourceUserType = await UserType.findByPk(sourceUserTypeId as number);
      if (!sourceUserType) {
        res.status(404).json([{ message: 'Source user type not found' }]);
        return;
      }
    }

    const actorId = req.authContext?.id ?? null;
    const result = await sequelize.transaction(async (transaction) => {
      const [pages, modules, actions] = await Promise.all([
        Page.findAll({ attributes: ['id'], transaction }),
        Module.findAll({ attributes: ['id'], transaction }),
        Action.findAll({ attributes: ['id'], transaction }),
      ]);

      const pageMap = new Map<number, { canView: boolean; status: boolean }>();
      const moduleMap = new Map<string, { allowed: boolean; status: boolean }>();

      if (action === 'copy_from') {
        const [sourcePages, sourceModules] = await Promise.all([
          RolePagePermission.findAll({ where: { userTypeId: sourceUserTypeId }, transaction }),
          RoleModulePermission.findAll({ where: { userTypeId: sourceUserTypeId }, transaction }),
        ]);

        sourcePages.forEach((permission) => {
          if (typeof permission.pageId === 'number') {
            pageMap.set(permission.pageId, {
              canView: permission.canView,
              status: permission.status,
            });
          }
        });

        sourceModules.forEach((permission) => {
          if (typeof permission.moduleId === 'number' && typeof permission.actionId === 'number') {
            moduleMap.set(`${permission.moduleId}:${permission.actionId}`, {
              allowed: permission.allowed,
              status: permission.status,
            });
          }
        });
      }

      const allowAll = action === 'add_all';
      for (const page of pages) {
        const pageId = page.id;
        if (typeof pageId !== 'number') {
          continue;
        }
        const next = action === 'copy_from'
          ? pageMap.get(pageId) ?? { canView: false, status: false }
          : { canView: allowAll, status: allowAll };

        await upsertPagePermission({
          userTypeId,
          pageId,
          canView: next.canView,
          status: next.status,
          actorId,
          transaction,
        });
      }

      for (const moduleRecord of modules) {
        const moduleId = moduleRecord.id;
        if (typeof moduleId !== 'number') {
          continue;
        }
        for (const actionRecord of actions) {
          const actionId = actionRecord.id;
          if (typeof actionId !== 'number') {
            continue;
          }
          const next = action === 'copy_from'
            ? moduleMap.get(`${moduleId}:${actionId}`) ?? { allowed: false, status: false }
            : { allowed: allowAll, status: allowAll };

          await upsertModulePermission({
            userTypeId,
            moduleId,
            actionId,
            allowed: next.allowed,
            status: next.status,
            actorId,
            transaction,
          });
        }
      }

      return {
        pagesApplied: pages.length,
        modulePermissionsApplied: modules.length * actions.length,
      };
    });

    res.status(200).json({
      message: 'Permissions updated.',
      ...result,
    });
  } catch (error) {
    const errorMessage = (error as ErrorWithMessage).message;
    res.status(500).json([{ message: errorMessage }]);
  }
};

