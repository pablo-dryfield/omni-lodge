const PRODUCT_NAME_STOPWORDS = new Set([
  'new',
  'booking',
  'order',
  'for',
  'the',
  'this',
  'a',
  'an',
  'and',
  'with',
  'details',
  'reservation',
  'cancelled',
  'canceled',
  'rebooked',
  'view',
  'fareharbor',
  'reference',
  'number',
  'id',
  'customer',
  'customers',
  'created',
  'by',
  'at',
  'from',
  'via',
  'info',
  'change',
  'amended',
  'amendment',
  'confirmation',
  'note',
]);

const PRODUCT_CANONICAL_PATTERNS: Array<{ canonical: string; patterns: RegExp[] }> = [
  {
    canonical: 'Krawl Through Krakow Pub Crawl',
    patterns: [
      /krawl through krakow/i,
      /pub crawl krawl through/i,
      /krakow:\s*pub crawl/i,
      /pub crawl\s+1h\s+open\s+bar/i,
    ],
  },
  {
    canonical: 'NYE Pub Crawl',
    patterns: [
      /new\s*year'?s?\s*eve/i,
      /\bnye\b/i,
      /new\s*years?\s*eve\s+crawl/i,
      /new\s*years?\s*eve\s+pub\s+crawl/i,
      /new\s*year'?s?\s*eve\s+crawl\s+with/i,
    ],
  },
  {
    canonical: 'Food Tour',
    patterns: [/food tour/i],
  },
  {
    canonical: 'Bottomless Brunch',
    patterns: [/bottomless brunch/i, /brunch\s+with\s+3-course/i],
  },
  {
    canonical: 'Go-Karting',
    patterns: [/go[-\s]?kart/i, /karting/i],
  },
  {
    canonical: 'Private Pub Crawl',
    patterns: [/private\s+pub\s+crawl/i, /private\s+krawl/i],
  },
  {
    canonical: 'Krawl Through Kazimierz',
    patterns: [
      /krawl\s+through\s+kazimierz/i,
      /kazimierz\s*-\s*1\s*hour\s*open\s*bar/i,
      /kazimierz\s+.*pro\s+guide/i,
    ],
  },
];

const EXPERIENCE_KEYWORDS = [
  'pub crawl',
  'crawl',
  'tour',
  'experience',
  'brunch',
  'bar crawl',
  'open bar',
  'vip',
  'entry',
  'shots',
  'food',
  'tasting',
];

const truncateAtMarkers = (value: string): string => {
  const markers = ['created by', 'created at', 'cancelled by', 'cancelled at', 'due', 'name:', 'email:', 'phone:'];
  let result = value;
  markers.forEach((marker) => {
    const index = result.toLowerCase().indexOf(marker.toLowerCase());
    if (index !== -1 && index > 0) {
      result = result.slice(0, index).trim();
    }
  });
  return result.trim();
};

const splitCandidateSegments = (value: string): string[] => {
  return value
    .split(/(?:####|\n|\r| {2,}|--+|==+|\|)+/g)
    .map((segment) => truncateAtMarkers(segment.trim()))
    .filter(Boolean);
};

const scoreSegment = (segment: string): number => {
  let score = Math.min(segment.length, 80) / 80;
  const lower = segment.toLowerCase();
  EXPERIENCE_KEYWORDS.forEach((keyword) => {
    if (lower.includes(keyword)) {
      score += 5;
    }
  });
  return score;
};

const pickLikelyProductSegment = (segments: string[]): string | null => {
  if (segments.length === 0) {
    return null;
  }
  const scored = segments
    .map((segment) => ({ segment, score: scoreSegment(segment) }))
    .sort((a, b) => b.score - a.score);
  return scored[0]?.segment ?? null;
};

const decodeHtmlEntities = (value: string): string => {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
};

export const sanitizeProductSource = (input: string): string => {
  let value = decodeHtmlEntities(input);
  value = value.replace(/&raquo;?/gi, ' ');
  value = value.replace(/#+/g, ' ');
  value = value.replace(/(Cancelled|Canceled|Rebooked)\s*:?/gi, ' ');
  value = value.replace(/New\s+order/gi, ' ');
  value = value.replace(/Booking\s+note:?/gi, ' ');
  value = value.replace(/View on FareHarbor/gi, ' ');
  value = value.replace(/\s+/g, ' ');
  return value.trim();
};

const tokenizeProductName = (source: string): string[] => {
  if (!source) {
    return [];
  }
  const tokens = sanitizeProductSource(source)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !PRODUCT_NAME_STOPWORDS.has(token));

  return tokens;
};

const matchKnownProductPatterns = (value: string): string | null => {
  const patterns = [
    /(?:tour|product)\s+name\s*:?\s*(.+)$/i,
    /(?:booking|order)\s+#?[^\s]+\s+(.+)$/i,
    /customers?:\s*(?:[^A-Za-z0-9]+)?(.+)$/i,
  ];
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match && match[1]) {
      return truncateAtMarkers(match[1].trim());
    }
  }
  return null;
};

export const canonicalizeProductLabel = (raw?: string | null): string | null => {
  if (!raw) {
    return null;
  }
  const sanitized = sanitizeProductSource(raw);
  if (!sanitized) {
    return null;
  }

  for (const entry of PRODUCT_CANONICAL_PATTERNS) {
    if (entry.patterns.some((pattern) => pattern.test(sanitized))) {
      return entry.canonical;
    }
  }

  const patternHit = matchKnownProductPatterns(sanitized);
  if (patternHit) {
    return patternHit;
  }

  const segments = splitCandidateSegments(sanitized);
  const chosen = pickLikelyProductSegment(segments);
  return (chosen ?? sanitized).trim() || null;
};

export const canonicalizeProductKeyFromLabel = (raw?: string | null): string | null => {
  if (!raw) {
    return null;
  }
  const tokens = tokenizeProductName(raw);
  if (tokens.length === 0) {
    return null;
  }
  const deduped = Array.from(new Set(tokens)).sort();
  return deduped.join('-');
};

export const canonicalizeProductKeyFromSources = (sources: Array<string | null | undefined>): string | null => {
  for (const source of sources) {
    const key = canonicalizeProductKeyFromLabel(source ?? null);
    if (key) {
      return key;
    }
  }
  return null;
};

export const canonicalizeProductLabelFromSources = (
  sources: Array<string | null | undefined>,
): string | null => {
  for (const source of sources) {
    const label = canonicalizeProductLabel(source ?? null);
    if (label) {
      return label;
    }
  }
  return null;
};
