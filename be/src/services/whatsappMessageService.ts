import crypto from 'node:crypto';
import { Op } from 'sequelize';
import {
  getWhatsAppConfigValue,
  getWhatsAppWebhookQueueConfig,
  resolveWhatsAppOnboardingGeneration,
} from '../config/whatsappConfig.js';
import WhatsAppMessage from '../models/WhatsAppMessage.js';
import WhatsAppSourceState from '../models/WhatsAppSourceState.js';
import WhatsAppWebhookInbox from '../models/WhatsAppWebhookInbox.js';
import type {
  NormalizedWhatsAppWebhookEvent,
  WhatsAppWebhookBatch,
} from '../types/whatsapp.js';

type NormalizedMessageEvent = Extract<NormalizedWhatsAppWebhookEvent, { kind: 'message' }>;
type NormalizedStatusEvent = Extract<NormalizedWhatsAppWebhookEvent, { kind: 'status' }>;
type NormalizedHistorySyncEvent = Extract<NormalizedWhatsAppWebhookEvent, { kind: 'history_sync' }>;
type NormalizedAccountStateEvent = Extract<NormalizedWhatsAppWebhookEvent, { kind: 'account_state' }>;

export const WHATSAPP_SOURCE_STATE_ID = 1;
export const WHATSAPP_MAX_RETENTION_DAYS = 7;
export const WHATSAPP_MAX_QUERY_LIMIT = 100;
export const DEFAULT_WHATSAPP_SOURCE_STALE_HOURS = 96;

const DEFAULT_QUERY_LIMIT = 25;
const MAX_CONTEXT_ITEMS_PER_SIDE = 10;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_TEXT_LENGTH = 4_000;
const PERSISTENCE_BATCH_SIZE = 500;
const WHATSAPP_QUEUE_HEALTH_GRACE_MS = 5 * 60 * 1000;

type StoredMessageValues = {
  phoneNumberId: string;
  providerMessageId: string;
  direction: 'inbound' | 'outbound';
  source: 'messages' | 'history' | 'smb_message_echoes';
  messageType: string;
  contactKey: string | null;
  contactPhoneSuffix: string | null;
  contactDisplayName: string | null;
  textContent: string | null;
  contextProviderMessageId: string | null;
  occurredAt: Date;
  contentUpdatedAt: Date | null;
  deliveryStatus: string | null;
  statusUpdatedAt: Date | null;
  editedAt: Date | null;
  revokedAt: Date | null;
};

export type WhatsAppBriefItem = {
  citationRef: string;
  contextCitationRef: string | null;
  direction: 'inbound' | 'outbound';
  source: 'messages' | 'history' | 'smb_message_echoes';
  timestamp: string;
  contactName: string | null;
  contactPhoneSuffix: string | null;
  messageType: string;
  text: string | null;
  deliveryStatus: string | null;
  edited: boolean;
  revoked: boolean;
};

export type WhatsAppSourceStatus = {
  source: 'whatsapp';
  available: boolean;
  status: 'unavailable' | 'connected' | 'degraded';
  historySyncStatus: 'not_started' | 'in_progress' | 'complete' | 'declined' | 'failed';
  historySyncProgress: number | null;
  lastWebhookAt: string | null;
  lastSuccessfulIngestAt: string | null;
  lastMessageAt: string | null;
  lastErrorAt: string | null;
  lastErrorCode: string | null;
  retentionDays: number;
  stale: boolean;
  staleAfterHours: number;
  onboardingGeneration: string;
  accountDisconnected: boolean;
  queue: {
    configured: boolean;
    queued: number;
    processing: number;
    failed: number;
    oldestPendingAt: string | null;
  };
};

export type WhatsAppIngestResult = {
  inserted: number;
  deduplicated: number;
  statusesUpdated: number;
};

type IngestOptions = {
  receivedAt?: Date;
  contactHashKey?: string;
  onboardingGeneration?: string;
};

type SourceStatePatch = Partial<{
  status: 'unavailable' | 'connected' | 'degraded';
  historySyncStatus: 'not_started' | 'in_progress' | 'complete' | 'declined' | 'failed';
  historySyncProgress: number | null;
  lastWebhookAt: Date | null;
  lastSuccessfulIngestAt: Date | null;
  lastMessageAt: Date | null;
  lastErrorAt: Date | null;
  lastErrorCode: string | null;
  onboardingGeneration: string | null;
  disconnectedGeneration: string | null;
}>;

