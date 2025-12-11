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
const MIN_LIMIT = Number(process.env.GYG_MIN_LIMIT ?? 20);
const MAX_LIMIT = Number(process.env.GYG_MAX_LIMIT ?? 150);
const CACHE_TTL_MS = Number(process.env.GYG_CACHE_TTL_MS ?? 5 * 60 * 1000);

const SESSION_PRIMER_URL = process.env.GYG_SESSION_URL ?? 'https://www.getyourguide.com/';
const SESSION_PRODUCT_URL =
  process.env.GYG_PRODUCT_URL ??
  'https://www.getyourguide.com/krawl-through-krakow-pubcrawl-s264786/';

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
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    if (['image', 'stylesheet', 'font', 'media'].includes(request.resourceType())) {
      request.abort().catch(() => {});
      return;
    }
    request.continue().catch(() => {});
  });
  await page.setUserAgent(BROWSER_HEADERS['User-Agent']);
  await page.setExtraHTTPHeaders({
    accept: BROWSER_HEADERS.accept,
    'accept-language': BROWSER_HEADERS['accept-language'],
  });
  await page.goto(SESSION_PRIMER_URL, { waitUntil: 'networkidle2', timeout: 30000 });
  try {
    await page.goto(SESSION_PRODUCT_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  } catch (error) {
    // ignore, we'll still attempt requests with whatever cookies we have
    console.warn('[getyourguide] Unable to load product page for session priming', error);
  }
  await page.setRequestInterception(false);
  return { browser, page };
};

type CacheEntry = {
  reviews: GetYourGuideReview[];
  fetchedAt: number;
};

const cacheByLimit: Record<number, CacheEntry> = {};

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

const requestBlocks = async (page: Page, body: Record<string, any>) => {
  const cookies = await page.cookies();
  const cookieMap: Record<string, string> = {};
  cookies.forEach((cookie) => {
    if (cookie?.name) {
      cookieMap[cookie.name] = cookie.value ?? '';
    }
  });

  const getCookieValue = (name: string): string | undefined => {
    const variants = [name, name.replace(/-/g, '_'), name.replace(/_/g, '-')];
    for (const variant of variants) {
      if (cookieMap[variant]) {
        return cookieMap[variant];
      }
    }
    return undefined;
  };

  const headersData = {
    acceptCurrency: cookieMap.cur ?? 'PLN',
    acceptLanguage: `${cookieMap.locale_code ?? 'en-US'},en;q=0.9`,
    visitorId: getCookieValue('visitor-id') ?? getCookieValue('visitor_id'),
    csrfToken: getCookieValue('csrfToken') ?? getCookieValue('csrf-token'),
    sessionId: getCookieValue('session-id'),
  };

  return page.evaluate(
    async ({
      endpoint,
      payload,
      headersData: innerHeaders,
    }: {
      endpoint: string;
      payload: Record<string, any>;
      headersData: {
        acceptCurrency?: string;
        acceptLanguage?: string;
        visitorId?: string;
        csrfToken?: string;
        sessionId?: string;
      };
    }) => {
      const headers = new Headers({
        'content-type': 'application/json',
        accept: 'application/json, text/plain, */*',
        'accept-currency': innerHeaders.acceptCurrency ?? 'PLN',
        'accept-language': innerHeaders.acceptLanguage ?? 'en-US,en;q=0.9',
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

      if (innerHeaders.visitorId) {
        headers.set('visitor-id', innerHeaders.visitorId);
        headers.set('x-gyg-visitor-id', innerHeaders.visitorId);
      }
      if (innerHeaders.csrfToken) {
        headers.set('x-gyg-csrf-token', innerHeaders.csrfToken);
      }
      if (innerHeaders.sessionId) {
        headers.set('x-gyg-session-id', innerHeaders.sessionId);
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        credentials: 'include',
        mode: 'cors',
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`GetYourGuide API ${response.status}: ${text.slice(0, 200)}`);
      }

      const data = (await response.json()) as GetYourGuideBlocksResponse;
      return data.content ?? [];
    },
    { endpoint: DEFAULT_ENDPOINT, payload: body, headersData },
  );
};

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
  limit?: number;
};

type ScrapeResult = {
  reviews: GetYourGuideReview[];
  fetchedAt: number;
  fromCache: boolean;
  limit: number;
};

export const scrapeGetYourGuideReviews = async (
  options?: ScrapeOptions,
): Promise<ScrapeResult> => {
  const requestedLimit = options?.limit ?? DEFAULT_LIMIT;
  const normalizedLimit = Math.max(MIN_LIMIT, Math.min(MAX_LIMIT, requestedLimit));
  const now = Date.now();
  const cachedEntry = cacheByLimit[normalizedLimit];
  if (!options?.forceRefresh && cachedEntry && now - cachedEntry.fetchedAt < CACHE_TTL_MS) {
    return {
      reviews: cachedEntry.reviews,
      fetchedAt: cachedEntry.fetchedAt,
      fromCache: true,
      limit: normalizedLimit,
    };
  }

  const { browser, page } = await createBrowserPage();

  try {
    const reviews: GetYourGuideReview[] = [];
    let body: Record<string, any> | undefined = buildInitialPayload();
    let iterations = 0;

    while (body && reviews.length < normalizedLimit && iterations < 10) {
      const content = await requestBlocks(page, body);
      reviews.push(...extractReviews(content));
      const loadMorePayload = findLoadMorePayload(content);

      if (!loadMorePayload || reviews.length >= normalizedLimit) {
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

    const trimmed = reviews.slice(0, normalizedLimit);
    cacheByLimit[normalizedLimit] = {
      reviews: trimmed,
      fetchedAt: Date.now(),
    };
    return {
      reviews: trimmed,
      fetchedAt: cacheByLimit[normalizedLimit].fetchedAt,
      fromCache: false,
      limit: normalizedLimit,
    };
  } finally {
    await browser.close();
  }
};
