import { Request, Response } from 'express';
import { DataType } from 'sequelize-typescript';
import Booking from '../models/Booking.js'; // Adjust the import path as necessary

interface ErrorWithMessage {
  message: string;
}

export const getAllBookings = async (req: Request, res: Response): Promise<void> => {
  try {
    const data = await Booking.findAll();
    const attributes = Booking.getAttributes();
    const columns = Object.entries(attributes)
      .map(([key, attribute]) => {
        return {
          header: key.charAt(0).toUpperCase() + key.slice(1),
          accessorKey: key,
          type: attribute.type instanceof DataType.DATE ? 'date' : 'text',
        };
      });
    res.status(200).json([{ data, columns }]);
  } catch (error) {
    res.status(500).json([{ message: (error as ErrorWithMessage).message }]);
  }
};

// Get Booking by ID
export const getBookingById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const data = await Booking.findByPk(id);

    if (!data) {
      res.status(404).json([{ message: 'Booking not found' }]);
      return;
    }

    res.status(200).json([data]);
  } catch (error) {
    res.status(500).json([{ message: (error as ErrorWithMessage).message }]);
  }
};

// Create New Booking
export const createBooking = async (req: Request, res: Response): Promise<void> => {
  try {
    const newBooking = await Booking.create(req.body);
    res.status(201).json([newBooking]);
  } catch (error) {
    res.status(500).json([{ message: (error as ErrorWithMessage).message }]);
  }
};

// Update Booking
export const updateBooking = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const [updated] = await Booking.update(req.body, {
      where: { id },
    });

    if (!updated) {
      res.status(404).json([{ message: 'Booking not found' }]);
      return;
    }

    const updatedBooking = await Booking.findByPk(id);
    res.status(200).json([updatedBooking]);
  } catch (error) {
    res.status(500).json([{ message: (error as ErrorWithMessage).message }]);
  }
};

// Delete Booking
export const deleteBooking = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const deleted = await Booking.destroy({
      where: { id },
    });

    if (!deleted) {
      res.status(404).json([{ message: 'Booking not found' }]);
      return;
    }

    res.status(204).send();
  } catch (error) {
    res.status(500).json([{ message: (error as ErrorWithMessage).message }]);
  }
};
