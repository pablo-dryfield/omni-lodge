const request = require('supertest');
const app = require('../../src/app'); // Import your Express app
const { Guest } = require('../../src/models'); // Import your Guest model

jest.mock('../../src/models/Guest'); // Mock the Guest model

describe('Guest Controller', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/guests', () => {
    it('should return all guests', async () => {
      const mockData = [
        { id: 1, name: 'Alice', email: 'alice@example.com' },
        { id: 2, name: 'Bob', email: 'bob@example.com' },
      ];

      Guest.findAll.mockResolvedValue(mockData);

      const res = await request(app).get('/api/guests');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockData);
    });
  });

  describe('GET /api/guests/:id', () => {
    it('should return a guest by ID', async () => {
      const mockData = { id: 1, name: 'Alice', email: 'alice@example.com' };

      Guest.findByPk.mockResolvedValue(mockData);

      const res = await request(app).get('/api/guests/1');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockData);
    });

    it('should return 404 if guest not found', async () => {
      Guest.findByPk.mockResolvedValue(null);

      const res = await request(app).get('/api/guests/1');

      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/guests', () => {
    it('should create a new guest', async () => {
      const newGuest = { name: 'Charlie', email: 'charlie@example.com' };
      Guest.create.mockResolvedValue(newGuest);

      const res = await request(app)
        .post('/api/guests')
        .send(newGuest);

      expect(res.status).toBe(201);
      expect(res.body).toEqual(newGuest);
    });
  });

  describe('PUT /api/guests/:id', () => {
    it('should update a guest', async () => {
      const updatedGuest = { id: 1, name: 'Alice', email: 'alice_new@example.com' };
      Guest.update.mockResolvedValue([1]);

      const res = await request(app)
        .put('/api/guests/1')
        .send(updatedGuest);

      expect(res.status).toBe(200);
      expect(res.body).toEqual(updatedGuest);
    });

    it('should return 404 if guest not found', async () => {
      Guest.update.mockResolvedValue([0]);

      const res = await request(app)
        .put('/api/guests/1')
        .send({ email: 'new_email@example.com' });

      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/guests/:id', () => {
    it('should delete a guest', async () => {
      Guest.destroy.mockResolvedValue(1);

      const res = await request(app).delete('/api/guests/1');

      expect(res.status).toBe(204);
    });

    it('should return 404 if guest not found', async () => {
      Guest.destroy.mockResolvedValue(0);

      const res = await request(app).delete('/api/guests/1');

      expect(res.status).toBe(404);
    });
  });
});
