import crypto from 'crypto';
import HttpError from '../errors/HttpError.js';
import type { CompensationSettlementDestination } from './compensationSettlementRoutingService.js';

// These tokens authorize calculated money movement, so they intentionally
// live only long enough to submit the currently visible Pays modal. A refresh
// is required after compensation data has had time to change.
export const COMPENSATION_SETTLEMENT_INTENT_MAX_AGE_SECONDS = 10 * 60;
export const COMPENSATION_SETTLEMENT_INTENT_CLOCK_SKEW_SECONDS = 60;

export type CompensationSettlementIntentPayload = {
  userId: number;
  rangeStart: string;
  rangeEnd: string;
  sourceKey: string;
  componentId: number | null;
  category: string;
  destination: CompensationSettlementDestination;
  fundId: number | null;
  grossAmountMinor: number;
  outstandingAmountMinor: number;
  ruleId: number;
  currency: string;
  /** Unix time in whole seconds. */
  issuedAt: number;
};

export type CompensationSettlementIntentInput = Omit<
  CompensationSettlementIntentPayload,
  'issuedAt'
>;

export type SignCompensationSettlementIntentOptions = {
  now?: Date;
};

export type VerifyCompensationSettlementIntentOptions = {
  now?: Date;
  maxAgeSeconds?: number;
  clockSkewSeconds?: number;
  /**
   * Only for resolving an already-recorded idempotent retry. The signature,
   * payload shape, and future-issued guard are still enforced. Any new money
   * movement must verify the same token again without this option.
   */
  allowExpired?: boolean;
};

export class CompensationSettlementIntentConfigurationError extends Error {
  readonly code = 'COMPENSATION_SETTLEMENT_INTENT_SECRET_REQUIRED';

  constructor() {
    super('JWT_SECRET is required to sign or verify compensation settlement intents.');
    this.name = 'CompensationSettlementIntentConfigurationError';
  }
}

const invalidIntent = (message = 'Compensation settlement intent is invalid.'): HttpError =>
  new HttpError(400, message, { code: 'COMPENSATION_SETTLEMENT_INTENT_INVALID' });

const readSecret = (): string => {
  const secret = process.env.JWT_SECRET?.trim();
  if (!secret) {
    throw new CompensationSettlementIntentConfigurationError();
  }
  return secret;
};

const parsePositiveInteger = (value: unknown, field: string): number => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw invalidIntent(`${field} must be a positive integer.`);
  }
  return parsed;
};

const parseNullablePositiveInteger = (value: unknown, field: string): number | null => {
  if (value === null) {
    return null;
  }
  return parsePositiveInteger(value, field);
};

const parseMinorAmount = (
  value: unknown,
  field: string,
  options: { allowZero: boolean },
): number => {
  const parsed = Number(value);
  if (
    !Number.isSafeInteger(parsed)
    || parsed < 0
    || (!options.allowZero && parsed === 0)
  ) {
    const qualification = options.allowZero ? 'a non-negative' : 'a positive';
    throw invalidIntent(`${field} must be ${qualification} integer in minor currency units.`);
  }
  return parsed;
};

const parseDateOnly = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw invalidIntent(`${field} must use YYYY-MM-DD.`);
  }
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) {
    throw invalidIntent(`${field} must be a valid calendar date.`);
  }
  return value;
};

const parseIdentifier = (value: unknown, field: string): string => {
  if (typeof value !== 'string') {
    throw invalidIntent(`${field} is required.`);
  }
  const normalized = value.trim().toLowerCase();
  if (
    !normalized
    || normalized.length > 64
    || !/^[a-z0-9][a-z0-9_:-]*$/.test(normalized)
  ) {
    throw invalidIntent(`${field} must be a lowercase identifier.`);
  }
  return normalized;
};

const parseCurrency = (value: unknown): string => {
  if (typeof value !== 'string' || !/^[A-Za-z]{3}$/.test(value.trim())) {
    throw invalidIntent('currency must be a three-letter currency code.');
  }
  return value.trim().toUpperCase();
};

const parseDestination = (value: unknown): CompensationSettlementDestination => {
  if (value !== 'staff_vendor' && value !== 'volunteer_fund' && value !== 'excluded') {
    throw invalidIntent('destination is invalid.');
  }
  return value;
};

const parseIssuedAt = (value: unknown): number => {
  const issuedAt = Number(value);
  if (!Number.isSafeInteger(issuedAt) || issuedAt <= 0) {
    throw invalidIntent('issuedAt must be a positive Unix timestamp in seconds.');
  }
  return issuedAt;
};

