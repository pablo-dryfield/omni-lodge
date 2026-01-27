import { Request, Response } from 'express';
import { DataType } from 'sequelize-typescript';
import { Op } from 'sequelize';
import ProductAlias from '../models/ProductAlias.js';
import Product from '../models/Product.js';
import { ErrorWithMessage } from '../types/ErrorWithMessage.js';
import { sanitizeProductSource } from '../utils/productName.js';

const MATCH_TYPES = new Set(['exact', 'contains', 'regex']);

const normalizeAliasLabel = (label: string): string => sanitizeProductSource(label).toLowerCase();

const buildProductAliasColumns = () => {
  const attributes = ProductAlias.getAttributes();
  const columns = Object.entries(attributes).map(([key, attribute]) => ({
    header: key.charAt(0).toUpperCase() + key.slice(1),
    accessorKey: key,
    type: attribute.type instanceof DataType.DATE ? 'date' : 'text',
  }));
  columns.push({
    header: 'Product Name',
    accessorKey: 'productName',
    type: 'text',
  });
  return columns;
};

export const getAllProductAliases = async (req: Request, res: Response): Promise<void> => {
  try {
    const where: Record<string, unknown> = {};
    const status = (req.query.status ?? '').toString().toLowerCase();
    if (status === 'pending') {
      where.productId = { [Op.is]: null };
    } else if (status === 'assigned') {
      where.productId = { [Op.not]: null };
    }

    if ((req.query.active ?? '').toString().toLowerCase() === 'true') {
      where.active = true;
    }

    const data = await ProductAlias.findAll({
      where,
      include: [{ model: Product, as: 'product', attributes: ['id', 'name'] }],
      order: [
        ['priority', 'ASC'],
        ['id', 'ASC'],
      ],
    });

    const payload = data.map((record) => {
      const plain = record.get({ plain: true }) as unknown as Record<string, unknown> & {
        product?: { name?: string | null };
      };
      return {
        ...plain,
        productName: plain.product?.name ?? null,
      };
    });

    res.status(200).json([{ data: payload, columns: buildProductAliasColumns() }]);
  } catch (error) {
    const errorMessage = (error as ErrorWithMessage).message;
    res.status(500).json([{ message: errorMessage }]);
  }
};

export const createProductAlias = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as Partial<ProductAlias>;
    const label = (body.label ?? '').toString().trim();
    if (!label) {
      res.status(400).json([{ message: 'label is required' }]);
      return;
    }
    const matchType = (body.matchType ?? 'contains').toString();
    if (!MATCH_TYPES.has(matchType)) {
      res.status(400).json([{ message: 'Invalid matchType' }]);
      return;
    }

    const normalizedLabel = normalizeAliasLabel(label);
    const payload = {
      productId: body.productId ?? null,
      label,
      normalizedLabel,
      matchType,
      priority: body.priority ?? 100,
      active: body.active ?? true,
      source: body.source ?? 'manual',
      createdBy: (body as { createdBy?: number }).createdBy ?? null,
      updatedBy: (body as { updatedBy?: number }).updatedBy ?? null,
    };

    const newAlias = await ProductAlias.create(payload);
    res.status(201).json([newAlias]);
  } catch (error) {
    const errorMessage = (error as ErrorWithMessage).message;
    res.status(500).json([{ message: errorMessage }]);
  }
};

export const updateProductAlias = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const body = req.body as Partial<ProductAlias>;

    const updates: Partial<ProductAlias> = { ...body };
    if (updates.label !== undefined) {
      const label = (updates.label ?? '').toString().trim();
      if (!label) {
        res.status(400).json([{ message: 'label is required' }]);
        return;
      }
      updates.label = label;
      updates.normalizedLabel = normalizeAliasLabel(label);
    }

    if (updates.matchType !== undefined && !MATCH_TYPES.has(String(updates.matchType))) {
      res.status(400).json([{ message: 'Invalid matchType' }]);
      return;
    }

    const [updated] = await ProductAlias.update(updates, { where: { id } });
    if (!updated) {
      res.status(404).json([{ message: 'Product alias not found' }]);
      return;
    }

    const updatedRecord = await ProductAlias.findByPk(id);
    res.status(200).json([updatedRecord]);
  } catch (error) {
    const errorMessage = (error as ErrorWithMessage).message;
    res.status(500).json([{ message: errorMessage }]);
  }
};

export const deleteProductAlias = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const deleted = await ProductAlias.destroy({ where: { id } });
    if (!deleted) {
      res.status(404).json([{ message: 'Product alias not found' }]);
      return;
    }
    res.status(204).send();
  } catch (error) {
    const errorMessage = (error as ErrorWithMessage).message;
    res.status(500).json([{ message: errorMessage }]);
  }
};
