jest.mock('../../config/database.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/ReviewArchive.js', () => ({ __esModule: true, default: { findAll: jest.fn().mockResolvedValue([]) } }));
jest.mock('../../models/ReviewAssignment.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/ReviewSyncRun.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/ReviewManualCredit.js', () => ({ __esModule: true, default: { findAll: jest.fn().mockResolvedValue([]) } }));
jest.mock('../../models/ReviewDailySnapshot.js', () => ({ __esModule: true, default: { findAll: jest.fn().mockResolvedValue([]) } }));
jest.mock('../../models/ReviewMonthLock.js', () => ({ __esModule: true, default: { findOne: jest.fn().mockResolvedValue(null) } }));
jest.mock('../../models/ReviewPlatform.js', () => ({ __esModule: true, default: { findAll: jest.fn() } }));
jest.mock('../../__mocks__/sequelizeModelStub', () => ({ __esModule: true, default: { findAll: jest.fn().mockResolvedValue([]) } }));

import ReviewPlatform from '../../models/ReviewPlatform';
import { getReviewCreditSummary } from '../reviewArchiveController';

it('includes configured platform metadata in the review-authorized summary, including inactive history labels', async () => {
  const platforms = [
    { slug: 'freetour', name: 'FreeTour', isActive: true, sourceKey: null, aliases: [] },
    { slug: 'civitatis', name: 'Civitatis', isActive: true, sourceKey: null, aliases: [] },
    { slug: 'retired', name: 'Retired', isActive: false, sourceKey: null, aliases: [] },
  ];
  (ReviewPlatform.findAll as jest.Mock).mockResolvedValue(platforms);
  const response = { json: jest.fn(), status: jest.fn().mockReturnThis() };
  await getReviewCreditSummary({ query: { start: '2026-10-01', end: '2026-10-31' } } as never, response as never);
  expect(response.status).not.toHaveBeenCalled();
  expect(ReviewPlatform.findAll).toHaveBeenCalledWith({
    attributes: ['slug', 'name', 'isActive', 'sourceKey', 'aliases'], order: [['name', 'ASC']],
  });
  expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ reviewPlatforms: platforms, staff: [] }));
});
