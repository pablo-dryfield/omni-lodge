import { createHash, randomUUID } from 'node:crypto';
import { Op } from 'sequelize';

import StorefrontJourneyEvent from '../models/StorefrontJourneyEvent.js';
import StorefrontJourneyVisit from '../models/StorefrontJourneyVisit.js';
import StorefrontOngoingCart from '../models/StorefrontOngoingCart.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_CLIENT_EVENTS = 200;
const MAX_EVENT_AGE_MS = 48 * 60 * 60 * 1000;
const MAX_DETAIL_DEPTH = 6;
const PERMANENT_CLIENT_EVENT_TYPES = [
  'checkout_opened',
  'checkout_reopened',
  'payment_element_ready',
  'payment_details_completed',
  'payment_attempted',
  'payment_error',
  'payment_authentication_cancelled',
  'recovery_email_opened',
];

const CLIENT_EVENT_TYPES = new Set([
  'product_viewed',
  'booking_builder_reached',
  'participant_changed',
  'experience_date_changed',
  'experience_time_changed',
  'addon_changed',
  'addon_variant_changed',
  'contact_field_completed',
  'contact_information_valid',
  'add_to_cart',
  'cart_opened',
  'cart_item_removed',
  'cart_item_edit_started',
  'cart_item_updated',
  'discount_applied',
  'checkout_opened',
  'checkout_reopened',
  'payment_element_ready',
  'payment_details_completed',
  'payment_attempted',
  'payment_error',
  'payment_authentication_cancelled',
  'checkout_page_hidden',
  'checkout_page_resumed',
  'recovery_email_opened',
]);

const BLOCKED_DETAIL_KEYS = new Set([
  'card',
  'cardnumber',
  'clientsecret',
  'cvc',
  'cvv',
  'customer',
  'email',
  'expiration',
  'expiry',
  'expirymonth',
  'expiryyear',
  'fullname',
  'paymentmethod',
  'phone',
  'phonelocal',
]);

type JourneyClientContext = {
  browserId: string | null;
  pageId: string | null;
  claritySampled: boolean;
  claritySessionId: string | null;
};

export type StorefrontJourneyEventInput = {
  eventId: string;
  visitId: string;
  pageId: string | null;
  type: string;
  occurredAt: Date;
  sequence: number | null;
  details: Record<string, unknown> | null;
};

export type StorefrontJourneyTimelineEvent = {
  id: string;
  type: string;
  source: string;
  severity: string;
  sequence: number | null;
  occurredAt: Date;
  receivedAt: Date;
  details: Record<string, unknown> | null;
};

export type StorefrontJourneyTimelineVisit = {
  id: string;
  browserInstanceId: string | null;
  startedAt: Date;
  lastActivityAt: Date;
  qualifiedAt: Date;
  claritySampled: boolean;
  claritySessionId: string | null;
  events: StorefrontJourneyTimelineEvent[];
};

const uuid = (value: unknown): string | null => {
  const normalized = String(value ?? '').trim();
  return UUID_PATTERN.test(normalized) ? normalized : null;
};

const text = (value: unknown, maximum: number): string =>
  typeof value === 'string' ? value.trim().slice(0, maximum) : '';

const sanitizeValue = (value: unknown, depth = 0): unknown => {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return value.slice(0, 300);
  if (depth >= MAX_DETAIL_DEPTH) return null;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizeValue(item, depth + 1));
  if (!value || typeof value !== 'object') return null;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !BLOCKED_DETAIL_KEYS.has(key.toLowerCase()))
      .slice(0, 30)
      .map(([key, item]) => [key.slice(0, 80), sanitizeValue(item, depth + 1)]),
  );
};

const sanitizeDetails = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const sanitized = sanitizeValue(value);
  return sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized)
    ? sanitized as Record<string, unknown>
    : null;
};

const eventDate = (value: unknown, now: Date): Date => {
  const parsed = new Date(String(value ?? ''));
  if (!Number.isFinite(parsed.getTime())) return now;
  if (parsed.getTime() > now.getTime() + 5 * 60_000) return now;
  if (parsed.getTime() < now.getTime() - MAX_EVENT_AGE_MS) {
    return new Date(now.getTime() - MAX_EVENT_AGE_MS);
  }
  return parsed;
};

