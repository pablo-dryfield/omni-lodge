import { Request, Response } from 'express';
import { DataType } from 'sequelize-typescript';
import UserType from '../models/UserType.js';
import { ErrorWithMessage } from '../types/ErrorWithMessage.js';

const buildColumns = () => {
  const attributes = UserType.getAttributes();
  return Object.entries(attributes)
    .map(([key, attribute]) => ({
      header: key.charAt(0).toUpperCase() + key.slice(1),
      accessorKey: key,
      type: attribute.type instanceof DataType.DATE ? 'date' : 'text',
    }));
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

export const getAllUserTypes = async (req: Request, res: Response): Promise<void> => {
  try {
    const data = await UserType.findAll();
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

    res.status(200).json([{ data, columns: buildColumns() }]);
  } catch (error) {
    const errorMessage = (error as ErrorWithMessage).message;
    res.status(500).json([{ message: errorMessage }]);
  }
};

export const createUserType = async (req: Request, res: Response): Promise<void> => {
  try {
    const payload = ensurePayload(req.body);
    const newUserType = await UserType.create(payload);
    res.status(201).json([newUserType]);
  } catch (error) {
    const e = error as ErrorWithMessage;
    res.status(500).json([{ message: e.message }]);
  }
};

export const updateUserType = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const payload = ensurePayload(req.body);
    const [updated] = await UserType.update(payload, { where: { id } });

    if (!updated) {
      res.status(404).json([{ message: 'UserType not found' }]);
      return;
    }

    const updatedUserType = await UserType.findByPk(id);
    res.status(200).json([updatedUserType]);
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

