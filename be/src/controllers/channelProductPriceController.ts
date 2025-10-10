import { Request, Response } from 'express';
import { DataType } from 'sequelize-typescript';
import ChannelProductPrice from '../models/ChannelProductPrice.js';
import Channel from '../models/Channel.js';
import Product from '../models/Product.js';
import User from '../models/User.js';
import { ErrorWithMessage } from '../types/ErrorWithMessage.js';

const buildColumns = () => {
  const attributes = ChannelProductPrice.getAttributes();
  const baseColumns = Object.entries(attributes).map(([key, attribute]) => ({
    header: key.charAt(0).toUpperCase() + key.slice(1),
    accessorKey: key,
    type: attribute.type instanceof DataType.DATE ? 'date' : 'text',
  }));

  return baseColumns.concat([
    { header: 'Channel Name', accessorKey: 'channelName', type: 'text' },
    { header: 'Product Name', accessorKey: 'productName', type: 'text' },
    { header: 'Created By Name', accessorKey: 'createdByName', type: 'text' },
    { header: 'Updated By Name', accessorKey: 'updatedByName', type: 'text' },
  ]);
};

const normalizePayload = (payload: Partial<ChannelProductPrice>) => {
  const next: Record<string, unknown> = {};

  if (payload.channelId != null) {
    next.channelId = Number(payload.channelId);
  }
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

export const listChannelProductPrices = async (req: Request, res: Response): Promise<void> => {
  try {
    const where: Record<string, unknown> = {};
    if (req.query.channelId != null && req.query.channelId !== '') {
      where.channelId = Number(req.query.channelId);
    }
    if (req.query.productId != null && req.query.productId !== '') {
      where.productId = Number(req.query.productId);
    }

    const records = await ChannelProductPrice.findAll({
      where,
      include: [
        { model: Channel, as: 'channel', attributes: ['id', 'name'] },
        { model: Product, as: 'product', attributes: ['id', 'name'] },
        { model: User, as: 'createdByUser', attributes: ['id', 'firstName', 'lastName'] },
        { model: User, as: 'updatedByUser', attributes: ['id', 'firstName', 'lastName'] },
      ],
      order: [
        ['channelId', 'ASC'],
        ['productId', 'ASC'],
        ['validFrom', 'DESC'],
        ['id', 'DESC'],
      ],
    });

    const data = records.map((record) => {
      const plain = record.get({ plain: true }) as Record<string, unknown>;
      return {
        ...plain,
        channelName: record.channel?.name ?? null,
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

export const createChannelProductPrice = async (req: Request, res: Response): Promise<void> => {
  try {
    const payload = normalizePayload(req.body);
    const created = await ChannelProductPrice.create(payload);
    const record = await ChannelProductPrice.findByPk(created.id, {
      include: [
        { model: Channel, as: 'channel', attributes: ['id', 'name'] },
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

export const updateChannelProductPrice = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const payload = normalizePayload(req.body);
    const [updated] = await ChannelProductPrice.update(payload, { where: { id } });
    if (!updated) {
      res.status(404).json([{ message: 'Channel product price not found' }]);
      return;
    }

    const record = await ChannelProductPrice.findByPk(id, {
      include: [
        { model: Channel, as: 'channel', attributes: ['id', 'name'] },
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

export const deleteChannelProductPrice = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const deleted = await ChannelProductPrice.destroy({ where: { id } });
    if (!deleted) {
      res.status(404).json([{ message: 'Channel product price not found' }]);
      return;
    }

    res.status(204).send();
  } catch (error) {
    const message = (error as ErrorWithMessage).message;
    res.status(500).json([{ message }]);
  }
};
