import { Request, Response } from 'express';
import { DataType } from 'sequelize-typescript';
import ModuleAction from '../models/ModuleAction.js';
import { ErrorWithMessage } from '../types/ErrorWithMessage.js';

const buildColumns = () => {
  const attributes = ModuleAction.getAttributes();
  return Object.entries(attributes).map(([key, attribute]) => ({
    header: key.charAt(0).toUpperCase() + key.slice(1),
    accessorKey: key,
    type: attribute.type instanceof DataType.DATE ? 'date' : 'text',
  }));
};

export const getAllModuleActions = async (req: Request, res: Response): Promise<void> => {
  try {
    const data = await ModuleAction.findAll();
    res.status(200).json([{ data, columns: buildColumns() }]);
  } catch (error) {
    res.status(500).json([{ message: (error as ErrorWithMessage).message }]);
  }
};

export const getModuleActionsByModule = async (req: Request, res: Response): Promise<void> => {
  try {
    const { moduleId } = req.params;
    const data = await ModuleAction.findAll({ where: { moduleId } });
    res.status(200).json([{ data, columns: buildColumns() }]);
  } catch (error) {
    res.status(500).json([{ message: (error as ErrorWithMessage).message }]);
  }
};

export const getModuleActionById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const data = await ModuleAction.findByPk(id);

    if (!data) {
      res.status(404).json([{ message: 'Module action not found' }]);
      return;
    }

    res.status(200).json([{ data, columns: buildColumns() }]);
  } catch (error) {
    res.status(500).json([{ message: (error as ErrorWithMessage).message }]);
  }
};

export const createModuleAction = async (req: Request, res: Response): Promise<void> => {
  try {
    const created = await ModuleAction.create(req.body);
    res.status(201).json([created]);
  } catch (error) {
    res.status(500).json([{ message: (error as ErrorWithMessage).message }]);
  }
};

export const updateModuleAction = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const [updated] = await ModuleAction.update(req.body, { where: { id } });

    if (!updated) {
      res.status(404).json([{ message: 'Module action not found' }]);
      return;
    }

    const data = await ModuleAction.findByPk(id);
    res.status(200).json([data]);
  } catch (error) {
    res.status(500).json([{ message: (error as ErrorWithMessage).message }]);
  }
};

export const deleteModuleAction = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const deleted = await ModuleAction.destroy({ where: { id } });

    if (!deleted) {
      res.status(404).json([{ message: 'Module action not found' }]);
      return;
    }

    res.status(204).send();
  } catch (error) {
    res.status(500).json([{ message: (error as ErrorWithMessage).message }]);
  }
};