export const normalizeJourneyClientContext = (value: unknown): JourneyClientContext => {
  const input = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    browserId: uuid(input.browserId),
    pageId: uuid(input.pageId),
    claritySampled: input.claritySampled === true,
    claritySessionId: text(input.claritySessionId, 255) || null,
  };
};

export const normalizeClientJourneyEvents = (
  value: unknown,
  contextValue: unknown,
  now = new Date(),
): StorefrontJourneyEventInput[] => {
  if (!Array.isArray(value)) return [];
  const context = normalizeJourneyClientContext(contextValue);
  return value.slice(0, MAX_CLIENT_EVENTS).flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return [];
    const input = candidate as Record<string, unknown>;
    const eventId = uuid(input.eventId);
    const visitId = uuid(input.visitId);
    const type = text(input.type, 64);
    if (!eventId || !visitId || !CLIENT_EVENT_TYPES.has(type)) return [];
    const sequenceValue = Number(input.sequence);
    return [{
      eventId,
      visitId,
      pageId: uuid(input.pageId) ?? context.pageId,
      type,
      occurredAt: eventDate(input.occurredAt, now),
      sequence: Number.isInteger(sequenceValue) && sequenceValue >= 0 ? sequenceValue : null,
      details: sanitizeDetails(input.details),
    }];
  });
};

const minDate = (events: StorefrontJourneyEventInput[]): Date =>
  new Date(Math.min(...events.map((event) => event.occurredAt.getTime())));

const maxDate = (events: StorefrontJourneyEventInput[]): Date =>
  new Date(Math.max(...events.map((event) => event.occurredAt.getTime())));

export const ingestClientJourneyEvents = async (
  ongoing: StorefrontOngoingCart,
  rawEvents: unknown,
  rawContext: unknown,
): Promise<{ acceptedEventIds: string[] }> => {
  const now = new Date();
  const context = normalizeJourneyClientContext(rawContext);
  const events = normalizeClientJourneyEvents(rawEvents, rawContext, now);
  if (!events.length) return { acceptedEventIds: [] };

  const byVisit = new Map<string, StorefrontJourneyEventInput[]>();
  for (const event of events) {
    byVisit.set(event.visitId, [...(byVisit.get(event.visitId) ?? []), event]);
  }

  const acceptedEventIds: string[] = [];
  for (const [publicId, visitEvents] of byVisit) {
    const [visit, created] = await StorefrontJourneyVisit.findOrCreate({
      where: { publicId },
      defaults: {
        publicId,
        ongoingCartId: ongoing.id,
        browserInstanceId: context.browserId,
        firstPageId: visitEvents[0]?.pageId ?? context.pageId,
        lastPageId: visitEvents.at(-1)?.pageId ?? context.pageId,
        startedAt: minDate(visitEvents),
        lastActivityAt: maxDate(visitEvents),
        qualifiedAt: now,
        claritySampled: context.claritySampled,
        claritySessionId: context.claritySessionId,
      } as never,
    });
    if (Number(visit.ongoingCartId) !== Number(ongoing.id)) continue;
    if (!created) {
      const latest = maxDate(visitEvents);
      await visit.update({
        browserInstanceId: visit.browserInstanceId ?? context.browserId,
        lastPageId: visitEvents.at(-1)?.pageId ?? context.pageId ?? visit.lastPageId,
        lastActivityAt: latest > visit.lastActivityAt ? latest : visit.lastActivityAt,
        claritySampled: visit.claritySampled || context.claritySampled,
        claritySessionId: context.claritySessionId ?? visit.claritySessionId,
      });
    }

    await StorefrontJourneyEvent.bulkCreate(
      visitEvents.map((event) => ({
        publicId: event.eventId,
        visitId: visit.id,
        ongoingCartId: ongoing.id,
        pageId: event.pageId,
        type: event.type,
        source: 'client',
        severity: event.type.includes('error') ? 'error' : 'info',
        sequence: event.sequence,
        occurredAt: event.occurredAt,
        details: event.details,
      })) as never[],
      { ignoreDuplicates: true },
    );
    acceptedEventIds.push(...visitEvents.map((event) => event.eventId));
  }

  return { acceptedEventIds };
};

