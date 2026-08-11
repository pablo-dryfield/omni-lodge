import type { GmailMessagePayload } from './gmailClient.js';

const FORWARDED_MARKER = /^-{2,}\s*Forwarded message\s*-{2,}\s*$/i;
const FORWARDED_SUBJECT_PREFIX = /^\s*(?:(?:fwd?|forwarded)\s*:\s*)+/i;
const FORWARDED_HEADER = /^(from|date|subject|to|cc|reply-to|message-id)\s*:\s*(.*)$/i;

type ForwardedContent = {
  headers: Record<string, string>;
  body: string;
};

const unfoldHeaderValue = (value: string): string => value.replace(/\s+/g, ' ').trim();

const extractForwardedContent = (textBody: string): ForwardedContent | null => {
  const lines = textBody.replace(/\r\n?/g, '\n').split('\n');

  for (let markerIndex = 0; markerIndex < lines.length; markerIndex += 1) {
    if (!FORWARDED_MARKER.test(lines[markerIndex]?.trim() ?? '')) {
      continue;
    }

    const headers: Record<string, string> = {};
    let currentHeader: string | null = null;
    let index = markerIndex + 1;

    while (index < lines.length && !lines[index]?.trim()) {
      index += 1;
    }

    for (; index < lines.length; index += 1) {
      const line = lines[index] ?? '';
      if (!line.trim()) {
        index += 1;
        break;
      }

      const headerMatch = line.match(FORWARDED_HEADER);
      if (headerMatch) {
        currentHeader = headerMatch[1].toLowerCase();
        headers[currentHeader] = unfoldHeaderValue(headerMatch[2] ?? '');
        continue;
      }

      if (/^\s+/.test(line) && currentHeader) {
        headers[currentHeader] = unfoldHeaderValue(`${headers[currentHeader]} ${line}`);
        continue;
      }

      break;
    }

    if (!headers.from || !headers.subject) {
      continue;
    }

    const senderAddress = headers.from.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
    if (!senderAddress) {
      continue;
    }

    return {
      headers,
      body: lines.slice(index).join('\n').trim(),
    };
  }

  return null;
};

export const normalizeForwardedBackupPayload = (
  payload: GmailMessagePayload,
): GmailMessagePayload => {
  if (payload.sourceAccount !== 'backup') {
    return payload;
  }

  const wrapperSubject = String(payload.headers.subject ?? '').trim();
  const forwarded = extractForwardedContent(payload.textBody);
  if (!forwarded) {
    return payload;
  }

  const originalSubject = forwarded.headers.subject.replace(FORWARDED_SUBJECT_PREFIX, '').trim();
  const normalizedHeaders: Record<string, string> = {
    ...payload.headers,
    ...forwarded.headers,
    subject: originalSubject || forwarded.headers.subject,
    'x-omnilodge-forwarded-manual': 'true',
    'x-omnilodge-forwarded-by': payload.headers.from ?? '',
    'x-omnilodge-forwarded-wrapper-subject': wrapperSubject,
  };

  return {
    ...payload,
    textBody: forwarded.body,
    htmlBody: null,
    headers: normalizedHeaders,
  };
};
