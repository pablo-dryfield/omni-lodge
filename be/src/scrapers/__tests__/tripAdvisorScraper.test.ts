import { parseTripAdvisorResponse } from '../tripAdvisorScraper.js';

describe('TripAdvisor scraper response parsing', () => {
  it('fails closed when TripAdvisor returns GraphQL errors', () => {
    expect(() => parseTripAdvisorResponse([
      { errors: [{ message: 'PersistedQueryNotFound' }] },
    ])).toThrow('TripAdvisor GraphQL error: PersistedQueryNotFound');
  });

  it('normalizes reviews when TripAdvisor returns a valid review page', () => {
    const reviews = parseTripAdvisorResponse([
      {
        data: {
          ReviewsProxy_getReviewListPageForLocation: [{
            totalCount: 1,
            reviews: [{
              id: 123,
              title: 'Great night',
              text: 'A lot of fun',
              rating: 5,
              publishedDate: '2026-10-01',
              userProfile: { displayName: 'Pablo' },
            }],
          }],
        },
      },
    ]);

    expect(reviews).toEqual([expect.objectContaining({
      reviewId: '123',
      title: 'Great night',
      description: 'A lot of fun',
      score: 5,
      name: 'Pablo',
    })]);
  });
});
