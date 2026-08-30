import jwt, { type JwtPayload } from 'jsonwebtoken';
import {
  STAFF_PAYOUT_RECEIPT_ACCESS_AUDIENCE,
  STAFF_PAYOUT_RECEIPT_ACCESS_ISSUER,
  STAFF_PAYOUT_RECEIPT_ACCESS_PURPOSE,
  issueStaffPayoutReceiptAccessToken,
  verifyStaffPayoutReceiptAccessToken,
} from '../staffPayoutReceiptAccessTokenService.js';

const FIXED_NOW = new Date('2026-08-30T12:00:00.000Z');
const SECRET = 'test-receipt-access-secret-that-is-long-enough';

describe('staff payout receipt access tokens', () => {
  const originalReceiptSecret = process.env.STAFF_PAYOUT_RECEIPT_ACCESS_SECRET;

  beforeEach(() => {
    process.env.STAFF_PAYOUT_RECEIPT_ACCESS_SECRET = SECRET;
  });

  afterAll(() => {
    if (originalReceiptSecret === undefined) {
      delete process.env.STAFF_PAYOUT_RECEIPT_ACCESS_SECRET;
    } else {
      process.env.STAFF_PAYOUT_RECEIPT_ACCESS_SECRET = originalReceiptSecret;
    }
  });

  it('issues a short-lived purpose/audience-bound capability without a normal user id claim', () => {
    const issued = issueStaffPayoutReceiptAccessToken(
      { userId: 28, receiptId: 91, actionId: 101 },
      { now: FIXED_NOW, ttlSeconds: 600, tokenId: 'receipt_token_101' },
    );
    const decoded = jwt.decode(issued.token) as JwtPayload;

    expect(decoded).toMatchObject({
      purpose: STAFF_PAYOUT_RECEIPT_ACCESS_PURPOSE,
      aud: STAFF_PAYOUT_RECEIPT_ACCESS_AUDIENCE,
      iss: STAFF_PAYOUT_RECEIPT_ACCESS_ISSUER,
      sub: '28',
      receiptId: 91,
      actionId: 101,
      jti: 'receipt_token_101',
    });
    expect(decoded.id).toBeUndefined();
    expect(verifyStaffPayoutReceiptAccessToken(issued.token, { now: FIXED_NOW })).toEqual({
      userId: 28,
      receiptId: 91,
      actionId: 101,
      tokenId: 'receipt_token_101',
      expiresAt: Math.floor(FIXED_NOW.getTime() / 1000) + 600,
    });
  });

  it('rejects expired, tampered, and wrong-purpose tokens', () => {
    const issued = issueStaffPayoutReceiptAccessToken(
      { userId: 28, receiptId: 91, actionId: 101 },
      { now: FIXED_NOW, ttlSeconds: 60, tokenId: 'receipt_token_102' },
    );
    expect(() => verifyStaffPayoutReceiptAccessToken(issued.token, {
      now: new Date(FIXED_NOW.getTime() + 91_000),
    })).toThrow('invalid or expired');
    expect(() => verifyStaffPayoutReceiptAccessToken(`${issued.token}x`, { now: FIXED_NOW }))
      .toThrow('invalid or expired');

    const wrongPurpose = jwt.sign(
      { purpose: 'normal_session', receiptId: 91, actionId: 101 },
      SECRET,
      {
        algorithm: 'HS256',
        audience: STAFF_PAYOUT_RECEIPT_ACCESS_AUDIENCE,
        issuer: STAFF_PAYOUT_RECEIPT_ACCESS_ISSUER,
        subject: '28',
        jwtid: 'receipt_token_103',
        expiresIn: 600,
      },
    );
    expect(() => verifyStaffPayoutReceiptAccessToken(wrongPurpose)).toThrow('invalid or expired');
  });
});
