import HttpError from '../errors/HttpError.js';
import { getConfigValue } from './configService.js';

const SERPAPI_ENDPOINT = 'https://serpapi.com/search.json';
const DEFAULT_TARGET_DOMAIN = 'krawlthroughkrakow.com';
const DEFAULT_LOCATION = 'Krakow, Lesser Poland Voivodeship, Poland';

type UnknownRecord = Record<string, unknown>;

export type SerpResultItem = {
  position: number | null;
  title: string | null;
  link: string | null;
  displayedLink: string | null;
  snippet: string | null;
  source: string | null;
  rating: number | null;
  reviews: number | null;
  type: string | null;
  isTargetDomain: boolean;
};

export type SerpAnalysisResult = {
  provider: 'serpapi';
  keyword: string;
  targetDomain: string;
  location: string;
  country: string;
  language: string;
  googleDomain: string;
  searchedAt: string;
  searchUrl: string | null;
  ads: SerpResultItem[];
  localResults: SerpResultItem[];
  organicResults: SerpResultItem[];
  targetResults: SerpResultItem[];
  features: {
    hasAds: boolean;
    hasLocalPack: boolean;
    hasPlacesSites: boolean;
    hasKnowledgeGraph: boolean;
    hasRelatedQuestions: boolean;
    organicResultCount: number;
  };
  summary: {
    topOrganicPosition: number | null;
    topLocalPosition: number | null;
    topAdPosition: number | null;
    aboveTheFoldPressure: 'High' | 'Medium' | 'Low';
    diagnosis: string[];
  };
};

