import { Request, Response } from 'express';
import { DataType } from 'sequelize-typescript';
import Channel from '../models/Channel.js';
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

export const getAllChannels = async (req: Request, res: Response): Promise<void> => {
  try {
    const format = (req.query.format ?? req.query.view ?? '').toString().toLowerCase();

    if (format === 'compact') {
      const channels = await Channel.findAll({ order: [['name', 'ASC']] });
      const payload = channels.map((channel) => ({
        id: channel.id,
        name: channel.name,
        description: channel.description,
        lateBookingAllowed: LATE_BOOKING_CHANNELS.has(channel.name),
      }));
      res.status(200).json(payload);
      return;
    }

    const data = await Channel.findAll();
    res.status(200).json([{ data, columns: buildChannelColumns() }]);
  } catch (error) {
    const errorMessage = (error as ErrorWithMessage).message;
    res.status(500).json([{ message: errorMessage }]);
  }
};

export const getChannelById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const data = await Channel.findByPk(id);

    if (!data) {
      res.status(404).json([{ message: 'Channel not found' }]);
      return;
    }

    res.status(200).json([{ data, columns: buildChannelColumns() }]);
  } catch (error) {
    const errorMessage = (error as ErrorWithMessage).message;
    res.status(500).json([{ message: errorMessage }]);
  }
};

export const createChannel = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, description, apiKey, apiSecret } = req.body;
    const newChannel = await Channel.create({
      name,
      description,
      apiKey,
      apiSecret,
    });
    res.status(201).json([newChannel]);
  } catch (error) {
    const errorMessage = (error as ErrorWithMessage).message;
    res.status(500).json([{ message: errorMessage }]);
  }
};

export const updateChannel = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const [updated] = await Channel.update(req.body, { where: { id } });

    if (!updated) {
      res.status(404).json([{ message: 'Channel not found' }]);
      return;
    }

    const updatedChannel = await Channel.findByPk(id);
    res.status(200).json([updatedChannel]);
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
