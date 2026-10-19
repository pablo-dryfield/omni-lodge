import axios from 'axios';
import { getConfigValue } from '../../services/configService.js';
import {
  buildTripAdvisorRequestPayload,
  describeTripAdvisorError,
  discoverTripAdvisorQueryId,
  fetchTripAdvisorRaw,
  parseTripAdvisorResponse,
} from '../tripAdvisorScraper.js';

jest.mock('axios');
jest.mock('../../services/configService.js', () => ({ getConfigValue: jest.fn() }));

const queryId = '1eeac11193438f8a';
// Synthetic records mirror the captured wire format without storing customer data.
const publishedResponse = () => [{ data: {
  ReviewsProxy_getPublishedReviewsForLocation: [{ error: null, result: {
    totalCount: 3038,
    sortBy: 'MOST_RECENT',
    reviews: [{
      id: 123,
      title: 'A synthetic review',
      text: 'An enjoyable evening',
      rating: 5,
      submittedDateTime: '2026-09-22T17:07:37.817Z',
      language: 'en',
      translationInfo: { translationType: 'MACHINE', originalLanguage: 'it' },
      locationId: 13998447,
      locationNode: { detail: { info: { localizedName: 'Example activity', placeType: 'ACTIVITY' } } },
      userProfile: {
        userId: 'synthetic-profile-id', displayName: 'Example reviewer', username: 'example',
        avatar: { data: { photoSizeDynamic: { urlTemplate: 'https://example.com/photo?w={width}&h={height}' } } },
      },
    }],
  } }],
} }, { data: { urls: [{ webLinkUrl: '/unrelated-pagination-url' }] } }];

let config: Record<string, unknown>;
beforeEach(() => {
  jest.resetAllMocks();
  config = {};
  jest.mocked(getConfigValue).mockImplementation((key) => config[key] ?? null);
});

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

  it('reads published reviews from a batched response and preserves source dates and identities', () => {
    expect(parseTripAdvisorResponse(publishedResponse())).toEqual([expect.objectContaining({
      reviewId: '123', title: 'A synthetic review', description: 'An enjoyable evening', score: 5,
      name: 'Example reviewer', username: 'example', userProfileId: 'synthetic-profile-id',
      date: '2026-09-22T17:07:37.817Z', createdDate: '2026-09-22T17:07:37.817Z', publishedDate: undefined,
      originalLanguage: 'it', translationType: 'MACHINE', locationId: 13998447,
      locationName: 'Example activity', locationPlaceType: 'ACTIVITY',
      profilePhotoUrl: 'https://example.com/photo?w=100&h=100',
    })]);
  });

  it('retains the legacy locations response and its publication date', () => {
    const reviews = parseTripAdvisorResponse([{ data: { locations: [{ reviewListPage: {
      totalCount: 1, reviews: [{ id: 123, createdDate: '2026-09-22', publishedDate: '2026-09-23' }],
    } }] } }]);
    expect(reviews[0].date).toBe('2026-09-23T00:00:00.000Z');
    expect(reviews[0].createdDate).toBe('2026-09-22T00:00:00.000Z');
  });

  it.each([null, {}, [], '<html>challenge</html>', [{ data: { urls: [] } }],
    [{ data: { ReviewsProxy_getPublishedReviewsForLocation: [{ result: { totalCount: 3038 } }] } }],
  ])('fails closed on an unsupported or malformed response rather than reporting an empty archive: %j', (response) => {
    expect(() => parseTripAdvisorResponse(response)).toThrow('unrecognized reviews response');
  });

  it('rejects nested application errors even when GraphQL returns HTTP 200', () => {
    expect(() => parseTripAdvisorResponse([{ data: { ReviewsProxy_getPublishedReviewsForLocation: [
      { error: { code: 'NOT_AVAILABLE' }, result: null },
    ] } }])).toThrow('application error');
  });

  it('never invents a current date or unstable ID for malformed source records', () => {
    const response = publishedResponse();
    const review = response[0].data.ReviewsProxy_getPublishedReviewsForLocation![0].result.reviews[0];
    review.submittedDateTime = 'invalid';
    expect(() => parseTripAdvisorResponse(response)).toThrow('valid source date');
    review.submittedDateTime = '2026-09-22T17:07:37.817Z';
    review.id = 0;
    expect(() => parseTripAdvisorResponse(response)).toThrow('stable ID');
  });
});

