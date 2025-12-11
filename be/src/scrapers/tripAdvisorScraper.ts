import axios from 'axios';

export type TripAdvisorReview = {
  channel: string;
  name?: string;
  title?: string;
  description?: string;
  score?: number;
  date?: string;
  reviewId?: string;
  profilePhotoUrl?: string;
};

type TripAdvisorGraphQLCard = Record<string, unknown> & {
  __typename?: string;
  bubbleRatingNumber?: number;
  bubbleRatingText?: { text?: string };
  cardTitle?: { text?: string };
  cardText?: { text?: string };
  cardSubtitle?: { text?: string };
  translation?: { text?: string };
  publishDate?: { text?: string };
  cardLink?: {
    trackingContext?: string;
    webRoute?: {
      typedParams?: {
        webLinkUrl?: string;
      };
    };
  };
  authorCard?: Record<string, unknown> & {
    displayName?: { text?: string };
  };
};

const GRAPHQL_ENDPOINT =
  process.env.TRIP_ADVISOR_GRAPHQL_ENDPOINT ?? 'https://www.tripadvisor.com/data/graphql/ids';
const PERSISTED_QUERY_HASH = process.env.TRIP_ADVISOR_PERSISTED_QUERY_HASH;
const OPERATION_NAME = process.env.TRIP_ADVISOR_OPERATION_NAME ?? 'Trek609669';
const COOKIE = process.env.TRIP_ADVISOR_COOKIE ?? '';
const USER_AGENT =
  process.env.TRIP_ADVISOR_USER_AGENT ??
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';
const ACCEPT_LANGUAGE = process.env.TRIP_ADVISOR_ACCEPT_LANGUAGE ?? 'en-US,en;q=0.9';
const LOCALE = process.env.TRIP_ADVISOR_LOCALE ?? 'en-US';
const CURRENCY = process.env.TRIP_ADVISOR_CURRENCY ?? 'USD';
const MAX_REVIEWS = Number.parseInt(process.env.TRIP_ADVISOR_MAX_REVIEWS ?? '30', 10);
const PAGE_SIZE = Number.parseInt(process.env.TRIP_ADVISOR_PAGE_SIZE ?? '10', 10);

type ParsedTripAdvisorUrl = {
  pageName: string;
  geoId: string;
  detailId: string;
};

const sanitizeNumber = (value?: string | null): string => (value ? value.replace(/[^0-9]/g, '') : '');

const parseTripAdvisorUrl = (targetUrl: string): ParsedTripAdvisorUrl => {
  const parsed = new URL(targetUrl);
  const parts = parsed.pathname.split('/').filter(Boolean);
  if (!parts.length) {
    throw new Error('TripAdvisor URL missing path segments');
  }

  const pageSegment = parts[0];
  const pageName = pageSegment.split('-')[0] ?? 'AttractionProductReview';
  const geoMatch = parsed.pathname.match(/-g(\d+)/i);
  const detailMatch = parsed.pathname.match(/-d(\d+)/i);

  const geoId = sanitizeNumber(geoMatch?.[1]);
  const detailId = sanitizeNumber(detailMatch?.[1]);

  if (!geoId || !detailId) {
    throw new Error('Unable to extract geoId/detailId from TripAdvisor URL');
  }

  return { pageName, geoId, detailId };
};

const buildGraphQLPayload = ({
  pageName,
  geoId,
  detailId,
  offset,
}: ParsedTripAdvisorUrl & { offset: number }) => [
  {
    operationName: OPERATION_NAME,
    variables: {
      f: {
        page: pageName,
        pos: LOCALE,
        currencyCode: CURRENCY,
        route: {
          page: pageName,
          params: {
            geoId,
            detailId,
            offset: offset.toString(),
          },
        },
        parameters: [
          { key: 'geoId', value: geoId },
          { key: 'detailId', value: detailId },
          { key: 'offset', value: offset.toString() },
        ],
        factors: ['TITLE', 'META_DESCRIPTION', 'MASTHEAD_H1', 'MAIN_H1', 'IS_INDEXABLE', 'RELCANONICAL'],
      },
    },
    extensions: {
      persistedQuery: {
        version: 1,
        sha256Hash: PERSISTED_QUERY_HASH,
      },
    },
  },
];

const defaultHeaders = (referer: string) => ({
  'Content-Type': 'application/json',
  Accept: '*/*',
  'Accept-Language': ACCEPT_LANGUAGE,
  Origin: 'https://www.tripadvisor.com',
  Referer: referer,
  'User-Agent': USER_AGENT,
  ...(COOKIE ? { Cookie: COOKIE } : {}),
});

const traverseForReviewCards = (node: unknown, acc: TripAdvisorGraphQLCard[], seen: WeakSet<object>) => {
  if (!node) return;

  if (Array.isArray(node)) {
    node.forEach((child) => traverseForReviewCards(child, acc, seen));
    return;
  }

  if (typeof node === 'object') {
    if (seen.has(node)) {
      return;
    }
    seen.add(node);

    const typed = node as TripAdvisorGraphQLCard;
    if (typed.__typename === 'WebPresentation_ReviewCardWeb') {
      acc.push(typed);
    }

    Object.values(typed).forEach((value) => traverseForReviewCards(value, acc, seen));
  }
};

const pickText = (...values: Array<string | { text?: string } | undefined>): string | undefined => {
  for (const value of values) {
    if (!value) continue;
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
    if (typeof value === 'object' && typeof value.text === 'string' && value.text.trim()) {
      return value.text.trim();
    }
  }
  return undefined;
};

