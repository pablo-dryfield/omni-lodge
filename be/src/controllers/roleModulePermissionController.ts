import { Request, Response } from 'express';
import { DataType } from 'sequelize-typescript';
import RoleModulePermission from '../models/RoleModulePermission.js';
import { ErrorWithMessage } from '../types/ErrorWithMessage.js';

const buildColumns = () => {
  const attributes = RoleModulePermission.getAttributes();
  return Object.entries(attributes).map(([key, attribute]) => ({
    header: key.charAt(0).toUpperCase() + key.slice(1),
    accessorKey: key,
    type: attribute.type instanceof DataType.DATE ? 'date' : 'text',
  }));
};

export const getAllRoleModulePermissions = async (req: Request, res: Response): Promise<void> => {
  try {
    const data = await RoleModulePermission.findAll();
    res.status(200).json([{ data, columns: buildColumns() }]);
  } catch (error) {
    res.status(500).json([{ message: (error as ErrorWithMessage).message }]);
  }
};

export const getRoleModulePermissionsByRole = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userTypeId } = req.params;
    const data = await RoleModulePermission.findAll({ where: { userTypeId } });
    res.status(200).json([{ data, columns: buildColumns() }]);
  } catch (error) {
    res.status(500).json([{ message: (error as ErrorWithMessage).message }]);
  }
};

export const getRoleModulePermissionsByModule = async (req: Request, res: Response): Promise<void> => {
  try {
    const { moduleId } = req.params;
    const data = await RoleModulePermission.findAll({ where: { moduleId } });
    res.status(200).json([{ data, columns: buildColumns() }]);
  } catch (error) {
    res.status(500).json([{ message: (error as ErrorWithMessage).message }]);
  }
};

export const getRoleModulePermissionById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const data = await RoleModulePermission.findByPk(id);

    if (!data) {
      res.status(404).json([{ message: 'Role module permission not found' }]);
      return;
    }

    res.status(200).json([{ data, columns: buildColumns() }]);
  } catch (error) {
    res.status(500).json([{ message: (error as ErrorWithMessage).message }]);
  }
};

export const createRoleModulePermission = async (req: Request, res: Response): Promise<void> => {
  try {
    const created = await RoleModulePermission.create(req.body);
    res.status(201).json([created]);
  } catch (error) {
    res.status(500).json([{ message: (error as ErrorWithMessage).message }]);
  }
};

export const updateRoleModulePermission = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const [updated] = await RoleModulePermission.update(req.body, { where: { id } });

    if (!updated) {
      res.status(404).json([{ message: 'Role module permission not found' }]);
      return;
    }

    const data = await RoleModulePermission.findByPk(id);
    res.status(200).json([data]);
  } catch (error) {
    res.status(500).json([{ message: (error as ErrorWithMessage).message }]);
  }
};

export const deleteRoleModulePermission = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const deleted = await RoleModulePermission.destroy({ where: { id } });

    if (!deleted) {
      res.status(404).json([{ message: 'Role module permission not found' }]);
      return;
    }

    res.status(204).send();
  } catch (error) {
    res.status(500).json([{ message: (error as ErrorWithMessage).message }]);
  }
};

