jest.mock('../../src/models/Guest.js', () => ({
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

const Guest = require('../../src/models/Guest.js').default;
const {
  createGuest,
  deleteGuest,
  getAllGuests,
  getGuestById,
  updateGuest,
} = require('../../src/controllers/guestController.js');

const makeResponse = () => {
  const res = {
    status: jest.fn(),
    json: jest.fn(),
    send: jest.fn(),
  };
  res.status.mockReturnValue(res);
  return res;
};

describe('guestController', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Guest.getAttributes.mockReturnValue({
      id: { type: {} },
      name: { type: {} },
    });
  });

  it('returns guests with the table column contract', async () => {
    const guests = [{ id: 1, name: 'Alice' }];
    Guest.findAll.mockResolvedValue(guests);
    const res = makeResponse();

    await getAllGuests({ query: {} }, res);

    expect(Guest.findAll).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith([{
      data: guests,
      columns: [
        { header: 'Id', accessorKey: 'id', type: 'text' },
        { header: 'Name', accessorKey: 'name', type: 'text' },
      ],
    }]);
  });

  it('returns a guest by ID using the current array response shape', async () => {
    const guest = { id: 7, name: 'Sam' };
    Guest.findByPk.mockResolvedValue(guest);
    const res = makeResponse();

    await getGuestById({ params: { id: '7' } }, res);

    expect(Guest.findByPk).toHaveBeenCalledWith('7');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith([guest]);
  });

  it('returns 404 when updating a missing guest', async () => {
    Guest.update.mockResolvedValue([0]);
    const res = makeResponse();

    await updateGuest({ params: { id: '9' }, body: { name: 'Nobody' } }, res);

    expect(Guest.update).toHaveBeenCalledWith(
      { name: 'Nobody' },
      { where: { id: '9' } },
    );
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith([{ message: 'Guest not found' }]);
  });

  it('creates and deletes guests through the current controller contract', async () => {
    const created = { id: 11, name: 'Charlie' };
    Guest.create.mockResolvedValue(created);
    Guest.destroy.mockResolvedValue(1);
    const createResponse = makeResponse();
    const deleteResponse = makeResponse();

    await createGuest({ body: { name: 'Charlie' } }, createResponse);
    await deleteGuest({ params: { id: '11' } }, deleteResponse);

    expect(createResponse.status).toHaveBeenCalledWith(201);
    expect(createResponse.json).toHaveBeenCalledWith([created]);
    expect(Guest.destroy).toHaveBeenCalledWith({ where: { id: '11' } });
    expect(deleteResponse.status).toHaveBeenCalledWith(204);
    expect(deleteResponse.send).toHaveBeenCalledTimes(1);
  });
});
