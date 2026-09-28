import type { PromotionRoutePolicyJson } from '../models/PromotionRouteVersion.js';
import type { PromotionVerificationQuality } from '../models/PromotionSession.js';

export type PromotionCoordinate = {
  latitude: number;
  longitude: number;
};

export type PromotionLocationProofPayload = PromotionCoordinate & {
  capturedAtUtc: string;
  elapsedRealtimeNanos?: string | number | null;
  bootId?: string | null;
  horizontalAccuracyMeters: number;
  speedMetersPerSecond?: number | null;
  bearingDegrees?: number | null;
  mockLocationSignal?: boolean | null;
};

export type PromotionDwellDecision = {
  accepted: boolean;
  blockers: string[];
  reviewFlags: string[];
  quality: PromotionVerificationQuality;
  distanceMeters: number | null;
  dwellSeconds: number;
  firstAcceptedProofAt: Date | null;
  boundaryProofAt: Date | null;
};

export const DEFAULT_PROMOTION_ROUTE_POLICY: PromotionRoutePolicyJson = {
  maxHorizontalAccuracyMeters: 30,
  startDwellSeconds: 15,
  checkpointDwellSeconds: 15,
  finishDwellSeconds: 15,
  consecutiveFixesRequired: 2,
  reminderOffsetsMinutes: [30, 10],
  preShiftCheckInWindowMinutes: 30,
  streetExpectedDurationMinutes: 60,
  hostelExpectedDurationMinutes: 30,
  minimumStreetDurationMinutes: null,
  minimumHostelDurationMinutes: null,
  requiredParticipantProof: 'self',
  participantProofMaxAgeSeconds: 120,
  participantProofMaxDistanceMeters: 60,
};

const EARTH_RADIUS_METERS = 6_371_000;
const MAX_REASONABLE_CLOCK_SKEW_SECONDS = 60;

const finiteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