const MESSAGE_UPDATE_FIELDS: Array<keyof StoredMessageValues> = [
  'direction',
  'source',
  'messageType',
  'contactKey',
  'contactPhoneSuffix',
  'contactDisplayName',
  'textContent',
  'contextProviderMessageId',
  'occurredAt',
  'contentUpdatedAt',
  'deliveryStatus',
  'statusUpdatedAt',
  'editedAt',
  'revokedAt',
];

function validDate(value: Date): boolean {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function asDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return validDate(parsed) ? parsed : null;
}

function toIso(value: Date | string | null | undefined): string | null {
  return asDate(value)?.toISOString() ?? null;
}

function latestDate(
  ...values: Array<Date | string | null | undefined>
): Date | null {
  return values
    .map(asDate)
    .filter((value): value is Date => value !== null)
    .reduce<Date | null>(
      (latest, value) => !latest || value.getTime() > latest.getTime() ? value : latest,
      null,
    );
}

function cleanRequired(value: string, maxLength: number): string | null {
  const cleaned = value.trim();
  return cleaned ? cleaned.slice(0, maxLength) : null;
}

function cleanOptional(value: string | null | undefined, maxLength: number): string | null {
  if (value == null) return null;
  return cleanRequired(value, maxLength);
}

function messageKey(phoneNumberId: string, providerMessageId: string): string {
  return `${phoneNumberId}\u0000${providerMessageId}`;
}

function latestByKey<T>(
  values: readonly T[],
  getKey: (value: T) => string,
  getTimestamp: (value: T) => Date,
): { values: T[]; deduplicated: number } {
  const latest = new Map<string, T>();
  for (const value of values) {
    const key = getKey(value);
    const prior = latest.get(key);
    if (!prior || getTimestamp(value).getTime() >= getTimestamp(prior).getTime()) {
      latest.set(key, value);
    }
  }
  return { values: [...latest.values()], deduplicated: values.length - latest.size };
}

function chunksOf<T>(values: readonly T[], size = PERSISTENCE_BATCH_SIZE): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function resolveContactHashKey(override?: string): string {
  const configured =
    override?.trim() ||
    getWhatsAppConfigValue('WHATSAPP_CONTACT_HASH_KEY')?.trim() ||
    getWhatsAppConfigValue('WHATSAPP_META_APP_SECRET')?.trim();
  if (!configured) {
    throw new Error('WHATSAPP_CONTACT_HASH_KEY or WHATSAPP_META_APP_SECRET must be configured');
  }
  return configured;
}

function contactMetadata(
  waId: string | null,
  hashKeyOverride?: string,
): { contactKey: string | null; contactPhoneSuffix: string | null } {
  const normalized = waId?.trim();
  if (!normalized) return { contactKey: null, contactPhoneSuffix: null };

  const digits = normalized.replace(/\D/g, '');
  return {
    contactKey: crypto
      .createHmac('sha256', resolveContactHashKey(hashKeyOverride))
      .update(normalized)
      .digest('hex'),
    contactPhoneSuffix: digits ? digits.slice(-4) : null,
  };
}

function storedValues(row: WhatsAppMessage): StoredMessageValues {
  return {
    phoneNumberId: row.phoneNumberId,
    providerMessageId: row.providerMessageId,
    direction: row.direction,
    source: row.source,
    messageType: row.messageType,
    contactKey: row.contactKey,
    contactPhoneSuffix: row.contactPhoneSuffix,
    contactDisplayName: row.contactDisplayName,
    textContent: row.textContent,
    contextProviderMessageId: row.contextProviderMessageId,
    occurredAt: row.occurredAt,
    contentUpdatedAt: row.contentUpdatedAt,
    deliveryStatus: row.deliveryStatus,
    statusUpdatedAt: row.statusUpdatedAt,
    editedAt: row.editedAt,
    revokedAt: row.revokedAt,
  };
}

