import crypto from 'crypto';

const TOKEN_VERSION = 'pgse1';
const TOKEN_PURPOSE = 'promotion_session_start_group_selfie';
const TOKEN_CLOCK_SKEW_SECONDS = 60;
const MAX_TOKEN_LENGTH = 4_096;

export type PromotionGroupSelfieEvidenceClaims = {
  evidenceRef: string;
  sha256: string;
  capturedAtUtc: string;
  byteSize: number;
  actorUserId: number;
  assignmentId: number;
  shiftInstanceId: number;
  teamAssignmentId: number;
  routeVersionId: number;
};

type PromotionGroupSelfieEvidenceTokenPayload = PromotionGroupSelfieEvidenceClaims & {
  version: 1;
  purpose: typeof TOKEN_PURPOSE;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
};

export type VerifyPromotionGroupSelfieEvidenceOptions = {
  actorUserId: number;
  assignmentId: number;
  shiftInstanceId: number;
  teamAssignmentId: number;
  routeVersionId: number;
  maxAgeSeconds: number;
  now?: Date;
};

export class PromotionGroupSelfieEvidenceConfigurationError extends Error {
  readonly code = 'PROMOTION_GROUP_SELFIE_EVIDENCE_SECRET_REQUIRED';

  constructor() {
    super('JWT_SECRET is required to sign or verify promotion group-selfie evidence.');
    this.name = 'PromotionGroupSelfieEvidenceConfigurationError';
  }
}

export class PromotionGroupSelfieEvidenceTokenError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'PROMOTION_GROUP_SELFIE_EVIDENCE_INVALID'
      | 'PROMOTION_GROUP_SELFIE_EVIDENCE_EXPIRED'
      | 'PROMOTION_GROUP_SELFIE_EVIDENCE_ACTOR_MISMATCH'
      | 'PROMOTION_GROUP_SELFIE_EVIDENCE_ASSIGNMENT_MISMATCH'
      | 'PROMOTION_GROUP_SELFIE_EVIDENCE_CONTEXT_MISMATCH',
  ) {
    super(message);
    this.name = 'PromotionGroupSelfieEvidenceTokenError';
  }
}

const invalidToken = (message = 'Promotion group-selfie evidence is invalid.'): PromotionGroupSelfieEvidenceTokenError =>
  new PromotionGroupSelfieEvidenceTokenError(message, 'PROMOTION_GROUP_SELFIE_EVIDENCE_INVALID');

const readSecret = (): string => {
  const secret = process.env.JWT_SECRET?.trim();
  if (!secret) throw new PromotionGroupSelfieEvidenceConfigurationError();
  return secret;
};

const positiveInteger = (value: unknown, field: string): number => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw invalidToken(`Promotion group-selfie evidence has an invalid ${field}.`);
  }
  return parsed;
};

const tokenSignature = (payloadSegment: string): Buffer =>
  crypto
    .createHmac('sha256', readSecret())
    .update(`${TOKEN_VERSION}.${payloadSegment}`, 'utf8')
    .digest();

const parsePayload = (value: unknown): PromotionGroupSelfieEvidenceTokenPayload => {
  if (!value || typeof value !== 'object') throw invalidToken();
  const record = value as Record<string, unknown>;
  if (record.version !== 1 || record.purpose !== TOKEN_PURPOSE) {
    throw invalidToken('Promotion group-selfie evidence has the wrong purpose.');
  }
  const evidenceRef = typeof record.evidenceRef === 'string' ? record.evidenceRef.trim() : '';
  const sha256 = typeof record.sha256 === 'string' ? record.sha256.trim().toLowerCase() : '';
  const capturedAtUtc = typeof record.capturedAtUtc === 'string'
    && Number.isFinite(new Date(record.capturedAtUtc).valueOf())
    ? new Date(record.capturedAtUtc).toISOString()
    : '';
  const nonce = typeof record.nonce === 'string' ? record.nonce : '';
  if (!evidenceRef.startsWith('drive:') || evidenceRef.length > 255) {
    throw invalidToken('Promotion group-selfie evidence has an invalid storage reference.');
  }
  if (!/^[a-f0-9]{64}$/u.test(sha256)) {
    throw invalidToken('Promotion group-selfie evidence has an invalid digest.');
  }
  if (!capturedAtUtc) {
    throw invalidToken('Promotion group-selfie evidence has an invalid capture time.');
  }
  if (!/^[A-Za-z0-9_-]{20,}$/u.test(nonce)) {
    throw invalidToken('Promotion group-selfie evidence has an invalid nonce.');
  }
  return {
    version: 1,
    purpose: TOKEN_PURPOSE,
    evidenceRef,
    sha256,
    capturedAtUtc,
    byteSize: positiveInteger(record.byteSize, 'byteSize'),
    actorUserId: positiveInteger(record.actorUserId, 'actorUserId'),
    assignmentId: positiveInteger(record.assignmentId, 'assignmentId'),
    shiftInstanceId: positiveInteger(record.shiftInstanceId, 'shiftInstanceId'),
    teamAssignmentId: positiveInteger(record.teamAssignmentId, 'teamAssignmentId'),
    routeVersionId: positiveInteger(record.routeVersionId, 'routeVersionId'),
    issuedAt: positiveInteger(record.issuedAt, 'issuedAt'),
    expiresAt: positiveInteger(record.expiresAt, 'expiresAt'),
    nonce,
  };
};

