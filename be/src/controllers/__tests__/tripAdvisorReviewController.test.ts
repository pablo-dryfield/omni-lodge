import axios from 'axios';
import { getTripAdvisorReviews } from '../reviewController.js';

jest.mock('axios');
jest.mock('../../services/configService.js', () => ({ getConfigValue: jest.fn(() => null) }));

const response = () => {
  const res = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  return res;
};

describe('TripAdvisor reviews controller', () => {
  beforeEach(() => jest.resetAllMocks());

  it('keeps the submitted source date and ID and paginates by returned rows, not the requested limit', async () => {
    jest.mocked(axios.post).mockResolvedValue({ data: [{ data: {
      ReviewsProxy_getPublishedReviewsForLocation: [{ error: null, result: { totalCount: 3038, reviews: [
        { id: 123, text: 'Synthetic review', rating: 5, submittedDateTime: '2026-09-22T17:07:37.817Z', userProfile: { displayName: 'Example' } },
      ] } }],
    } }] });
    const res = response();
    await getTripAdvisorReviews({ query: { offset: '10' } } as never, res as never);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith([{
      data: [expect.objectContaining({ reviewId: '123', createTime: '2026-09-22T17:07:37.817Z', updateTime: '2026-09-22T17:07:37.817Z' })],
      columns: [expect.objectContaining({ offset: 10, nextOffset: 11, hasMore: true, totalCount: 3038 })],
    }]);
  });

  it('surfaces access errors without logging Axios configuration or the secret cookie', async () => {
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.mocked(axios.isAxiosError).mockReturnValueOnce(true).mockReturnValue(false);
    jest.mocked(axios.post).mockRejectedValue({ response: { status: 403 }, config: { headers: { cookie: 'synthetic-secret-cookie' } } });
    const res = response();
    try {
      await getTripAdvisorReviews({ query: {} } as never, res as never);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: expect.stringContaining('HTTP 403') });
      expect(JSON.stringify(log.mock.calls)).not.toContain('synthetic-secret-cookie');
    } finally { log.mockRestore(); }
  });
});