async function loadExistingMessages(
  keys: Array<{ phoneNumberId: string; providerMessageId: string }>,
): Promise<Map<string, StoredMessageValues>> {
  if (!keys.length) return new Map();
  const rows: WhatsAppMessage[] = [];
  for (const keyChunk of chunksOf(keys)) {
    rows.push(...await WhatsAppMessage.findAll({
      where: {
        [Op.or]: keyChunk.map((key) => ({
          phoneNumberId: key.phoneNumberId,
          providerMessageId: key.providerMessageId,
        })),
      },
    }));
  }
  return new Map(
    rows.map((row) => {
      const values = storedValues(row);
      return [messageKey(values.phoneNumberId, values.providerMessageId), values];
    }),
  );
}

function messageContactWaId(event: NormalizedMessageEvent): string | null {
  return event.direction === 'inbound' ? event.senderWaId : event.recipientWaId;
}

function effectiveMessageId(event: NormalizedMessageEvent): string | null {
  return cleanRequired(event.targetMessageId || event.messageId, 256);
}

function mergeMessageEvent(
  event: NormalizedMessageEvent,
  existing: StoredMessageValues | undefined,
  contactHashKey?: string,
): StoredMessageValues | null {
  const phoneNumberId = cleanRequired(event.phoneNumberId, 64);
  const providerMessageId = effectiveMessageId(event);
  if (!phoneNumberId || !providerMessageId || !validDate(event.timestamp)) return null;

  const priorContentAt = asDate(existing?.contentUpdatedAt);
  if (priorContentAt && priorContentAt.getTime() > event.timestamp.getTime()) return null;

  const contact = contactMetadata(messageContactWaId(event), contactHashKey);
  const isRevoked = event.action === 'revoke' || Boolean(existing?.revokedAt);
  const messageType = cleanRequired(event.messageType, 64) ?? existing?.messageType ?? 'unknown';
  const nextText = isRevoked
    ? null
    : cleanOptional(event.text, MAX_TEXT_LENGTH);
  const nextContext = isRevoked
    ? null
    : cleanOptional(event.contextMessageId, 256);

  return {
    phoneNumberId,
    providerMessageId,
    direction: event.direction,
    source: event.source,
    messageType,
    contactKey: contact.contactKey ?? existing?.contactKey ?? null,
    contactPhoneSuffix: contact.contactPhoneSuffix ?? existing?.contactPhoneSuffix ?? null,
    contactDisplayName:
      cleanOptional(event.contactName, 256) ?? existing?.contactDisplayName ?? null,
    textContent: nextText,
    contextProviderMessageId: nextContext,
    occurredAt: existing?.contentUpdatedAt ? existing.occurredAt : event.timestamp,
    contentUpdatedAt: event.timestamp,
    deliveryStatus: existing?.deliveryStatus ?? null,
    statusUpdatedAt: existing?.statusUpdatedAt ?? null,
    editedAt: event.action === 'edit' ? event.timestamp : existing?.editedAt ?? null,
    revokedAt: event.action === 'revoke' ? event.timestamp : existing?.revokedAt ?? null,
  };
}

function mergeStatusEvent(
  event: NormalizedStatusEvent,
  existing: StoredMessageValues | undefined,
  contactHashKey?: string,
): StoredMessageValues | null {
  const phoneNumberId = cleanRequired(event.phoneNumberId, 64);
  const providerMessageId = cleanRequired(event.messageId, 256);
  if (!phoneNumberId || !providerMessageId || !validDate(event.timestamp)) return null;

  const priorStatusAt = asDate(existing?.statusUpdatedAt);
  if (priorStatusAt && priorStatusAt.getTime() > event.timestamp.getTime()) return null;

  const contact = contactMetadata(event.recipientWaId, contactHashKey);
  return {
    phoneNumberId,
    providerMessageId,
    direction: existing?.direction ?? 'outbound',
    source: existing?.source ?? 'messages',
    messageType: existing?.messageType ?? 'unknown',
    contactKey: existing?.contactKey ?? contact.contactKey,
    contactPhoneSuffix: existing?.contactPhoneSuffix ?? contact.contactPhoneSuffix,
    contactDisplayName: existing?.contactDisplayName ?? null,
    textContent: existing?.textContent ?? null,
    contextProviderMessageId: existing?.contextProviderMessageId ?? null,
    occurredAt: existing?.occurredAt ?? event.timestamp,
    contentUpdatedAt: existing?.contentUpdatedAt ?? null,
    deliveryStatus: cleanRequired(event.status, 32),
    statusUpdatedAt: event.timestamp,
    editedAt: existing?.editedAt ?? null,
    revokedAt: existing?.revokedAt ?? null,
  };
}

