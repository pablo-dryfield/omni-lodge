import { Request, Response } from 'express';
import { Op, type WhereOptions } from 'sequelize';
import { DataType } from 'sequelize-typescript';
import Product from '../models/Product.js';
import ProductAddon from '../models/ProductAddon.js';
import Addon from '../models/Addon.js';
import { ErrorWithMessage } from '../types/ErrorWithMessage.js';
import { toAddonConfig } from '../services/counterMetricUtils.js';

function buildProductColumns() {
  const attributes = Product.getAttributes();
  return Object.entries(attributes).map(([key, attribute]) => ({
    header: key.charAt(0).toUpperCase() + key.slice(1),
    accessorKey: key,
    type: attribute.type instanceof DataType.DATE ? 'date' : 'text',
  }));
}

export const getAllProducts = async (req: Request, res: Response): Promise<void> => {
  try {
    const format = (req.query.format ?? req.query.view ?? '').toString().toLowerCase();

    if (format === 'compact') {
      const where: WhereOptions = {};
      if ((req.query.active ?? '').toString().toLowerCase() === 'true') {
        where.status = { [Op.ne]: false };
      }

      const products = await Product.findAll({
        where,
        order: [['name', 'ASC']],
        include: [
          {
            model: ProductAddon,
            as: 'productAddons',
            include: [{ model: Addon, as: 'addon' }],
            required: false,
            separate: true,
            order: [['sortOrder', 'ASC']],
          },
        ],
      });

      const payload = products.map((product) => {
        const productAddons = (product as unknown as { productAddons?: ProductAddon[] }).productAddons ?? [];
        const allowedAddOns = productAddons
          .filter((record) => {
            const addon = record.addon as { isActive?: boolean; name?: string } | undefined;
            return addon?.isActive !== false;
          })
          .map((record, index) => {
            const addon = record.addon as { isActive?: boolean; name?: string } | undefined;
            return {
              ...toAddonConfig({
                addonId: record.addonId,
                name: addon?.name ?? `Addon ${record.addonId}`,
                maxPerAttendee: record.maxPerAttendee ?? null,
                sortOrder: record.sortOrder ?? index,
              }),
              priceOverride: record.priceOverride ?? null,
            };
          });

        return {
          id: product.id,
          name: product.name,
          status: product.status,
          productTypeId: product.productTypeId,
          price: product.price,
          allowedAddOns,
        };
      });

      res.status(200).json(payload);
      return;
    }

    const data = await Product.findAll();
    res.status(200).json([{ data, columns: buildProductColumns() }]);
  } catch (error) {
    const errorMessage = (error as ErrorWithMessage).message;
    res.status(500).json([{ message: errorMessage }]);
  }
};

export const getAllActiveProducts = async (req: Request, res: Response): Promise<void> => {
  try {
    const data = await Product.findAll({ where: { status: true } });
    res.status(200).json([{ data, columns: buildProductColumns() }]);
  } catch (error) {
    const errorMessage = (error as ErrorWithMessage).message;
    res.status(500).json([{ message: errorMessage }]);
  }
};

export const getProductById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const data = await Product.findByPk(id);

    if (!data) {
      res.status(404).json([{ message: 'Product not found' }]);
      return;
    }

    res.status(200).json([{ data, columns: buildProductColumns() }]);
  } catch (error) {
    const errorMessage = (error as ErrorWithMessage).message;
    res.status(500).json([{ message: errorMessage }]);
  }
};

export const createProduct = async (req: Request, res: Response): Promise<void> => {
  try {
    const newProduct = await Product.create(req.body);
    res.status(201).json([newProduct]);
  } catch (error) {
    const errorMessage = (error as ErrorWithMessage).message;
    res.status(500).json([{ message: errorMessage }]);
  }
};

export const updateProduct = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const [updated] = await Product.update(req.body, { where: { id } });

    if (!updated) {
      res.status(404).json([{ message: 'Product not found' }]);
      return;
    }

    const updatedProduct = await Product.findByPk(id);
    res.status(200).json([updatedProduct]);
  } catch (error) {
    const errorMessage = (error as ErrorWithMessage).message;
    res.status(500).json([{ message: errorMessage }]);
  }
};

export const deleteProduct = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const deleted = await Product.destroy({ where: { id } });

    if (!deleted) {
      res.status(404).json([{ message: 'Product not found' }]);
      return;
    }

    res.status(204).send();
  } catch (error) {
    const errorMessage = (error as ErrorWithMessage).message;
    res.status(500).json([{ message: errorMessage }]);
  }
};
