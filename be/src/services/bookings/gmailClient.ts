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

export type MailboxDirection = 'sent' | 'received';

export type MailboxMessageSummary = {
  messageId: string;
  threadId: string | null;
  fromAddress: string | null;
  toAddresses: string | null;
  subject: string | null;
  snippet: string | null;
  internalDate: string | null;
  labelIds: string[];
  direction: MailboxDirection;
};

type ListMailboxMessagesParams = {
  email: string;
  maxResults?: number;
  pageToken?: string | null;
};

export type ListMailboxMessagesResult = {
  messages: MailboxMessageSummary[];
  nextPageToken: string | null;
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

const normalizeInternalDate = (value?: string | null): string | null => {
  if (!value) {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  const date = new Date(parsed);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
};

const extractHeaderFromMetadata = (
  payload?: gmail_v1.Schema$MessagePart | null,
  headerName?: string,
): string | null => {
  if (!payload?.headers || !headerName) {
    return null;
  }
  const match = payload.headers.find(
    (header) => header?.name?.toLowerCase() === headerName.toLowerCase(),
  );
  const value = String(match?.value ?? '').trim();
  return value.length > 0 ? value : null;
};

const resolveDirection = (labelIds?: string[] | null): MailboxDirection =>
  Array.isArray(labelIds) && labelIds.includes('SENT') ? 'sent' : 'received';

export const listMailboxMessages = async (
  params: ListMailboxMessagesParams,
): Promise<ListMailboxMessagesResult> => {
  const gmail = getGmailClient();
  const query = `(from:"${params.email}" OR to:"${params.email}")`;
  const response = await gmail.users.messages.list({
    userId: 'me',
    q: query,
    maxResults: params.maxResults ?? 25,
    pageToken: params.pageToken ?? undefined,
  });

  const listedMessages = response.data.messages ?? [];
  const summaries = await Promise.all(
    listedMessages.map(async (message): Promise<MailboxMessageSummary | null> => {
      if (!message.id) {
        return null;
      }
      try {
        const { data } = await gmail.users.messages.get({
          userId: 'me',
          id: message.id,
          format: 'metadata',
          metadataHeaders: ['From', 'To', 'Subject', 'Date'],
        });
        if (!data.id) {
          return null;
        }
        const labels = data.labelIds ?? [];
        return {
          messageId: data.id,
          threadId: data.threadId ?? null,
          fromAddress: extractHeaderFromMetadata(data.payload, 'From'),
          toAddresses: extractHeaderFromMetadata(data.payload, 'To'),
          subject: extractHeaderFromMetadata(data.payload, 'Subject'),
          snippet: data.snippet ?? null,
          internalDate: normalizeInternalDate(data.internalDate),
          labelIds: labels,
          direction: resolveDirection(labels),
        };
      } catch (error) {
        logger.warn(
          `[booking-email] Failed to read Gmail message metadata ${message.id}: ${(error as Error).message}`,
        );
        return null;
      }
    }),
  );

  return {
    messages: summaries.filter((entry): entry is MailboxMessageSummary => entry !== null),
    nextPageToken: response.data.nextPageToken ?? null,
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

type SendMessageParams = {
  to: string;
  subject: string;
  body?: string;
  textBody?: string;
  htmlBody?: string | null;
};

export type SendMessageResult = {
  id: string | null;
  threadId: string | null;
};

const encodeBase64Url = (value: string): string =>
  Buffer.from(value, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');

const buildRawMessage = (params: SendMessageParams): string => {
  const normalizedTextBody = (params.textBody ?? params.body ?? '').replace(/\r\n/g, '\n');
  const normalizedHtmlBody = (params.htmlBody ?? '').replace(/\r\n/g, '\n').trim();

  const messageLines: string[] = [
    `To: ${params.to}`,
    `Subject: ${params.subject}`,
    'MIME-Version: 1.0',
  ];

  if (normalizedHtmlBody.length > 0) {
    const boundary = `omni-lodge-email-boundary-${Date.now().toString(16)}`;
    messageLines.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    messageLines.push('');
    messageLines.push(`--${boundary}`);
    messageLines.push('Content-Type: text/plain; charset="UTF-8"');
    messageLines.push('Content-Transfer-Encoding: 8bit');
    messageLines.push('');
    messageLines.push(normalizedTextBody);
    messageLines.push('');
    messageLines.push(`--${boundary}`);
    messageLines.push('Content-Type: text/html; charset="UTF-8"');
    messageLines.push('Content-Transfer-Encoding: 8bit');
    messageLines.push('');
    messageLines.push(normalizedHtmlBody);
    messageLines.push('');
    messageLines.push(`--${boundary}--`);
  } else {
    messageLines.push('Content-Type: text/plain; charset="UTF-8"');
    messageLines.push('Content-Transfer-Encoding: 8bit');
    messageLines.push('');
    messageLines.push(normalizedTextBody);
  }

  const message = messageLines.join('\r\n');
  return encodeBase64Url(message);
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

export const sendMessage = async (params: SendMessageParams): Promise<SendMessageResult> => {
  const gmail = getGmailClient();
  try {
    const raw = buildRawMessage(params);
    const { data } = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw },
    });
    return {
      id: data.id ?? null,
      threadId: data.threadId ?? null,
    };
  } catch (error) {
    logger.error(`[booking-email] Failed to send Gmail message: ${(error as Error).message}`);
    throw error;
  }
};
