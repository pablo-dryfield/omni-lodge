jest.mock('../../src/models/Booking.js', () => ({
  __esModule: true,
  default: {
    findByPk: jest.fn(),
  },
}));
jest.mock('../../src/config/database.js', () => ({
  __esModule: true,
  default: {
    query: jest.fn(),
    transaction: jest.fn(),
  },
}));
jest.mock('../../src/services/bookings/bookingIngestionService.js', () => ({
  ingestAllBookingEmails: jest.fn(),
  ingestLatestBookingEmails: jest.fn(),
  processBookingEmail: jest.fn(),
}));

const Booking = require('../../src/models/Booking.js').default;
const { getBookingDetails } = require('../../src/controllers/bookingController.js');

const makeResponse = () => {
  const res = {
    status: jest.fn(),
    json: jest.fn(),
  };
  res.status.mockReturnValue(res);
  return res;
};

describe('bookingController.getBookingDetails', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects an invalid booking ID before querying the database', async () => {
    const res = makeResponse();

    await getBookingDetails({ params: { bookingId: 'not-a-number' } }, res);

    expect(Booking.findByPk).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'A valid booking ID must be provided' });
  });

  it('returns 404 when the requested booking does not exist', async () => {
    Booking.findByPk.mockResolvedValue(null);
    const res = makeResponse();

    await getBookingDetails({ params: { bookingId: '404' } }, res);

    expect(Booking.findByPk).toHaveBeenCalledWith(404, expect.objectContaining({
      include: expect.any(Array),
    }));
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ message: 'Booking not found' });
  });
});
