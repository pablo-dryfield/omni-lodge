import { Request, Response } from 'express';
import { DataType } from 'sequelize-typescript';
import ProductPrice from '../models/ProductPrice.js';
import Product from '../models/Product.js';
import User from '../models/User.js';
import { ErrorWithMessage } from '../types/ErrorWithMessage.js';

const buildColumns = () => {
  const attributes = ProductPrice.getAttributes();
  const baseColumns = Object.entries(attributes).map(([key, attribute]) => ({
    header: key.charAt(0).toUpperCase() + key.slice(1),
    accessorKey: key,
    type: attribute.type instanceof DataType.DATE ? 'date' : 'text',
  }));

  return baseColumns.concat([
    { header: 'Product Name', accessorKey: 'productName', type: 'text' },
    { header: 'Created By Name', accessorKey: 'createdByName', type: 'text' },
    { header: 'Updated By Name', accessorKey: 'updatedByName', type: 'text' },
  ]);
};

const normalizePayload = (payload: Partial<ProductPrice>) => {
  const next: Record<string, unknown> = {};

  if (payload.productId != null) {
    next.productId = Number(payload.productId);
  }
  if (payload.price != null) {
    next.price = Number(payload.price);
  }
  if (payload.validFrom != null && payload.validFrom !== '') {
    next.validFrom = payload.validFrom;
  }
  if (payload.validTo !== undefined) {
    next.validTo = payload.validTo === null || payload.validTo === '' ? null : payload.validTo;
  }

  return next;
};

export const listProductPrices = async (req: Request, res: Response): Promise<void> => {
  try {
    const where: Record<string, unknown> = {};
    const rawProductId = req.query.productId;
    if (rawProductId != null && rawProductId !== '') {
      where.productId = Number(rawProductId);
    }

    const records = await ProductPrice.findAll({
      where,
      include: [
        { model: Product, as: 'product', attributes: ['id', 'name'] },
        { model: User, as: 'createdByUser', attributes: ['id', 'firstName', 'lastName'] },
        { model: User, as: 'updatedByUser', attributes: ['id', 'firstName', 'lastName'] },
      ],
      order: [
        ['productId', 'ASC'],
        ['validFrom', 'DESC'],
        ['id', 'DESC'],
      ],
    });

    const data = records.map((record) => {
      const plain = record.get({ plain: true }) as Record<string, unknown>;
      return {
        ...plain,
        productName: record.product?.name ?? null,
        createdByName: record.createdByUser
          ? `${record.createdByUser.firstName ?? ''} ${record.createdByUser.lastName ?? ''}`.trim()
          : null,
        updatedByName: record.updatedByUser
          ? `${record.updatedByUser.firstName ?? ''} ${record.updatedByUser.lastName ?? ''}`.trim()
          : null,
      };
    });

    res.status(200).json([{ data, columns: buildColumns() }]);
  } catch (error) {
    const message = (error as ErrorWithMessage).message;
    res.status(500).json([{ message }]);
  }
};

export const createProductPrice = async (req: Request, res: Response): Promise<void> => {
  try {
    const payload = normalizePayload(req.body);
    const created = await ProductPrice.create(payload);
    const record = await ProductPrice.findByPk(created.id, {
      include: [
        { model: Product, as: 'product', attributes: ['id', 'name'] },
        { model: User, as: 'createdByUser', attributes: ['id', 'firstName', 'lastName'] },
        { model: User, as: 'updatedByUser', attributes: ['id', 'firstName', 'lastName'] },
      ],
    });
    res.status(201).json([record]);
  } catch (error) {
    const message = (error as ErrorWithMessage).message;
    res.status(500).json([{ message }]);
  }
};

export const updateProductPrice = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const payload = normalizePayload(req.body);
    const [updated] = await ProductPrice.update(payload, { where: { id } });
    if (!updated) {
      res.status(404).json([{ message: 'Product price not found' }]);
      return;
    }

    const record = await ProductPrice.findByPk(id, {
      include: [
        { model: Product, as: 'product', attributes: ['id', 'name'] },
        { model: User, as: 'createdByUser', attributes: ['id', 'firstName', 'lastName'] },
        { model: User, as: 'updatedByUser', attributes: ['id', 'firstName', 'lastName'] },
      ],
    });
    res.status(200).json([record]);
  } catch (error) {
    const message = (error as ErrorWithMessage).message;
    res.status(500).json([{ message }]);
  }
};

export const deleteProductPrice = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const deleted = await ProductPrice.destroy({ where: { id } });
    if (!deleted) {
      res.status(404).json([{ message: 'Product price not found' }]);
      return;
    }

    res.status(204).send();
  } catch (error) {
    const message = (error as ErrorWithMessage).message;
    res.status(500).json([{ message }]);
  }
};
