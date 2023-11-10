import Booking from '../models/Booking.js';
import { google } from 'googleapis';
const sheets = google.sheets('v4');

// Temp Google Data - Remove later
import googleClient from '../config/googleClient.js';

// Get All Bookings
/*export const getAllBookings = async (req, res) => {
  try {
    const bookings = await Booking.findAll();
    res.status(200).json(bookings);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};*/

// Get All Bookings
googleClient.authorize((err, tokens) => {
  if (err) {
    console.error('Error authorizing client:', err);
    return;
  }
});

export const getAllBookings = async (req, res) => {
  try {
    const resultsHostelWorld = await sheets.spreadsheets.values.get(
      {
        auth: googleClient,
        spreadsheetId: '1En-HJE8QXKKDLAPwH12vuhd34DhhAWbkRmlgTkmAgEY',
        range: 'Hostelworld!A1:X300',
      });

      res.status(200).json(resultsHostelWorld.data.values);

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

  

// Get Booking by ID
export const getBookingById = async (req, res) => {
  try {
    const { id } = req.params;
    const booking = await Booking.findByPk(id);

    if (!booking) return res.status(404).json({ message: 'Booking not found' });

    res.status(200).json(booking);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Create New Booking
export const createBooking = async (req, res) => {
  try {
    const newBooking = await Booking.create(req.body);
    res.status(201).json(newBooking);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Update Booking
export const updateBooking = async (req, res) => {
  try {
    const { id } = req.params;
    const [updated] = await Booking.update(req.body, {
      where: { id: id },
    });

    if (!updated) return res.status(404).json({ message: 'Booking not found' });

    const updatedBooking = await Booking.findByPk(id);
    res.status(200).json(updatedBooking);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Delete Booking
export const deleteBooking = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await Booking.destroy({
      where: { id: id },
    });

    if (!deleted) return res.status(404).json({ message: 'Booking not found' });

    res.status(204).json({ message: 'Booking deleted' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Additional methods could include filtering bookings by date range, guest, channel, etc.
