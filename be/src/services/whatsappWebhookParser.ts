import { createHmac, timingSafeEqual } from 'node:crypto';

import type { WhatsAppConfig } from '../config/whatsappConfig.js';
import type {
  NormalizedWhatsAppAccountStateEvent,
  NormalizedWhatsAppHistorySyncEvent,
  NormalizedWhatsAppMessageEvent,
  NormalizedWhatsAppStatusEvent,
  NormalizedWhatsAppWebhookEvent,
  WhatsAppMessageDirection,
  WhatsAppWebhookBatch,
  WhatsAppWebhookParserOptions,
  WhatsAppWebhookSource,
} from '../types/whatsapp.js';

type UnknownRecord = Record<string, unknown>;
const MAX_NORMALIZED_TEXT_LENGTH = 4_000;

export class WhatsAppWebhookSignatureError extends Error {
  constructor() {
    super('Invalid WhatsApp webhook signature');
    this.name = 'WhatsAppWebhookSignatureError';
  }
}

export class WhatsAppWebhookValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WhatsAppWebhookValidationError';
  }
}

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const records = (value: unknown): UnknownRecord[] =>
  Array.isArray(value) ? value.filter(isRecord) : [];

const nonEmptyString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

const contentString = (value: unknown): string | null =>
  typeof value === 'string' ? value.slice(0, MAX_NORMALIZED_TEXT_LENGTH) : null;

const nestedRecord = (record: UnknownRecord, key: string): UnknownRecord | null => {
  const value = record[key];
  return isRecord(value) ? value : null;
};

const parseTimestamp = (value: unknown): Date | null => {
  let numericValue: number;

  if (typeof value === 'number') {
    numericValue = value;
  } else if (typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value.trim())) {
    numericValue = Number(value.trim());
  } else {
    return null;
  }

  if (!Number.isFinite(numericValue) || numericValue < 0) return null;

  // Meta normally sends epoch seconds, while accepting milliseconds makes replay/import
  // handling deterministic without treating either numeric representation as text.
  const epochMilliseconds = numericValue >= 100_000_000_000 ? numericValue : numericValue * 1_000;
  const timestamp = new Date(epochMilliseconds);
  return Number.isNaN(timestamp.getTime()) ? null : timestamp;
};

const parseInteger = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
};

const extractMessageText = (message: UnknownRecord, allowDirectBody = false): string | null => {
  const text = nestedRecord(message, 'text');
  if (text) {
    const body = contentString(text.body);
    if (body !== null) return body;
  }

  for (const contentType of ['image', 'video', 'document'] as const) {
    const content = nestedRecord(message, contentType);
    if (content) {
      const caption = contentString(content.caption);
      if (caption !== null) return caption;
    }
  }

  const button = nestedRecord(message, 'button');
  const buttonText = button && (contentString(button.text) ?? contentString(button.payload));
  if (typeof buttonText === 'string') return buttonText;

  const interactive = nestedRecord(message, 'interactive');
  if (interactive) {
    const buttonReply = nestedRecord(interactive, 'button_reply');
    const listReply = nestedRecord(interactive, 'list_reply');
    const replyText = buttonReply
      ? contentString(buttonReply.title) ?? contentString(buttonReply.id)
      : listReply
        ? contentString(listReply.title)
          ?? contentString(listReply.description)
          ?? contentString(listReply.id)
        : null;
    if (replyText !== null) return replyText;
  }

  const reaction = nestedRecord(message, 'reaction');
  if (reaction) {
    const emoji = contentString(reaction.emoji);
    return emoji ? `[Reaction] ${emoji}` : '[Reaction removed]';
  }

  const location = nestedRecord(message, 'location');
  if (location) {
    const label = [contentString(location.name), contentString(location.address)]
      .filter((value): value is string => Boolean(value))
      .join(' — ');
    return label ? `[Location] ${label}` : '[Location shared]';
  }

  const sharedContacts = records(message.contacts)
    .map((contact) => contentString(nestedRecord(contact, 'name')?.formatted_name))
    .filter((value): value is string => Boolean(value));
  if (sharedContacts.length > 0) {
    return `[Contact shared] ${sharedContacts.slice(0, 3).join(', ')}`;
  }

  return allowDirectBody ? contentString(message.body) : null;
};

