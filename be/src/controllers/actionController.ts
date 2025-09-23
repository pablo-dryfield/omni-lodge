import { Request, Response } from 'express';
import { DataType } from 'sequelize-typescript';
import Action from '../models/Action.js';
import { ErrorWithMessage } from '../types/ErrorWithMessage.js';

const buildColumns = () => {
  const attributes = Action.getAttributes();
  return Object.entries(attributes).map(([key, attribute]) => ({
    header: key.charAt(0).toUpperCase() + key.slice(1),
    accessorKey: key,
    type: attribute.type instanceof DataType.DATE ? 'date' : 'text',
  }));
};

export const getAllActions = async (req: Request, res: Response): Promise<void> => {
  try {
    const data = await Action.findAll();
    res.status(200).json([{ data, columns: buildColumns() }]);
  } catch (error) {
    res.status(500).json([{ message: (error as ErrorWithMessage).message }]);
  }
};

export const getActionById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const data = await Action.findByPk(id);

    if (!data) {
      res.status(404).json([{ message: 'Action not found' }]);
      return;
    }

    res.status(200).json([{ data, columns: buildColumns() }]);
  } catch (error) {
    res.status(500).json([{ message: (error as ErrorWithMessage).message }]);
  }
};

export const createAction = async (req: Request, res: Response): Promise<void> => {
  try {
    const created = await Action.create(req.body);
    res.status(201).json([created]);
  } catch (error) {
    res.status(500).json([{ message: (error as ErrorWithMessage).message }]);
  }
};

export const updateAction = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const [updated] = await Action.update(req.body, { where: { id } });

    if (!updated) {
      res.status(404).json([{ message: 'Action not found' }]);
      return;
    }

    const data = await Action.findByPk(id);
    res.status(200).json([data]);
  } catch (error) {
    res.status(500).json([{ message: (error as ErrorWithMessage).message }]);
  }
};

export const deleteAction = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const deleted = await Action.destroy({ where: { id } });

    if (!deleted) {
      res.status(404).json([{ message: 'Action not found' }]);
      return;
    }

    res.status(204).send();
  } catch (error) {
    res.status(500).json([{ message: (error as ErrorWithMessage).message }]);
  }
};

