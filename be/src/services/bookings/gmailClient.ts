import { randomUUID } from 'crypto';
import { setDefaultResultOrder } from 'dns';
import { google, gmail_v1 } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import logger from '../../utils/logger.js';
import { getConfigValue } from '../configService.js';

setDefaultResultOrder('ipv4first');

const resolveCredentials = (): { clientId: string; clientSecret: string; refreshToken: string } => {
  const clientId = getConfigValue('GOOGLE_CLIENT_ID') as string | null;
  const clientSecret = getConfigValue('GOOGLE_CLIENT_SECRET') as string | null;
  const refreshToken = getConfigValue('GOOGLE_REFRESH_TOKEN') as string | null;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Missing Google API credentials for Gmail ingestion');
  }
  return { clientId, clientSecret, refreshToken };
};

let cachedCredentialsKey: string | null = null;
let cachedOauthClient: OAuth2Client | null = null;

const getGmailAuthClient = (): OAuth2Client => {
  const credentials = resolveCredentials();
  const credentialsKey = `${credentials.clientId}:${credentials.clientSecret}:${credentials.refreshToken}`;
  if (cachedOauthClient && cachedCredentialsKey === credentialsKey) {
    return cachedOauthClient;
  }

  const { clientId, clientSecret, refreshToken } = credentials;
  const client = new google.auth.OAuth2(clientId, clientSecret);
  client.setCredentials({ refresh_token: refreshToken });
  cachedCredentialsKey = credentialsKey;
  cachedOauthClient = client;
  return client;
};

export const getGmailClient = (): gmail_v1.Gmail => {
  return google.gmail({ version: 'v1', auth: getGmailAuthClient() });
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
  from?: string | null;
  subject: string;
  body?: string;
  textBody?: string;
  htmlBody?: string | null;
  attachments?: Array<{
    filename: string;
    content: string | Buffer;
    contentType?: string;
  }>;
};

export type SendMessageResult = {
  id: string | null;
  threadId: string | null;
  from: string | null;
  to: string;
  rfcMessageId: string | null;
  labelIds: string[];
};

const encodeBase64Url = (value: string | Buffer): string =>
  (Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf-8'))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');

const encodeBase64 = (value: string | Buffer): string =>
  Buffer.isBuffer(value) ? value.toString('base64') : Buffer.from(value, 'utf-8').toString('base64');

const sanitizeHeaderValue = (value: string): string => value.replace(/[\r\n]+/g, ' ').trim();

const buildRfcMessageId = (): string => `<omni-lodge-${randomUUID()}@omni-lodge.local>`;

const extractEmailAddress = (value: string): string | null => {
  const trimmed = sanitizeHeaderValue(value);
  const angleMatch = trimmed.match(/<([^<>@\s]+@[^<>\s]+)>/);
  const address = angleMatch?.[1] ?? trimmed;
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(address) ? address.toLowerCase() : null;
};

const assertVerifiedSendAsAlias = async (gmail: gmail_v1.Gmail, from: string | null | undefined): Promise<void> => {
  if (!from) {
    return;
  }

  const requestedAddress = extractEmailAddress(from);
  if (!requestedAddress) {
    throw new Error(`Invalid Gmail From address: ${from}`);
  }

  const { data } = await gmail.users.settings.sendAs.list({ userId: 'me' });
  const aliases = data.sendAs ?? [];
  const alias = aliases.find((entry) => entry.sendAsEmail?.toLowerCase() === requestedAddress);
  if (!alias) {
    throw new Error(
      `Gmail From address ${requestedAddress} is not configured as a Send mail as alias for this Google account`,
    );
  }

  if (alias.verificationStatus && alias.verificationStatus !== 'accepted') {
    throw new Error(
      `Gmail From address ${requestedAddress} is configured but not verified; current status: ${alias.verificationStatus}`,
    );
  }
};

