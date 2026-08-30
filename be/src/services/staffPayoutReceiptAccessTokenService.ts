import crypto from 'node:crypto';
import jwt, { type JwtPayload } from 'jsonwebtoken';

export const STAFF_PAYOUT_RECEIPT_ACCESS_PURPOSE = 'staff_payout_receipt_access';
export const STAFF_PAYOUT_RECEIPT_ACCESS_AUDIENCE = 'omni-lodge:staff-payout-receipt';
export const STAFF_PAYOUT_RECEIPT_ACCESS_ISSUER = 'omni-lodge';
export const STAFF_PAYOUT_RECEIPT_ACCESS_TTL_SECONDS = 20 * 60;

export type StaffPayoutReceiptAccessClaims = {
  userId: number;
  receiptId: number;
  actionId: number;
  tokenId: string;
  expiresAt: number;
};

type IssueStaffPayoutReceiptAccessTokenOptions = {
  now?: Date;
  ttlSeconds?: number;
  tokenId?: string;
};

type VerifyStaffPayoutReceiptAccessTokenOptions = {
  now?: Date;
};

export class StaffPayoutReceiptAccessTokenConfigurationError extends Error {
  readonly code = 'STAFF_PAYOUT_RECEIPT_ACCESS_SECRET_REQUIRED';

  constructor() {
    super('A receipt access signing secret is required.');
    this.name = 'StaffPayoutReceiptAccessTokenConfigurationError';
  }
}

const invalidToken = (): Error => new Error('Receipt access token is invalid or expired.');

const readSecret = (): string => {
  const secret = (
    process.env.STAFF_PAYOUT_RECEIPT_ACCESS_SECRET
    ?? process.env.JWT_SECRET
    ?? ''
  ).trim();
  if (!secret) {
    throw new StaffPayoutReceiptAccessTokenConfigurationError();
  }
  return secret;
};

const readPositiveInteger = (value: unknown): number => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw invalidToken();
  }
  return parsed;
};

const readNowSeconds = (now?: Date): number => {
  const timestamp = (now ?? new Date()).getTime();
  if (!Number.isFinite(timestamp)) {
    throw invalidToken();
  }
  return Math.floor(timestamp / 1000);
};

const readTtlSeconds = (value: number | undefined): number => {
  const ttl = value ?? STAFF_PAYOUT_RECEIPT_ACCESS_TTL_SECONDS;
  if (!Number.isSafeInteger(ttl) || ttl <= 0 || ttl > 60 * 60) {
    throw new Error('Receipt access token lifetime must be between 1 second and 1 hour.');
  }
  return ttl;
};

export const isStaffPayoutReceiptAccessPayload = (
  value: string | JwtPayload | null,
): boolean => Boolean(
  value
  && typeof value !== 'string'
  && value.purpose === STAFF_PAYOUT_RECEIPT_ACCESS_PURPOSE,
);

export const issueStaffPayoutReceiptAccessToken = (
  input: { userId: number; receiptId: number; actionId: number },
  options: IssueStaffPayoutReceiptAccessTokenOptions = {},
): { token: string; expiresAt: number; expiresInSeconds: number } => {
  const userId = readPositiveInteger(input.userId);
  const receiptId = readPositiveInteger(input.receiptId);
  const actionId = readPositiveInteger(input.actionId);
  const issuedAt = readNowSeconds(options.now);
  const expiresInSeconds = readTtlSeconds(options.ttlSeconds);
  const tokenId = options.tokenId?.trim() || crypto.randomUUID();
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(tokenId)) {
    throw new Error('Receipt access token id is invalid.');
  }

  const token = jwt.sign(
    {
      purpose: STAFF_PAYOUT_RECEIPT_ACCESS_PURPOSE,
      receiptId,
      actionId,
      iat: issuedAt,
    },
    readSecret(),
    {
      algorithm: 'HS256',
      audience: STAFF_PAYOUT_RECEIPT_ACCESS_AUDIENCE,
      issuer: STAFF_PAYOUT_RECEIPT_ACCESS_ISSUER,
      subject: String(userId),
      jwtid: tokenId,
      expiresIn: expiresInSeconds,
    },
  );

  return {
    token,
    expiresAt: issuedAt + expiresInSeconds,
    expiresInSeconds,
  };
};

export const verifyStaffPayoutReceiptAccessToken = (
  token: string,
  options: VerifyStaffPayoutReceiptAccessTokenOptions = {},
): StaffPayoutReceiptAccessClaims => {
  if (typeof token !== 'string' || token.length < 20 || token.length > 4096) {
    throw invalidToken();
  }

  let decoded: string | JwtPayload;
  try {
    decoded = jwt.verify(token, readSecret(), {
      algorithms: ['HS256'],
      audience: STAFF_PAYOUT_RECEIPT_ACCESS_AUDIENCE,
      issuer: STAFF_PAYOUT_RECEIPT_ACCESS_ISSUER,
      clockTimestamp: readNowSeconds(options.now),
      clockTolerance: 30,
    });
  } catch (error) {
    if (error instanceof StaffPayoutReceiptAccessTokenConfigurationError) {
      throw error;
    }
    throw invalidToken();
  }

  if (
    typeof decoded === 'string'
    || !isStaffPayoutReceiptAccessPayload(decoded)
    || typeof decoded.sub !== 'string'
    || typeof decoded.jti !== 'string'
    || !decoded.jti
    || typeof decoded.exp !== 'number'
  ) {
    throw invalidToken();
  }

  return {
    userId: readPositiveInteger(decoded.sub),
    receiptId: readPositiveInteger(decoded.receiptId),
    actionId: readPositiveInteger(decoded.actionId),
    tokenId: decoded.jti,
    expiresAt: decoded.exp,
  };
};
