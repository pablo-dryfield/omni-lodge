import { Request, Response } from 'express';
import { DataType } from 'sequelize-typescript';
import RolePagePermission from '../models/RolePagePermission.js';
import { ErrorWithMessage } from '../types/ErrorWithMessage.js';

const buildColumns = () => {
  const attributes = RolePagePermission.getAttributes();
  return Object.entries(attributes).map(([key, attribute]) => ({
    header: key.charAt(0).toUpperCase() + key.slice(1),
    accessorKey: key,
    type: attribute.type instanceof DataType.DATE ? 'date' : 'text',
  }));
};

export const getAllRolePagePermissions = async (req: Request, res: Response): Promise<void> => {
  try {
    const data = await RolePagePermission.findAll();
    res.status(200).json([{ data, columns: buildColumns() }]);
  } catch (error) {
    res.status(500).json([{ message: (error as ErrorWithMessage).message }]);
  }
};

export const getRolePagePermissionsByRole = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userTypeId } = req.params;
    const data = await RolePagePermission.findAll({ where: { userTypeId } });
    res.status(200).json([{ data, columns: buildColumns() }]);
  } catch (error) {
    res.status(500).json([{ message: (error as ErrorWithMessage).message }]);
  }
};

export const getRolePagePermissionsByPage = async (req: Request, res: Response): Promise<void> => {
  try {
    const { pageId } = req.params;
    const data = await RolePagePermission.findAll({ where: { pageId } });
    res.status(200).json([{ data, columns: buildColumns() }]);
  } catch (error) {
    res.status(500).json([{ message: (error as ErrorWithMessage).message }]);
  }
};

export const getRolePagePermissionById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const data = await RolePagePermission.findByPk(id);

    if (!data) {
      res.status(404).json([{ message: 'Role page permission not found' }]);
      return;
    }

    res.status(200).json([{ data, columns: buildColumns() }]);
  } catch (error) {
    res.status(500).json([{ message: (error as ErrorWithMessage).message }]);
  }
};

export const createRolePagePermission = async (req: Request, res: Response): Promise<void> => {
  try {
    const created = await RolePagePermission.create(req.body);
    res.status(201).json([created]);
  } catch (error) {
    res.status(500).json([{ message: (error as ErrorWithMessage).message }]);
  }
};

export const updateRolePagePermission = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const [updated] = await RolePagePermission.update(req.body, { where: { id } });

    if (!updated) {
      res.status(404).json([{ message: 'Role page permission not found' }]);
      return;
    }

    const data = await RolePagePermission.findByPk(id);
    res.status(200).json([data]);
  } catch (error) {
    res.status(500).json([{ message: (error as ErrorWithMessage).message }]);
  }
};

export const deleteRolePagePermission = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const deleted = await RolePagePermission.destroy({ where: { id } });

    if (!deleted) {
      res.status(404).json([{ message: 'Role page permission not found' }]);
      return;
    }

    res.status(204).send();
  } catch (error) {
    res.status(500).json([{ message: (error as ErrorWithMessage).message }]);
  }
};

