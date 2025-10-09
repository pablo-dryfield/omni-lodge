import type { Request, Response } from 'express';

import Addon from '../models/Addon.js';
import { toAddonConfig } from '../services/counterMetricUtils.js';

export const listAddons = async (req: Request, res: Response): Promise<void> => {
  try {
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
