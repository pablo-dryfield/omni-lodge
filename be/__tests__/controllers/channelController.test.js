jest.mock('../../src/models/Channel.js', () => ({
  __esModule: true,
  default: {
    create: jest.fn(),
    destroy: jest.fn(),
    findAll: jest.fn(),
    findByPk: jest.fn(),
    getAttributes: jest.fn(),
    update: jest.fn(),
  },
}));
jest.mock('../../src/models/PaymentMethod.js', () => ({
  __esModule: true,
  default: {
    findByPk: jest.fn(),
    findOne: jest.fn(),
  },
}));

const Channel = require('../../src/models/Channel.js').default;
const PaymentMethod = require('../../src/models/PaymentMethod.js').default;
const {
  createChannel,
  deleteChannel,
  getAllChannels,
} = require('../../src/controllers/channelController.js');

const makeResponse = () => {
  const res = {
    status: jest.fn(),
    json: jest.fn(),
    send: jest.fn(),
  };
  res.status.mockReturnValue(res);
  return res;
};

describe('channelController', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the compact channel contract and late-booking capability', async () => {
    Channel.findAll.mockResolvedValue([
      {
        id: 1,
        name: 'Ecwid',
        description: 'Storefront',
        paymentMethodId: 4,
        paymentMethod: { name: 'Online/Card' },
      },
      {
        id: 2,
        name: 'Partner',
        description: null,
        paymentMethodId: 5,
        paymentMethod: { name: 'Bank Transfer' },
      },
    ]);
    const res = makeResponse();

    await getAllChannels({ query: { format: 'compact' } }, res);

    expect(Channel.findAll).toHaveBeenCalledWith(expect.objectContaining({
      order: [['name', 'ASC']],
    }));
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith([
      expect.objectContaining({ id: 1, lateBookingAllowed: true, paymentMethodName: 'Online/Card' }),
      expect.objectContaining({ id: 2, lateBookingAllowed: false, paymentMethodName: 'Bank Transfer' }),
    ]);
  });

  it('requires an authenticated actor when creating a channel', async () => {
    const res = makeResponse();

    await createChannel({ body: { name: 'Partner' } }, res);

    expect(Channel.create).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith([{ message: 'Unauthorized' }]);
  });

  it('records the actor and selected payment method when creating a channel', async () => {
    PaymentMethod.findByPk.mockResolvedValue({ id: 12 });
    const channel = {
      reload: jest.fn().mockResolvedValue(undefined),
      get: jest.fn().mockReturnValue({
        id: 3,
        name: 'Bank',
        paymentMethodId: 12,
        paymentMethod: { name: 'Bank Transfer' },
      }),
    };
    Channel.create.mockResolvedValue(channel);
    const res = makeResponse();

    await createChannel({
      authContext: { id: 42 },
      body: {
        name: 'Bank',
        description: 'Manual orders',
        apiKey: null,
        apiSecret: null,
        paymentMethodId: 12,
      },
    }, res);

    expect(Channel.create).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Bank',
      paymentMethodId: 12,
      createdBy: 42,
    }));
    expect(channel.reload).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      id: 3,
      paymentMethodName: 'Bank Transfer',
    }));
  });

  it('returns 404 when deleting a missing channel', async () => {
    Channel.destroy.mockResolvedValue(0);
    const res = makeResponse();

    await deleteChannel({ params: { id: '99' } }, res);

    expect(Channel.destroy).toHaveBeenCalledWith({ where: { id: '99' } });
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith([{ message: 'Channel not found' }]);
  });
});