async function bulkUpsert(rows: StoredMessageValues[]): Promise<number> {
  if (!rows.length) return 0;
  for (const rowChunk of chunksOf(rows)) {
    await WhatsAppMessage.bulkCreate(rowChunk, {
      updateOnDuplicate: MESSAGE_UPDATE_FIELDS as string[],
    });
  }
  return rows.length;
}

export function resolveWhatsAppRetentionDays(
  configured = getWhatsAppConfigValue('WHATSAPP_RETENTION_DAYS'),
): number {
  if (!configured) return WHATSAPP_MAX_RETENTION_DAYS;
  const normalized = configured.trim();
  if (!/^\d+$/.test(normalized)) return WHATSAPP_MAX_RETENTION_DAYS;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 1) return WHATSAPP_MAX_RETENTION_DAYS;
  return Math.min(parsed, WHATSAPP_MAX_RETENTION_DAYS);
}

export function resolveWhatsAppSourceStaleHours(
  configured = getWhatsAppConfigValue('WHATSAPP_SOURCE_STALE_HOURS'),
): number {
  if (!configured) return DEFAULT_WHATSAPP_SOURCE_STALE_HOURS;
  const normalized = configured.trim();
  if (!/^\d+$/.test(normalized)) return DEFAULT_WHATSAPP_SOURCE_STALE_HOURS;
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return DEFAULT_WHATSAPP_SOURCE_STALE_HOURS;
  return Math.min(parsed, 24 * 7);
}

export function resolveWhatsAppQueryWindow(params: {
  since: Date;
  until: Date;
  now?: Date;
}): { since: Date; until: Date } {
  const now = params.now ?? new Date();
  if (!validDate(params.since) || !validDate(params.until) || !validDate(now)) {
    throw new Error('Invalid WhatsApp message query date');
  }
  const cutoff = new Date(now.getTime() - resolveWhatsAppRetentionDays() * DAY_MS);
  return {
    since: new Date(Math.max(params.since.getTime(), cutoff.getTime())),
    until: new Date(Math.min(params.until.getTime(), now.getTime())),
  };
}

function clampQueryLimit(limit: number | undefined, fallback = DEFAULT_QUERY_LIMIT): number {
  if (!Number.isFinite(limit)) return fallback;
  return Math.max(1, Math.min(Math.floor(limit as number), WHATSAPP_MAX_QUERY_LIMIT));
}

function briefItem(row: WhatsAppMessage): WhatsAppBriefItem {
  return {
    citationRef: `whatsapp:${row.providerMessageId}`,
    contextCitationRef: row.contextProviderMessageId
      ? `whatsapp:${row.contextProviderMessageId}`
      : null,
    direction: row.direction,
    source: row.source,
    timestamp: row.occurredAt.toISOString(),
    contactName: row.contactDisplayName,
    contactPhoneSuffix: row.contactPhoneSuffix,
    messageType: row.messageType,
    text: row.revokedAt ? null : row.textContent,
    deliveryStatus: row.deliveryStatus,
    edited: Boolean(row.editedAt),
    revoked: Boolean(row.revokedAt),
  };
}

async function updateWhatsAppSourceState(patch: SourceStatePatch): Promise<void> {
  const values: Record<string, unknown> = { id: WHATSAPP_SOURCE_STATE_ID };
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) values[key] = value;
  }
  await WhatsAppSourceState.upsert(values);
}

export async function setWhatsAppHistorySyncStatus(
  historySyncStatus: 'not_started' | 'in_progress' | 'complete' | 'declined' | 'failed',
): Promise<void> {
  await updateWhatsAppSourceState({ historySyncStatus });
}

