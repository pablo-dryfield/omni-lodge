import axios from 'axios';
import { randomUUID } from 'node:crypto';
import { getConfigValue } from '../services/configService.js';

export type TripAdvisorReview = {
  channel: string;
  name?: string;
  title?: string;
  description?: string;
  score?: number;
  /** Backwards-compatible ISO date (defaults to published date when available). */
  date?: string;
  createdDate?: string;
  publishedDate?: string;
  language?: string;
  originalLanguage?: string;
  translationType?: string | null;
  publishPlatform?: string;
  status?: string;
  helpfulVotes?: number;
  username?: string;
  locationId?: number;
  locationName?: string;
  locationCategory?: string;
  locationPlaceType?: string;
  reviewId?: string;
  profilePhotoUrl?: string;
  userProfileId?: string;
};

type TripAdvisorApiReview = {
  id?: number;
  title?: string;
  text?: string;
  rating?: number;
  createdDate?: string;
  publishedDate?: string;
  submittedDateTime?: string;
  language?: string;
  originalLanguage?: string;
  translationType?: string | null;
  publishPlatform?: string;
  status?: string;
  helpfulVotes?: number;
  username?: string;
  locationId?: number;
  translationInfo?: { originalLanguage?: string; translationType?: string | null };
  locationNode?: { detail?: { info?: { localizedName?: string; placeType?: string } } };
  location?: {
    locationId?: number;
    name?: string;
    accommodationCategory?: string;
    placeType?: string;
  };
  userProfile?: {
    id?: string;
    userId?: string;
    displayName?: string;
    username?: string;
    avatar?: {
      data?: {
        photoSizeDynamic?: {
          urlTemplate?: string;
        };
      };
    };
  };
};

type TripAdvisorApiPage = {
  totalCount: number;
  reviews: TripAdvisorApiReview[];
};

type TripAdvisorApiError = {
  message?: string;
};

type TripAdvisorApiResponse = {
  errors?: TripAdvisorApiError[];
  data?: {
    ReviewsProxy_getPublishedReviewsForLocation?: Array<{ error?: unknown; result?: TripAdvisorApiPage }>;
    ReviewsProxy_getReviewListPageForLocation?: TripAdvisorApiPage[];
    locations?: Array<{ reviewListPage?: TripAdvisorApiPage }>;
  };
};

const GRAPHQL_ENDPOINT = 'https://www.tripadvisor.com/data/graphql/ids';

export const TRIP_ADVISOR_PAGE_SIZE = Number(getConfigValue('TRIP_ADVISOR_PAGE_SIZE') ?? 20);
// Public persisted-query identifier captured from the reviews request on 2026-10-19.
const DEFAULT_QUERY_ID = '1eeac11193438f8a';

const GRAPHQL_HEADERS = {
  accept: '*/*',
  'accept-language': 'en-US,en;q=0.9',
  'content-type': 'application/json',
  priority: 'u=1, i',
  'sec-ch-device-memory': '8',
  'sec-ch-ua': '"Google Chrome";v="143", "Chromium";v="143", "Not A(Brand";v="24"',
  'sec-ch-ua-arch': '"x86"',
  'sec-ch-ua-full-version-list': '"Google Chrome";v="143.0.7499.41", "Chromium";v="143.0.7499.41", "Not A(Brand";v="24.0.0.0"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-model': '""',
  'sec-ch-ua-platform': '"Windows"',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'same-origin',
  'sec-fetch-site': 'same-origin',
  Referer:
    (getConfigValue('TRIP_ADVISOR_REFERER') as string | null) ??
    'https://www.tripadvisor.com/Attraction_Review-g274772-d2725527-Reviews-Krawl_Through_Krakow_Pub_Crawl-Krakow_Lesser_Poland_Province_Southern_Poland.html',
};

export const buildTripAdvisorRequestPayload = (offset = 0, queryId?: string) => {
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('TripAdvisor review offset must be a non-negative integer.');
  const language = String(getConfigValue('TRIP_ADVISOR_LANGUAGE') ?? 'en').trim() || 'en';
  const locationId = Number(getConfigValue('TRIP_ADVISOR_LOCATION_ID') ?? 2725527);
  const limit = Number(getConfigValue('TRIP_ADVISOR_PAGE_SIZE') ?? 20);
  if (!Number.isSafeInteger(locationId) || locationId <= 0 || !Number.isSafeInteger(limit) || limit <= 0) {
    throw new Error('TripAdvisor location ID and page size must be positive integers.');
  }
  return [{
    variables: {
      clientId: 'ATTRACTION_DETAIL_LIST',
      locationId,
      limit,
      offset,
      sortBy: 'SERVER_DETERMINED',
      filterOptions: { language: { languageTag: language } },
      locale: language === 'en' ? 'en-US' : language,
    },
    extensions: {
      preRegisteredQueryId: queryId ?? (getConfigValue('TRIP_ADVISOR_QUERY_ID') as string | null) ?? DEFAULT_QUERY_ID,
    },
  }];
};

