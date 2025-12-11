import puppeteer, { Page } from 'puppeteer';

export type GetYourGuideReview = {
  reviewId?: string;
  name: string;
  location?: string;
  rating: number;
  comment: string;
  date?: string;
  avatarUrl?: string;
};

type GetYourGuideBlocksResponse = {
  content: Array<Record<string, any>>;
};

const DEFAULT_ENDPOINT =
  process.env.GYG_REVIEWS_ENDPOINT ??
  'https://travelers-api.getyourguide.com/user-interface/activity-details-page/blocks?ranking_uuid=2abbc102-010b-4c47-b440-376e2af70475';

const DEFAULT_ACTIVITY_ID = Number(process.env.GYG_ACTIVITY_ID ?? 443425);
const DEFAULT_RANKING_UUID = process.env.GYG_RANKING_UUID ?? '2abbc102-010b-4c47-b440-376e2af70475';
const DEFAULT_LIMIT = Number(process.env.GYG_REVIEWS_LIMIT ?? 30);
const PAGE_LIMIT = Number(process.env.GYG_PAGE_LIMIT ?? 10);

const SESSION_PRIMER_URL = process.env.GYG_SESSION_URL ?? 'https://www.getyourguide.com/';

const BROWSER_HEADERS = {
  accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
  'accept-language': 'en-US,en;q=0.9',
  'accept-encoding': 'gzip, deflate, br',
  'sec-ch-ua': '"Google Chrome";v="143", "Chromium";v="143", "Not A(Brand";v="24"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'none',
  'sec-fetch-user': '?1',
  'upgrade-insecure-requests': '1',
  'User-Agent':
    process.env.GYG_USER_AGENT ??
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
};

const createBrowserPage = async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  await page.setUserAgent(BROWSER_HEADERS['User-Agent']);
  await page.setExtraHTTPHeaders({
    accept: BROWSER_HEADERS.accept,
    'accept-language': BROWSER_HEADERS['accept-language'],
  });
  await page.goto(SESSION_PRIMER_URL, { waitUntil: 'networkidle2', timeout: 30000 });
  return { browser, page };
};

const CACHE_TTL_MS = Number(process.env.GYG_CACHE_TTL_MS ?? 5 * 60 * 1000);

type CacheEntry = {
  reviews: GetYourGuideReview[];
  fetchedAt: number;
};

let cachedReviews: CacheEntry | null = null;

const buildInitialPayload = () => ({
  events: [
    {
      event: {
        type: 'reviewsSortingSelected',
        emitterId: 'reviewsSortingFiltersContentIdentifier',
        payload: {
          value: 'date_desc',
        },
      },
    },
  ],
  payload: {
    activityId: DEFAULT_ACTIVITY_ID,
    templateName: 'ActivityDetails',
    contentIdentifier: 'reviewsSortingFiltersContentIdentifier',
    rankingUuid: DEFAULT_RANKING_UUID,
    additionalDetailsSelectedLanguage: 'en-US',
    participantsLanguage: 'en-US',
  },
});

const buildNextPayload = (payload: Record<string, any>) => ({
  payload,
});

const requestBlocks = async (page: Page, body: Record<string, any>) =>
  page.evaluate(
    async ({
      endpoint,
      payload,
    }: {
      endpoint: string;
      payload: Record<string, any>;
    }) => {
      const cookiePairs = document.cookie.split(';').map((entry) => entry.trim()).filter(Boolean);
      const cookieMap: Record<string, string> = {};
      cookiePairs.forEach((entry) => {
        const [key, ...valueParts] = entry.split('=');
        if (key) {
          cookieMap[key] = valueParts.join('=');
        }
      });

      const headers = new Headers({
        'content-type': 'application/json',
        accept: 'application/json, text/plain, */*',
        'accept-currency': cookieMap.cur ?? 'PLN',
        'accept-language': `${cookieMap.locale_code ?? 'en-US'},en;q=0.9`,
        'geo-ip-country': 'PL',
        'visitor-platform': 'desktop',
        'sec-ch-ua': '"Google Chrome";v="143", "Chromium";v="143", "Not A(Brand";v="24"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        priority: 'u=1, i',
        Referer: 'https://www.getyourguide.com/krawl-through-krakow-pubcrawl-s264786/',
        origin: 'https://www.getyourguide.com',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-site',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
        'partner-id': '',
        'x-gyg-app-type': 'Web',
        'x-gyg-geoip-city': 'Krakow',
        'x-gyg-geoip-country': 'PL',
        'x-gyg-is-new-visitor': 'false',
        'x-gyg-partner-hash': '',
        'x-gyg-referrer': 'https://www.getyourguide.com/',
        'x-gyg-time-zone': 'Europe/Warsaw',
      });

      if (cookieMap.visitor_id) {
        headers.set('visitor-id', cookieMap.visitor_id);
        headers.set('x-gyg-visitor-id', cookieMap.visitor_id);
      }
      if (cookieMap.csrfToken) {
        headers.set('x-gyg-csrf-token', cookieMap.csrfToken);
      }
      if (cookieMap.session_id) {
        headers.set('x-gyg-session-id', cookieMap.session_id);
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`GetYourGuide API ${response.status}: ${text.slice(0, 200)}`);
      }

      const data = (await response.json()) as GetYourGuideBlocksResponse;
      return data.content ?? [];
    },
    { endpoint: DEFAULT_ENDPOINT, payload: body },
  );