export async function markWhatsAppSourceError(
  errorCode: string,
  at = new Date(),
  onboardingGeneration = resolveWhatsAppOnboardingGeneration(),
): Promise<void> {
  if (onboardingGeneration !== resolveWhatsAppOnboardingGeneration()) return;
  const normalizedCode =
    errorCode.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').slice(0, 64) ||
    'unknown_error';
  const existing = await WhatsAppSourceState.findByPk(WHATSAPP_SOURCE_STATE_ID);
  const generationChanged = Boolean(
    existing
    && (existing.onboardingGeneration ?? existing.disconnectedGeneration)
      !== onboardingGeneration,
  );
  const accountDisconnected = !generationChanged
    && existing?.disconnectedGeneration === onboardingGeneration;
  await updateWhatsAppSourceState({
    status: accountDisconnected ? 'unavailable' : 'degraded',
    onboardingGeneration,
    disconnectedGeneration: generationChanged ? null : undefined,
    historySyncStatus: generationChanged ? 'not_started' : undefined,
    historySyncProgress: generationChanged ? null : undefined,
    lastErrorAt: latestDate(existing?.lastErrorAt, at),
    lastErrorCode: normalizedCode,
  });
}

export async function ingestWhatsAppWebhook(
  batch: WhatsAppWebhookBatch,
  options: IngestOptions = {},
): Promise<WhatsAppIngestResult> {
  const receivedAt = options.receivedAt ?? new Date();
  const onboardingGeneration = options.onboardingGeneration
    ?? resolveWhatsAppOnboardingGeneration();
  const currentOnboardingGeneration = resolveWhatsAppOnboardingGeneration();
  const retentionCutoff = new Date(
    receivedAt.getTime() - resolveWhatsAppRetentionDays() * DAY_MS,
  );
  const historySyncEvents = batch.events.filter(
    (event): event is NormalizedHistorySyncEvent => event.kind === 'history_sync',
  );
  const accountStateEvents = batch.events.filter(
    (event): event is NormalizedAccountStateEvent => event.kind === 'account_state',
  );
  const validEvents = batch.events.filter(
    (event): event is NormalizedMessageEvent | NormalizedStatusEvent =>
      (event.kind === 'message' || event.kind === 'status')
      && validDate(event.timestamp)
      && event.timestamp >= retentionCutoff,
  );
  const messageEvents = validEvents.filter(
    (event): event is NormalizedMessageEvent => event.kind === 'message',
  );
  const statusEvents = validEvents.filter(
    (event): event is NormalizedStatusEvent => event.kind === 'status',
  );

  const validMessageEvents = messageEvents.filter(
    (event) =>
      Boolean(cleanRequired(event.phoneNumberId, 64)) && Boolean(effectiveMessageId(event)),
  );
  const validStatusEvents = statusEvents.filter(
    (event) =>
      Boolean(cleanRequired(event.phoneNumberId, 64)) &&
      Boolean(cleanRequired(event.messageId, 256)),
  );

  const dedupedMessages = latestByKey(
    validMessageEvents,
    (event) => messageKey(event.phoneNumberId.trim(), effectiveMessageId(event) as string),
    (event) => event.timestamp,
  );
  const dedupedStatuses = latestByKey(
    validStatusEvents,
    (event) => messageKey(event.phoneNumberId.trim(), event.messageId.trim()),
    (event) => event.timestamp,
  );

  try {
    // History synchronization can contain up to 180 days. Discard expired content
    // before persistence and prune anything that has just crossed the retention boundary.
    await deleteExpiredWhatsAppMessages(receivedAt);

    const messageKeys = dedupedMessages.values.map((event) => ({
      phoneNumberId: event.phoneNumberId.trim(),
      providerMessageId: effectiveMessageId(event) as string,
    }));
    const existingMessages = await loadExistingMessages(messageKeys);
    const messageRows = dedupedMessages.values
      .map((event) => {
        const providerMessageId = effectiveMessageId(event) as string;
        return mergeMessageEvent(
          event,
          existingMessages.get(messageKey(event.phoneNumberId.trim(), providerMessageId)),
          options.contactHashKey,
        );
      })
      .filter((row): row is StoredMessageValues => Boolean(row));
    const messagesUpserted = await bulkUpsert(messageRows);

    const statusKeys = dedupedStatuses.values.map((event) => ({
      phoneNumberId: event.phoneNumberId.trim(),
      providerMessageId: event.messageId.trim(),
    }));
    const existingStatusMessages = await loadExistingMessages(statusKeys);
    const statusRows = dedupedStatuses.values
      .map((event) =>
        mergeStatusEvent(
          event,
          existingStatusMessages.get(
            messageKey(event.phoneNumberId.trim(), event.messageId.trim()),
          ),
          options.contactHashKey,
        ),
      )
      .filter((row): row is StoredMessageValues => Boolean(row));
    const statusesApplied = await bulkUpsert(statusRows);

    const latestMessageAt = validEvents.reduce<Date | null>(
      (latest, event) =>
        !latest || event.timestamp.getTime() > latest.getTime() ? event.timestamp : latest,
      null,
    );
    const existingSourceState = onboardingGeneration === currentOnboardingGeneration
      ? await WhatsAppSourceState.findByPk(WHATSAPP_SOURCE_STATE_ID)
      : null;
    const generationChanged = Boolean(
      existingSourceState
      && (existingSourceState.onboardingGeneration
        ?? existingSourceState.disconnectedGeneration) !== onboardingGeneration,
    );
    const currentProgress = generationChanged
      ? null
      : existingSourceState?.historySyncProgress ?? null;
    const incomingProgressValues = historySyncEvents
      .map((event) => event.progress)
      .filter((progress): progress is number => progress !== null);
    const incomingProgress = incomingProgressValues.length > 0
      ? Math.max(...incomingProgressValues)
      : null;
    const historySyncProgress = currentProgress === null
      ? incomingProgress
      : incomingProgress === null
        ? currentProgress
        : Math.max(currentProgress, incomingProgress);
    const priorHistoryStatus = generationChanged
      ? 'not_started'
      : existingSourceState?.historySyncStatus ?? 'not_started';
    const historyComplete = priorHistoryStatus === 'complete'
      || currentProgress === 100
      || historySyncEvents.some((event) => event.status === 'complete')
      || historySyncProgress === 100;
    const historyDeclined = !historyComplete
      && (priorHistoryStatus === 'declined'
        || historySyncEvents.some((event) => event.status === 'declined'));
    const historyFailed = historyComplete || historyDeclined
      ? undefined
      : historySyncEvents.find((event) => event.status === 'failed');
    const historyInProgress = !historyComplete
      && !historyDeclined
      && !historyFailed
      && (historySyncEvents.some((event) => event.status === 'in_progress')
        || incomingProgress !== null);
    const unavailableAccountEvent = accountStateEvents.find((event) => event.unavailable);
    const historySyncStatus = historyFailed
      ? 'failed'
      : historyComplete
        ? 'complete'
        : historyDeclined
          ? 'declined'
        : historyInProgress
          ? 'in_progress'
          : priorHistoryStatus;
    const accountDisconnected = Boolean(
      unavailableAccountEvent
      || (!generationChanged
        && existingSourceState?.disconnectedGeneration === onboardingGeneration),
    );

    // A queue row captures the onboarding generation at receipt. Rows left from an
    // older generation may still be ingested idempotently, but cannot reconnect or
    // degrade the newly configured source.
    if (onboardingGeneration === currentOnboardingGeneration) {
      const sourceError = unavailableAccountEvent
        ? cleanOptional(unavailableAccountEvent.event, 64)?.toLowerCase() ?? 'account_unavailable'
        : historyFailed
          ? cleanOptional(historyFailed.errorCode, 64) ?? 'history_sync_failed'
          : null;
      await updateWhatsAppSourceState({
        status: accountDisconnected
          ? 'unavailable'
          : historySyncStatus === 'complete' || historySyncStatus === 'declined'
            ? 'connected'
            : 'degraded',
        onboardingGeneration,
        disconnectedGeneration: accountDisconnected ? onboardingGeneration : null,
        historySyncStatus,
        historySyncProgress: historySyncEvents.length > 0 || generationChanged
          ? historySyncProgress
          : undefined,
        lastWebhookAt: latestDate(existingSourceState?.lastWebhookAt, receivedAt),
        lastSuccessfulIngestAt: latestDate(
          existingSourceState?.lastSuccessfulIngestAt,
          receivedAt,
        ),
        lastMessageAt: latestDate(existingSourceState?.lastMessageAt, latestMessageAt),
        lastErrorAt: sourceError
          ? latestDate(existingSourceState?.lastErrorAt, receivedAt)
          : historySyncStatus === 'complete' || historySyncStatus === 'declined'
            ? null
            : generationChanged
              ? null
              : undefined,
        lastErrorCode: sourceError
          ?? (historySyncStatus === 'complete'
            || historySyncStatus === 'declined'
            || generationChanged
            ? null
            : undefined),
      });
    }

    return {
      inserted: messagesUpserted,
      deduplicated: dedupedMessages.deduplicated + dedupedStatuses.deduplicated,
      statusesUpdated: statusesApplied,
    };
  } catch (error) {
    try {
      await markWhatsAppSourceError('ingest_failed', receivedAt, onboardingGeneration);
    } catch {
      // Preserve the original persistence failure if status tracking also fails.
    }
    throw error;
  }
}