const requestTripAdvisorData = async (offset: number, queryId?: string) => {
  const body = buildTripAdvisorRequestPayload(offset, queryId);
  const requestedBy = randomUUID();
  try {
    return await axios.post(GRAPHQL_ENDPOINT, body, {
      headers: {
        ...GRAPHQL_HEADERS,
        Referer: (getConfigValue('TRIP_ADVISOR_REFERER') as string | null) ?? GRAPHQL_HEADERS.Referer,
        origin: 'https://www.tripadvisor.com',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/143.0.0.0 Safari/537.36',
        'x-requested-by': requestedBy,
        cookie: (getConfigValue('TRIP_ADVISOR_COOKIE') as string | null) ?? `TAUnique=${requestedBy}`,
      },
      timeout: 15000,
    });
  } catch (error) {
    // All callers, including exports/scheduled sync, must receive a cookie-safe error.
    throw new Error(describeTripAdvisorError(error));
  }
};

const extractQueryIds = (content: string): string[] => {
  const ids = new Set<string>();
  for (const match of content.matchAll(/preRegisteredQueryId["']?\s*[:=]\s*["']([a-f0-9]{16})["']/gi)) {
    ids.add(match[1]);
  }
  for (const match of content.matchAll(/(?:AttractionQueryID|HotelQueryID)\s+(?:string\s+)?=\s*["']([a-f0-9]{16})["']/gi)) {
    ids.add(match[1]);
  }
  return [...ids];
};

export const discoverTripAdvisorQueryId = async (): Promise<{
  queryId: string;
  source: string;
  totalCount: number;
  sampleCount: number;
}> => {
  const candidates: Array<{ queryId: string; source: string }> = [];
  const seen = new Set<string>();
  const addCandidates = (content: string, source: string) => {
    for (const queryId of extractQueryIds(content)) {
      if (!seen.has(queryId)) {
        seen.add(queryId);
        candidates.push({ queryId, source });
      }
    }
  };

  const validateCandidates = async () => {
    while (candidates.length > 0) {
      const candidate = candidates.shift()!;
      try {
        const response = await requestTripAdvisorData(0, candidate.queryId);
        const page = extractPage(response.data);
        const sampleCount = page.reviews.map(normalizeReview).length;
        if (sampleCount > 0 && page.totalCount > 0) {
          return { ...candidate, totalCount: page.totalCount, sampleCount };
        }
      } catch {
        // Never save an ID whose request, response, or review records fail validation.
      }
    }
    return null;
  };
  addCandidates(`preRegisteredQueryId: "${getConfigValue('TRIP_ADVISOR_QUERY_ID') ?? ''}"`, 'Configured reviews query');
  addCandidates(`preRegisteredQueryId: "${DEFAULT_QUERY_ID}"`, 'Captured published-reviews query (2026-10-19)');
  const known = await validateCandidates();
  if (known) return known;

  const referer = (getConfigValue('TRIP_ADVISOR_REFERER') as string | null) ?? GRAPHQL_HEADERS.Referer;
  try {
    const page = await axios.get<string>(referer, {
      headers: { 'user-agent': GRAPHQL_HEADERS['sec-ch-ua'], accept: 'text/html' },
      timeout: 15000,
    });
    addCandidates(String(page.data), 'TripAdvisor listing page');
  } catch {
    // TripAdvisor frequently challenges server-side page requests; continue to the maintained public fallback.
  }

  try {
    const publicSource = await axios.get<string>(
      'https://raw.githubusercontent.com/algo7/TripAdvisor-Review-Scraper/main/scraper/pkg/tripadvisor/models.go',
      { timeout: 15000 },
    );
    addCandidates(String(publicSource.data), 'TripAdvisor Review Scraper public query registry');
  } catch {
    // Validation below will provide a useful error if no candidates were discoverable.
  }

  const discovered = await validateCandidates();
  if (discovered) return discovered;

  throw new Error('No working TripAdvisor reviews query ID could be discovered and validated.');
};

const extractPhotoUrl = (template?: string): string | undefined => {
  if (!template) return undefined;
  return template.replace('{width}', '100').replace('{height}', '100');
};

const normalizeDate = (date?: string): string | undefined => {
  if (!date) return undefined;
  const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T00:00:00Z` : date);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
};

const normalizeReview = (review: TripAdvisorApiReview): TripAdvisorReview => {
  const profileUrl = extractPhotoUrl(review.userProfile?.avatar?.data?.photoSizeDynamic?.urlTemplate);
  const createdDate = normalizeDate(review.createdDate) ?? normalizeDate(review.submittedDateTime);
  const publishedDate = normalizeDate(review.publishedDate);
  if (!review.id || !/^\d+$/.test(String(review.id))) throw new Error('TripAdvisor returned a review without a stable ID.');
  if (!createdDate && !publishedDate) throw new Error('TripAdvisor returned a review without a valid source date.');
  const displayName =
    review.userProfile?.displayName?.trim() ||
    review.userProfile?.username?.trim() ||
    review.username?.trim();
  return {
    channel: 'Tripadvisor',
    reviewId: review.id?.toString(),
    title: review.title ?? '',
    description: review.text ?? '',
    score: review.rating,
    date: publishedDate ?? createdDate,
    createdDate,
    publishedDate,
    language: review.language,
    originalLanguage: review.originalLanguage ?? review.translationInfo?.originalLanguage,
    translationType: review.translationType ?? review.translationInfo?.translationType ?? null,
    publishPlatform: review.publishPlatform,
    status: review.status,
    helpfulVotes: review.helpfulVotes,
    username: review.username ?? review.userProfile?.username,
    locationId: review.location?.locationId ?? review.locationId,
    locationName: review.location?.name ?? review.locationNode?.detail?.info?.localizedName,
    locationCategory: review.location?.accommodationCategory,
    locationPlaceType: review.location?.placeType ?? review.locationNode?.detail?.info?.placeType,
    name: displayName || 'TripAdvisor guest',
    profilePhotoUrl: profileUrl,
    userProfileId: review.userProfile?.id ?? review.userProfile?.userId,
  };
};

const extractPage = (response: unknown): TripAdvisorApiPage => {
  if (!Array.isArray(response)) throw new Error('TripAdvisor returned an unrecognized reviews response.');
  const errors = (response as TripAdvisorApiResponse[])
    .flatMap((item) => Array.isArray(item?.errors) ? item.errors : [])
    .map((error) => error?.message?.trim())
    .filter((message): message is string => Boolean(message));
  if (errors.length > 0) {
    throw new Error(`TripAdvisor GraphQL error: ${errors.join('; ')}`);
  }
  const page = (response as TripAdvisorApiResponse[]).map(item => {
    const published = item?.data?.ReviewsProxy_getPublishedReviewsForLocation?.[0];
    if (published?.error != null) throw new Error('TripAdvisor reviews endpoint returned an application error.');
    return published?.result ?? item?.data?.ReviewsProxy_getReviewListPageForLocation?.[0]
      ?? item?.data?.locations?.[0]?.reviewListPage;
  }).find(Boolean);
  if (!page || !Number.isSafeInteger(page.totalCount) || page.totalCount < 0 || !Array.isArray(page.reviews)) {
    throw new Error('TripAdvisor returned an unrecognized reviews response.');
  }
  return page;
};

export const parseTripAdvisorResponse = (response: unknown): TripAdvisorReview[] => {
  const page = extractPage(response);
  return page.reviews?.map(normalizeReview) ?? [];
};

export const fetchTripAdvisorRaw = async (offset = 0) => {
  const resp = await requestTripAdvisorData(offset);
  const page = extractPage(resp.data);
  if (page.reviews.length === 0 && offset < page.totalCount) {
    throw new Error('TripAdvisor returned an empty page before the reported end of the reviews. Sync was stopped to protect the archive.');
  }
  return {
    totalCount: page.totalCount ?? 0,
    reviews: (page.reviews ?? []).map(normalizeReview),
  };
};

export const describeTripAdvisorError = (error: unknown): string => {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    return status === 401 || status === 403
      ? `TripAdvisor rejected the request (HTTP ${status}). Check the TripAdvisor cookie and server access.`
      : `TripAdvisor request failed${status ? ` (HTTP ${status})` : ''}. Please try again later.`;
  }
  return error instanceof Error ? error.message.slice(0, 600) : 'Unknown TripAdvisor review error.';
};

export const scrapeTripAdvisor = async (offsets: number[] = [0]): Promise<TripAdvisorReview[]> => {
  const aggregated: TripAdvisorReview[] = [];
  const seen = new Set<string>();

  for (const offset of offsets) {
    try {
      const page = await fetchTripAdvisorRaw(offset);
      const normalized = page.reviews ?? [];
      normalized.forEach((review) => {
        const key = review.reviewId ?? `${review.name}-${review.title}`;
        if (!seen.has(key)) {
          seen.add(key);
          aggregated.push(review);
        }
      });
      if (!normalized.length) {
        break;
      }
    } catch (error) {
      console.error('Error scraping TripAdvisor:', error);
      break;
    }
  }

  return aggregated;
};
