import { google, gmail_v1 } from 'googleapis';
import logger from '../../utils/logger.js';

const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN } = process.env;

const oauthClient = new google.auth.OAuth2(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
);

if (GOOGLE_REFRESH_TOKEN) {
  oauthClient.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
}

const assertCredentials = (): void => {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
    throw new Error('Missing Google API credentials for Gmail ingestion');
  }
};

export const getGmailClient = (): gmail_v1.Gmail => {
  assertCredentials();
  return google.gmail({ version: 'v1', auth: oauthClient });
};

type ListMessagesParams = {
  query?: string;
  maxResults?: number;
  pageToken?: string | null;
};

export const listMessages = async (
  params: ListMessagesParams,
): Promise<gmail_v1.Schema$Message[]> => {
  const gmail = getGmailClient();
  const response = await gmail.users.messages.list({
    userId: 'me',
    q: params.query,
    maxResults: params.maxResults ?? 25,
    pageToken: params.pageToken ?? undefined,
  });
  return response.data.messages ?? [];
};

const decodeBody = (data?: string | null): string => {
  if (!data) {
    return '';
  }
  const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized, 'base64').toString('utf-8');
};

const flattenParts = (
  part: gmail_v1.Schema$MessagePart | undefined,
  target: { text: string[]; html: string[] },
): void => {
  if (!part) {
    return;
  }
  const { mimeType, body, parts } = part;
  if (mimeType?.startsWith('text/plain') && body?.data) {
    target.text.push(decodeBody(body.data));
  } else if (mimeType?.startsWith('text/html') && body?.data) {
    target.html.push(decodeBody(body.data));
  }
  if (Array.isArray(parts)) {
    parts.forEach((child) => flattenParts(child, target));
  }
};

const buildHeaders = (payload?: gmail_v1.Schema$MessagePart | null): Record<string, string> => {
  const headers = payload?.headers ?? [];
  return headers.reduce<Record<string, string>>((acc, header) => {
    if (!header?.name) {
      return acc;
    }
    acc[header.name.toLowerCase()] = header.value ?? '';
    return acc;
  }, {});
};

export type GmailMessagePayload = {
  message: gmail_v1.Schema$Message;
  textBody: string;
  htmlBody: string | null;
  headers: Record<string, string>;
};

export const fetchMessagePayload = async (messageId: string): Promise<GmailMessagePayload | null> => {
  const gmail = getGmailClient();
  try {
    const { data } = await gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full',
    });

    if (!data) {
      return null;
    }

    const buckets = { text: [] as string[], html: [] as string[] };
    flattenParts(data.payload, buckets);

    if (buckets.text.length === 0 && data.payload?.body?.data) {
      buckets.text.push(decodeBody(data.payload.body.data));
    }

    if (buckets.html.length === 0 && data.payload?.body?.data && data.payload.mimeType?.includes('html')) {
      buckets.html.push(decodeBody(data.payload.body.data));
    }

    return {
      message: data,
      textBody: buckets.text.join('\n').trim(),
      htmlBody: buckets.html.length > 0 ? buckets.html.join('\n') : null,
      headers: buildHeaders(data.payload),
    };
  } catch (error) {
    logger.error(`[booking-email] Failed to fetch Gmail message ${messageId}: ${(error as Error).message}`);
    throw error;
  }
};
