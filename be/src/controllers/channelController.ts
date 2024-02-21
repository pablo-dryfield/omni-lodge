import { Request, Response } from 'express';
import { DataType } from 'sequelize-typescript';
import Channel from '../models/Channel.js'; // Adjust the import path as necessary

// Assuming you have a more specific error type
interface ErrorWithMessage {
  message: string;
}

// Get All Channels
export const getAllChannels = async (req: Request, res: Response): Promise<void> => {
  try {
    const data = await Channel.findAll();
    const attributes = Channel.getAttributes();
    const columns = Object.entries(attributes)
      .filter(([key]) => key !== 'password') 
      .map(([key, attribute]) => {
        return {
          header: key.charAt(0).toUpperCase() + key.slice(1),
          accessorKey: key,
          type: attribute.type instanceof DataType.DATE ? 'date' : 'text',
        };
      });
    res.status(200).json([{ data, columns }]);
  } catch (error) {
    const e = error as ErrorWithMessage;
    res.status(500).json([{ message: e.message }]);
  }
};

// Get Channel by ID
export const getChannelById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const data = await Channel.findByPk(id);

    if (!data) {
      res.status(404).json([{ message: 'Channel not found' }]);
      return;
    }

    res.status(200).json([data]);
  } catch (error) {
    const e = error as ErrorWithMessage;
    res.status(500).json([{ message: e.message }]);
  }
};

// Create New Channel
export const createChannel = async (req: Request, res: Response): Promise<void> => {
  try {
    const newChannel = await Channel.create(req.body);
    res.status(201).json([newChannel]);
  } catch (error) {
    const e = error as ErrorWithMessage;
    res.status(500).json([{ message: e.message }]);
  }
};

// Update Channel
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
    const e = error as ErrorWithMessage;
    res.status(500).json([{ message: e.message }]);
  }
};

// Delete Channel
export const deleteChannel = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const deleted = await Channel.destroy({ where: { id } });

    if (!deleted) {
      res.status(404).json([{ message: 'Channel not found' }]);
      return;
    }

    res.status(204).send(); // Properly using send() for a 204 response
  } catch (error) {
    const e = error as ErrorWithMessage;
    res.status(500).json([{ message: e.message }]);
  }
};
