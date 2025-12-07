import dotenv from 'dotenv';
import dayjs from 'dayjs';

dotenv.config({ path: '.env.dev' });

const { fetchMessagePayload } = await import('./dist/services/bookings/gmailClient.js');
const { getBookingParsers } = await import('./dist/services/bookings/parsers/index.js');

const [messageId, parserName] = process.argv.slice(2);

if (!messageId) {
  console.error('Usage: node debugParseEmail.mjs <messageId> [parserName]');
  process.exit(1);
}

const stripHtmlToText = (html = '') => {
  if (!html) return '';
  const withoutBlocks = html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<\/(p|div|li|tr|td)>/gi, '$&\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return decodeHtmlEntities(withoutBlocks);
};

const decodeHtmlEntities = (input = '') =>
  input.replace(/&(#\d+|#x[\da-f]+|\w+);/gi, (entity, match) => {
    if (match.startsWith('#x') || match.startsWith('#X')) {
      const codePoint = Number.parseInt(match.slice(2), 16);
      return Number.isNaN(codePoint) ? entity : String.fromCodePoint(codePoint);
    }
    if (match.startsWith('#')) {
      const codePoint = Number.parseInt(match.slice(1), 10);
      return Number.isNaN(codePoint) ? entity : String.fromCodePoint(codePoint);
    }
    const lookup = {
      nbsp: ' ',
      amp: '&',
      quot: '"',
      lt: '<',
      gt: '>',
      apos: "'",
      bull: '*',
      ndash: '-',
      mdash: '-',
      rsquo: "'",
      lsquo: "'",
    };
    return lookup[match.toLowerCase()] ?? entity;
  });

const normalizeWhitespace = (input = '') => input.replace(/\s+/g, ' ').trim();

const ensurePlainTextBody = (textBody, htmlBody, snippet) => {
  const textCandidate = textBody && textBody.trim().length > 0 ? textBody : null;
  if (textCandidate) {
    const looksLikeHtml = /<[^>]+>/.test(textCandidate);
    const candidate = looksLikeHtml ? stripHtmlToText(textCandidate) : textCandidate;
    const normalized = normalizeWhitespace(candidate);
    if (normalized) {
      return normalized;
    }
  }
  if (htmlBody) {
    const stripped = normalizeWhitespace(stripHtmlToText(htmlBody));
    if (stripped) {
      return stripped;
    }
  }
  if (snippet && snippet.trim().length > 0) {
    return normalizeWhitespace(snippet);
  }
  return '';
};

const parseDateHeader = (value) => {
  if (!value) return null;
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.toDate() : null;
};

const payload = await fetchMessagePayload(messageId);
if (!payload) {
  console.error('No payload for message', messageId);
  process.exit(1);
}

const headers = {
  ...payload.headers,
  from: payload.headers.from ?? payload.message.payload?.headers?.find((h) => h.name?.toLowerCase() === 'from')?.value ?? '',
  to: payload.headers.to ?? payload.message.payload?.headers?.find((h) => h.name?.toLowerCase() === 'to')?.value ?? '',
};

const normalizedTextBody = ensurePlainTextBody(payload.textBody, payload.htmlBody, payload.message.snippet ?? '');

const context = {
  messageId: payload.message.id ?? messageId,
  threadId: payload.message.threadId ?? undefined,
  historyId: payload.message.historyId ?? undefined,
  subject:
    payload.message.payload?.headers?.find((h) => h.name?.toLowerCase() === 'subject')?.value ?? payload.headers.subject,
  snippet: payload.message.snippet ?? '',
  from: headers.from,
  to: headers.to,
  cc: payload.headers.cc,
  receivedAt: parseDateHeader(payload.headers.date),
  internalDate: payload.message.internalDate ? new Date(Number.parseInt(payload.message.internalDate, 10)) : undefined,
  headers,
  textBody: normalizedTextBody,
  rawTextBody: payload.textBody ?? '',
  htmlBody: payload.htmlBody ?? '',
};

const parsers = getBookingParsers();
const results = [];
for (const parser of parsers) {
  if (parserName && parser.name !== parserName) {
    continue;
  }
  if (!parser.canParse(context)) {
    continue;
  }
  const parsed = await parser.parse(context);
  if (parsed) {
    results.push({ parser: parser.name, parsed });
  }
}

if (results.length === 0) {
  console.log('No parser produced a result for', messageId);
  process.exit(0);
}

for (const result of results) {
  console.log(`Parser: ${result.parser}`);
  console.log(JSON.stringify(result.parsed, null, 2));
}
