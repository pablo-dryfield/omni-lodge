import { randomUUID } from 'crypto';
import { setDefaultResultOrder } from 'dns';
import { google, gmail_v1 } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import logger from '../../utils/logger.js';
import { getConfigValue } from '../configService.js';

setDefaultResultOrder('ipv4first');

export type GmailAccount = 'primary' | 'backup';

const BACKUP_MESSAGE_ID_PREFIX = 'backup:';

const buildMessageReference = (account: GmailAccount, messageId: string): string =>
  account === 'backup' ? `${BACKUP_MESSAGE_ID_PREFIX}${messageId}` : messageId;

const parseMessageReference = (
  messageId: string,
): { account: GmailAccount; gmailMessageId: string } =>
  messageId.startsWith(BACKUP_MESSAGE_ID_PREFIX)
    ? { account: 'backup', gmailMessageId: messageId.slice(BACKUP_MESSAGE_ID_PREFIX.length) }
    : { account: 'primary', gmailMessageId: messageId };

const resolveCredentials = (
  account: GmailAccount,
): { clientId: string; clientSecret: string; refreshToken: string } => {
  const defaultClientId = getConfigValue('GOOGLE_CLIENT_ID') as string | null;
  const defaultClientSecret = getConfigValue('GOOGLE_CLIENT_SECRET') as string | null;
  const dedicatedClientId = account === 'backup'
    ? (getConfigValue('GMAIL_SEND_CLIENT_ID') as string | null)
    : null;
  const dedicatedClientSecret = account === 'backup'
    ? (getConfigValue('GMAIL_SEND_CLIENT_SECRET') as string | null)
    : null;
  if (account === 'backup' && Boolean(dedicatedClientId) !== Boolean(dedicatedClientSecret)) {
    throw new Error('GMAIL_SEND_CLIENT_ID and GMAIL_SEND_CLIENT_SECRET must be configured together');
  }
  const clientId = dedicatedClientId || defaultClientId;
  const clientSecret = dedicatedClientSecret || defaultClientSecret;
  const dedicatedRefreshToken = getConfigValue(
    account === 'backup' ? 'GMAIL_SEND_REFRESH_TOKEN' : 'GMAIL_INGEST_REFRESH_TOKEN',
  ) as string | null;
  const refreshToken = account === 'backup'
    ? dedicatedRefreshToken
    : dedicatedRefreshToken || (getConfigValue('GOOGLE_REFRESH_TOKEN') as string | null);
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(`Missing Google API credentials for Gmail ${account}`);
  }
  return { clientId, clientSecret, refreshToken };
};

const cachedOauthClients = new Map<string, OAuth2Client>();

const getGmailAuthClient = (account: GmailAccount): OAuth2Client => {
  const credentials = resolveCredentials(account);
  const credentialsKey = `${credentials.clientId}:${credentials.clientSecret}:${credentials.refreshToken}`;
  const cachedClient = cachedOauthClients.get(credentialsKey);
  if (cachedClient) return cachedClient;

  const { clientId, clientSecret, refreshToken } = credentials;
  const client = new google.auth.OAuth2(clientId, clientSecret);
  client.setCredentials({ refresh_token: refreshToken });
  cachedOauthClients.set(credentialsKey, client);
  return client;
};

export const getGmailClient = (account: GmailAccount = 'primary'): gmail_v1.Gmail => {
  return google.gmail({ version: 'v1', auth: getGmailAuthClient(account) });
};

export const hasBackupGmailAccount = (): boolean =>
  Boolean(getConfigValue('GMAIL_SEND_REFRESH_TOKEN'));

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

const gmailApiCooldownUntil: Record<GmailAccount, number> = { primary: 0, backup: 0 };
const GMAIL_RATE_LIMIT_FALLBACK_COOLDOWN_MS = 15 * 60 * 1000;
const GMAIL_RATE_LIMIT_RETRY_SAFETY_MS = 60 * 1000;

type GmailCooldownError = Error & {
  code: 429;
  gmailCooldown: true;
  retryAfter: string;
  account: GmailAccount;
};

const buildGmailCooldownError = (
  account: GmailAccount,
  retryAt: number,
): GmailCooldownError => {
  const retryAfter = new Date(retryAt).toISOString();
  const error = new Error(
    `Gmail ${account} account API cooldown is active. Retry after ${retryAfter}`,
  ) as GmailCooldownError;
  error.code = 429;
  error.gmailCooldown = true;
  error.retryAfter = retryAfter;
  error.account = account;
  return error;
};

