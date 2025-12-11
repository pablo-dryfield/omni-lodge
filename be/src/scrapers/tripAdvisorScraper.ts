import axios from 'axios';

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

const GRAPHQL_ENDPOINT = 'https://www.tripadvisor.com/data/graphql/ids';

const LOCATION_ID = Number.parseInt(process.env.TRIP_ADVISOR_LOCATION_ID ?? '2725527', 10);
export const TRIP_ADVISOR_PAGE_SIZE = Number.parseInt(process.env.TRIP_ADVISOR_PAGE_SIZE ?? '20', 10);
const LANGUAGE = process.env.TRIP_ADVISOR_LANGUAGE ?? 'en';

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
  cookie:
    process.env.TRIP_ADVISOR_COOKIE ??
    'TAUnique=%1%enc%3AfP3UWefxDLGshPonIpy3mbk%2FIgjcWHKTsHpRcTPjgwDrPpCRcPmdOp0gqPK3zLEENox8JbUSTxk%3D',
  Referer:
    process.env.TRIP_ADVISOR_REFERER ??
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
      preRegisteredQueryId: '00005812efce572c',
    },
  },
];

const clonePayload = () => JSON.parse(JSON.stringify(GRAPHQL_BODY_TEMPLATE)) as typeof GRAPHQL_BODY_TEMPLATE;

const requestTripAdvisorData = async (offset: number) => {
  const body = clonePayload();
  body[0].variables.offset = offset;
  body[0].variables.limit = TRIP_ADVISOR_PAGE_SIZE;
  return axios.post(GRAPHQL_ENDPOINT, body, { headers: GRAPHQL_HEADERS, timeout: 15000 });
};

const extractPhotoUrl = (template?: string): string | undefined => {
  if (!template) return undefined;
  return template.replace('{width}', '100').replace('{height}', '100');
};

const normalizeDate = (date?: string): string | undefined => {
  if (!date) return undefined;
  const iso = new Date(`${date}T00:00:00Z`).toISOString();
  return iso;
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
  const page =
    response[0]?.data?.ReviewsProxy_getReviewListPageForLocation?.[0] ??
    ({} as TripAdvisorApiPage);
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
