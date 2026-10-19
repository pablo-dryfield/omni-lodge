jest.mock('../../config/database.js', () => ({ __esModule: true, default: { transaction: jest.fn() } }));
jest.mock('../../models/ReviewArchive.js', () => ({ __esModule: true, default: {
  findOne: jest.fn(), create: jest.fn(), count: jest.fn(), update: jest.fn(),
} }));
jest.mock('../../models/ReviewDailySnapshot.js', () => ({ __esModule: true, default: { upsert: jest.fn() } }));
jest.mock('../../models/ReviewSyncRun.js', () => ({ __esModule: true, default: { create: jest.fn() } }));
jest.mock('../../controllers/reviewController.js', () => ({
  getAirbnbReviews: jest.fn(), getAllGoogleReviews: jest.fn(), getTripAdvisorReviews: jest.fn(),
}));

import sequelize from '../../config/database.js';
import ReviewArchive from '../../models/ReviewArchive.js';
import ReviewDailySnapshot from '../../models/ReviewDailySnapshot.js';
import ReviewSyncRun from '../../models/ReviewSyncRun.js';
import { getTripAdvisorReviews } from '../../controllers/reviewController.js';
import { runFullReviewSync } from '../reviewFullSyncService.js';

const run = { id: 123, update: jest.fn() };
const source = getTripAdvisorReviews as jest.Mock;

beforeEach(() => {
  jest.resetAllMocks();
  (ReviewSyncRun.create as jest.Mock).mockResolvedValue(run);
  (sequelize.transaction as jest.Mock).mockImplementation((callback) => callback({}));
  (ReviewArchive.findOne as jest.Mock).mockResolvedValue(null);
  (ReviewArchive.update as jest.Mock).mockResolvedValue([0]);
  (ReviewArchive.count as jest.Mock).mockResolvedValue(40);
});

const page = (offset: number, totalCount: number, hasMore: boolean, nextOffset = offset + 1) => [{
  data: [{ reviewId: String(offset + 1), comment: 'Synthetic review', createTime: '2026-09-22T17:07:37.817Z', starRating: 'FIVE' }],
  columns: [{ totalCount, hasMore, nextOffset }],
}];

test('full TripAdvisor sync can retrieve more than 250 pages before marking missing rows', async () => {
  source.mockImplementation((req, res) => {
    const offset = Number(req.query.offset ?? 0);
    return res.status(200).json(page(offset, 304, offset < 303));
  });
  await expect(runFullReviewSync('tripadvisor')).resolves.toEqual({ seen: 304, deleted: 0 });
  expect(source).toHaveBeenCalledTimes(304);
  expect(source.mock.calls[0][0].query).toEqual({});
  expect(source.mock.calls[303][0].query).toEqual({ offset: 303 });
  expect(ReviewArchive.update).toHaveBeenCalledTimes(1);
  expect(ReviewDailySnapshot.upsert).toHaveBeenCalledWith(expect.objectContaining({ sourceTotalCount: 304 }));
});

test('a premature source end cannot delete archive rows', async () => {
  source.mockImplementation((_req, res) => res.status(200).json(page(0, 3038, false)));
  await expect(runFullReviewSync('tripadvisor')).rejects.toThrow('fetched 1 of 3038');
  expect(ReviewArchive.update).not.toHaveBeenCalled();
  expect(ReviewDailySnapshot.upsert).not.toHaveBeenCalled();
  expect(run.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }));
});

test('non-advancing offsets cannot loop or complete a destructive sync', async () => {
  source.mockImplementation((_req, res) => res.status(200).json(page(0, 3038, true, 0)));
  await expect(runFullReviewSync('tripadvisor')).rejects.toThrow('pagination did not advance');
  expect(source).toHaveBeenCalledTimes(1);
  expect(ReviewArchive.update).not.toHaveBeenCalled();
});

test('hitting the safety limit fails without declaring remaining reviews deleted', async () => {
  source.mockImplementation((req, res) => res.status(200).json(page(Number(req.query.offset ?? 0), 1001, true)));
  await expect(runFullReviewSync('tripadvisor')).rejects.toThrow('page limit before pagination completed');
  expect(source).toHaveBeenCalledTimes(1000);
  expect(ReviewArchive.update).not.toHaveBeenCalled();
});
