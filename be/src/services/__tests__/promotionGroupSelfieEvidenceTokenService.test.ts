import {
  PromotionGroupSelfieEvidenceTokenError,
  signPromotionGroupSelfieEvidence,
  verifyPromotionGroupSelfieEvidence,
} from '../promotionGroupSelfieEvidenceTokenService.js';

const NOW = new Date('2026-10-13T12:00:00.000Z');
const originalSecret = process.env.JWT_SECRET;
const claims = {
  evidenceRef: 'drive:file-123',
  sha256: 'a'.repeat(64),
  capturedAtUtc: NOW.toISOString(),
  byteSize: 12_345,
  actorUserId: 90,
  assignmentId: 101,
  shiftInstanceId: 102,
  teamAssignmentId: 103,
  routeVersionId: 104,
};

const verificationOptions = {
  actorUserId: claims.actorUserId,
  assignmentId: claims.assignmentId,
  shiftInstanceId: claims.shiftInstanceId,
  teamAssignmentId: claims.teamAssignmentId,
  routeVersionId: claims.routeVersionId,
  maxAgeSeconds: 120,
  now: NOW,
};

describe('promotion group-selfie evidence tokens', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = 'test-only-promotion-evidence-secret';
  });

  afterAll(() => {
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
  });

  it('accepts a fresh server-issued token in its bound promotion context', () => {
    const token = signPromotionGroupSelfieEvidence(claims, {
      maxAgeSeconds: 120,
      now: NOW,
    });

    expect(verifyPromotionGroupSelfieEvidence(token, verificationOptions)).toEqual(claims);
  });

  it('rejects client-forged evidence metadata', () => {
    const token = signPromotionGroupSelfieEvidence(claims, {
      maxAgeSeconds: 120,
      now: NOW,
    });
    const [version, payloadSegment, signature] = token.split('.');
    const payload = JSON.parse(Buffer.from(payloadSegment, 'base64url').toString('utf8')) as Record<string, unknown>;
    payload.evidenceRef = 'drive:attacker-controlled';
    const forgedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');

    expect(() =>
      verifyPromotionGroupSelfieEvidence(
        `${version}.${forgedPayload}.${signature}`,
        verificationOptions,
      ),
    ).toThrow('signature is invalid');
  });

  it('rejects evidence issued to another authenticated actor', () => {
    const token = signPromotionGroupSelfieEvidence(claims, {
      maxAgeSeconds: 120,
      now: NOW,
    });

    expect(() =>
      verifyPromotionGroupSelfieEvidence(token, {
        ...verificationOptions,
        actorUserId: claims.actorUserId + 1,
      }),
    ).toThrow(PromotionGroupSelfieEvidenceTokenError);
    try {
      verifyPromotionGroupSelfieEvidence(token, {
        ...verificationOptions,
        actorUserId: claims.actorUserId + 1,
      });
    } catch (error) {
      expect(error).toMatchObject({ code: 'PROMOTION_GROUP_SELFIE_EVIDENCE_ACTOR_MISMATCH' });
    }
  });

  it('rejects evidence issued for another assignment', () => {
    const token = signPromotionGroupSelfieEvidence(claims, {
      maxAgeSeconds: 120,
      now: NOW,
    });

    expect(() =>
      verifyPromotionGroupSelfieEvidence(token, {
        ...verificationOptions,
        assignmentId: claims.assignmentId + 1,
      }),
    ).toThrow('another assignment');
  });

  it('rejects evidence after its configured freshness window', () => {
    const token = signPromotionGroupSelfieEvidence(claims, {
      maxAgeSeconds: 120,
      now: NOW,
    });

    expect(() =>
      verifyPromotionGroupSelfieEvidence(token, {
        ...verificationOptions,
        now: new Date(NOW.valueOf() + 121_000),
      }),
    ).toThrow('expired');
  });
});