const inferNestedMessageType = (message: UnknownRecord): string | null => {
  const explicitType = nonEmptyString(message.type);
  if (explicitType) return explicitType;
  if (nestedRecord(message, 'text') || typeof message.body === 'string') return 'text';
  for (const contentType of ['image', 'video', 'document'] as const) {
    if (nestedRecord(message, contentType)) return contentType;
  }
  return null;
};

interface MessageContext {
  source: WhatsAppWebhookSource;
  direction: WhatsAppMessageDirection;
  wabaId: string;
  phoneNumberId: string;
  contactName: string | null;
}

const normalizeMessage = (
  message: UnknownRecord,
  context: MessageContext,
): NormalizedWhatsAppMessageEvent | null => {
  const messageId = nonEmptyString(message.id);
  const timestamp = parseTimestamp(message.timestamp);
  if (!messageId || !timestamp) return null;

  const outerType = nonEmptyString(message.type) ?? 'unknown';
  let action: NormalizedWhatsAppMessageEvent['action'] = 'create';
  let targetMessageId: string | null = null;
  let messageType = outerType;
  let text = extractMessageText(message);
  let contextMessageId = nonEmptyString(nestedRecord(message, 'context')?.id);

  if (outerType === 'reaction') {
    contextMessageId = nonEmptyString(nestedRecord(message, 'reaction')?.message_id) ?? contextMessageId;
  }

  if (outerType === 'edit') {
    action = 'edit';
    const edit = nestedRecord(message, 'edit');
    targetMessageId = nonEmptyString(edit?.original_message_id);
    const editedMessage = edit && nestedRecord(edit, 'message');
    if (editedMessage) {
      messageType = inferNestedMessageType(editedMessage) ?? outerType;
      text = extractMessageText(editedMessage, true);
      contextMessageId =
        nonEmptyString(nestedRecord(editedMessage, 'context')?.id) ?? contextMessageId;
    }
  } else if (outerType === 'revoke') {
    action = 'revoke';
    const revoke = nestedRecord(message, 'revoke');
    targetMessageId = nonEmptyString(revoke?.original_message_id);
    text = null;
  }

  return {
    kind: 'message',
    source: context.source,
    direction: context.direction,
    action,
    wabaId: context.wabaId,
    phoneNumberId: context.phoneNumberId,
    messageId,
    targetMessageId,
    senderWaId: nonEmptyString(message.from),
    recipientWaId: nonEmptyString(message.to),
    contactName: context.contactName,
    messageType,
    text,
    contextMessageId,
    timestamp,
  };
};

const normalizeStatus = (
  status: UnknownRecord,
  wabaId: string,
  phoneNumberId: string,
): NormalizedWhatsAppStatusEvent | null => {
  const messageId = nonEmptyString(status.id);
  const statusName = nonEmptyString(status.status);
  const timestamp = parseTimestamp(status.timestamp);
  if (!messageId || !statusName || !timestamp) return null;

  return {
    kind: 'status',
    source: 'messages',
    wabaId,
    phoneNumberId,
    messageId,
    recipientWaId: nonEmptyString(status.recipient_id),
    status: statusName,
    conversationId: nonEmptyString(nestedRecord(status, 'conversation')?.id),
    timestamp,
  };
};

const buildContactNameIndex = (value: UnknownRecord): Map<string, string> => {
  const names = new Map<string, string>();
  for (const contact of records(value.contacts)) {
    const waId = nonEmptyString(contact.wa_id);
    const name = nonEmptyString(nestedRecord(contact, 'profile')?.name);
    if (waId && name) names.set(waId, name);
  }
  return names;
};