const assertGmailApiCooldownElapsed = (account: GmailAccount): void => {
  if (gmailApiCooldownUntil[account] > Date.now()) {
    throw buildGmailCooldownError(account, gmailApiCooldownUntil[account]);
  }
};

export const getGmailApiCooldownUntil = (): Date | null =>
  gmailApiCooldownUntil.primary > Date.now() ? new Date(gmailApiCooldownUntil.primary) : null;

export const isGmailCooldownError = (error: unknown): boolean =>
  (error as Partial<GmailCooldownError>)?.gmailCooldown === true;

export const listMessages = async (
  params: ListMessagesParams,
  account: GmailAccount = 'primary',
): Promise<ListMessagesResult> => {
  const gmail = getGmailClient(account);
  const response = await withRetryableGoogleApi(
    'Gmail message list',
    account,
    () => {
      assertGmailApiCooldownElapsed(account);
      return gmail.users.messages.list({
        userId: 'me',
        q: params.query,
        maxResults: params.maxResults ?? 25,
        pageToken: params.pageToken ?? undefined,
      });
    },
    GMAIL_READ_MAX_ATTEMPTS,
  );
  return {
    messages: (response.data.messages ?? []).map((message) => ({
      ...message,
      ...(message.id ? { id: buildMessageReference(account, message.id) } : {}),
    })),
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
  const gmail = getGmailClient('primary');
  const query = `(from:"${params.email}" OR to:"${params.email}")`;
  const response = await withRetryableGoogleApi(
    'Gmail mailbox message list',
    'primary',
    () => {
      assertGmailApiCooldownElapsed('primary');
      return gmail.users.messages.list({
        userId: 'me',
        q: query,
        maxResults: params.maxResults ?? 25,
        pageToken: params.pageToken ?? undefined,
      });
    },
    GMAIL_READ_MAX_ATTEMPTS,
  );

  const listedMessages = response.data.messages ?? [];
  const summaries: Array<MailboxMessageSummary | null> = [];
  for (let offset = 0; offset < listedMessages.length; offset += 3) {
    const batch = listedMessages.slice(offset, offset + 3);
    const batchSummaries = await Promise.all(
      batch.map(async (message): Promise<MailboxMessageSummary | null> => {
        if (!message.id) {
          return null;
        }
        const messageId = message.id;
        try {
          const { data } = await withRetryableGoogleApi(
            `Gmail mailbox metadata fetch ${messageId}`,
            'primary',
            () => {
              assertGmailApiCooldownElapsed('primary');
              return gmail.users.messages.get({
                userId: 'me',
                id: messageId,
                format: 'metadata',
                metadataHeaders: ['From', 'To', 'Subject', 'Date'],
              });
            },
            GMAIL_READ_MAX_ATTEMPTS,
          );
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
          if (isGmailRateLimitError(error)) {
            throw error;
          }
          logger.warn(
            `[booking-email] Failed to read Gmail message metadata ${messageId}: ${(error as Error).message}`,
          );
          return null;
        }
      }),
    );
    summaries.push(...batchSummaries);
  }

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
  sourceAccount: GmailAccount;
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
  threadId?: string | null;
  inReplyTo?: string | null;
  references?: string | null;
  rfcMessageId?: string | null;
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

const resolveDefaultFrom = (): string | null => {
  const address = sanitizeHeaderValue(
    String(getConfigValue('GMAIL_DEFAULT_FROM_ADDRESS') ?? 'pubthroughkrakow@gmail.com'),
  );
  if (!address) {
    return null;
  }

  const name = sanitizeHeaderValue(
    String(getConfigValue('GMAIL_DEFAULT_FROM_NAME') ?? 'Krawl Through Krakow'),
  );
  if (!name) {
    return address;
  }

  const quotedName = name.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${quotedName}" <${address}>`;
};

const extractRfcMessageIds = (value: string | null | undefined): string[] =>
  sanitizeHeaderValue(value ?? '').match(/<[^<>\s]+>/g) ?? [];

const buildReferencesHeader = (params: SendMessageParams): string | null => {
  const messageIds = [...extractRfcMessageIds(params.references), ...extractRfcMessageIds(params.inReplyTo)];
  const uniqueMessageIds = Array.from(new Set(messageIds));
  return uniqueMessageIds.length > 0 ? uniqueMessageIds.join(' ') : null;
};

const buildRfcMessageId = (): string => `<omni-lodge-${randomUUID()}@omni-lodge.local>`;

export const extractEmailAddress = (value: string): string | null => {
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
  const inReplyTo = extractRfcMessageIds(params.inReplyTo)[0] ?? null;
  const references = buildReferencesHeader(params);

  const messageLines: string[] = [
    `To: ${sanitizeHeaderValue(params.to)}`,
    ...(params.from ? [`From: ${sanitizeHeaderValue(params.from)}`] : []),
    `Subject: ${sanitizeHeaderValue(params.subject)}`,
    `Message-ID: ${sanitizeHeaderValue(rfcMessageId)}`,
    ...(inReplyTo ? [`In-Reply-To: ${inReplyTo}`] : []),
    ...(references ? [`References: ${references}`] : []),
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
  const { account, gmailMessageId } = parseMessageReference(messageId);
  const gmail = getGmailClient(account);
  try {
    const { data } = await withRetryableGoogleApi(
      `Gmail message fetch ${messageId}`,
      account,
      () => {
        assertGmailApiCooldownElapsed(account);
        return gmail.users.messages.get({
          userId: 'me',
          id: gmailMessageId,
          format: 'full',
        });
      },
      GMAIL_READ_MAX_ATTEMPTS,
    );

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
      sourceAccount: account,
      message: { ...data, id: buildMessageReference(account, data.id ?? gmailMessageId) },
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

const GOOGLE_API_RETRY_BASE_DELAY_MS = 1000;
const GOOGLE_API_RETRY_MAX_DELAY_MS = 32000;
const GOOGLE_OAUTH_REFRESH_MAX_ATTEMPTS = 8;
const GMAIL_READ_MAX_ATTEMPTS = 6;
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

export const resolveGmailRetryAfterAt = (
  error: unknown,
  now = Date.now(),
): number | null => {
  const candidate = error as {
    message?: unknown;
    response?: {
      headers?: Record<string, unknown> & { get?: (name: string) => unknown };
      data?: {
        error?: {
          message?: unknown;
          details?: Array<{ retryDelay?: unknown }>;
        };
      };
    };
  };
  const headers = candidate.response?.headers;
  const rawHeader =
    (typeof headers?.get === 'function' ? headers.get('retry-after') : undefined) ??
    headers?.['retry-after'] ??
    headers?.['Retry-After'];
  if (rawHeader !== null && rawHeader !== undefined && String(rawHeader).trim()) {
    const normalized = String(rawHeader).trim();
    const seconds = Number(normalized);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return now + seconds * 1000;
    }
    const timestamp = Date.parse(normalized);
    if (Number.isFinite(timestamp)) return timestamp;
  }

  const retryDelay = candidate.response?.data?.error?.details
    ?.map((detail) => String(detail.retryDelay ?? '').trim())
    .find(Boolean);
  const retryDelayMatch = retryDelay?.match(/^(\d+(?:\.\d+)?)s$/i);
  if (retryDelayMatch) {
    return now + Number(retryDelayMatch[1]) * 1000;
  }

  const message = [candidate.message, candidate.response?.data?.error?.message]
    .map((value) => String(value ?? ''))
    .join(' ');
  const timestampMatch = message.match(
    /retry\s+after\s+(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)/i,
  );
  if (!timestampMatch) return null;
  const timestamp = Date.parse(timestampMatch[1]);
  return Number.isFinite(timestamp) ? timestamp : null;
};

export const isGmailRateLimitError = (error: unknown): boolean => {
  const candidate = error as {
    message?: unknown;
    response?: {
      data?: {
        error?: {
          errors?: Array<{ reason?: unknown; message?: unknown }>;
          message?: unknown;
        };
      };
    };
  };
  const status = getErrorStatusCode(error);
  const apiError = candidate.response?.data?.error;
  const reasons = (apiError?.errors ?? [])
    .map((entry) => String(entry.reason ?? '').toLowerCase())
    .filter(Boolean);
  const message = [candidate.message, apiError?.message, ...(apiError?.errors ?? []).map((entry) => entry.message)]
    .map((value) => String(value ?? '').toLowerCase())
    .join(' ');
  const hasRateReason = reasons.some((reason) =>
    ['userratelimitexceeded', 'ratelimitexceeded', 'quotaexceeded'].includes(reason),
  );
  const hasRateMessage =
    message.includes('user-rate limit exceeded') ||
    message.includes('user rate limit exceeded') ||
    message.includes('rate limit exceeded') ||
    message.includes('too many requests');
  return status === 429 || (status === 403 && (hasRateReason || hasRateMessage));
};

export const describeGmailApiError = (error: unknown): string => {
  const candidate = error as {
    response?: {
      data?: {
        error?: {
          errors?: Array<{ reason?: unknown }>;
          status?: unknown;
        };
      };
    };
  };
  const apiError = candidate.response?.data?.error;
  const reasons = Array.from(
    new Set(
      (apiError?.errors ?? [])
        .map((entry) => String(entry.reason ?? '').trim())
        .filter(Boolean),
    ),
  );
  const parts = [
    `httpStatus=${getErrorStatusCode(error) ?? 'unknown'}`,
    `reason=${reasons.join(',') || 'unknown'}`,
  ];
  const apiStatus = String(apiError?.status ?? '').trim();
  if (apiStatus) parts.push(`apiStatus=${apiStatus}`);
  return parts.join(' ');
};

const isRetryableGmailSendError = (error: unknown): boolean => {
  const candidate = error as { code?: unknown; message?: unknown };
  const code = typeof candidate.code === 'string' ? candidate.code.toUpperCase() : '';
  if (RETRYABLE_GMAIL_SEND_ERROR_CODES.has(code)) {
    return true;
  }
  if (isGmailRateLimitError(error)) {
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
  account: GmailAccount,
  operation: () => Promise<T>,
  maxAttempts = 3,
): Promise<T> => {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      assertGmailApiCooldownElapsed(account);
      return await operation();
    } catch (error) {
      lastError = error;
      if (isGmailCooldownError(error)) {
        throw error;
      }
      if (!isRetryableGmailSendError(error) || attempt >= maxAttempts) {
        throw error;
      }

      const now = Date.now();
      const retryAfterAt = resolveGmailRetryAfterAt(error, now);
      const serverDelay = retryAfterAt === null ? null : Math.max(0, retryAfterAt - now);
      if (isGmailRateLimitError(error)) {
        const requestedRetryAt = retryAfterAt ?? now + GMAIL_RATE_LIMIT_FALLBACK_COOLDOWN_MS;
        const safeRetryAt = requestedRetryAt + GMAIL_RATE_LIMIT_RETRY_SAFETY_MS;
        gmailApiCooldownUntil[account] = Math.max(gmailApiCooldownUntil[account], safeRetryAt);
        logger.warn(
          `[booking-email] ${description} was rate limited (${describeGmailApiError(error)}). Gmail ${account} account operations are paused until ${new Date(safeRetryAt).toISOString()}.`,
        );
        throw error;
      }

      const exponentialDelay = GOOGLE_API_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
      const jitter = Math.floor(Math.random() * 1000);
      const delay =
        serverDelay === null
          ? Math.min(exponentialDelay + jitter, GOOGLE_API_RETRY_MAX_DELAY_MS)
          : Math.max(serverDelay, 1000) + jitter;
      logger.warn(
        `[booking-email] ${description} failed with a retryable Google API error on attempt ${attempt}/${maxAttempts}: ${(error as Error).message}`,
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
  account: GmailAccount,
  gmail: gmail_v1.Gmail,
  messageId: string | null,
): Promise<gmail_v1.Schema$Message | null> => {
  if (!messageId) {
    return null;
  }

  try {
    const { data } = await withRetryableGoogleApi('Gmail sent metadata fetch', account, () =>
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
  account: GmailAccount,
  gmail: gmail_v1.Gmail,
  params: SendMessageParams,
  rfcMessageId: string,
): Promise<SendMessageResult | null> => {
  const reconciliationDelays = [750, 1500, 3000];

  for (const delay of reconciliationDelays) {
    await wait(delay);
    try {
      const { data } = await withRetryableGoogleApi('Gmail sent reconciliation search', account, () =>
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

      const metadata = await fetchSentMetadata(account, gmail, sentMessage.id);
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
      if (isGmailCooldownError(error)) {
        throw error;
      }
      logger.warn(
        `[booking-email] Failed to reconcile Gmail send by Message-ID ${rfcMessageId}: ${(error as Error).message}`,
      );
    }
  }

  return null;
};

const sendMessageWithAccount = async (
  account: GmailAccount,
  params: SendMessageParams,
  requestedRfcMessageId: string | null,
  rfcMessageId: string,
  mimeMessage: string,
): Promise<SendMessageResult> => {
  const oauthClient = getGmailAuthClient(account);
  const gmail = getGmailClient(account);

  await withRetryableGoogleApi('Google OAuth token refresh', account, async () => {
    await oauthClient.getAccessToken();
  }, GOOGLE_OAUTH_REFRESH_MAX_ATTEMPTS);
  await withRetryableGoogleApi(
    'Gmail send-as alias check',
    account,
    () => assertVerifiedSendAsAlias(gmail, params.from),
  );

  if (requestedRfcMessageId) {
    const existing = await findSentMessageByRfcMessageId(
      account,
      gmail,
      params,
      rfcMessageId,
    );
    if (existing) {
      logger.info(
        `[booking-email] Reused existing sent message with Message-ID ${rfcMessageId} from the Gmail ${account} account.`,
      );
      return existing;
    }
  }

  for (let attempt = 1; attempt <= GMAIL_SEND_MAX_ATTEMPTS; attempt += 1) {
    try {
      assertGmailApiCooldownElapsed(account);
      const { data } = await gmail.users.messages.send({
        userId: 'me',
        requestBody: {
          raw: encodeBase64Url(mimeMessage),
          ...(params.threadId && account === 'primary'
            ? { threadId: sanitizeHeaderValue(params.threadId) }
            : {}),
        },
      });
      const metadata = await fetchSentMetadata(account, gmail, data.id ?? null);
      return buildSendMessageResult(params, data, metadata);
    } catch (sendError) {
      if (isGmailCooldownError(sendError)) {
        throw sendError;
      }
      if (!isRetryableGmailSendError(sendError)) {
        throw sendError;
      }

      if (isGmailRateLimitError(sendError)) {
        const now = Date.now();
        const requestedRetryAt = resolveGmailRetryAfterAt(sendError, now)
          ?? now + GMAIL_RATE_LIMIT_FALLBACK_COOLDOWN_MS;
        gmailApiCooldownUntil[account] = Math.max(
          gmailApiCooldownUntil[account],
          requestedRetryAt + GMAIL_RATE_LIMIT_RETRY_SAFETY_MS,
        );
        throw sendError;
      }

      logger.warn(
        `[booking-email] Gmail ${account} account send failed with a retryable transport error on attempt ${attempt}/${GMAIL_SEND_MAX_ATTEMPTS}: ${(sendError as Error).message}`,
      );

      const reconciled = await findSentMessageByRfcMessageId(
        account,
        gmail,
        params,
        rfcMessageId,
      );
      if (reconciled) {
        logger.info(
          `[booking-email] Gmail ${account} account send reconciled from Sent mailbox after attempt ${attempt}.`,
        );
        return reconciled;
      }

      if (attempt >= GMAIL_SEND_MAX_ATTEMPTS) {
        throw sendError;
      }
    }
  }

  throw new Error('Failed to send Gmail message');
};

export const sendMessage = async (params: SendMessageParams): Promise<SendMessageResult> => {
  const resolvedParams: SendMessageParams = params.from
    ? params
    : { ...params, from: resolveDefaultFrom() };
  const requestedRfcMessageId = extractRfcMessageIds(resolvedParams.rfcMessageId)[0] ?? null;
  const rfcMessageId = requestedRfcMessageId ?? buildRfcMessageId();
  const mimeMessage = buildMimeMessage(resolvedParams, rfcMessageId);

  try {
    return await sendMessageWithAccount(
      'primary',
      resolvedParams,
      requestedRfcMessageId,
      rfcMessageId,
      mimeMessage,
    );
  } catch (primaryError) {
    const canFailOver = hasBackupGmailAccount()
      && (isGmailCooldownError(primaryError) || isGmailRateLimitError(primaryError));
    if (!canFailOver) {
      logger.error(`[booking-email] Failed to send Gmail message: ${(primaryError as Error).message}`);
      throw primaryError;
    }

    logger.warn(
      `[booking-email] Gmail primary account is rate limited; attempting delivery with the configured backup account.`,
    );
    try {
      return await sendMessageWithAccount(
        'backup',
        resolvedParams,
        requestedRfcMessageId,
        rfcMessageId,
        mimeMessage,
      );
    } catch (backupError) {
      logger.error(
        `[booking-email] Gmail backup account delivery failed: ${(backupError as Error).message}`,
      );
      throw backupError;
    }
  }
};
