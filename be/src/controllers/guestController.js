import Guest from '../models/Guest.js';

// Get All Guests
export const getAllGuests = async (req, res) => {
  try {
    const guests = await Guest.findAll();
    res.status(200).json(guests);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Get Guest by ID
export const getGuestById = async (req, res) => {
  try {
    const { id } = req.params;
    const guest = await Guest.findByPk(id);

    if (!guest) return res.status(404).json({ message: 'Guest not found' });

    res.status(200).json(guest);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Create New Guest
export const createGuest = async (req, res) => {
  try {
    const newGuest = await Guest.create(req.body);
    res.status(201).json(newGuest);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Update Guest
export const updateGuest = async (req, res) => {
  try {
    const { id } = req.params;
    const [updated] = await Guest.update(req.body, {
      where: { id: id },
    });

    if (!updated) return res.status(404).json({ message: 'Guest not found' });

    const updatedGuest = await Guest.findByPk(id);
    res.status(200).json(updatedGuest);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Delete Guest
export const deleteGuest = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await Guest.destroy({
      where: { id: id },
    });

    if (!deleted) return res.status(404).json({ message: 'Guest not found' });

    res.status(204).json({ message: 'Guest deleted' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