export async function searchWhatsAppMessages(params: {
  since: Date;
  until: Date;
  limit: number;
  phoneNumberId?: string;
  now?: Date;
}): Promise<WhatsAppBriefItem[]> {
  const window = resolveWhatsAppQueryWindow(params);
  if (window.since.getTime() > window.until.getTime()) return [];

  const where: Record<string, unknown> = {
    occurredAt: { [Op.gte]: window.since, [Op.lte]: window.until },
    [Op.or]: [
      { textContent: { [Op.ne]: null } },
      { messageType: { [Op.ne]: 'unknown' } },
    ],
  };
  const phoneNumberId = params.phoneNumberId?.trim();
  if (phoneNumberId) where.phoneNumberId = phoneNumberId;

  const rows = await WhatsAppMessage.findAll({
    attributes: [
      'providerMessageId',
      'direction',
      'source',
      'messageType',
      'contactPhoneSuffix',
      'contactDisplayName',
      'textContent',
      'contextProviderMessageId',
      'occurredAt',
      'deliveryStatus',
      'editedAt',
      'revokedAt',
    ],
    where,
    order: [
      ['occurredAt', 'DESC'],
      ['id', 'DESC'],
    ],
    limit: clampQueryLimit(params.limit),
  });
  return rows.map(briefItem);
}

