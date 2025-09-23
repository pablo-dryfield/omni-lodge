import { Request, Response } from 'express';
import { DataType } from 'sequelize-typescript';
import Module from '../models/Module.js';
import { ErrorWithMessage } from '../types/ErrorWithMessage.js';

const buildColumns = () => {
  const attributes = Module.getAttributes();
  return Object.entries(attributes).map(([key, attribute]) => ({
    header: key.charAt(0).toUpperCase() + key.slice(1),
    accessorKey: key,
    type: attribute.type instanceof DataType.DATE ? 'date' : 'text',
  }));
};

export const getAllModules = async (req: Request, res: Response): Promise<void> => {
  try {
    const data = await Module.findAll();
    res.status(200).json([{ data, columns: buildColumns() }]);
  } catch (error) {
    res.status(500).json([{ message: (error as ErrorWithMessage).message }]);
  }
};

export const getModulesByPage = async (req: Request, res: Response): Promise<void> => {
  try {
    const { pageId } = req.params;
    const data = await Module.findAll({ where: { pageId } });
    res.status(200).json([{ data, columns: buildColumns() }]);
  } catch (error) {
    res.status(500).json([{ message: (error as ErrorWithMessage).message }]);
  }
};

export const getModuleById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const data = await Module.findByPk(id);

    if (!data) {
      res.status(404).json([{ message: 'Module not found' }]);
      return;
    }

    res.status(200).json([{ data, columns: buildColumns() }]);
  } catch (error) {
    res.status(500).json([{ message: (error as ErrorWithMessage).message }]);
  }
};

export const createModule = async (req: Request, res: Response): Promise<void> => {
  try {
    const created = await Module.create(req.body);
    res.status(201).json([created]);
  } catch (error) {
    res.status(500).json([{ message: (error as ErrorWithMessage).message }]);
  }
};

export const updateModule = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const [updated] = await Module.update(req.body, { where: { id } });

    if (!updated) {
      res.status(404).json([{ message: 'Module not found' }]);
      return;
    }

    const data = await Module.findByPk(id);
    res.status(200).json([data]);
  } catch (error) {
    res.status(500).json([{ message: (error as ErrorWithMessage).message }]);
  }
};

export const deleteModule = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const deleted = await Module.destroy({ where: { id } });

    if (!deleted) {
      res.status(404).json([{ message: 'Module not found' }]);
      return;
    }

    res.status(204).send();
  } catch (error) {
    res.status(500).json([{ message: (error as ErrorWithMessage).message }]);
  }
};

