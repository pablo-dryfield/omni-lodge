import { Request, Response } from 'express';
import { DataType } from 'sequelize-typescript';

import Addon from '../models/Addon.js';
import Product from '../models/Product.js';
import ProductAddon from '../models/ProductAddon.js';
import { ErrorWithMessage } from '../types/ErrorWithMessage.js';

type ProductAddonWithAssociations = ProductAddon & {
  product?: { id?: number; name?: string | null } | null;
  addon?: { id?: number; name?: string | null } | null;
};

const buildProductAddonColumns = () => {
  const attributes = ProductAddon.getAttributes();
  const baseColumns = Object.entries(attributes).map(([key, attribute]) => ({
    header: key.charAt(0).toUpperCase() + key.slice(1),
    accessorKey: key,
    type: attribute.type instanceof DataType.DATE ? 'date' : 'text',
  }));

  return baseColumns.concat([
    { header: 'Product Name', accessorKey: 'productName', type: 'text' },
    { header: 'Addon Name', accessorKey: 'addonName', type: 'text' },
  ]);
};

const decorateRecord = (record: ProductAddonWithAssociations) => ({
  id: record.id,
  productId: record.productId,
  productName: record.product?.name ?? null,
  addonId: record.addonId,
  addonName: record.addon?.name ?? null,
  maxPerAttendee: record.maxPerAttendee ?? null,
  priceOverride: record.priceOverride ?? null,
  sortOrder: record.sortOrder,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
});

export const getAllProductAddons = async (req: Request, res: Response): Promise<void> => {
  try {
    const productAddons = await ProductAddon.findAll({
      include: [
        { model: Product, as: 'product', attributes: ['id', 'name'] },
        { model: Addon, as: 'addon', attributes: ['id', 'name'] },
      ],
      order: [
        ['productId', 'ASC'],
        ['sortOrder', 'ASC'],
      ],
    });

    const data = productAddons.map((record) => decorateRecord(record as ProductAddonWithAssociations));
    res.status(200).json([{ data, columns: buildProductAddonColumns() }]);
  } catch (error) {
    const errorMessage = (error as ErrorWithMessage).message;
    res.status(500).json([{ message: errorMessage }]);
  }
};

export const getProductAddonById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const record = await ProductAddon.findByPk(id, {
      include: [
        { model: Product, as: 'product', attributes: ['id', 'name'] },
        { model: Addon, as: 'addon', attributes: ['id', 'name'] },
      ],
    });

    if (!record) {
      res.status(404).json([{ message: 'Product addon not found' }]);
      return;
    }

    res.status(200).json([{ data: decorateRecord(record as ProductAddonWithAssociations), columns: buildProductAddonColumns() }]);
  } catch (error) {
    const errorMessage = (error as ErrorWithMessage).message;
    res.status(500).json([{ message: errorMessage }]);
  }
};

const normalizePayload = (payload: Partial<ProductAddon>, { forCreate = false } = {}) => {
  const next: Record<string, unknown> = {};

  if (payload.productId != null) {
    next.productId = Number(payload.productId);
  }
  if (payload.addonId != null) {
    next.addonId = Number(payload.addonId);
  }
  if (payload.maxPerAttendee !== undefined) {
    next.maxPerAttendee = payload.maxPerAttendee === null ? null : Number(payload.maxPerAttendee);
  }
  if (payload.priceOverride !== undefined) {
    next.priceOverride = payload.priceOverride === null ? null : Number(payload.priceOverride);
  }
  if (payload.sortOrder !== undefined) {
    next.sortOrder = Number(payload.sortOrder);
  } else if (forCreate) {
    next.sortOrder = 0;
  }

  return next;
};

export const createProductAddon = async (req: Request, res: Response): Promise<void> => {
  try {
    const created = await ProductAddon.create(normalizePayload(req.body, { forCreate: true }));
    await created.reload({
      include: [
        { model: Product, as: 'product', attributes: ['id', 'name'] },
        { model: Addon, as: 'addon', attributes: ['id', 'name'] },
      ],
    });
    res.status(201).json([decorateRecord(created as ProductAddonWithAssociations)]);
  } catch (error) {
    const errorMessage = (error as ErrorWithMessage).message;
    res.status(500).json([{ message: errorMessage }]);
  }
};

export const updateProductAddon = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const [updated] = await ProductAddon.update(normalizePayload(req.body), { where: { id } });

    if (!updated) {
      res.status(404).json([{ message: 'Product addon not found' }]);
      return;
    }

    const record = await ProductAddon.findByPk(id, {
      include: [
        { model: Product, as: 'product', attributes: ['id', 'name'] },
        { model: Addon, as: 'addon', attributes: ['id', 'name'] },
      ],
    });
    if (!record) {
      res.status(404).json([{ message: 'Product addon not found' }]);
      return;
    }
    res.status(200).json([decorateRecord(record as ProductAddonWithAssociations)]);
  } catch (error) {
    const errorMessage = (error as ErrorWithMessage).message;
    res.status(500).json([{ message: errorMessage }]);
  }
};

export const deleteProductAddon = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const deleted = await ProductAddon.destroy({ where: { id } });

    if (!deleted) {
      res.status(404).json([{ message: 'Product addon not found' }]);
      return;
    }

    res.status(204).send();
  } catch (error) {
    const errorMessage = (error as ErrorWithMessage).message;
    res.status(500).json([{ message: errorMessage }]);
  }
};