const parseReviewDate = (raw?: string): string | undefined => {
  if (!raw) return undefined;
  const sanitized = raw.replace(/•/g, ' ').replace(/\s+/g, ' ').trim();
  const normalized = sanitized.replace(/^(Written|Reviewed)\s+/i, '').trim();
  const parsedTime = Date.parse(normalized);
  if (!Number.isNaN(parsedTime)) {
    return new Date(parsedTime).toISOString();
  }
  return undefined;
};

const collectFirstPhotoUrl = (node: unknown): string | undefined => {
  if (!node) return undefined;
  if (Array.isArray(node)) {
    for (const entry of node) {
      const candidate = collectFirstPhotoUrl(entry);
      if (candidate) return candidate;
    }
    return undefined;
  }

  if (typeof node === 'object') {
    const typed = node as Record<string, unknown>;
    if (Array.isArray(typed.photoSizes)) {
      for (const size of typed.photoSizes) {
        if (size && typeof size === 'object') {
          const url = (size as Record<string, unknown>).url;
          if (typeof url === 'string' && url.startsWith('http')) {
            return url;
          }
        }
      }
    }

    if (typed.photo) {
      const nested = collectFirstPhotoUrl(typed.photo);
      if (nested) return nested;
    }

    if (typeof typed.url === 'string' && typed.url.startsWith('http')) {
      return typed.url;
    }

    for (const value of Object.values(typed)) {
      const childCandidate = collectFirstPhotoUrl(value);
      if (childCandidate) return childCandidate;
    }
  }

  return undefined;
};

const extractReviewId = (card: TripAdvisorGraphQLCard): string | undefined => {
  const tracking = typeof card.cardLink?.trackingContext === 'string' ? card.cardLink?.trackingContext : undefined;
  if (tracking) {
    const trackingMatch = tracking.match(/review_(\d+)/i);
    if (trackingMatch) {
      return trackingMatch[1];
    }
  }

  const link = card.cardLink?.webRoute?.typedParams?.webLinkUrl;
  if (typeof link === 'string') {
    const linkMatch = link.match(/-r(\d+)-/i);
    if (linkMatch) {
      return linkMatch[1];
    }
  }

  return undefined;
};

const extractScore = (card: TripAdvisorGraphQLCard): number | undefined => {
  if (typeof card.bubbleRatingNumber === 'number') {
    return card.bubbleRatingNumber;
  }

  const ratingText = pickText(card.bubbleRatingText);
  if (ratingText) {
    const scoreMatch = ratingText.match(/(\d+(?:\.\d+)?)/);
    if (scoreMatch) {
      return Number.parseFloat(scoreMatch[1]);
    }
  }

  return undefined;
};

const normalizeCard = (card: TripAdvisorGraphQLCard): TripAdvisorReview => {
  const description = pickText(card.cardText, card.translation) ?? '';
  const title = pickText(card.cardTitle);
  const reviewerName =
    pickText(card.authorCard?.displayName, card.cardSubtitle) ??
    pickText(card.cardSubtitle) ??
    'TripAdvisor guest';
  const isoDate = parseReviewDate(
    pickText(card.publishDate, card.cardSubtitle, card.bubbleRatingText) ?? undefined,
  );
  const profilePhotoUrl = collectFirstPhotoUrl(card.authorCard) ?? collectFirstPhotoUrl(card);

  return {
    channel: 'Tripadvisor',
    name: reviewerName,
    title,
    description,
    score: extractScore(card),
    date: isoDate,
    reviewId: extractReviewId(card),
    profilePhotoUrl,
  };
};

const extractCardsFromPayload = (payload: unknown): TripAdvisorGraphQLCard[] => {
  const accumulator: TripAdvisorGraphQLCard[] = [];
  traverseForReviewCards(payload, accumulator, new WeakSet());
  return accumulator;
};

export const scrapeTripAdvisor = async (url: string): Promise<TripAdvisorReview[]> => {
  if (!PERSISTED_QUERY_HASH) {
    throw new Error('TRIP_ADVISOR_PERSISTED_QUERY_HASH is not configured');
  }

  const paginationSize = Number.isFinite(PAGE_SIZE) && PAGE_SIZE > 0 ? PAGE_SIZE : 10;
  const limit = Number.isFinite(MAX_REVIEWS) && MAX_REVIEWS > 0 ? MAX_REVIEWS : 30;

  try {
    const parsed = parseTripAdvisorUrl(url);
    const collected: TripAdvisorReview[] = [];

    for (let offset = 0; offset < limit; offset += paginationSize) {
      const payload = buildGraphQLPayload({ ...parsed, offset });
      const response = await axios.post(GRAPHQL_ENDPOINT, payload, {
        headers: defaultHeaders(url),
        timeout: 15000,
      });

      const cards = extractCardsFromPayload(response.data);
      if (!cards.length) {
        if (offset === 0) {
          console.warn('[TripAdvisor] GraphQL payload returned no review cards');
        }
        break;
      }

      const normalized = cards.map(normalizeCard);
      collected.push(...normalized);

      if (cards.length < paginationSize || collected.length >= limit) {
        break;
      }
    }

    return collected.slice(0, limit);
  } catch (error) {
    console.error('Error scraping TripAdvisor GraphQL feed:', error);
    return [];
  }
};