const buildMimeMessage = (params: SendMessageParams, rfcMessageId: string): string => {
  const normalizedTextBody = (params.textBody ?? params.body ?? '').replace(/\r\n/g, '\n');
  const normalizedHtmlBody = (params.htmlBody ?? '').replace(/\r\n/g, '\n').trim();
  const attachments = Array.isArray(params.attachments) ? params.attachments : [];

  const messageLines: string[] = [
    `To: ${sanitizeHeaderValue(params.to)}`,
    ...(params.from ? [`From: ${sanitizeHeaderValue(params.from)}`] : []),
    `Subject: ${sanitizeHeaderValue(params.subject)}`,
    `Message-ID: ${sanitizeHeaderValue(rfcMessageId)}`,
    'MIME-Version: 1.0',
  ];

  if (attachments.length > 0) {
    const mixedBoundary = `omni-lodge-mixed-${Date.now().toString(16)}`;
    const alternativeBoundary = `omni-lodge-alt-${(Date.now() + 1).toString(16)}`;
    messageLines.push(`Content-Type: multipart/mixed; boundary="${mixedBoundary}"`);
    messageLines.push('');
    messageLines.push(`--${mixedBoundary}`);

    if (normalizedHtmlBody.length > 0) {
      messageLines.push(`Content-Type: multipart/alternative; boundary="${alternativeBoundary}"`);
      messageLines.push('');
      messageLines.push(`--${alternativeBoundary}`);
      messageLines.push('Content-Type: text/plain; charset="UTF-8"');
      messageLines.push('Content-Transfer-Encoding: 8bit');
      messageLines.push('');
      messageLines.push(normalizedTextBody);
      messageLines.push('');
      messageLines.push(`--${alternativeBoundary}`);
      messageLines.push('Content-Type: text/html; charset="UTF-8"');
      messageLines.push('Content-Transfer-Encoding: 8bit');
      messageLines.push('');
      messageLines.push(normalizedHtmlBody);
      messageLines.push('');
      messageLines.push(`--${alternativeBoundary}--`);
    } else {
      messageLines.push('Content-Type: text/plain; charset="UTF-8"');
      messageLines.push('Content-Transfer-Encoding: 8bit');
      messageLines.push('');
      messageLines.push(normalizedTextBody);
    }

    attachments.forEach((attachment) => {
      const fileName = String(attachment.filename ?? 'attachment');
      const contentType = String(attachment.contentType ?? 'application/octet-stream');
      messageLines.push('');
      messageLines.push(`--${mixedBoundary}`);
      messageLines.push(`Content-Type: ${contentType}; name="${fileName}"`);
      messageLines.push('Content-Transfer-Encoding: base64');
      messageLines.push(`Content-Disposition: attachment; filename="${fileName}"`);
      messageLines.push('');

      const encoded = encodeBase64(attachment.content);
      for (let index = 0; index < encoded.length; index += 76) {
        messageLines.push(encoded.slice(index, index + 76));
      }
    });

    messageLines.push('');
    messageLines.push(`--${mixedBoundary}--`);
  } else if (normalizedHtmlBody.length > 0) {
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

  return messageLines.join('\r\n');
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

const wait = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

const GOOGLE_API_RETRY_BASE_DELAY_MS = 750;
const GOOGLE_API_RETRY_MAX_DELAY_MS = 5000;
const GOOGLE_OAUTH_REFRESH_MAX_ATTEMPTS = 8;
const GMAIL_SEND_MAX_ATTEMPTS = 4;
const RETRYABLE_GMAIL_SEND_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);
const RETRYABLE_GMAIL_SEND_ERROR_CODES = new Set([
  'ECONNRESET',
  'ECONNABORTED',
  'ETIMEDOUT',
  'EPIPE',
  'ENOTFOUND',
  'EAI_AGAIN',
  'UND_ERR_SOCKET',
]);

const getErrorStatusCode = (error: unknown): number | null => {
  const candidate = error as {
    code?: unknown;
    status?: unknown;
    response?: { status?: unknown };
  };
  const status = Number(candidate.response?.status ?? candidate.status ?? candidate.code);
  return Number.isInteger(status) ? status : null;
};

const isRetryableGmailSendError = (error: unknown): boolean => {
  const candidate = error as { code?: unknown; message?: unknown };
  const code = typeof candidate.code === 'string' ? candidate.code.toUpperCase() : '';
  if (RETRYABLE_GMAIL_SEND_ERROR_CODES.has(code)) {
    return true;
  }

  const status = getErrorStatusCode(error);
  if (status !== null && RETRYABLE_GMAIL_SEND_STATUS_CODES.has(status)) {
    return true;
  }

  const message = typeof candidate.message === 'string' ? candidate.message.toLowerCase() : '';
  return (
    message.includes('econnreset') ||
    message.includes('socket hang up') ||
    message.includes('network socket disconnected') ||
    message.includes('temporarily unavailable')
  );
};

const withRetryableGoogleApi = async <T>(
  description: string,
  operation: () => Promise<T>,
  maxAttempts = 3,
): Promise<T> => {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isRetryableGmailSendError(error) || attempt >= maxAttempts) {
        throw error;
      }

      const exponentialDelay = GOOGLE_API_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
      const jitter = Math.floor(Math.random() * 250);
      const delay = Math.min(exponentialDelay + jitter, GOOGLE_API_RETRY_MAX_DELAY_MS);
      logger.warn(
        `[booking-email] ${description} failed with a retryable Google API transport error on attempt ${attempt}/${maxAttempts}: ${(error as Error).message}`,
      );
      await wait(delay);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`${description} failed`);
};

