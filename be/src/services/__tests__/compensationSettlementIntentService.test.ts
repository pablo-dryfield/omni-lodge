import crypto from 'crypto';
import HttpError from '../../errors/HttpError.js';
import {
  COMPENSATION_SETTLEMENT_INTENT_MAX_AGE_SECONDS,
  CompensationSettlementIntentConfigurationError,
  signCompensationSettlementIntent,
  verifyCompensationSettlementIntent,
  type CompensationSettlementIntentInput,
} from '../compensationSettlementIntentService.js';

const FIXED_NOW = new Date('2026-08-29T12:00:00.000Z');
const FIXED_NOW_SECONDS = Math.floor(FIXED_NOW.getTime() / 1000);
const originalSecret = process.env.JWT_SECRET;

const baseIntent = (overrides: Partial<CompensationSettlementIntentInput> = {}): CompensationSettlementIntentInput => ({
  userId: 191,
  rangeStart: '2026-08-01',
  rangeEnd: '2026-08-31',
  sourceKey: 'guide_commission',
  componentId: null,
  category: 'commission',
  destination: 'volunteer_fund',
  fundId: 7,
  grossAmountMinor: 18_000,
  outstandingAmountMinor: 12_500,
  ruleId: 42,
  currency: 'PLN',
  ...overrides,
});

const signRawPayload = (payload: Record<string, unknown>, secret: string): string => {
  const payloadSegment = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(payloadSegment, 'utf8').digest('base64url');
  return `${payloadSegment}.${signature}`;
};

describe('compensation settlement intent service', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = 'test-only-compensation-settlement-secret';
  });

  afterAll(() => {
    if (originalSecret === undefined) {
      delete process.env.JWT_SECRET;
    } else {
      process.env.JWT_SECRET = originalSecret;
    }
  });

  it('round-trips every authoritative allocation field and adds issuedAt', () => {
    const token = signCompensationSettlementIntent(baseIntent(), { now: FIXED_NOW });

    expect(verifyCompensationSettlementIntent(token, { now: FIXED_NOW })).toEqual({
      ...baseIntent(),
      issuedAt: FIXED_NOW_SECONDS,
    });
    expect(token.split('.')).toHaveLength(2);
  });

  it('normalizes identifiers and currency before signing', () => {
    const token = signCompensationSettlementIntent(
      baseIntent({ sourceKey: ' GUIDE_COMMISSION ', category: ' COMMISSION ', currency: 'pln' }),
      { now: FIXED_NOW },
    );

    expect(verifyCompensationSettlementIntent(token, { now: FIXED_NOW })).toMatchObject({
      sourceKey: 'guide_commission',
      category: 'commission',
      currency: 'PLN',
    });
  });

  it('rejects payload or signature tampering', () => {
    const token = signCompensationSettlementIntent(baseIntent(), { now: FIXED_NOW });
    const [payloadSegment, signatureSegment] = token.split('.');
    const decoded = JSON.parse(Buffer.from(payloadSegment, 'base64url').toString('utf8')) as Record<string, unknown>;
    decoded.outstandingAmountMinor = 99_999;
    const tamperedPayload = Buffer.from(JSON.stringify(decoded), 'utf8').toString('base64url');

    expect(() => verifyCompensationSettlementIntent(
      `${tamperedPayload}.${signatureSegment}`,
      { now: FIXED_NOW },
    )).toThrow(HttpError);
    expect(() => verifyCompensationSettlementIntent(
      `${payloadSegment}.${signatureSegment.slice(0, -1)}A`,
      { now: FIXED_NOW },
    )).toThrow('Compensation settlement intent is invalid.');
  });

  it('expires intents after the configured maximum age', () => {
    const token = signCompensationSettlementIntent(baseIntent(), { now: FIXED_NOW });
    const afterExpiry = new Date(
      FIXED_NOW.getTime() + (COMPENSATION_SETTLEMENT_INTENT_MAX_AGE_SECONDS + 1) * 1000,
    );

    expect(() => verifyCompensationSettlementIntent(token, { now: afterExpiry })).toThrow(
      'Compensation settlement intent has expired. Refresh Pays and try again.',
    );
  });

  it('can decode an expired signed intent only for idempotency matching', () => {
    const token = signCompensationSettlementIntent(baseIntent(), { now: FIXED_NOW });
    const afterExpiry = new Date(
      FIXED_NOW.getTime() + (COMPENSATION_SETTLEMENT_INTENT_MAX_AGE_SECONDS + 1) * 1000,
    );

    expect(verifyCompensationSettlementIntent(token, {
      now: afterExpiry,
      allowExpired: true,
    })).toMatchObject({
      ...baseIntent(),
      issuedAt: FIXED_NOW_SECONDS,
    });
  });

  it('rejects intents issued beyond the clock-skew allowance', () => {
    const future = new Date(FIXED_NOW.getTime() + 10 * 60 * 1000);
    const token = signCompensationSettlementIntent(baseIntent(), { now: future });

    expect(() => verifyCompensationSettlementIntent(token, { now: FIXED_NOW })).toThrow(
      'Compensation settlement intent was issued in the future.',
    );
  });

  it('rejects signed payloads whose semantic fields are inconsistent', () => {
    const invalidPayload = {
      ...baseIntent(),
      outstandingAmountMinor: 18_001,
      issuedAt: FIXED_NOW_SECONDS,
    };
    const token = signRawPayload(invalidPayload, process.env.JWT_SECRET as string);

    expect(() => verifyCompensationSettlementIntent(token, { now: FIXED_NOW })).toThrow(
      'outstandingAmountMinor cannot exceed grossAmountMinor.',
    );
    expect(() => signCompensationSettlementIntent(
      baseIntent({ destination: 'staff_vendor', fundId: 7 }),
      { now: FIXED_NOW },
    )).toThrow('fundId is only allowed for a volunteer_fund intent.');
  });

  it('fails clearly when JWT_SECRET is absent', () => {
    delete process.env.JWT_SECRET;

    expect(() => signCompensationSettlementIntent(baseIntent(), { now: FIXED_NOW }))
      .toThrow(CompensationSettlementIntentConfigurationError);
    expect(() => verifyCompensationSettlementIntent('payload.signature', { now: FIXED_NOW }))
      .toThrow('JWT_SECRET is required to sign or verify compensation settlement intents.');
  });
});