const historyDirection = (
  message: UnknownRecord,
  threadId: string | null,
  businessDisplayPhone: string | null,
): WhatsAppMessageDirection => {
  const from = nonEmptyString(message.from);
  const to = nonEmptyString(message.to);
  if (threadId && from === threadId) return 'inbound';
  if (threadId && to === threadId) return 'outbound';

  const businessDigits = normalizedDigits(businessDisplayPhone);
  if (businessDigits && normalizedDigits(from) === businessDigits) return 'outbound';
  if (businessDigits && normalizedDigits(to) === businessDigits) return 'inbound';

  const historyStatus = nonEmptyString(nestedRecord(message, 'history_context')?.status)?.toUpperCase();
  if (historyStatus === 'RECEIVED') return 'inbound';
  if (historyStatus) return 'outbound';
  return 'inbound';
};

const normalizedDigits = (value: string | null): string | null => {
  const digits = value?.replace(/\D/g, '') ?? '';
  return digits || null;
};

const historyMediaDirection = (
  message: UnknownRecord,
  businessDisplayPhone: string | null,
): WhatsAppMessageDirection => {
  const businessDigits = normalizedDigits(businessDisplayPhone);
  const fromDigits = normalizedDigits(nonEmptyString(message.from));
  return businessDigits && fromDigits === businessDigits ? 'outbound' : 'inbound';
};

const parseMessagesChange = (
  value: UnknownRecord,
  wabaId: string,
  phoneNumberId: string,
): NormalizedWhatsAppWebhookEvent[] => {
  const events: NormalizedWhatsAppWebhookEvent[] = [];
  const contactNames = buildContactNameIndex(value);

  for (const message of records(value.messages)) {
    const senderWaId = nonEmptyString(message.from);
    const normalized = normalizeMessage(message, {
      source: 'messages',
      direction: 'inbound',
      wabaId,
      phoneNumberId,
      contactName: senderWaId ? contactNames.get(senderWaId) ?? null : null,
    });
    if (normalized) events.push(normalized);
  }

  for (const status of records(value.statuses)) {
    const normalized = normalizeStatus(status, wabaId, phoneNumberId);
    if (normalized) events.push(normalized);
  }

  return events;
};

const parseHistoryChange = (
  value: UnknownRecord,
  wabaId: string,
  phoneNumberId: string,
): NormalizedWhatsAppWebhookEvent[] => {
  const events: NormalizedWhatsAppWebhookEvent[] = [];
  const metadata = nestedRecord(value, 'metadata');
  const businessDisplayPhone = nonEmptyString(metadata?.display_phone_number);

  for (const historyChunk of records(value.history)) {
    const chunkMetadata = nestedRecord(historyChunk, 'metadata');
    const progress = parseInteger(chunkMetadata?.progress);
    const errors = records(historyChunk.errors);
    const errorCode = errors.length > 0
      ? String(errors.map((error) => error.code).find((code) => code !== undefined) ?? 'history_sync_failed')
      : null;
    const syncEvent: NormalizedWhatsAppHistorySyncEvent = {
      kind: 'history_sync',
      source: 'history',
      wabaId,
      phoneNumberId,
      status: errorCode === '2593109'
        ? 'declined'
        : errorCode
          ? 'failed'
          : progress === 100
            ? 'complete'
            : 'in_progress',
      progress,
      phase: parseInteger(chunkMetadata?.phase),
      chunkOrder: parseInteger(chunkMetadata?.chunk_order),
      errorCode,
    };
    events.push(syncEvent);

    for (const thread of records(historyChunk.threads)) {
      const threadId = nonEmptyString(thread.id);
      for (const message of records(thread.messages)) {
        const direction = historyDirection(message, threadId, businessDisplayPhone);
        const messageWithConversation = {
          ...message,
          ...(direction === 'inbound' && !nonEmptyString(message.from) && threadId
            ? { from: threadId }
            : {}),
          ...(direction === 'outbound' && !nonEmptyString(message.to) && threadId
            ? { to: threadId }
            : {}),
        };
        const normalized = normalizeMessage(messageWithConversation, {
          source: 'history',
          direction,
          wabaId,
          phoneNumberId,
          contactName: null,
        });
        if (normalized) events.push(normalized);
      }
    }
  }

  // History media enrichment is delivered as value.messages[] under field=history.
  // Retain only its normalized type/caption; never persist Meta media identifiers.
  for (const message of records(value.messages)) {
    const normalized = normalizeMessage(message, {
      source: 'history',
      direction: historyMediaDirection(message, businessDisplayPhone),
      wabaId,
      phoneNumberId,
      contactName: null,
    });
    if (normalized) events.push(normalized);
  }

  return events;
};