const parseAuthor = (title?: string) => {
  if (!title) return { name: 'GetYourGuide traveler', location: undefined };
  const parts = title.split('–').map((token) => token.trim());
  if (parts.length === 1) {
    return { name: parts[0], location: undefined };
  }
  return {
    name: parts[0],
    location: parts.slice(1).join(' – '),
  };
};

const extractReviews = (content: Array<Record<string, any>>): GetYourGuideReview[] =>
  content
    .filter((block) => block.type === 'review')
    .map((block) => {
      const authorTitle: string | undefined = block.author?.title?.text;
      const { name, location } = parseAuthor(authorTitle);
      const subtitle: string | undefined = block.author?.subtitle?.text;
      const dateFromSubtitle = subtitle?.split(' - ')?.[0]?.trim();
      const dateFromTracking: string | undefined = block.onImpressionTrackingEvent?.properties?.review_date;
      const isoDate = dateFromTracking ?? (dateFromSubtitle ? new Date(dateFromSubtitle).toISOString() : undefined);
      const avatarUrl: string | undefined = block.media?.[0]?.urls?.find((u: any) => u.size === 'thumb')?.url;
      return {
        reviewId: String(block.reviewId ?? block.id ?? `${name}-${isoDate ?? Date.now()}`),
        name,
        location,
        rating: Number(block.rating ?? 0),
        comment: block.message?.text ?? '',
        date: isoDate,
        avatarUrl,
      };
    });

const findLoadMorePayload = (content: Array<Record<string, any>>): Record<string, any> | undefined =>
  content.find((block) => block.type === 'loadMore')?.payload;

type ScrapeOptions = {
  forceRefresh?: boolean;
};

type ScrapeResult = {
  reviews: GetYourGuideReview[];
  fetchedAt: number;
  fromCache: boolean;
};

export const scrapeGetYourGuideReviews = async (
  options?: ScrapeOptions,
): Promise<ScrapeResult> => {
  const now = Date.now();
  if (!options?.forceRefresh && cachedReviews && now - cachedReviews.fetchedAt < CACHE_TTL_MS) {
    return {
      reviews: cachedReviews.reviews,
      fetchedAt: cachedReviews.fetchedAt,
      fromCache: true,
    };
  }

  const { browser, page } = await createBrowserPage();

  try {
    const reviews: GetYourGuideReview[] = [];
    let body: Record<string, any> | undefined = buildInitialPayload();
    let iterations = 0;

    while (body && reviews.length < DEFAULT_LIMIT && iterations < 10) {
      const content = await requestBlocks(page, body);
      reviews.push(...extractReviews(content));
      const loadMorePayload = findLoadMorePayload(content);

      if (!loadMorePayload || reviews.length >= DEFAULT_LIMIT) {
        break;
      }

      body = buildNextPayload({
        ...loadMorePayload,
        reviewsLimit: PAGE_LIMIT,
        selectedReviewsSortingOrder: 'date_desc',
        participantsLanguage: 'en-US',
      });
      iterations += 1;
    }

    const trimmed = reviews.slice(0, DEFAULT_LIMIT);
    cachedReviews = {
      reviews: trimmed,
      fetchedAt: Date.now(),
    };
    return {
      reviews: trimmed,
      fetchedAt: cachedReviews.fetchedAt,
      fromCache: false,
    };
  } finally {
    await browser.close();
  }
};