const deterministicUuid = (value: string): string => {
  const digest = createHash('sha256').update(value).digest('hex').slice(0, 32).split('');
  digest[12] = '4';
  digest[16] = ['8', '9', 'a', 'b'][Number.parseInt(digest[16], 16) % 4];
  return `${digest.slice(0, 8).join('')}-${digest.slice(8, 12).join('')}-${digest.slice(12, 16).join('')}-${digest.slice(16, 20).join('')}-${digest.slice(20).join('')}`;
};

export const recordServerJourneyEvent = async (
  ongoing: StorefrontOngoingCart,
  event: {
    type: string;
    severity: 'info' | 'warning' | 'error';
    message: string;
    details: Record<string, unknown> | null;
    dedupeKey?: string;
    occurredAt?: Date;
    source?: 'server' | 'stripe';
  },
): Promise<void> => {
  const occurredAt = event.occurredAt ?? new Date();
  let visit = await StorefrontJourneyVisit.findOne({
    where: { ongoingCartId: ongoing.id },
    order: [['lastActivityAt', 'DESC']],
  });
  if (!visit) {
    visit = await StorefrontJourneyVisit.create({
      publicId: randomUUID(),
      ongoingCartId: ongoing.id,
      browserInstanceId: null,
      firstPageId: null,
      lastPageId: null,
      startedAt: occurredAt,
      lastActivityAt: occurredAt,
      qualifiedAt: occurredAt,
      claritySampled: false,
      claritySessionId: null,
    } as never);
  } else if (occurredAt > visit.lastActivityAt) {
    await visit.update({ lastActivityAt: occurredAt });
  }

  const publicId = event.dedupeKey
    ? deterministicUuid(`${ongoing.publicId}:${event.dedupeKey}`)
    : randomUUID();
  await StorefrontJourneyEvent.bulkCreate([{
    publicId,
    visitId: visit.id,
    ongoingCartId: ongoing.id,
    pageId: visit.lastPageId,
    type: text(event.type, 64) || 'storefront_event',
    source: event.source ?? 'server',
    severity: event.severity,
    sequence: null,
    occurredAt,
    details: sanitizeDetails({
      message: text(event.message, 1000),
      ...(event.details ?? {}),
      ...(event.dedupeKey ? { dedupeKey: event.dedupeKey } : {}),
    }),
  }] as never[], { ignoreDuplicates: true });
};

export const getOngoingCartJourney = async (
  ongoingCartId: number,
): Promise<StorefrontJourneyTimelineVisit[]> => {
  const visits = await StorefrontJourneyVisit.findAll({
    where: { ongoingCartId },
    order: [['startedAt', 'ASC']],
  });
  if (!visits.length) return [];
  const events = await StorefrontJourneyEvent.findAll({
    where: { visitId: { [Op.in]: visits.map((visit) => visit.id) } },
    order: [['occurredAt', 'ASC'], ['id', 'ASC']],
  });
  const byVisit = new Map<number, StorefrontJourneyTimelineEvent[]>();
  for (const event of events) {
    byVisit.set(Number(event.visitId), [...(byVisit.get(Number(event.visitId)) ?? []), {
      id: event.publicId,
      type: event.type,
      source: event.source,
      severity: event.severity,
      sequence: event.sequence,
      occurredAt: event.occurredAt,
      receivedAt: event.receivedAt,
      details: event.details,
    }]);
  }
  return visits.map((visit) => ({
    id: visit.publicId,
    browserInstanceId: visit.browserInstanceId,
    startedAt: visit.startedAt,
    lastActivityAt: visit.lastActivityAt,
    qualifiedAt: visit.qualifiedAt,
    claritySampled: visit.claritySampled,
    claritySessionId: visit.claritySessionId,
    events: byVisit.get(Number(visit.id)) ?? [],
  }));
};

export const purgeExpiredStorefrontJourneyDetails = async (
  retentionDays: number,
  now = new Date(),
): Promise<number> => {
  const days = Math.max(7, Math.min(730, Math.trunc(retentionDays) || 90));
  return StorefrontJourneyEvent.destroy({
    where: {
      source: 'client',
      type: { [Op.notIn]: PERMANENT_CLIENT_EVENT_TYPES },
      occurredAt: { [Op.lt]: new Date(now.getTime() - days * 24 * 60 * 60 * 1000) },
    },
  });
};
