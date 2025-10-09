import { Request, Response } from 'express';
import { DataType } from 'sequelize-typescript';
import Channel from '../models/Channel.js';
import PaymentMethod from '../models/PaymentMethod.js';
import { ErrorWithMessage } from '../types/ErrorWithMessage.js';

const LATE_BOOKING_CHANNELS = new Set(['Ecwid', 'Walk-In']);

function buildChannelColumns() {
  const attributes = Channel.getAttributes();
  return Object.entries(attributes).map(([key, attribute]) => ({
    header: key.charAt(0).toUpperCase() + key.slice(1),
    accessorKey: key,
    type: attribute.type instanceof DataType.DATE ? 'date' : 'text',
  }));
}

function appendPaymentMethodColumn(columns: Array<{ header: string; accessorKey: string; type: string }>) {
  const hasPaymentMethodColumn = columns.some((column) => column.accessorKey === 'paymentMethodName');
  if (!hasPaymentMethodColumn) {
    columns.push({ header: 'Payment Method', accessorKey: 'paymentMethodName', type: 'text' });
  }
}

type ChannelWithRelations = Channel & { paymentMethod?: PaymentMethod };

function serializeChannel(channel: ChannelWithRelations) {
  const plain = channel.get({ plain: true }) as ChannelWithRelations & { paymentMethodId: number };
  return {
    ...plain,
    paymentMethodName: plain.paymentMethod?.name ?? null,
  };
}

async function resolvePaymentMethodId(requestedId?: number | null): Promise<number> {
  if (requestedId != null) {
    const method = await PaymentMethod.findByPk(requestedId);
    if (method) {
      return method.id;
    }
  }

  const defaultMethod = await PaymentMethod.findOne({ where: { name: 'Online/Card' } });
  if (!defaultMethod) {
    throw new Error('Default payment method \"Online/Card\" is not configured.');
  }
  return defaultMethod.id;
}

export const getAllChannels = async (req: Request, res: Response): Promise<void> => {
  try {
    const format = (req.query.format ?? req.query.view ?? '').toString().toLowerCase();

    if (format === 'compact') {
      const channels = await Channel.findAll({
        order: [['name', 'ASC']],
        include: [{ model: PaymentMethod, as: 'paymentMethod', attributes: ['id', 'name'] }],
      });
      const payload = channels.map((channel) => ({
        id: channel.id,
        name: channel.name,
        description: channel.description,
        lateBookingAllowed: LATE_BOOKING_CHANNELS.has(channel.name),
        paymentMethodId: channel.paymentMethodId,
        paymentMethodName: channel.paymentMethod?.name ?? null,
      }));
      res.status(200).json(payload);
      return;
    }

    const channels = await Channel.findAll({
      include: [{ model: PaymentMethod, as: 'paymentMethod', attributes: ['id', 'name'] }],
    });
    const serialized = channels.map((channel) => serializeChannel(channel));
    const columns = buildChannelColumns();
    appendPaymentMethodColumn(columns);
    res.status(200).json([{ data: serialized, columns }]);
  } catch (error) {
    const errorMessage = (error as ErrorWithMessage).message;
    res.status(500).json([{ message: errorMessage }]);
  }
};

export const getChannelById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const channel = await Channel.findByPk(id, {
      include: [{ model: PaymentMethod, as: 'paymentMethod', attributes: ['id', 'name'] }],
    });

    if (!channel) {
      res.status(404).json([{ message: 'Channel not found' }]);
      return;
    }

    const columns = buildChannelColumns();
    appendPaymentMethodColumn(columns);
    res.status(200).json([{ data: serializeChannel(channel), columns }]);
  } catch (error) {
    const errorMessage = (error as ErrorWithMessage).message;
    res.status(500).json([{ message: errorMessage }]);
  }
};

export const createChannel = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, description, apiKey, apiSecret, paymentMethodId } = req.body;
    const resolvedPaymentMethodId = await resolvePaymentMethodId(paymentMethodId);
    const newChannel = await Channel.create({
      name,
      description,
      apiKey,
      apiSecret,
      paymentMethodId: resolvedPaymentMethodId,
    });
    await newChannel.reload({
      include: [{ model: PaymentMethod, as: 'paymentMethod', attributes: ['id', 'name'] }],
    });
    res.status(201).json(serializeChannel(newChannel as ChannelWithRelations));
  } catch (error) {
    const errorMessage = (error as ErrorWithMessage).message;
    res.status(500).json([{ message: errorMessage }]);
  }
};

export const updateChannel = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const payload = { ...req.body };
    if ('paymentMethodId' in payload) {
      payload.paymentMethodId = await resolvePaymentMethodId(payload.paymentMethodId);
    }
    const [updated] = await Channel.update(payload, { where: { id } });

    if (!updated) {
      res.status(404).json([{ message: 'Channel not found' }]);
      return;
    }

    const updatedChannel = await Channel.findByPk(id, {
      include: [{ model: PaymentMethod, as: 'paymentMethod', attributes: ['id', 'name'] }],
    });
    if (!updatedChannel) {
      res.status(404).json([{ message: 'Channel not found' }]);
      return;
    }
    res.status(200).json(serializeChannel(updatedChannel));
  } catch (error) {
    const errorMessage = (error as ErrorWithMessage).message;
    res.status(500).json([{ message: errorMessage }]);
  }
};

export const deleteChannel = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const deleted = await Channel.destroy({ where: { id } });

    if (!deleted) {
      res.status(404).json([{ message: 'Channel not found' }]);
      return;
    }

    res.status(204).send();
  } catch (error) {
    const errorMessage = (error as ErrorWithMessage).message;
    res.status(500).json([{ message: errorMessage }]);
  }
};
