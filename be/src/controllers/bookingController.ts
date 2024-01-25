import { Request, Response } from 'express';
import Booking from '../models/Booking.js'; // Adjust the import path as necessary
import { google } from 'googleapis';
import googleClient from '../config/googleClient.js'; // Adjust the import path as necessary

const sheets = google.sheets('v4');

// Assuming the authorization of googleClient is handled elsewhere or refactored into an async function

export const getAllBookings = async (req: Request, res: Response): Promise<void> => {
  try {
    const resultsHostelWorld = await sheets.spreadsheets.values.get({
      auth: googleClient,
      spreadsheetId: '1En-HJE8QXKKDLAPwH12vuhd34DhhAWbkRmlgTkmAgEY',
      range: 'Hostelworld!A1:X300',
    });

    res.status(200).json(resultsHostelWorld.data.values);

  } catch (error) {
    res.status(500).json({ message: (error as Error).message });
  }
};

// Get Booking by ID
export const getBookingById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const booking = await Booking.findByPk(id);

    if (!booking) {
      res.status(404).json({ message: 'Booking not found' });
      return;
    }

    res.status(200).json(booking);
  } catch (error) {
    res.status(500).json({ message: (error as Error).message });
  }
};

// Create New Booking
export const createBooking = async (req: Request, res: Response): Promise<void> => {
  try {
    const newBooking = await Booking.create(req.body);
    res.status(201).json(newBooking);
  } catch (error) {
    res.status(500).json({ message: (error as Error).message });
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
      res.status(404).json({ message: 'Booking not found' });
      return;
    }

    const updatedBooking = await Booking.findByPk(id);
    res.status(200).json(updatedBooking);
  } catch (error) {
    res.status(500).json({ message: (error as Error).message });
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
      res.status(404).json({ message: 'Booking not found' });
      return;
    }

    res.status(204).send();
  } catch (error) {
    res.status(500).json({ message: (error as Error).message });
  }
};
