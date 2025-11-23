import type { Request, Response } from 'express';
import { DataType } from 'sequelize-typescript';
import VenueCompensationTermRate from '../models/VenueCompensationTermRate.js';
import VenueCompensationTerm from '../models/VenueCompensationTerm.js';
import Venue from '../models/Venue.js';
import Product from '../models/Product.js';

type RateWithRelations = VenueCompensationTermRate & {
  term?: VenueCompensationTerm & { venueCompTermVenue?: Venue | null };
  rateProduct?: Product | null;
};

const buildColumns = () => {
  const attributes = VenueCompensationTermRate.getAttributes();
  const baseColumns = Object.entries(attributes).map(([key, attribute]) => ({
    header: key.charAt(0).toUpperCase() + key.slice(1),
    accessorKey: key,
    type: attribute.type instanceof DataType.DATE ? 'date' : 'text',
  }));

  return baseColumns.concat([
    { header: 'Venue Name', accessorKey: 'venueName', type: 'text' },
    { header: 'Term ID', accessorKey: 'termLabel', type: 'text' },
    { header: 'Product Name', accessorKey: 'productName', type: 'text' },
  ]);
};

const normalizePayload = (payload: Partial<VenueCompensationTermRate>) => {
  const next: Record<string, unknown> = {};

  if (payload.termId !== undefined && payload.termId !== null) {
    const termText = String(payload.termId).trim();
    if (termText !== '') {
      next.termId = Number(payload.termId);
    }
  }

  if (payload.productId !== undefined) {
    if (payload.productId === null) {
      next.productId = null;
    } else {
      const productText = String(payload.productId).trim();
      next.productId = productText === '' ? null : Number(payload.productId);
    }
  }

  if (payload.ticketType) {
    next.ticketType = payload.ticketType;
  }

  if (payload.rateAmount !== undefined && payload.rateAmount !== null) {
    const amountText = String(payload.rateAmount).trim();
    if (amountText !== '') {
      next.rateAmount = Number(payload.rateAmount);
    }
  }

  if (payload.rateUnit) {
    next.rateUnit = payload.rateUnit;
  }

  if (payload.validFrom) {
    next.validFrom = payload.validFrom;
  }

  if (payload.validTo !== undefined) {
    next.validTo = payload.validTo === null || payload.validTo === '' ? null : payload.validTo;
  }

  if (payload.isActive !== undefined) {
    next.isActive = typeof payload.isActive === 'boolean' ? payload.isActive : Boolean(payload.isActive);
  }

  return next;
};

export const listVenueCompensationTermRates = async (req: Request, res: Response): Promise<void> => {
  try {
    const where: Record<string, unknown> = {};
    if (typeof req.query.termId === 'string' && req.query.termId.trim() !== '') {
      where.termId = Number(req.query.termId);
    }
    if (typeof req.query.venueId === 'string' && req.query.venueId.trim() !== '') {
      where['$term.venue_id$'] = Number(req.query.venueId);
    }

    const records = await VenueCompensationTermRate.findAll({
      where,
      include: [
        {
          model: VenueCompensationTerm,
          as: 'term',
          include: [{ model: Venue, as: 'venueCompTermVenue', attributes: ['id', 'name'] }],
        },
        { model: Product, as: 'rateProduct', attributes: ['id', 'name'] },
      ],
      order: [
        ['termId', 'ASC'],
        ['ticketType', 'ASC'],
        ['productId', 'ASC'],
        ['validFrom', 'DESC'],
        ['id', 'DESC'],
      ],
    });

    const data = records.map((record) => {
      const info = record as RateWithRelations;
      const plain = record.get({ plain: true }) as Record<string, unknown>;
      return {
        ...plain,
        venueName: info.term?.venueCompTermVenue?.name ?? null,
        termLabel: `Term #${record.termId}`,
        productName: record.productId ? info.rateProduct?.name ?? `Product #${record.productId}` : 'All Products',
      };
    });

    res.status(200).json([
      {
        data,
        columns: buildColumns(),
      },
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch rate bands';
    res.status(500).json([{ message }]);
  }
};

export const createVenueCompensationTermRate = async (req: Request, res: Response): Promise<void> => {
  try {
    const payload = normalizePayload(req.body);
    if (!payload.termId || !payload.ticketType || payload.rateAmount == null || !payload.validFrom) {
      res.status(400).json([{ message: 'termId, ticketType, rateAmount, and validFrom are required' }]);
      return;
    }

    const record = await VenueCompensationTermRate.create(payload);
    res.status(201).json([record]);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create rate band';
    res.status(500).json([{ message }]);
  }
};

export const updateVenueCompensationTermRate = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (!id) {
      res.status(400).json([{ message: 'id is required' }]);
      return;
    }

    const payload = normalizePayload(req.body);
    if (Object.keys(payload).length === 0) {
      res.status(200).json([{ message: 'No changes detected' }]);
      return;
    }

    const [updated] = await VenueCompensationTermRate.update(payload, { where: { id } });
    if (!updated) {
      res.status(404).json([{ message: 'Rate band not found' }]);
      return;
    }

    const record = await VenueCompensationTermRate.findByPk(id, {
      include: [
        {
          model: VenueCompensationTerm,
          as: 'term',
          include: [{ model: Venue, as: 'venueCompTermVenue', attributes: ['id', 'name'] }],
        },
        { model: Product, as: 'rateProduct', attributes: ['id', 'name'] },
      ],
    });
    res.status(200).json([record]);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update rate band';
    res.status(500).json([{ message }]);
  }
};

export const deleteVenueCompensationTermRate = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (!id) {
      res.status(400).json([{ message: 'id is required' }]);
      return;
    }

    const deleted = await VenueCompensationTermRate.destroy({ where: { id } });
    if (!deleted) {
      res.status(404).json([{ message: 'Rate band not found' }]);
      return;
    }
    res.status(204).send();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete rate band';
    res.status(500).json([{ message }]);
  }
};
