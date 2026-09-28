import {
  calculateDistanceMeters,
  evaluateLocationDwell,
  normalizePromotionPolicy,
} from '../promotionTrackingRules.js';

const NOW = new Date('2026-09-28T12:00:00.000Z');
const target = { latitude: 50.06143, longitude: 19.93658 };

const proof = (overrides: Record<string, unknown> = {}) => ({
  capturedAtUtc: '2026-09-28T11:59:50.000Z',
  elapsedRealtimeNanos: '1000',
  bootId: 'boot-a',
  latitude: target.latitude,
  longitude: target.longitude,
  horizontalAccuracyMeters: 12,
  mockLocationSignal: false,
  ...overrides,
});

describe('promotionTrackingRules', () => {
  it('blocks outside, stale, and inaccurate proofs with specific explanations', () => {
    const result = evaluateLocationDwell({
      proofs: [
        proof({
          capturedAtUtc: '2026-09-28T11:50:00.000Z',
          latitude: 50.065,
          horizontalAccuracyMeters: 80,
        }),
      ],
      target,
      radiusMeters: 40,
      maxHorizontalAccuracyMeters: 30,
      requiredDwellSeconds: 0,
      consecutiveFixesRequired: 1,
      maxAgeSeconds: 120,
      now: NOW,
    });

    expect(result.accepted).toBe(false);
    expect(result.blockers.join(' ')).toContain('GPS accuracy');
    expect(result.blockers.join(' ')).toContain('stale');
    expect(result.blockers.join(' ')).toContain('Move within 40m');
  });

  it('requires both configured dwell time and consecutive accurate fixes', () => {
    const oneFix = evaluateLocationDwell({
      proofs: [proof()],
      target,
      radiusMeters: 40,
      maxHorizontalAccuracyMeters: 30,
      requiredDwellSeconds: 15,
      consecutiveFixesRequired: 2,
      maxAgeSeconds: 120,
      now: NOW,
    });
    expect(oneFix.accepted).toBe(false);
    expect(oneFix.blockers.join(' ')).toContain('Need 2 accurate');

    const accepted = evaluateLocationDwell({
      proofs: [
        proof({ capturedAtUtc: '2026-09-28T11:59:30.000Z' }),
        proof({ capturedAtUtc: '2026-09-28T11:59:50.000Z' }),
      ],
      target,
      radiusMeters: 40,
      maxHorizontalAccuracyMeters: 30,
      requiredDwellSeconds: 15,
      consecutiveFixesRequired: 2,
      maxAgeSeconds: 120,
      now: NOW,
    });
    expect(accepted.accepted).toBe(true);
    expect(accepted.dwellSeconds).toBe(20);
    expect(accepted.firstAcceptedProofAt?.toISOString()).toBe('2026-09-28T11:59:30.000Z');
  });

  it('marks mock-location signals review-required without hiding the accepted proof', () => {
    const result = evaluateLocationDwell({
      proofs: [proof({ mockLocationSignal: true })],
      target,
      radiusMeters: 40,
      maxHorizontalAccuracyMeters: 30,
      requiredDwellSeconds: 0,
      consecutiveFixesRequired: 1,
      maxAgeSeconds: 120,
      now: NOW,
    });

    expect(result.accepted).toBe(true);
    expect(result.quality).toBe('REVIEW_REQUIRED');
    expect(result.reviewFlags).toContain('mock_location_signal');
  });

  it('normalizes server-configured route policy defaults and custom timing values', () => {
    const policy = normalizePromotionPolicy({
      maxHorizontalAccuracyMeters: 25,
      startDwellSeconds: 20,
      reminderOffsetsMinutes: [45, 5],
      streetExpectedDurationMinutes: 42,
      hostelExpectedDurationMinutes: 12,
      requiredParticipantProof: 'all_assigned',
    });

    expect(policy.maxHorizontalAccuracyMeters).toBe(25);
    expect(policy.startDwellSeconds).toBe(20);
    expect(policy.checkpointDwellSeconds).toBe(15);
    expect(policy.reminderOffsetsMinutes).toEqual([45, 5]);
    expect(policy.streetExpectedDurationMinutes).toBe(42);
    expect(policy.hostelExpectedDurationMinutes).toBe(12);
    expect(policy.requiredParticipantProof).toBe('all_assigned');
  });

  it('computes realistic distance in metres for geofence checks', () => {
    const distance = calculateDistanceMeters(target, { latitude: 50.06143, longitude: 19.93758 });
    expect(distance).toBeGreaterThan(60);
    expect(distance).toBeLessThan(80);
  });
});
