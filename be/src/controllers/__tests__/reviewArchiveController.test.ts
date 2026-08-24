jest.mock('../../config/database.js', () => ({
  __esModule: true,
  default: { transaction: jest.fn() },
}));
jest.mock('../../models/ReviewArchive.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/ReviewAssignment.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/ReviewSyncRun.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/ReviewManualCredit.js', () => ({
  __esModule: true,
  default: { findByPk: jest.fn() },
}));
jest.mock('../../models/ReviewDailySnapshot.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/ReviewMonthLock.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../__mocks__/sequelizeModelStub', () => ({
  __esModule: true,
  default: { count: jest.fn() },
}));

import ReviewManualCredit from '../../models/ReviewManualCredit';
import { deleteManualReviewCredit, updateManualReviewCredit } from '../reviewArchiveController';

const findManualCredit = ReviewManualCredit.findByPk as jest.Mock;
const countUsers = jest.requireMock('../../__mocks__/sequelizeModelStub').default.count as jest.Mock;

const createResponse = () => {
  const response = {
    status: jest.fn(),
    json: jest.fn(),
    send: jest.fn(),
  };
  response.status.mockReturnValue(response);
  return response;
};

describe('deleteManualReviewCredit', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('deletes only the requested manual credit', async () => {
    const credit = { id: 77, destroy: jest.fn().mockResolvedValue(undefined) };
    findManualCredit.mockResolvedValue(credit);
    const response = createResponse();

    await deleteManualReviewCredit(
      { params: { id: '77' } } as never,
      response as never,
    );

    expect(findManualCredit).toHaveBeenCalledWith(77);
    expect(credit.destroy).toHaveBeenCalledTimes(1);
    expect(response.status).toHaveBeenCalledWith(204);
    expect(response.send).toHaveBeenCalledTimes(1);
  });

  it('returns not found without deleting another credit', async () => {
    findManualCredit.mockResolvedValue(null);
    const response = createResponse();

    await deleteManualReviewCredit(
      { params: { id: '999' } } as never,
      response as never,
    );

    expect(response.status).toHaveBeenCalledWith(404);
    expect(response.json).toHaveBeenCalledWith([{ message: 'Manual review credit not found' }]);
  });

  it('rejects an invalid manual credit ID', async () => {
    const response = createResponse();

    await deleteManualReviewCredit(
      { params: { id: 'invalid' } } as never,
      response as never,
    );

    expect(findManualCredit).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith([{ message: 'A valid manual credit ID is required' }]);
  });
});

describe('updateManualReviewCredit', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('updates only the supported manual-credit fields', async () => {
    const credit = {
      id: 77,
      category: 'staff',
      userId: 42,
      notes: 'Original description',
      update: jest.fn().mockResolvedValue(undefined),
    };
    findManualCredit.mockResolvedValue(credit);
    countUsers.mockResolvedValue(1);
    const response = createResponse();

    await updateManualReviewCredit(
      {
        params: { id: '77' },
        body: {
          userId: 42,
          platform: 'Google',
          credit: 0.5,
          notes: '  Corrected description  ',
        },
      } as never,
      response as never,
    );

    expect(credit.update).toHaveBeenCalledWith({
      userId: 42,
      platform: 'google',
      credit: 0.5,
      notes: 'Corrected description',
    });
    expect(response.json).toHaveBeenCalledWith({ credit });
  });

  it('rejects a non-positive credit amount', async () => {
    const credit = {
      id: 77,
      category: 'staff',
      userId: 42,
      notes: 'Original description',
      update: jest.fn(),
    };
    findManualCredit.mockResolvedValue(credit);
    const response = createResponse();

    await updateManualReviewCredit(
      { params: { id: '77' }, body: { credit: 0 } } as never,
      response as never,
    );

    expect(credit.update).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith([{
      message: 'Credit amount must be greater than zero and no more than 999999.9999',
    }]);
  });

  it('protects backfilled legacy review-counter credits from editing', async () => {
    const credit = {
      id: 77,
      category: 'staff',
      userId: 42,
      notes: 'Backfilled from legacy review counter #12',
      update: jest.fn(),
    };
    findManualCredit.mockResolvedValue(credit);
    const response = createResponse();

    await updateManualReviewCredit(
      { params: { id: '77' }, body: { credit: 0.5 } } as never,
      response as never,
    );

    expect(credit.update).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(409);
  });
});
