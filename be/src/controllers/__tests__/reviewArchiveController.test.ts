jest.mock('../../config/database.js', () => ({
  __esModule: true,
  default: { transaction: jest.fn() },
}));
jest.mock('../../models/ReviewArchive.js', () => ({ __esModule: true, default: { findAll: jest.fn(), count: jest.fn(), update: jest.fn() } }));
jest.mock('../../models/ReviewAssignment.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/ReviewSyncRun.js', () => ({ __esModule: true, default: { findByPk: jest.fn() } }));
jest.mock('../../models/ReviewManualCredit.js', () => ({
  __esModule: true,
  default: { create: jest.fn(), findByPk: jest.fn() },
}));
jest.mock('../../models/ReviewDailySnapshot.js', () => ({ __esModule: true, default: { findAll: jest.fn() } }));
jest.mock('../../models/ReviewMonthLock.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../__mocks__/sequelizeModelStub', () => ({
  __esModule: true,
  default: { count: jest.fn() },
}));

import ReviewManualCredit from '../../models/ReviewManualCredit';
import ReviewArchive from '../../models/ReviewArchive';
import ReviewDailySnapshot from '../../models/ReviewDailySnapshot';
import ReviewSyncRun from '../../models/ReviewSyncRun';
import { completeReviewSync, createManualReviewCredit, deleteManualReviewCredit, failReviewSync, getReviewTrends, updateManualReviewCredit } from '../reviewArchiveController';

const findManualCredit = ReviewManualCredit.findByPk as jest.Mock;
const createManualCredit = ReviewManualCredit.create as jest.Mock;
const countUsers = jest.requireMock('../../__mocks__/sequelizeModelStub').default.count as jest.Mock;
const findArchivedReviews = ReviewArchive.findAll as jest.Mock;
const findDailySnapshots = ReviewDailySnapshot.findAll as jest.Mock;
const findReviewSyncRun = ReviewSyncRun.findByPk as jest.Mock;

const createResponse = () => {
  const response = {
    status: jest.fn(),
    json: jest.fn(),
    send: jest.fn(),
  };
  response.status.mockReturnValue(response);
  return response;
};

test('the browser sync completion endpoint refuses an incomplete TripAdvisor total before deletion', async () => {
  const run = { id: 941, platform: 'tripadvisor', status: 'running', seenCount: 2500, update: jest.fn() };
  findReviewSyncRun.mockResolvedValue(run);
  (ReviewArchive.count as jest.Mock).mockResolvedValue(3038);
  const res = createResponse();
  await completeReviewSync({ params: { runId: '941' }, body: { sourceTotalCount: 3038 } } as never, res as never);
  expect(res.status).toHaveBeenCalledWith(400);
  expect(res.json).toHaveBeenCalledWith([{ message: expect.stringContaining('fetched 2500 of 3038') }]);
  expect(ReviewArchive.update).not.toHaveBeenCalled();
  expect(run.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }));
});

describe('createManualReviewCredit', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates a no-name GetYourGuide entry without a user ID', async () => {
    const credit = { id: 81 };
    createManualCredit.mockResolvedValue(credit);
    const response = createResponse();

    await createManualReviewCredit(
      {
        body: {
          category: 'no_name',
          platform: 'GetYourGuide',
          date: '2026-09-01',
          credit: 1,
          notes: 'Reviewer did not name a team member',
        },
        authContext: { id: 9 },
      } as never,
      response as never,
    );

    expect(countUsers).not.toHaveBeenCalled();
    expect(createManualCredit).toHaveBeenCalledWith({
      userId: null,
      category: 'no_name',
      platform: 'getyourguide',
      date: '2026-09-01',
      credit: 1,
      notes: 'Reviewer did not name a team member',
      createdBy: 9,
    });
    expect(response.status).toHaveBeenCalledWith(201);
    expect(response.json).toHaveBeenCalledWith({ credit });
  });
});

describe('getReviewTrends', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows an archive total when a platform has not completed a snapshot yet', async () => {
    findDailySnapshots.mockResolvedValue([]);
    findArchivedReviews.mockResolvedValue([
      { platform: 'getyourguide' },
      { platform: 'getyourguide' },
    ]);
    const response = createResponse();

    await getReviewTrends(
      { query: { platform: 'getyourguide', days: '90' } } as never,
      response as never,
    );

    expect(findArchivedReviews).toHaveBeenCalledWith({
      attributes: ['platform'],
      where: { isDeleted: false, platform: 'getyourguide' },
    });
    expect(response.json).toHaveBeenCalledWith({
      snapshots: [expect.objectContaining({
        platform: 'getyourguide',
        sourceTotalCount: null,
        activeCount: 2,
      })],
    });
  });
});

describe('failReviewSync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('marks a running sync as failed so a client-side scraper error does not leave it stuck', async () => {
    const run = {
      id: 941,
      status: 'running',
      update: jest.fn().mockResolvedValue(undefined),
    };
    findReviewSyncRun.mockResolvedValue(run);
    const response = createResponse();

    await failReviewSync(
      { params: { runId: '941' } } as never,
      response as never,
    );

    expect(findReviewSyncRun).toHaveBeenCalledWith(941);
    expect(run.update).toHaveBeenCalledWith({
      status: 'failed',
      completedAt: expect.any(Date),
    });
    expect(response.json).toHaveBeenCalledWith({ run });
  });

  it('does not change a sync run that already left the running state', async () => {
    const run = {
      id: 941,
      status: 'completed',
      update: jest.fn(),
    };
    findReviewSyncRun.mockResolvedValue(run);
    const response = createResponse();

    await failReviewSync(
      { params: { runId: '941' } } as never,
      response as never,
    );

    expect(run.update).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith([{ message: 'Active sync run not found' }]);
  });
});

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
