import type { Request, Response } from 'express';
import { DataType } from 'sequelize-typescript';
import Venue from '../models/Venue.js';

const buildVenueColumns = () => {
  const attributes = Venue.getAttributes();
  return Object.entries(attributes).map(([key, attribute]) => ({
    header: key.charAt(0).toUpperCase() + key.slice(1),
    accessorKey: key,
    type: attribute.type instanceof DataType.DATE ? 'date' : 'text',
  }));
};

const parseSortOrder = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const num = Number(value);
  if (Number.isNaN(num)) {
    return null;
  }
  return Math.max(0, Math.floor(num));
};

export const listVenues = async (req: Request, res: Response): Promise<void> => {
  try {
    const format = (req.query.format ?? '').toString().toLowerCase();
    const where: Record<string, unknown> = {};

    if ((req.query.active ?? '').toString().toLowerCase() === 'true') {
      where.isActive = true;
    }

    const venues = await Venue.findAll({
      where,
      order: [
        ['isActive', 'DESC'],
        ['sortOrder', 'ASC'],
        ['name', 'ASC'],
      ],
    });

    if (format === 'table') {
      res.status(200).json([
        {
          data: venues,
          columns: buildVenueColumns(),
        },
      ]);
      return;
    }

    res.status(200).json(venues);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch venues';
    res.status(500).json([{ message }]);
  }
};

export const getVenueById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const venue = await Venue.findByPk(id);

    if (!venue) {
      res.status(404).json([{ message: 'Venue not found' }]);
      return;
    }

    res.status(200).json([{ data: venue, columns: buildVenueColumns() }]);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load venue';
    res.status(500).json([{ message }]);
  }
};

export const createVenue = async (req: Request, res: Response): Promise<void> => {
  try {
    const payload = {
      name: (req.body.name ?? '').toString().trim(),
      isActive: req.body.isActive ?? true,
      sortOrder: parseSortOrder(req.body.sortOrder) ?? 0,
      allowsOpenBar:
        typeof req.body.allowsOpenBar === 'boolean' ? req.body.allowsOpenBar : Boolean(req.body.allowsOpenBar),
    };

    if (!payload.name) {
      res.status(400).json([{ message: 'Name is required' }]);
      return;
    }

    const created = await Venue.create(payload);
    res.status(201).json([created]);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create venue';
    res.status(500).json([{ message }]);
  }
};

export const updateVenue = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const payload = {
      name: req.body.name != null ? req.body.name.toString().trim() : undefined,
      isActive:
        typeof req.body.isActive === 'boolean'
          ? req.body.isActive
          : req.body.isActive === undefined
          ? undefined
          : Boolean(req.body.isActive),
      sortOrder: parseSortOrder(req.body.sortOrder) ?? undefined,
      allowsOpenBar:
        typeof req.body.allowsOpenBar === 'boolean'
          ? req.body.allowsOpenBar
          : req.body.allowsOpenBar === undefined
          ? undefined
          : Boolean(req.body.allowsOpenBar),
    };

    if (payload.name === '') {
      res.status(400).json([{ message: 'Name cannot be empty' }]);
      return;
    }

    const [updated] = await Venue.update(
      {
        ...payload,
      },
      { where: { id } },
    );

    if (!updated) {
      res.status(404).json([{ message: 'Venue not found' }]);
      return;
    }

    const venue = await Venue.findByPk(id);
    res.status(200).json([venue]);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update venue';
    res.status(500).json([{ message }]);
  }
};

export const deleteVenue = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const deleted = await Venue.destroy({ where: { id } });

    if (!deleted) {
      res.status(404).json([{ message: 'Venue not found' }]);
      return;
    }

    res.status(204).send();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete venue';
    res.status(500).json([{ message }]);
  }
};
