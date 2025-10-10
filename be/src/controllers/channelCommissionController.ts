import { Request, Response } from 'express';
import { DataType } from 'sequelize-typescript';
import ChannelCommission from '../models/ChannelCommission.js';
import Channel from '../models/Channel.js';
import User from '../models/User.js';
import { ErrorWithMessage } from '../types/ErrorWithMessage.js';

const buildColumns = () => {
  const attributes = ChannelCommission.getAttributes();
  const baseColumns = Object.entries(attributes).map(([key, attribute]) => ({
    header: key.charAt(0).toUpperCase() + key.slice(1),
    accessorKey: key,
    type: attribute.type instanceof DataType.DATE ? 'date' : 'text',
  }));

  return baseColumns.concat([
    { header: 'Channel Name', accessorKey: 'channelName', type: 'text' },
    { header: 'Created By Name', accessorKey: 'createdByName', type: 'text' },
    { header: 'Updated By Name', accessorKey: 'updatedByName', type: 'text' },
  ]);
};

const normalizePayload = (payload: Partial<ChannelCommission>) => {
  const next: Record<string, unknown> = {};

  if (payload.channelId != null) {
    next.channelId = Number(payload.channelId);
  }
  if (payload.rate != null) {
    next.rate = Number(payload.rate);
  }
  if (payload.validFrom != null && payload.validFrom !== '') {
    next.validFrom = payload.validFrom;
  }
  if (payload.validTo !== undefined) {
    next.validTo = payload.validTo === null || payload.validTo === '' ? null : payload.validTo;
  }

  return next;
};

export const listChannelCommissions = async (req: Request, res: Response): Promise<void> => {
  try {
    const where: Record<string, unknown> = {};
    const rawChannelId = req.query.channelId;
    if (rawChannelId != null && rawChannelId !== '') {
      where.channelId = Number(rawChannelId);
    }

    const records = await ChannelCommission.findAll({
      where,
      include: [
        { model: Channel, as: 'channel', attributes: ['id', 'name'] },
        { model: User, as: 'createdByUser', attributes: ['id', 'firstName', 'lastName'] },
        { model: User, as: 'updatedByUser', attributes: ['id', 'firstName', 'lastName'] },
      ],
      order: [
        ['channelId', 'ASC'],
        ['validFrom', 'DESC'],
        ['id', 'DESC'],
      ],
    });

    const data = records.map((record) => {
      const plain = record.get({ plain: true }) as Record<string, unknown>;
      return {
        ...plain,
        channelName: record.channel?.name ?? null,
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

export const createChannelCommission = async (req: Request, res: Response): Promise<void> => {
  try {
    const payload = normalizePayload(req.body);
    const created = await ChannelCommission.create(payload);
    const record = await ChannelCommission.findByPk(created.id, {
      include: [
        { model: Channel, as: 'channel', attributes: ['id', 'name'] },
        { model: User, as: 'createdByUser', attributes: ['id', 'firstName', 'lastName'] },
        { model: User, as: 'updatedByUser', attributes: ['id', 'firstName', 'lastName'] },
      ],
    });
    const payloadWithRelations = record?.get({ plain: true }) ?? created.get({ plain: true });
    res.status(201).json([payloadWithRelations]);
  } catch (error) {
    const message = (error as ErrorWithMessage).message;
    res.status(500).json([{ message }]);
  }
};

export const updateChannelCommission = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const payload = normalizePayload(req.body);
    const [updated] = await ChannelCommission.update(payload, { where: { id } });
    if (!updated) {
      res.status(404).json([{ message: 'Channel commission not found' }]);
      return;
    }

    const record = await ChannelCommission.findByPk(id, {
      include: [
        { model: Channel, as: 'channel', attributes: ['id', 'name'] },
        { model: User, as: 'createdByUser', attributes: ['id', 'firstName', 'lastName'] },
        { model: User, as: 'updatedByUser', attributes: ['id', 'firstName', 'lastName'] },
      ],
    });
    const payloadWithRelations = record?.get({ plain: true }) ?? null;
    res.status(200).json([payloadWithRelations]);
  } catch (error) {
    const message = (error as ErrorWithMessage).message;
    res.status(500).json([{ message }]);
  }
};

export const deleteChannelCommission = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const deleted = await ChannelCommission.destroy({ where: { id } });
    if (!deleted) {
      res.status(404).json([{ message: 'Channel commission not found' }]);
      return;
    }
    res.status(204).send();
  } catch (error) {
    const message = (error as ErrorWithMessage).message;
    res.status(500).json([{ message }]);
  }
};