export const calculateDistanceMeters = (from: PromotionCoordinate, to: PromotionCoordinate): number => {
  const deltaLatitude = toRadians(to.latitude - from.latitude);
  const deltaLongitude = toRadians(to.longitude - from.longitude);
  const startLatitude = toRadians(from.latitude);
  const endLatitude = toRadians(to.latitude);
  const a = Math.sin(deltaLatitude / 2) ** 2
    + Math.cos(startLatitude) * Math.cos(endLatitude) * Math.sin(deltaLongitude / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

export const normalizePromotionPolicy = (value: unknown): PromotionRoutePolicyJson => {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const numberOrDefault = (key: keyof PromotionRoutePolicyJson, fallback: number): number => {
    const parsed = Number(record[key]);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  };
  const nullableMinutes = (key: keyof PromotionRoutePolicyJson): number | null => {
    if (record[key] == null || record[key] === '') return null;
    const parsed = Number(record[key]);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  };
  const reminderOffsets = Array.isArray(record.reminderOffsetsMinutes)
    ? record.reminderOffsetsMinutes
        .map((item) => Number(item))
        .filter((item) => Number.isFinite(item) && item >= 0)
    : DEFAULT_PROMOTION_ROUTE_POLICY.reminderOffsetsMinutes;
  const requiredParticipantProof = record.requiredParticipantProof === 'all_assigned'
    ? 'all_assigned'
    : 'self';

  return {
    maxHorizontalAccuracyMeters: numberOrDefault('maxHorizontalAccuracyMeters', DEFAULT_PROMOTION_ROUTE_POLICY.maxHorizontalAccuracyMeters),
    startDwellSeconds: numberOrDefault('startDwellSeconds', DEFAULT_PROMOTION_ROUTE_POLICY.startDwellSeconds),
    checkpointDwellSeconds: numberOrDefault('checkpointDwellSeconds', DEFAULT_PROMOTION_ROUTE_POLICY.checkpointDwellSeconds),
    finishDwellSeconds: numberOrDefault('finishDwellSeconds', DEFAULT_PROMOTION_ROUTE_POLICY.finishDwellSeconds),
    consecutiveFixesRequired: Math.max(
      1,
      Math.floor(numberOrDefault('consecutiveFixesRequired', DEFAULT_PROMOTION_ROUTE_POLICY.consecutiveFixesRequired)),
    ),
    reminderOffsetsMinutes: reminderOffsets.length ? reminderOffsets : DEFAULT_PROMOTION_ROUTE_POLICY.reminderOffsetsMinutes,
    preShiftCheckInWindowMinutes: numberOrDefault(
      'preShiftCheckInWindowMinutes',
      DEFAULT_PROMOTION_ROUTE_POLICY.preShiftCheckInWindowMinutes,
    ),
    streetExpectedDurationMinutes: Math.max(
      1,
      Math.floor(numberOrDefault('streetExpectedDurationMinutes', DEFAULT_PROMOTION_ROUTE_POLICY.streetExpectedDurationMinutes)),
    ),
    hostelExpectedDurationMinutes: Math.max(
      1,
      Math.floor(numberOrDefault('hostelExpectedDurationMinutes', DEFAULT_PROMOTION_ROUTE_POLICY.hostelExpectedDurationMinutes)),
    ),
    minimumStreetDurationMinutes: nullableMinutes('minimumStreetDurationMinutes'),
    minimumHostelDurationMinutes: nullableMinutes('minimumHostelDurationMinutes'),
    requiredParticipantProof,
    participantProofMaxAgeSeconds: Math.max(
      15,
      Math.floor(numberOrDefault('participantProofMaxAgeSeconds', DEFAULT_PROMOTION_ROUTE_POLICY.participantProofMaxAgeSeconds ?? 120)),
    ),
    participantProofMaxDistanceMeters: Math.max(
      1,
      numberOrDefault('participantProofMaxDistanceMeters', DEFAULT_PROMOTION_ROUTE_POLICY.participantProofMaxDistanceMeters ?? 60),
    ),
  };
};

export const coerceProofs = (value: unknown): PromotionLocationProofPayload[] => {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  return list
    .map((item) => item && typeof item === 'object' ? item as Record<string, unknown> : null)
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .map((item) => ({
      capturedAtUtc: typeof item.capturedAtUtc === 'string' ? item.capturedAtUtc : '',
      elapsedRealtimeNanos: typeof item.elapsedRealtimeNanos === 'string' || typeof item.elapsedRealtimeNanos === 'number'
        ? item.elapsedRealtimeNanos
        : null,
      bootId: typeof item.bootId === 'string' ? item.bootId : null,
      latitude: Number(item.latitude),
      longitude: Number(item.longitude),
      horizontalAccuracyMeters: Number(item.horizontalAccuracyMeters),
      speedMetersPerSecond: item.speedMetersPerSecond == null ? null : Number(item.speedMetersPerSecond),
      bearingDegrees: item.bearingDegrees == null ? null : Number(item.bearingDegrees),
      mockLocationSignal: typeof item.mockLocationSignal === 'boolean' ? item.mockLocationSignal : null,
    }));
};

export const evaluateLocationDwell = (input: {
  proofs: PromotionLocationProofPayload[];
  target: PromotionCoordinate;
  radiusMeters: number;
  maxHorizontalAccuracyMeters: number;
  requiredDwellSeconds: number;
  consecutiveFixesRequired: number;
  maxAgeSeconds: number;
  now: Date;
}): PromotionDwellDecision => {
  const blockers = new Set<string>();
  const reviewFlags = new Set<string>();
  const acceptedProofs: Array<{ proof: PromotionLocationProofPayload; capturedAt: Date; distanceMeters: number }> = [];
  let nearestDistance: number | null = null;

  for (const proof of input.proofs) {
    if (
      !finiteNumber(proof.latitude)
      || !finiteNumber(proof.longitude)
      || proof.latitude < -90
      || proof.latitude > 90
      || proof.longitude < -180
      || proof.longitude > 180
    ) {
      blockers.add('Location proof is missing a valid latitude/longitude.');
      continue;
    }
    if (!finiteNumber(proof.horizontalAccuracyMeters) || proof.horizontalAccuracyMeters <= 0) {
      blockers.add('Location proof is missing GPS accuracy.');
      continue;
    }
    if (proof.horizontalAccuracyMeters > input.maxHorizontalAccuracyMeters) {
      blockers.add(`GPS accuracy must be ${input.maxHorizontalAccuracyMeters}m or better.`);
    }
    const capturedAt = new Date(proof.capturedAtUtc);
    if (!Number.isFinite(capturedAt.valueOf())) {
      blockers.add('Location proof has an invalid capture time.');
      continue;
    }
    const ageSeconds = (input.now.valueOf() - capturedAt.valueOf()) / 1000;
    if (ageSeconds > input.maxAgeSeconds) {
      blockers.add('Location proof is stale. Wait for a fresh GPS fix.');
    }
    if (ageSeconds < -MAX_REASONABLE_CLOCK_SKEW_SECONDS) {
      blockers.add('Device clock is ahead of server time.');
      reviewFlags.add('clock_skew');
    }
    const distanceMeters = calculateDistanceMeters(proof, input.target);
    nearestDistance = nearestDistance == null ? distanceMeters : Math.min(nearestDistance, distanceMeters);
    if (distanceMeters > input.radiusMeters) {
      blockers.add(`Move within ${input.radiusMeters}m of the required location.`);
    }
    if (proof.mockLocationSignal === true) {
      reviewFlags.add('mock_location_signal');
    }
    if (
      proof.horizontalAccuracyMeters <= input.maxHorizontalAccuracyMeters
      && ageSeconds <= input.maxAgeSeconds
      && ageSeconds >= -MAX_REASONABLE_CLOCK_SKEW_SECONDS
      && distanceMeters <= input.radiusMeters
    ) {
      acceptedProofs.push({ proof, capturedAt, distanceMeters });
    }
  }

  acceptedProofs.sort((left, right) => left.capturedAt.valueOf() - right.capturedAt.valueOf());
  const consecutiveRequired = Math.max(1, Math.floor(input.consecutiveFixesRequired));
  const requiredDwellSeconds = Math.max(0, Math.floor(input.requiredDwellSeconds));
  const latestRun = acceptedProofs.slice(-consecutiveRequired);
  const firstAcceptedProofAt = latestRun[0]?.capturedAt ?? null;
  const boundaryProofAt = latestRun.at(-1)?.capturedAt ?? null;
  const dwellSeconds = firstAcceptedProofAt && boundaryProofAt
    ? Math.max(0, Math.floor((boundaryProofAt.valueOf() - firstAcceptedProofAt.valueOf()) / 1000))
    : 0;

  if (acceptedProofs.length < consecutiveRequired) {
    blockers.add(`Need ${consecutiveRequired} accurate in-radius GPS fixes.`);
  }
  if (acceptedProofs.length >= consecutiveRequired && dwellSeconds < requiredDwellSeconds) {
    blockers.add(`Remain at the required location for ${requiredDwellSeconds - dwellSeconds}s more.`);
  }
  if (input.proofs.length === 0) {
    blockers.add('Location proof is required.');
  }

  const accepted = blockers.size === 0 && Boolean(boundaryProofAt);
  return {
    accepted,
    blockers: [...blockers],
    reviewFlags: [...reviewFlags],
    quality: reviewFlags.has('mock_location_signal') || reviewFlags.has('clock_skew') ? 'REVIEW_REQUIRED' : 'VERIFIED',
    distanceMeters: nearestDistance,
    dwellSeconds,
    firstAcceptedProofAt,
    boundaryProofAt,
  };
};

export const strongestQuality = (...qualities: PromotionVerificationQuality[]): PromotionVerificationQuality => {
  if (qualities.includes('REVIEW_REQUIRED')) return 'REVIEW_REQUIRED';
  if (qualities.includes('DEGRADED')) return 'DEGRADED';
  return 'VERIFIED';
};
