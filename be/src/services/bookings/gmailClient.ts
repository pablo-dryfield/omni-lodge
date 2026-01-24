import { google, gmail_v1 } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import logger from '../../utils/logger.js';
import { getConfigValue } from '../configService.js';

const resolveCredentials = (): { clientId: string; clientSecret: string; refreshToken: string } => {
  const clientId = getConfigValue('GOOGLE_CLIENT_ID') as string | null;
  const clientSecret = getConfigValue('GOOGLE_CLIENT_SECRET') as string | null;
  const refreshToken = getConfigValue('GOOGLE_REFRESH_TOKEN') as string | null;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Missing Google API credentials for Gmail ingestion');
  }
  return { clientId, clientSecret, refreshToken };
};

const buildOauthClient = (): OAuth2Client => {
  const { clientId, clientSecret, refreshToken } = resolveCredentials();
  const client = new google.auth.OAuth2(clientId, clientSecret);
  client.setCredentials({ refresh_token: refreshToken });
  return client;
};

export const getGmailClient = (): gmail_v1.Gmail => {
  const oauthClient = buildOauthClient();
  return google.gmail({ version: 'v1', auth: oauthClient });
};

type ListMessagesParams = {
  query?: string;
  maxResults?: number;
  pageToken?: string | null;
};

export type GmailMessage = gmail_v1.Schema$Message;

export type ListMessagesResult = {
  messages: GmailMessage[];
  nextPageToken: string | null;
  totalSizeEstimate: number | null;
};

export const listMessages = async (
  params: ListMessagesParams,
): Promise<ListMessagesResult> => {
  const gmail = getGmailClient();
  const response = await gmail.users.messages.list({
    userId: 'me',
    q: params.query,
    maxResults: params.maxResults ?? 25,
    pageToken: params.pageToken ?? undefined,
  });
  return {
    messages: response.data.messages ?? [],
    nextPageToken: response.data.nextPageToken ?? null,
    totalSizeEstimate:
      typeof response.data.resultSizeEstimate === 'number' ? response.data.resultSizeEstimate : null,
  };
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