const buildSendMessageResult = (
  params: SendMessageParams,
  message: gmail_v1.Schema$Message,
  metadata?: gmail_v1.Schema$Message | null,
): SendMessageResult => ({
  id: message.id ?? null,
  threadId: message.threadId ?? null,
  from: params.from ? sanitizeHeaderValue(params.from) : null,
  to: sanitizeHeaderValue(params.to),
  rfcMessageId: metadata?.payload ? extractHeaderFromMetadata(metadata.payload, 'Message-ID') : null,
  labelIds: metadata?.labelIds ?? message.labelIds ?? [],
});

const fetchSentMetadata = async (
  gmail: gmail_v1.Gmail,
  messageId: string | null,
): Promise<gmail_v1.Schema$Message | null> => {
  if (!messageId) {
    return null;
  }

  try {
    const { data } = await withRetryableGoogleApi('Gmail sent metadata fetch', () =>
      gmail.users.messages.get({
        userId: 'me',
        id: messageId,
        format: 'metadata',
        metadataHeaders: ['Message-ID'],
      }),
    );
    return data;
  } catch (error) {
    logger.warn(
      `[booking-email] Gmail message was sent, but metadata fetch failed for ${messageId}: ${(error as Error).message}`,
    );
    return null;
  }
};

const findSentMessageByRfcMessageId = async (
  gmail: gmail_v1.Gmail,
  params: SendMessageParams,
  rfcMessageId: string,
): Promise<SendMessageResult | null> => {
  const reconciliationDelays = [750, 1500, 3000];

  for (const delay of reconciliationDelays) {
    await wait(delay);
    try {
      const { data } = await withRetryableGoogleApi('Gmail sent reconciliation search', () =>
        gmail.users.messages.list({
          userId: 'me',
          q: `in:sent rfc822msgid:${rfcMessageId}`,
          maxResults: 1,
        }),
      );
      const sentMessage = data.messages?.[0] ?? null;
      if (!sentMessage?.id) {
        continue;
      }

      const metadata = await fetchSentMetadata(gmail, sentMessage.id);
      return buildSendMessageResult(
        params,
        {
          id: sentMessage.id,
          threadId: sentMessage.threadId ?? metadata?.threadId ?? null,
          labelIds: metadata?.labelIds ?? ['SENT'],
        },
        metadata,
      );
    } catch (error) {
      logger.warn(
        `[booking-email] Failed to reconcile Gmail send by Message-ID ${rfcMessageId}: ${(error as Error).message}`,
      );
    }
  }

  return null;
};

export const sendMessage = async (params: SendMessageParams): Promise<SendMessageResult> => {
  const oauthClient = getGmailAuthClient();
  const gmail = getGmailClient();
  const rfcMessageId = buildRfcMessageId();
  const mimeMessage = buildMimeMessage(params, rfcMessageId);

  try {
    await withRetryableGoogleApi('Google OAuth token refresh', async () => {
      await oauthClient.getAccessToken();
    }, GOOGLE_OAUTH_REFRESH_MAX_ATTEMPTS);
    await withRetryableGoogleApi('Gmail send-as alias check', () => assertVerifiedSendAsAlias(gmail, params.from));

    for (let attempt = 1; attempt <= GMAIL_SEND_MAX_ATTEMPTS; attempt += 1) {
      try {
        const { data } = await gmail.users.messages.send({
          userId: 'me',
          media: {
            mimeType: 'message/rfc822',
            body: Buffer.from(mimeMessage, 'utf-8'),
          },
        });
        const metadata = await fetchSentMetadata(gmail, data.id ?? null);
        return buildSendMessageResult(params, data, metadata);
      } catch (sendError) {
        if (!isRetryableGmailSendError(sendError)) {
          throw sendError;
        }

        logger.warn(
          `[booking-email] Gmail send failed with a retryable transport error on attempt ${attempt}/${GMAIL_SEND_MAX_ATTEMPTS}: ${(sendError as Error).message}`,
        );

        const reconciled = await findSentMessageByRfcMessageId(gmail, params, rfcMessageId);
        if (reconciled) {
          logger.info(`[booking-email] Gmail send reconciled from Sent mailbox after attempt ${attempt}.`);
          return reconciled;
        }

        if (attempt >= GMAIL_SEND_MAX_ATTEMPTS) {
          throw sendError;
        }
      }
    }

    throw new Error('Failed to send Gmail message');
  } catch (error) {
    logger.error(`[booking-email] Failed to send Gmail message: ${(error as Error).message}`);
    throw error;
  }
};
