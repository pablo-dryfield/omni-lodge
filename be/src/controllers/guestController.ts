import { Request, Response } from 'express';
import { DataType } from 'sequelize-typescript';
import Guest from '../models/Guest.js'; // Adjust the import path as necessary

interface ErrorWithMessage {
  message: string;
}

// Get All Guests
export const getAllGuests = async (req: Request, res: Response): Promise<void> => {
  try {
    const data = await Guest.findAll();
    const attributes = Guest.getAttributes();
    const columns = Object.entries(attributes)
      .filter(([key]) => key !== 'password') 
      .map(([key, attribute]) => {
        return {
          header: key.charAt(0).toUpperCase() + key.slice(1),
          accessorKey: key,
          type: attribute.type instanceof DataType.DATE ? 'date' : 'text',
        };
      });
    res.status(200).json({ data, columns });
  } catch (error) {
    const e = error as ErrorWithMessage;
    res.status(500).json({ message: e.message });
  }
};

// Get Guest by ID
export const getGuestById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const guest = await Guest.findByPk(id);

    if (!guest) {
      res.status(404).json({ message: 'Guest not found' });
      return;
    }

    res.status(200).json(guest);
  } catch (error) {
    const e = error as ErrorWithMessage;
    res.status(500).json({ message: e.message });
  }
};

// Create New Guest
export const createGuest = async (req: Request, res: Response): Promise<void> => {
  try {
    const newGuest = await Guest.create(req.body);
    res.status(201).json(newGuest);
  } catch (error) {
    const e = error as ErrorWithMessage;
    res.status(500).json({ message: e.message });
  }
};

// Update Guest
export const updateGuest = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const [updated] = await Guest.update(req.body, { where: { id } });

    if (!updated) {
      res.status(404).json({ message: 'Guest not found' });
      return;
    }

    const updatedGuest = await Guest.findByPk(id);
    res.status(200).json(updatedGuest);
  } catch (error) {
    const e = error as ErrorWithMessage;
    res.status(500).json({ message: e.message });
  }
};

// Delete Guest
export const deleteGuest = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const deleted = await Guest.destroy({ where: { id } });

    if (!deleted) {
      res.status(404).json({ message: 'Guest not found' });
      return;
    }

    res.status(204).send();
  } catch (error) {
    const e = error as ErrorWithMessage;
    res.status(500).json({ message: e.message });
  }
};