export async function getWhatsAppMessageContext(params: {
  providerMessageId: string;
  before: number;
  after: number;
  phoneNumberId?: string;
  now?: Date;
}): Promise<WhatsAppBriefItem[]> {
  const providerMessageId = cleanRequired(params.providerMessageId, 256);
  if (!providerMessageId) return [];

  const now = params.now ?? new Date();
  if (!validDate(now)) throw new Error('Invalid WhatsApp context query date');
  const cutoff = new Date(now.getTime() - resolveWhatsAppRetentionDays() * DAY_MS);
  const targetWhere: Record<string, unknown> = {
    providerMessageId,
    occurredAt: { [Op.gte]: cutoff, [Op.lte]: now },
  };
  const phoneNumberId = params.phoneNumberId?.trim();
  if (phoneNumberId) targetWhere.phoneNumberId = phoneNumberId;
  const target = await WhatsAppMessage.findOne({ where: targetWhere });
  if (!target) return [];

  const before = Math.max(
    0,
    Math.min(Math.floor(params.before || 0), MAX_CONTEXT_ITEMS_PER_SIDE),
  );
  const after = Math.max(
    0,
    Math.min(Math.floor(params.after || 0), MAX_CONTEXT_ITEMS_PER_SIDE),
  );
  if (!target.contactKey || (!before && !after)) return [briefItem(target)];

  const conversationWhere = {
    phoneNumberId: target.phoneNumberId,
    contactKey: target.contactKey,
    occurredAt: { [Op.gte]: cutoff, [Op.lte]: now },
  };
  const [beforeRows, afterRows] = await Promise.all([
    before
      ? WhatsAppMessage.findAll({
          where: {
            ...conversationWhere,
            [Op.or]: [
              { occurredAt: { [Op.lt]: target.occurredAt } },
              { occurredAt: target.occurredAt, id: { [Op.lt]: target.id } },
            ],
          },
          order: [
            ['occurredAt', 'DESC'],
            ['id', 'DESC'],
          ],
          limit: before,
        })
      : Promise.resolve([]),
    after
      ? WhatsAppMessage.findAll({
          where: {
            ...conversationWhere,
            [Op.or]: [
              { occurredAt: { [Op.gt]: target.occurredAt } },
              { occurredAt: target.occurredAt, id: { [Op.gt]: target.id } },
            ],
          },
          order: [
            ['occurredAt', 'ASC'],
            ['id', 'ASC'],
          ],
          limit: after,
        })
      : Promise.resolve([]),
  ]);

  return [...beforeRows.reverse(), target, ...afterRows].map(briefItem);
}

