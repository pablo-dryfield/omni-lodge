import { Request, Response } from 'express';
import { DataType } from 'sequelize-typescript';
import Page from '../models/Page.js';
import { ErrorWithMessage } from '../types/ErrorWithMessage.js';

const buildColumns = () => {
  const attributes = Page.getAttributes();
  return Object.entries(attributes).map(([key, attribute]) => ({
    header: key.charAt(0).toUpperCase() + key.slice(1),
    accessorKey: key,
    type: attribute.type instanceof DataType.DATE ? 'date' : 'text',
  }));
};

export const getAllPages = async (req: Request, res: Response): Promise<void> => {
  try {
    const data = await Page.findAll();
    res.status(200).json([{ data, columns: buildColumns() }]);
  } catch (error) {
    res.status(500).json([{ message: (error as ErrorWithMessage).message }]);
  }
};

export const getPageById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const data = await Page.findByPk(id);

    if (!data) {
      res.status(404).json([{ message: 'Page not found' }]);
      return;
    }

    res.status(200).json([{ data, columns: buildColumns() }]);
  } catch (error) {
    res.status(500).json([{ message: (error as ErrorWithMessage).message }]);
  }
};

export const createPage = async (req: Request, res: Response): Promise<void> => {
  try {
    const created = await Page.create(req.body);
    res.status(201).json([created]);
  } catch (error) {
    res.status(500).json([{ message: (error as ErrorWithMessage).message }]);
  }
};

export const updatePage = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const [updated] = await Page.update(req.body, { where: { id } });

    if (!updated) {
      res.status(404).json([{ message: 'Page not found' }]);
      return;
    }

    const data = await Page.findByPk(id);
    res.status(200).json([data]);
  } catch (error) {
    res.status(500).json([{ message: (error as ErrorWithMessage).message }]);
  }
};

export const deletePage = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const deleted = await Page.destroy({ where: { id } });

    if (!deleted) {
      res.status(404).json([{ message: 'Page not found' }]);
      return;
    }

    res.status(204).send();
  } catch (error) {
    res.status(500).json([{ message: (error as ErrorWithMessage).message }]);
  }
};