export const signPromotionGroupSelfieEvidence = (
  claims: PromotionGroupSelfieEvidenceClaims,
  options: { maxAgeSeconds: number; now?: Date },
): string => {
  const now = options.now ?? new Date();
  const issuedAt = Math.floor(now.valueOf() / 1_000);
  const maxAgeSeconds = Math.max(1, Math.floor(options.maxAgeSeconds));
  const payload: PromotionGroupSelfieEvidenceTokenPayload = {
    ...claims,
    version: 1,
    purpose: TOKEN_PURPOSE,
    capturedAtUtc: new Date(claims.capturedAtUtc).toISOString(),
    issuedAt,
    expiresAt: issuedAt + maxAgeSeconds,
    nonce: crypto.randomBytes(18).toString('base64url'),
  };
  const payloadSegment = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signatureSegment = tokenSignature(payloadSegment).toString('base64url');
  return `${TOKEN_VERSION}.${payloadSegment}.${signatureSegment}`;
};

export const verifyPromotionGroupSelfieEvidence = (
  token: string,
  options: VerifyPromotionGroupSelfieEvidenceOptions,
): PromotionGroupSelfieEvidenceClaims => {
  if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LENGTH) throw invalidToken();
  const [version, payloadSegment, signatureSegment, extra] = token.split('.');
  if (version !== TOKEN_VERSION || !payloadSegment || !signatureSegment || extra !== undefined) throw invalidToken();
  if (!/^[A-Za-z0-9_-]+$/u.test(payloadSegment) || !/^[A-Za-z0-9_-]{43}$/u.test(signatureSegment)) {
    throw invalidToken();
  }
  const expectedSignature = tokenSignature(payloadSegment);
  const suppliedSignature = Buffer.from(signatureSegment, 'base64url');
  if (
    suppliedSignature.length !== expectedSignature.length
    || !crypto.timingSafeEqual(suppliedSignature, expectedSignature)
  ) {
    throw invalidToken('Promotion group-selfie evidence signature is invalid.');
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(payloadSegment, 'base64url').toString('utf8')) as unknown;
  } catch {
    throw invalidToken();
  }
  const payload = parsePayload(decoded);
  const now = options.now ?? new Date();
  const nowSeconds = Math.floor(now.valueOf() / 1_000);
  const maxAgeSeconds = Math.max(1, Math.floor(options.maxAgeSeconds));
  const capturedAtSeconds = Math.floor(new Date(payload.capturedAtUtc).valueOf() / 1_000);
  if (
    payload.issuedAt > nowSeconds + TOKEN_CLOCK_SKEW_SECONDS
    || payload.expiresAt <= payload.issuedAt
    || payload.expiresAt - payload.issuedAt > maxAgeSeconds
  ) {
    throw invalidToken('Promotion group-selfie evidence has an invalid validity window.');
  }
  if (nowSeconds > payload.expiresAt || nowSeconds - capturedAtSeconds > maxAgeSeconds) {
    throw new PromotionGroupSelfieEvidenceTokenError(
      'Promotion group-selfie evidence has expired. Take a new photo.',
      'PROMOTION_GROUP_SELFIE_EVIDENCE_EXPIRED',
    );
  }
  if (payload.actorUserId !== options.actorUserId) {
    throw new PromotionGroupSelfieEvidenceTokenError(
      'Promotion group-selfie evidence belongs to another authenticated actor.',
      'PROMOTION_GROUP_SELFIE_EVIDENCE_ACTOR_MISMATCH',
    );
  }
  if (payload.assignmentId !== options.assignmentId) {
    throw new PromotionGroupSelfieEvidenceTokenError(
      'Promotion group-selfie evidence belongs to another assignment.',
      'PROMOTION_GROUP_SELFIE_EVIDENCE_ASSIGNMENT_MISMATCH',
    );
  }
  if (
    payload.shiftInstanceId !== options.shiftInstanceId
    || payload.teamAssignmentId !== options.teamAssignmentId
    || payload.routeVersionId !== options.routeVersionId
  ) {
    throw new PromotionGroupSelfieEvidenceTokenError(
      'Promotion group-selfie evidence belongs to another promotion route context.',
      'PROMOTION_GROUP_SELFIE_EVIDENCE_CONTEXT_MISMATCH',
    );
  }

  return {
    evidenceRef: payload.evidenceRef,
    sha256: payload.sha256,
    capturedAtUtc: payload.capturedAtUtc,
    byteSize: payload.byteSize,
    actorUserId: payload.actorUserId,
    assignmentId: payload.assignmentId,
    shiftInstanceId: payload.shiftInstanceId,
    teamAssignmentId: payload.teamAssignmentId,
    routeVersionId: payload.routeVersionId,
  };
};
