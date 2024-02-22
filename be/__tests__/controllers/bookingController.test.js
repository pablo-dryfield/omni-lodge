const request = require('supertest');
const app = require('../../src/app');  // Import your Express app
const { Booking } = require('../../src/models'); // Import your Booking model

jest.mock('../../src/models/Booking');  // Mock the Booking model

describe('Booking Controller', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/bookings', () => {
    it('should return all bookings', async () => {
      const mockData = [
        { id: 1, guestId: 1, channelId: 1, startDate: '2023-08-01', endDate: '2023-08-05' },
        { id: 2, guestId: 2, channelId: 2, startDate: '2023-09-01', endDate: '2023-09-05' },
      ];

      Booking.findAll.mockResolvedValue(mockData);

      const res = await request(app).get('/api/bookings');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockData);
    });
  });

  describe('GET /api/bookings/:id', () => {
    it('should return a booking by ID', async () => {
      const mockData = { id: 1, guestId: 1, channelId: 1, startDate: '2023-08-01', endDate: '2023-08-05' };

      Booking.findByPk.mockResolvedValue(mockData);

      const res = await request(app).get('/api/bookings/1');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockData);
    });

    it('should return 404 if booking not found', async () => {
      Booking.findByPk.mockResolvedValue(null);

      const res = await request(app).get('/api/bookings/1');

      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/bookings', () => {
    it('should create a new booking', async () => {
      const newBooking = { guestId: 3, channelId: 3, startDate: '2023-10-01', endDate: '2023-10-05' };
      Booking.create.mockResolvedValue(newBooking);

      const res = await request(app)
        .post('/api/bookings')
        .send(newBooking);

      expect(res.status).toBe(201);
      expect(res.body).toEqual(newBooking);
    });
  });

  describe('PUT /api/bookings/:id', () => {
    it('should update a booking', async () => {
      const updatedBooking = { id: 1, guestId: 1, channelId: 1, startDate: '2023-08-01', endDate: '2023-08-10' };
      Booking.update.mockResolvedValue([1]);

      const res = await request(app)
        .put('/api/bookings/1')
        .send(updatedBooking);

      expect(res.status).toBe(200);
      expect(res.body).toEqual(updatedBooking);
    });

    it('should return 404 if booking not found', async () => {
      Booking.update.mockResolvedValue([0]);

      const res = await request(app)
        .put('/api/bookings/1')
        .send({ startDate: '2023-08-01', endDate: '2023-08-10' });

      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/bookings/:id', () => {
    it('should delete a booking', async () => {
      Booking.destroy.mockResolvedValue(1);

      const res = await request(app).delete('/api/bookings/1');

      expect(res.status).toBe(204);
    });

    it('should return 404 if booking not found', async () => {
      Booking.destroy.mockResolvedValue(0);

      const res = await request(app).delete('/api/bookings/1');

      expect(res.status).toBe(404);
    });
  });
});
