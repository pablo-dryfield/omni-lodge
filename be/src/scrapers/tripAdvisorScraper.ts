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
  language?: string;
  originalLanguage?: string;
  translationType?: string | null;
  publishPlatform?: string;
  status?: string;
  helpfulVotes?: number;
  username?: string;
  locationId?: number;
  location?: {
    locationId?: number;
    name?: string;
    accommodationCategory?: string;
    placeType?: string;
  };
  userProfile?: {
    id?: string;
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
  totalCount?: number;
  reviews?: TripAdvisorApiReview[];
};

type TripAdvisorApiResponse = {
  data?: {
    ReviewsProxy_getReviewListPageForLocation?: TripAdvisorApiPage[];
    locations?: Array<{ reviewListPage?: TripAdvisorApiPage }>;
  };
};

const GRAPHQL_ENDPOINT = 'https://www.tripadvisor.com/data/graphql/ids';

const LOCATION_ID = Number(getConfigValue('TRIP_ADVISOR_LOCATION_ID') ?? 2725527);
export const TRIP_ADVISOR_PAGE_SIZE = Number(getConfigValue('TRIP_ADVISOR_PAGE_SIZE') ?? 20);
const LANGUAGE = (getConfigValue('TRIP_ADVISOR_LANGUAGE') as string | null) ?? 'en';
const DEFAULT_QUERY_ID = 'ef1a9f94012220d3';

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

const GRAPHQL_BODY_TEMPLATE = [
  {
    variables: {
      locationId: LOCATION_ID,
      filters: [] as Array<{ key: string; value: string }>,
      limit: TRIP_ADVISOR_PAGE_SIZE,
      offset: 0,
      sortType: null as string | null,
      sortBy: 'SERVER_DETERMINED',
      language: LANGUAGE,
      doMachineTranslation: false,
      photosPerReviewLimit: 7,
    },
    extensions: {
      preRegisteredQueryId: DEFAULT_QUERY_ID,
    },
  },
];

const clonePayload = () => JSON.parse(JSON.stringify(GRAPHQL_BODY_TEMPLATE)) as typeof GRAPHQL_BODY_TEMPLATE;

const requestTripAdvisorData = async (offset: number, queryId?: string) => {
  const body = clonePayload();
  body[0].variables.offset = offset;
  body[0].variables.limit = TRIP_ADVISOR_PAGE_SIZE;
  body[0].extensions.preRegisteredQueryId =
    queryId ?? (getConfigValue('TRIP_ADVISOR_QUERY_ID') as string | null) ?? DEFAULT_QUERY_ID;
  const requestedBy = randomUUID();
  return axios.post(GRAPHQL_ENDPOINT, body, {
    headers: {
      ...GRAPHQL_HEADERS,
      origin: 'https://www.tripadvisor.com',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/143.0.0.0 Safari/537.36',
      'x-requested-by': requestedBy,
      cookie: (getConfigValue('TRIP_ADVISOR_COOKIE') as string | null) ?? `TAUnique=${requestedBy}`,
    },
    timeout: 15000,
  });
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

  for (const candidate of candidates) {
    try {
      const response = await requestTripAdvisorData(0, candidate.queryId);
      const page = extractPage(response.data);
      const sampleCount = page.reviews?.length ?? 0;
      if (sampleCount > 0 && (page.totalCount ?? 0) > 0) {
        return { ...candidate, totalCount: page.totalCount ?? sampleCount, sampleCount };
      }
    } catch {
      // Try every discovered candidate and never save one that cannot return reviews.
    }
  }

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
  const createdDate = normalizeDate(review.createdDate);
  const publishedDate = normalizeDate(review.publishedDate);
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
    originalLanguage: review.originalLanguage,
    translationType: review.translationType ?? null,
    publishPlatform: review.publishPlatform,
    status: review.status,
    helpfulVotes: review.helpfulVotes,
    username: review.username,
    locationId: review.location?.locationId ?? review.locationId,
    locationName: review.location?.name,
    locationCategory: review.location?.accommodationCategory,
    locationPlaceType: review.location?.placeType,
    name: displayName || 'TripAdvisor guest',
    profilePhotoUrl: profileUrl,
    userProfileId: review.userProfile?.id,
  };
};

const extractPage = (response: unknown): TripAdvisorApiPage => {
  if (!Array.isArray(response)) return { totalCount: 0, reviews: [] };
  const page = (response as TripAdvisorApiResponse[]).map(item =>
    item?.data?.ReviewsProxy_getReviewListPageForLocation?.[0] ??
    item?.data?.locations?.[0]?.reviewListPage,
  ).find(Boolean) ?? ({} as TripAdvisorApiPage);
  return {
    totalCount: page?.totalCount ?? 0,
    reviews: page?.reviews ?? [],
  };
};

export const parseTripAdvisorResponse = (response: unknown): TripAdvisorReview[] => {
  const page = extractPage(response);
  return page.reviews?.map(normalizeReview) ?? [];
};

export const fetchTripAdvisorRaw = async (offset = 0) => {
  const resp = await requestTripAdvisorData(offset);
  const page = extractPage(resp.data);
  return {
    totalCount: page.totalCount ?? 0,
    reviews: (page.reviews ?? []).map(normalizeReview),
  };
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