describe('TripAdvisor published-reviews requests', () => {
  it('matches the captured review request and sends no routing/advertising query', () => {
    config.TRIP_ADVISOR_PAGE_SIZE = 10;
    expect(buildTripAdvisorRequestPayload(10)).toEqual([{
      variables: { clientId: 'ATTRACTION_DETAIL_LIST', locationId: 2725527, sortBy: 'SERVER_DETERMINED',
        limit: 10, offset: 10, filterOptions: { language: { languageTag: 'en' } }, locale: 'en-US' },
      extensions: { preRegisteredQueryId: queryId },
    }]);
  });

  it('reads configuration per request, starts at offset zero, and does not mutate earlier payloads', () => {
    const first = buildTripAdvisorRequestPayload();
    config.TRIP_ADVISOR_LOCATION_ID = 456;
    config.TRIP_ADVISOR_LANGUAGE = 'pl';
    config.TRIP_ADVISOR_QUERY_ID = 'abcdef1234567890';
    const next = buildTripAdvisorRequestPayload(20);
    expect(first[0].variables.offset).toBe(0);
    expect(first[0].variables.locationId).toBe(2725527);
    expect(next[0].variables).toMatchObject({ locationId: 456, offset: 20, locale: 'pl', filterOptions: { language: { languageTag: 'pl' } } });
    expect(next[0].extensions.preRegisteredQueryId).toBe('abcdef1234567890');
  });

  it.each([-1, 0.5, NaN])('rejects invalid pagination offsets: %s', (offset) => {
    expect(() => buildTripAdvisorRequestPayload(offset)).toThrow('non-negative integer');
  });

  it('keeps source totals and advances by the actual returned page length', async () => {
    jest.mocked(axios.post).mockResolvedValue({ data: publishedResponse() });
    const page = await fetchTripAdvisorRaw(10);
    expect(page.totalCount).toBe(3038);
    expect(page.reviews).toHaveLength(1);
    expect(jest.mocked(axios.post).mock.calls[0][1]).toEqual(buildTripAdvisorRequestPayload(10));
  });

  it('rejects an empty page before the reported total, but permits a genuine end', async () => {
    const response = [{ data: { ReviewsProxy_getPublishedReviewsForLocation: [{ error: null, result: { totalCount: 10, reviews: [] } }] } }];
    jest.mocked(axios.post).mockResolvedValue({ data: response });
    await expect(fetchTripAdvisorRaw(0)).rejects.toThrow('empty page before');
    await expect(fetchTripAdvisorRaw(10)).resolves.toMatchObject({ totalCount: 10, reviews: [] });
  });

  it('validates the captured candidate after a configured advertising ID fails, without requiring public registries', async () => {
    config.TRIP_ADVISOR_QUERY_ID = '928136d2240e1ed3';
    jest.mocked(axios.post)
      .mockResolvedValueOnce({ data: [{ errors: [{ message: 'Variable $page was not provided' }] }] })
      .mockResolvedValueOnce({ data: publishedResponse() });
    await expect(discoverTripAdvisorQueryId()).resolves.toMatchObject({ queryId, totalCount: 3038, sampleCount: 1 });
    expect(axios.get).not.toHaveBeenCalled();
    expect(jest.mocked(axios.post).mock.calls.map((call) => (call[1] as ReturnType<typeof buildTripAdvisorRequestPayload>)[0].extensions.preRegisteredQueryId))
      .toEqual(['928136d2240e1ed3', queryId]);
  });

  it('does not validate IDs that return no reviews or an unrelated response', async () => {
    jest.mocked(axios.post).mockResolvedValue({ data: [{ data: { urls: [] } }] });
    jest.mocked(axios.get).mockRejectedValue(new Error('Unavailable'));
    await expect(discoverTripAdvisorQueryId()).rejects.toThrow('No working TripAdvisor reviews query ID');
  });

  it('formats access failures without exposing Axios request headers', () => {
    jest.mocked(axios.isAxiosError).mockReturnValue(true);
    const error = { response: { status: 403 }, config: { headers: { cookie: 'synthetic-cookie-do-not-log' } } };
    expect(describeTripAdvisorError(error)).toContain('HTTP 403');
    expect(describeTripAdvisorError(error)).not.toContain('synthetic-cookie');
  });
});
