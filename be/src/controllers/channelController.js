import Channel from '../models/Channel.js';

// Get All Channels
export const getAllChannels = async (req, res) => {
  try {
    const channels = await Channel.findAll();
    res.status(200).json(channels);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Get Channel by ID
export const getChannelById = async (req, res) => {
  try {
    const { id } = req.params;
    const channel = await Channel.findByPk(id);

    if (!channel) return res.status(404).json({ message: 'Channel not found' });

    res.status(200).json(channel);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Create New Channel
export const createChannel = async (req, res) => {
  try {
    const newChannel = await Channel.create(req.body);
    res.status(201).json(newChannel);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Update Channel
export const updateChannel = async (req, res) => {
  try {
    const { id } = req.params;
    const [updated] = await Channel.update(req.body, {
      where: { id: id },
    });

    if (!updated) return res.status(404).json({ message: 'Channel not found' });

    const updatedChannel = await Channel.findByPk(id);
    res.status(200).json(updatedChannel);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Delete Channel
export const deleteChannel = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await Channel.destroy({
      where: { id: id },
    });

    if (!deleted) return res.status(404).json({ message: 'Channel not found' });

    res.status(204).json({ message: 'Channel deleted' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Additional methods could include filtering channels by some criteria, if needed.