const normalizePayload = (raw: Record<string, unknown>): CompensationSettlementIntentPayload => {
  const rangeStart = parseDateOnly(raw.rangeStart, 'rangeStart');
  const rangeEnd = parseDateOnly(raw.rangeEnd, 'rangeEnd');
  if (rangeEnd < rangeStart) {
    throw invalidIntent('rangeEnd must be on or after rangeStart.');
  }

  const destination = parseDestination(raw.destination);
  const fundId = parseNullablePositiveInteger(raw.fundId, 'fundId');
  if (destination === 'volunteer_fund' && fundId === null) {
    throw invalidIntent('fundId is required for a volunteer_fund intent.');
  }
  if (destination !== 'volunteer_fund' && fundId !== null) {
    throw invalidIntent('fundId is only allowed for a volunteer_fund intent.');
  }

  const grossAmountMinor = parseMinorAmount(raw.grossAmountMinor, 'grossAmountMinor', {
    allowZero: false,
  });
  const outstandingAmountMinor = parseMinorAmount(
    raw.outstandingAmountMinor,
    'outstandingAmountMinor',
    { allowZero: true },
  );
  if (outstandingAmountMinor > grossAmountMinor) {
    throw invalidIntent('outstandingAmountMinor cannot exceed grossAmountMinor.');
  }

  return {
    userId: parsePositiveInteger(raw.userId, 'userId'),
    rangeStart,
    rangeEnd,
    sourceKey: parseIdentifier(raw.sourceKey, 'sourceKey'),
    componentId: parseNullablePositiveInteger(raw.componentId, 'componentId'),
    category: parseIdentifier(raw.category, 'category'),
    destination,
    fundId,
    grossAmountMinor,
    outstandingAmountMinor,
    ruleId: parsePositiveInteger(raw.ruleId, 'ruleId'),
    currency: parseCurrency(raw.currency),
    issuedAt: parseIssuedAt(raw.issuedAt),
  };
};

const nowInSeconds = (now: Date | undefined): number => {
  const value = now ?? new Date();
  const timestamp = value.getTime();
  if (!Number.isFinite(timestamp)) {
    throw invalidIntent('The compensation settlement intent clock is invalid.');
  }
  return Math.floor(timestamp / 1000);
};

const signPayloadSegment = (payloadSegment: string, secret: string): Buffer =>
  crypto.createHmac('sha256', secret).update(payloadSegment, 'utf8').digest();

export const signCompensationSettlementIntent = (
  input: CompensationSettlementIntentInput,
  options: SignCompensationSettlementIntentOptions = {},
): string => {
  const secret = readSecret();
  const payload = normalizePayload({
    ...input,
    issuedAt: nowInSeconds(options.now),
  });
  const payloadSegment = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signatureSegment = signPayloadSegment(payloadSegment, secret).toString('base64url');
  return `${payloadSegment}.${signatureSegment}`;
};

const decodePayload = (payloadSegment: string): CompensationSettlementIntentPayload => {
  try {
    const decoded = Buffer.from(payloadSegment, 'base64url').toString('utf8');
    const parsed = JSON.parse(decoded) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw invalidIntent();
    }
    return normalizePayload(parsed as Record<string, unknown>);
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }
    throw invalidIntent();
  }
};

const parseDuration = (value: number, field: string, allowZero: boolean): number => {
  if (!Number.isSafeInteger(value) || value < 0 || (!allowZero && value === 0)) {
    throw new Error(`${field} must be ${allowZero ? 'a non-negative' : 'a positive'} integer.`);
  }
  return value;
};

export const verifyCompensationSettlementIntent = (
  token: string,
  options: VerifyCompensationSettlementIntentOptions = {},
): CompensationSettlementIntentPayload => {
  const secret = readSecret();
  if (typeof token !== 'string') {
    throw invalidIntent();
  }
  const segments = token.split('.');
  if (
    segments.length !== 2
    || !segments[0]
    || !segments[1]
    || !/^[A-Za-z0-9_-]+$/.test(segments[0])
    || !/^[A-Za-z0-9_-]+$/.test(segments[1])
  ) {
    throw invalidIntent();
  }

  const [payloadSegment, signatureSegment] = segments;
  const expectedSignature = signPayloadSegment(payloadSegment, secret);
  let suppliedSignature: Buffer;
  try {
    suppliedSignature = Buffer.from(signatureSegment, 'base64url');
  } catch {
    throw invalidIntent();
  }
  if (
    suppliedSignature.length !== expectedSignature.length
    || !crypto.timingSafeEqual(suppliedSignature, expectedSignature)
  ) {
    throw invalidIntent();
  }

  const payload = decodePayload(payloadSegment);
  const now = nowInSeconds(options.now);
  const maxAgeSeconds = parseDuration(
    options.maxAgeSeconds ?? COMPENSATION_SETTLEMENT_INTENT_MAX_AGE_SECONDS,
    'maxAgeSeconds',
    false,
  );
  const clockSkewSeconds = parseDuration(
    options.clockSkewSeconds ?? COMPENSATION_SETTLEMENT_INTENT_CLOCK_SKEW_SECONDS,
    'clockSkewSeconds',
    true,
  );
  if (payload.issuedAt > now + clockSkewSeconds) {
    throw invalidIntent('Compensation settlement intent was issued in the future.');
  }
  if (!options.allowExpired && now - payload.issuedAt > maxAgeSeconds) {
    throw new HttpError(409, 'Compensation settlement intent has expired. Refresh Pays and try again.', {
      code: 'COMPENSATION_SETTLEMENT_INTENT_EXPIRED',
      issuedAt: payload.issuedAt,
      maxAgeSeconds,
    });
  }
  return payload;
};