const normalizeText = (value: unknown, fallback = ''): string => {
  if (typeof value !== 'string') {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
};

const normalizeOptionalText = (value: unknown): string | null => {
  const normalized = normalizeText(value);
  return normalized || null;
};

const normalizeNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/[^\d.]/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const asRecord = (value: unknown): UnknownRecord => (value && typeof value === 'object' ? (value as UnknownRecord) : {});

const asArray = (value: unknown): UnknownRecord[] => (Array.isArray(value) ? value.map(asRecord) : []);

const getHostname = (url: string | null): string | null => {
  if (!url) {
    return null;
  }
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
};

const normalizeDomain = (value: string): string => value.trim().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').toLowerCase();

const isTargetMatch = (item: UnknownRecord, targetDomain: string): boolean => {
  const normalizedTarget = normalizeDomain(targetDomain);
  const linkHost = getHostname(normalizeOptionalText(item.link) ?? normalizeOptionalText(item.website));
  const displayedHost = normalizeDomain(normalizeOptionalText(item.displayed_link) ?? normalizeOptionalText(item.source) ?? '');
  return linkHost === normalizedTarget || linkHost?.endsWith(`.${normalizedTarget}`) || displayedHost.includes(normalizedTarget);
};

const normalizeSerpItem = (item: UnknownRecord, targetDomain: string, fallbackPosition: number): SerpResultItem => ({
  position: normalizeNumber(item.position) ?? fallbackPosition,
  title: normalizeOptionalText(item.title),
  link: normalizeOptionalText(item.link) ?? normalizeOptionalText(item.website),
  displayedLink: normalizeOptionalText(item.displayed_link),
  snippet: normalizeOptionalText(item.snippet) ?? normalizeOptionalText(item.description),
  source: normalizeOptionalText(item.source),
  rating: normalizeNumber(item.rating),
  reviews: normalizeNumber(item.reviews),
  type: normalizeOptionalText(item.type),
  isTargetDomain: isTargetMatch(item, targetDomain),
});

const buildDiagnosis = (params: {
  topOrganicPosition: number | null;
  topLocalPosition: number | null;
  topAdPosition: number | null;
  hasAds: boolean;
  hasLocalPack: boolean;
  targetResults: SerpResultItem[];
}): string[] => {
  const diagnosis: string[] = [];
  if (params.hasAds) {
    diagnosis.push('Ads are present above organic results, so organic CTR may be compressed.');
  }
  if (params.hasLocalPack) {
    diagnosis.push('A local/business pack is present, so Google Business Profile visibility matters for this keyword.');
  }
  if (params.topOrganicPosition && params.topOrganicPosition <= 3) {
    diagnosis.push('The site is already strong organically; investigate snippet quality and SERP features before changing page content.');
  } else if (params.topOrganicPosition) {
    diagnosis.push('The site is visible organically but not near the top; content depth, links, and intent match are likely priority checks.');
  } else {
    diagnosis.push('The target domain was not found in the returned organic results.');
  }
  if (params.topLocalPosition && params.topLocalPosition > 1) {
    diagnosis.push('The business appears in local results but competitors are above it; prioritize reviews, categories, photos, and local relevance.');
  }
  if (params.topAdPosition) {
    diagnosis.push('The target domain is present in sponsored results; compare paid and organic CTR together.');
  }
  if (params.targetResults.length === 0) {
    diagnosis.push('No target-domain result was detected in ads, local pack, or organic results for this SERP sample.');
  }
  return diagnosis;
};

const readSerpApiKey = (): string => {
  const value = getConfigValue('SERPAPI_API_KEY');
  if (typeof value !== 'string' || !value.trim()) {
    throw new HttpError(400, 'SERPAPI_API_KEY is not configured. Add a SerpApi key in Settings > Control Panel or environment config.');
  }
  return value.trim();
};

export const analyzeGoogleSerp = async (params: {
  keyword: unknown;
  targetDomain?: unknown;
  location?: unknown;
  country?: unknown;
  language?: unknown;
  googleDomain?: unknown;
}): Promise<SerpAnalysisResult> => {
  const keyword = normalizeText(params.keyword);
  if (!keyword) {
    throw new HttpError(400, 'keyword is required');
  }

  const targetDomain = normalizeDomain(normalizeText(params.targetDomain, DEFAULT_TARGET_DOMAIN));
  const location = normalizeText(params.location, DEFAULT_LOCATION);
  const country = normalizeText(params.country, 'pl').toLowerCase();
  const language = normalizeText(params.language, 'en').toLowerCase();
  const googleDomain = normalizeText(params.googleDomain, 'google.com');

  const searchParams = new URLSearchParams({
    engine: 'google',
    q: keyword,
    location,
    gl: country,
    hl: language,
    google_domain: googleDomain,
    no_cache: 'true',
    api_key: readSerpApiKey(),
  });

  const response = await fetch(`${SERPAPI_ENDPOINT}?${searchParams.toString()}`, {
    headers: { Accept: 'application/json' },
  });
  const payload = (await response.json().catch(() => ({}))) as UnknownRecord;
  if (!response.ok) {
    throw new HttpError(response.status >= 400 && response.status < 500 ? 400 : 502, normalizeText(payload.error, `SerpApi request failed with status ${response.status}`));
  }
  if (payload.error) {
    throw new HttpError(502, normalizeText(payload.error, 'SerpApi returned an error.'));
  }

  const ads = [
    ...asArray(payload.ads),
    ...asArray(payload.top_ads),
    ...asArray(payload.bottom_ads),
  ].map((item, index) => normalizeSerpItem(item, targetDomain, index + 1));

  const localResultsRecord = asRecord(payload.local_results);
  const localResults = [
    ...asArray(localResultsRecord.places),
    ...asArray(payload.places_results),
  ].map((item, index) => normalizeSerpItem(item, targetDomain, index + 1));

  const organicResults = asArray(payload.organic_results).map((item, index) =>
    normalizeSerpItem(item, targetDomain, index + 1),
  );

  const targetResults = [...ads, ...localResults, ...organicResults].filter((item) => item.isTargetDomain);
  const topOrganicPosition = organicResults.find((item) => item.isTargetDomain)?.position ?? null;
  const topLocalPosition = localResults.find((item) => item.isTargetDomain)?.position ?? null;
  const topAdPosition = ads.find((item) => item.isTargetDomain)?.position ?? null;
  const hasAds = ads.length > 0;
  const hasLocalPack = localResults.length > 0;
  const hasPlacesSites = Array.isArray(payload.places_sites) || Boolean(payload.places_sites);
  const hasKnowledgeGraph = Boolean(payload.knowledge_graph);
  const hasRelatedQuestions = asArray(payload.related_questions).length > 0;
  const aboveTheFoldPressure = hasAds && hasLocalPack ? 'High' : hasAds || hasLocalPack || hasPlacesSites ? 'Medium' : 'Low';

  return {
    provider: 'serpapi',
    keyword,
    targetDomain,
    location,
    country,
    language,
    googleDomain,
    searchedAt: new Date().toISOString(),
    searchUrl: normalizeOptionalText(asRecord(payload.search_metadata).google_url),
    ads,
    localResults,
    organicResults,
    targetResults,
    features: {
      hasAds,
      hasLocalPack,
      hasPlacesSites,
      hasKnowledgeGraph,
      hasRelatedQuestions,
      organicResultCount: organicResults.length,
    },
    summary: {
      topOrganicPosition,
      topLocalPosition,
      topAdPosition,
      aboveTheFoldPressure,
      diagnosis: buildDiagnosis({
        topOrganicPosition,
        topLocalPosition,
        topAdPosition,
        hasAds,
        hasLocalPack,
        targetResults,
      }),
    },
  };
};