const parseMessageEchoesChange = (
  value: UnknownRecord,
  wabaId: string,
  phoneNumberId: string,
): NormalizedWhatsAppMessageEvent[] => {
  const events: NormalizedWhatsAppMessageEvent[] = [];

  for (const message of records(value.message_echoes)) {
    const normalized = normalizeMessage(message, {
      source: 'smb_message_echoes',
      direction: 'outbound',
      wabaId,
      phoneNumberId,
      contactName: null,
    });
    if (normalized) events.push(normalized);
  }

  return events;
};

type SupportedWebhookField = WhatsAppWebhookSource | 'account_update' | 'smb_app_state_sync';

const supportedField = (
  value: string | null,
): value is SupportedWebhookField =>
  value === 'messages'
  || value === 'history'
  || value === 'smb_message_echoes'
  || value === 'smb_app_state_sync'
  || value === 'account_update';

const parseAccountUpdateChange = (
  value: UnknownRecord,
  wabaId: string,
  expectedPhoneNumberId: string,
): NormalizedWhatsAppAccountStateEvent[] => {
  const metadataPhoneNumberId = nonEmptyString(nestedRecord(value, 'metadata')?.phone_number_id);
  if (metadataPhoneNumberId && metadataPhoneNumberId !== expectedPhoneNumberId) {
    throw new WhatsAppWebhookValidationError('WhatsApp webhook has an unexpected phone number id');
  }

  const event = nonEmptyString(value.event)
    ?? nonEmptyString(nestedRecord(value, 'account_update')?.event);
  if (!event) return [];
  return [{
    kind: 'account_state',
    source: 'account_update',
    wabaId,
    // Meta's account_update payload may omit metadata.phone_number_id. This
    // connector intentionally supports one configured number per WABA, so such
    // account-level events are scoped to that configured number.
    phoneNumberId: metadataPhoneNumberId ?? expectedPhoneNumberId,
    event,
    unavailable: /(partner_removed|removed|disabled|blocked|banned|deleted|disconnected)/i.test(event),
  }];
};

const validateChangeScope = (
  value: UnknownRecord,
  options: WhatsAppWebhookParserOptions,
): string => {
  const metadata = nestedRecord(value, 'metadata');
  const phoneNumberId = nonEmptyString(metadata?.phone_number_id);
  if (!phoneNumberId) {
    throw new WhatsAppWebhookValidationError('WhatsApp webhook is missing its phone number id');
  }
  if (phoneNumberId !== options.expectedPhoneNumberId) {
    throw new WhatsAppWebhookValidationError('WhatsApp webhook has an unexpected phone number id');
  }
  return phoneNumberId;
};