export async function getWhatsAppSourceStatus(now = new Date()): Promise<WhatsAppSourceStatus> {
  let queueConfigured = true;
  try {
    getWhatsAppWebhookQueueConfig();
  } catch {
    queueConfigured = false;
  }
  const [state, queued, processing, failed, oldestPending] = await Promise.all([
    WhatsAppSourceState.findByPk(WHATSAPP_SOURCE_STATE_ID),
    WhatsAppWebhookInbox.count({ where: { status: 'queued' } }),
    WhatsAppWebhookInbox.count({ where: { status: 'processing' } }),
    WhatsAppWebhookInbox.count({ where: { status: 'failed' } }),
    WhatsAppWebhookInbox.findOne({
      attributes: ['receivedAt'],
      where: { status: { [Op.in]: ['queued', 'processing'] } },
      order: [['receivedAt', 'ASC']],
    }),
  ]);
  const onboardingGeneration = resolveWhatsAppOnboardingGeneration();
  const staleAfterHours = resolveWhatsAppSourceStaleHours();
  const lastSuccessfulIngestAt = asDate(state?.lastSuccessfulIngestAt);
  const stale = Boolean(
    lastSuccessfulIngestAt
    && lastSuccessfulIngestAt.getTime() < now.getTime() - staleAfterHours * 60 * 60 * 1000,
  );
  const accountDisconnected = state?.disconnectedGeneration === onboardingGeneration;
  const oldestPendingAt = asDate(oldestPending?.receivedAt);
  const stalePendingJob = Boolean(
    oldestPendingAt
    && oldestPendingAt.getTime() < now.getTime() - WHATSAPP_QUEUE_HEALTH_GRACE_MS,
  );
  // A fresh queued/processing row is normal. Only configuration failures,
  // dead letters, or a backlog older than the processing lease degrade reads.
  const queueHealthy = queueConfigured && failed === 0 && !stalePendingJob;
  const available = Boolean(
    state
    && state.status === 'connected'
    && state.onboardingGeneration === onboardingGeneration
    && !accountDisconnected
    && (state.historySyncStatus === 'complete' || state.historySyncStatus === 'declined')
    && lastSuccessfulIngestAt
    && !stale
    && queueHealthy,
  );
  const effectiveStatus = !state || accountDisconnected || state.status === 'unavailable'
    ? 'unavailable'
    : available
      ? 'connected'
      : 'degraded';
  return {
    source: 'whatsapp',
    available,
    status: effectiveStatus,
    historySyncStatus: state?.historySyncStatus ?? 'not_started',
    historySyncProgress: state?.historySyncProgress ?? null,
    lastWebhookAt: toIso(state?.lastWebhookAt),
    lastSuccessfulIngestAt: toIso(state?.lastSuccessfulIngestAt),
    lastMessageAt: toIso(state?.lastMessageAt),
    lastErrorAt: toIso(state?.lastErrorAt),
    lastErrorCode: state?.lastErrorCode ?? null,
    retentionDays: resolveWhatsAppRetentionDays(),
    stale,
    staleAfterHours,
    onboardingGeneration,
    accountDisconnected,
    queue: {
      configured: queueConfigured,
      queued,
      processing,
      failed,
      oldestPendingAt: toIso(oldestPendingAt),
    },
  };
}

export async function deleteExpiredWhatsAppMessages(now = new Date()): Promise<number> {
  if (!validDate(now)) throw new Error('Invalid WhatsApp retention date');
  const cutoff = new Date(now.getTime() - resolveWhatsAppRetentionDays() * DAY_MS);
  return WhatsAppMessage.destroy({
    where: { occurredAt: { [Op.lt]: cutoff } },
  });
}
