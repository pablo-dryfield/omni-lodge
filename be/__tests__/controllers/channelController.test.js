const request = require('supertest');
const app = require('../../src/app');  // Import your Express app
const { Channel } = require('../../src/models'); // Import your Channel model

jest.mock('../../src/models/Channel');  // Mock the Channel model

describe('Channel Controller', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/channels', () => {
    it('should return all channels', async () => {
      const mockData = [
        { id: 1, name: 'Channel 1', description: 'Description 1' },
        { id: 2, name: 'Channel 2', description: 'Description 2' },
      ];

      Channel.findAll.mockResolvedValue(mockData);

      const res = await request(app).get('/api/channels');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockData);
    });
  });

  describe('GET /api/channels/:id', () => {
    it('should return a channel by ID', async () => {
      const mockData = { id: 1, name: 'Channel 1', description: 'Description 1' };

      Channel.findByPk.mockResolvedValue(mockData);

      const res = await request(app).get('/api/channels/1');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockData);
    });

    it('should return 404 if channel not found', async () => {
      Channel.findByPk.mockResolvedValue(null);

      const res = await request(app).get('/api/channels/1');

      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/channels', () => {
    it('should create a new channel', async () => {
      const newChannel = { name: 'Channel 3', description: 'Description 3' };
      Channel.create.mockResolvedValue(newChannel);

      const res = await request(app)
        .post('/api/channels')
        .send(newChannel);

      expect(res.status).toBe(201);
      expect(res.body).toEqual(newChannel);
    });
  });

  describe('PUT /api/channels/:id', () => {
    it('should update a channel', async () => {
      const updatedChannel = { id: 1, name: 'Updated Channel', description: 'Updated Description' };
      Channel.update.mockResolvedValue([1]);

      const res = await request(app)
        .put('/api/channels/1')
        .send(updatedChannel);

      expect(res.status).toBe(200);
      expect(res.body).toEqual(updatedChannel);
    });

    it('should return 404 if channel not found', async () => {
      Channel.update.mockResolvedValue([0]);

      const res = await request(app)
        .put('/api/channels/1')
        .send({ name: 'New Name' });

      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/channels/:id', () => {
    it('should delete a channel', async () => {
      Channel.destroy.mockResolvedValue(1);

      const res = await request(app).delete('/api/channels/1');

      expect(res.status).toBe(204);
    });

    it('should return 404 if channel not found', async () => {
      Channel.destroy.mockResolvedValue(0);

      const res = await request(app).delete('/api/channels/1');

      expect(res.status).toBe(404);
    });
  });
});