export const parseWhatsAppWebhookPayload = (
  payload: unknown,
  options: WhatsAppWebhookParserOptions,
): NormalizedWhatsAppWebhookEvent[] => {
  if (!isRecord(payload) || payload.object !== 'whatsapp_business_account') {
    throw new WhatsAppWebhookValidationError(
      'Webhook object must be whatsapp_business_account',
    );
  }

  const events: NormalizedWhatsAppWebhookEvent[] = [];
  for (const entry of records(payload.entry)) {
    const wabaId = nonEmptyString(entry.id);
    if (!wabaId) {
      throw new WhatsAppWebhookValidationError('WhatsApp webhook entry is missing its WABA id');
    }
    if (wabaId !== options.expectedWabaId) {
      throw new WhatsAppWebhookValidationError('WhatsApp webhook has an unexpected WABA id');
    }

    for (const change of records(entry.changes)) {
      const field = nonEmptyString(change.field);
      if (!supportedField(field)) continue;

      const value = nestedRecord(change, 'value');
      if (!value) {
        throw new WhatsAppWebhookValidationError('WhatsApp webhook change is missing its value');
      }
      if (field === 'account_update') {
        events.push(...parseAccountUpdateChange(value, wabaId, options.expectedPhoneNumberId));
        continue;
      }
      const phoneNumberId = validateChangeScope(value, options);

      if (field === 'smb_app_state_sync') {
        // Coexistence requires this subscription. Validate its account scope, but
        // intentionally retain no address-book data: the morning brief only needs
        // messages and contact sync payloads contain personal data we do not use.
        continue;
      }
      if (field === 'messages') {
        events.push(...parseMessagesChange(value, wabaId, phoneNumberId));
      } else if (field === 'history') {
        events.push(...parseHistoryChange(value, wabaId, phoneNumberId));
      } else {
        events.push(...parseMessageEchoesChange(value, wabaId, phoneNumberId));
      }
    }
  }

  return events;
};

export const verifyWhatsAppWebhookSignature = (
  rawBody: Buffer,
  signatureHeader: unknown,
  appSecret: string,
): boolean => {
  if (!Buffer.isBuffer(rawBody)) {
    throw new TypeError('WhatsApp webhook signature verification requires a raw Buffer');
  }
  if (!appSecret) {
    throw new Error('WhatsApp app secret is required for webhook signature verification');
  }
  if (typeof signatureHeader !== 'string') return false;

  const match = /^sha256=([a-f0-9]{64})$/.exec(signatureHeader);
  if (!match) return false;

  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  const supplied = Buffer.from(match[1], 'hex');
  return supplied.length === expected.length && timingSafeEqual(expected, supplied);
};

export const verifyMetaWebhookSignature = (
  rawBody: Buffer,
  signatureHeader: string | undefined,
  appSecret: string,
): boolean => verifyWhatsAppWebhookSignature(rawBody, signatureHeader, appSecret);

export const parseMetaWebhook = (
  rawBody: Buffer,
  expectedIds: { wabaId: string; phoneNumberId: string },
): WhatsAppWebhookBatch => {
  if (!Buffer.isBuffer(rawBody)) {
    throw new TypeError('WhatsApp webhook parsing requires a raw Buffer');
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody.toString('utf8')) as unknown;
  } catch {
    throw new WhatsAppWebhookValidationError('WhatsApp webhook body is not valid JSON');
  }

  return {
    events: parseWhatsAppWebhookPayload(payload, {
      expectedWabaId: expectedIds.wabaId,
      expectedPhoneNumberId: expectedIds.phoneNumberId,
    }),
  };
};

export const parseSignedWhatsAppWebhook = (
  rawBody: Buffer,
  signatureHeader: unknown,
  config: Pick<WhatsAppConfig, 'metaAppSecret' | 'wabaId' | 'phoneNumberId'>,
): NormalizedWhatsAppWebhookEvent[] => {
  if (!verifyWhatsAppWebhookSignature(rawBody, signatureHeader, config.metaAppSecret)) {
    throw new WhatsAppWebhookSignatureError();
  }

  return parseMetaWebhook(rawBody, {
    wabaId: config.wabaId,
    phoneNumberId: config.phoneNumberId,
  }).events;
};
