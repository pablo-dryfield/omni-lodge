import type { Request, Response } from 'express';
import { DataType } from 'sequelize-typescript';

import Addon from '../models/Addon.js';
import { toAddonConfig } from '../services/counterMetricUtils.js';
import { ErrorWithMessage } from '../types/ErrorWithMessage.js';

const buildAddonColumns = () => {
  const attributes = Addon.getAttributes();
  return Object.entries(attributes).map(([key, attribute]) => ({
    header: key.charAt(0).toUpperCase() + key.slice(1),
    accessorKey: key,
    type: attribute.type instanceof DataType.DATE ? 'date' : 'text',
  }));
};

const resolveFormat = (req: Request): string => {
  const raw = (req.query.format ?? req.query.view ?? '').toString().toLowerCase();
  return raw;
};

export const listAddons = async (req: Request, res: Response): Promise<void> => {
  try {
    const format = resolveFormat(req);

    if (format === 'table') {
      const data = await Addon.findAll({ order: [['name', 'ASC']] });
      res.status(200).json([{ data, columns: buildAddonColumns() }]);
      return;
    }

    const where: Record<string, unknown> = {};
    if ((req.query.active ?? '').toString().toLowerCase() === 'true') {
      where.isActive = true;
    }

    const addons = await Addon.findAll({ where, order: [['name', 'ASC']] });
    const payload = addons.map((addon, index) => ({
      ...toAddonConfig({
        addonId: addon.id,
        name: addon.name,
        maxPerAttendee: null,
        sortOrder: index,
      }),
      basePrice: addon.basePrice != null ? Number(addon.basePrice) : null,
      taxRate: addon.taxRate != null ? Number(addon.taxRate) : null,
      isActive: addon.isActive,
    }));

    res.status(200).json(payload);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json([{ message: errorMessage }]);
  }
};

export const getAddonById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const addon = await Addon.findByPk(id);

    if (!addon) {
      res.status(404).json([{ message: 'Addon not found' }]);
      return;
    }

    res.status(200).json([{ data: addon, columns: buildAddonColumns() }]);
  } catch (error) {
    const errorMessage = (error as ErrorWithMessage).message;
    res.status(500).json([{ message: errorMessage }]);
  }
};

export const createAddon = async (req: Request, res: Response): Promise<void> => {
  try {
    const payload = {
      name: req.body.name,
      basePrice: req.body.basePrice ?? null,
      taxRate: req.body.taxRate ?? null,
      isActive: req.body.isActive ?? true,
    };

    const created = await Addon.create(payload);
    res.status(201).json([created]);
  } catch (error) {
    const errorMessage = (error as ErrorWithMessage).message;
    res.status(500).json([{ message: errorMessage }]);
  }
};

export const updateAddon = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const payload = {
      name: req.body.name,
      basePrice: req.body.basePrice ?? null,
      taxRate: req.body.taxRate ?? null,
      isActive: req.body.isActive ?? true,
    };

    const [updated] = await Addon.update(payload, { where: { id } });

    if (!updated) {
      res.status(404).json([{ message: 'Addon not found' }]);
      return;
    }

    const addon = await Addon.findByPk(id);
    res.status(200).json([addon]);
  } catch (error) {
    const errorMessage = (error as ErrorWithMessage).message;
    res.status(500).json([{ message: errorMessage }]);
  }
};

export const deleteAddon = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const deleted = await Addon.destroy({ where: { id } });

    if (!deleted) {
      res.status(404).json([{ message: 'Addon not found' }]);
      return;
    }

    res.status(204).send();
  } catch (error) {
    const errorMessage = (error as ErrorWithMessage).message;
    res.status(500).json([{ message: errorMessage }]);
  }
};
