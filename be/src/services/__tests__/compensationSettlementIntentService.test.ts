import crypto from 'crypto';
import HttpError from '../../errors/HttpError.js';
import {
  COMPENSATION_SETTLEMENT_INTENT_MAX_AGE_SECONDS,
  CompensationSettlementIntentConfigurationError,
  getCompensationSettlementIntentDirection,
  isSegmentedCompensationSettlementIntent,
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
      version: 1,
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
      version: 1,
    });
  });

  it('round-trips the complete v2 staff-type earning segment', () => {
    const token = signCompensationSettlementIntent({
      ...baseIntent(),
      direction: 'payable',
      segmentKey: 'seg_1234567890abcdef1234567890abcdef',
      earningStart: '2026-08-01',
      earningEnd: '2026-08-15',
      staffTypePeriodId: 10,
      staffType: ' VOLUNTEER ',
      legacyExtrapolation: true,
      referenceIds: [9514, 9513, 9514],
    }, { now: FIXED_NOW });

    const verified = verifyCompensationSettlementIntent(token, { now: FIXED_NOW });
    expect(isSegmentedCompensationSettlementIntent(verified)).toBe(true);
    expect(getCompensationSettlementIntentDirection(verified)).toBe('payable');
    expect(verified).toEqual({
      ...baseIntent(),
      issuedAt: FIXED_NOW_SECONDS,
      version: 2,
      direction: 'payable',
      segmentKey: 'seg_1234567890abcdef1234567890abcdef',
      earningStart: '2026-08-01',
      earningEnd: '2026-08-15',
      staffTypePeriodId: 10,
      staffType: 'volunteer',
      legacyExtrapolation: true,
      referenceIds: [9513, 9514],
    });
  });

  it('verifies pre-version signed intents as normalized v1 payloads', () => {
    const token = signRawPayload({
      ...baseIntent(),
      issuedAt: FIXED_NOW_SECONDS,
    }, process.env.JWT_SECRET as string);

    expect(verifyCompensationSettlementIntent(token, { now: FIXED_NOW })).toEqual({
      ...baseIntent(),
      issuedAt: FIXED_NOW_SECONDS,
      version: 1,
    });
    expect(getCompensationSettlementIntentDirection(
      verifyCompensationSettlementIntent(token, { now: FIXED_NOW }),
    )).toBe('payable');
  });

  it('rejects partial or range-inconsistent v2 segment fields', () => {
    expect(() => signCompensationSettlementIntent({
      ...baseIntent(),
      version: 2,
      segmentKey: 'seg_incomplete',
    } as CompensationSettlementIntentInput, { now: FIXED_NOW })).toThrow(
      'earningStart must use YYYY-MM-DD.',
    );

    expect(() => signCompensationSettlementIntent({
      ...baseIntent(),
      segmentKey: 'seg_outside_range',
      earningStart: '2026-07-31',
      earningEnd: '2026-08-15',
      staffTypePeriodId: 10,
      staffType: 'volunteer',
      legacyExtrapolation: false,
    }, { now: FIXED_NOW })).toThrow(
      'The earning range must be contained in the settlement range.',
    );

    expect(() => signCompensationSettlementIntent({
      ...baseIntent(),
      version: 2,
      direction: 'payable',
      segmentKey: 'seg_bad_references',
      earningStart: '2026-08-01',
      earningEnd: '2026-08-15',
      staffTypePeriodId: 10,
      staffType: 'volunteer',
      legacyExtrapolation: false,
      referenceIds: [9513, 0],
    }, { now: FIXED_NOW })).toThrow('referenceIds must be a positive integer.');
  });

  it('requires signed v2 calculated intents to declare the payable direction', () => {
    const segmentedIntent = {
      ...baseIntent(),
      version: 2 as const,
      segmentKey: 'seg_direction_bound',
      earningStart: '2026-08-01',
      earningEnd: '2026-08-15',
      staffTypePeriodId: 10,
      staffType: 'volunteer',
      legacyExtrapolation: false,
      referenceIds: [9513],
    };

    expect(() => signCompensationSettlementIntent(
      segmentedIntent as CompensationSettlementIntentInput,
      { now: FIXED_NOW },
    )).toThrow('direction must be payable for a version 2 intent.');
    expect(() => signCompensationSettlementIntent(
      { ...segmentedIntent, direction: 'receivable' } as unknown as CompensationSettlementIntentInput,
      { now: FIXED_NOW },
    )).toThrow('direction must be payable for a version 2 intent.');
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
