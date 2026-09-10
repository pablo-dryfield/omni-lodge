jest.mock('../../models/User.js', () => ({
  __esModule: true,
  default: { findOne: jest.fn() },
}));

import type { NextFunction, Request, Response } from 'express';

import optionalErrorMonitoringAuth, {
  isTrustedInternalTelemetrySecret,
} from '../optionalErrorMonitoringAuth.js';

const buildRequest = (headers: Record<string, string> = {}): Request => ({
  headers,
  cookies: {},
} as unknown as Request);

const buildResponse = (): Response => ({
  status: jest.fn().mockReturnThis(),
  json: jest.fn().mockReturnThis(),
} as unknown as Response);

describe('optional error-monitoring authentication', () => {
  const previousSecret = process.env.ERROR_MONITORING_INTERNAL_SECRET;

  afterEach(() => {
    jest.clearAllMocks();
    if (previousSecret === undefined) delete process.env.ERROR_MONITORING_INTERNAL_SECRET;
    else process.env.ERROR_MONITORING_INTERNAL_SECRET = previousSecret;
  });

  it('uses a timing-safe fixed-length comparison for matching and mismatched secrets', () => {
    const secret = 'a-long-independent-private-secret-value';
    expect(isTrustedInternalTelemetrySecret(secret, secret)).toBe(true);
    expect(isTrustedInternalTelemetrySecret('wrong', secret)).toBe(false);
    expect(isTrustedInternalTelemetrySecret('', secret)).toBe(false);
    expect(isTrustedInternalTelemetrySecret(secret, '')).toBe(false);
    expect(isTrustedInternalTelemetrySecret('too-short', 'too-short')).toBe(false);
  });

  it('trusts only the private shared-secret header', async () => {
    process.env.ERROR_MONITORING_INTERNAL_SECRET = 'a-long-independent-private-secret-value';
    const req = buildRequest({
      'x-omnilodge-internal-telemetry': 'a-long-independent-private-secret-value',
      'x-omnilodge-telemetry': '1',
    });
    const next: NextFunction = jest.fn();
    const res = buildResponse();

    await optionalErrorMonitoringAuth(req, res, next);

    expect(req.monitoringTrustedInternal).toBe(true);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('keeps the public marker untrusted and rejects invalid private credentials', async () => {
    process.env.ERROR_MONITORING_INTERNAL_SECRET = 'configured-private-secret-value-long';
    const publicMarker = buildRequest({ 'x-omnilodge-telemetry': '1' });
    const wrongSecret = buildRequest({ 'x-omnilodge-internal-telemetry': 'wrong' });
    const next: NextFunction = jest.fn();
    const publicResponse = buildResponse();
    const wrongResponse = buildResponse();

    await optionalErrorMonitoringAuth(publicMarker, publicResponse, next);
    await optionalErrorMonitoringAuth(wrongSecret, wrongResponse, next);

    expect(publicMarker.monitoringTrustedInternal).toBe(false);
    expect(next).toHaveBeenCalledTimes(1);
    expect(publicResponse.status).not.toHaveBeenCalled();
    expect(wrongSecret.monitoringTrustedInternal).toBe(false);
    expect(wrongResponse.status).toHaveBeenCalledWith(401);
  });

  it('rejects duplicated private headers even when one value is correct', async () => {
    const secret = 'another-long-independent-private-secret';
    process.env.ERROR_MONITORING_INTERNAL_SECRET = secret;
    const req = buildRequest();
    req.headers['x-omnilodge-internal-telemetry'] = [secret, 'wrong'];
    const next: NextFunction = jest.fn();
    const res = buildResponse();

    await optionalErrorMonitoringAuth(req, res, next);

    expect(req.monitoringTrustedInternal).toBe(false);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('rejects a private header when the API secret is not configured', async () => {
    delete process.env.ERROR_MONITORING_INTERNAL_SECRET;
    const unconfigured = buildRequest({ 'x-omnilodge-internal-telemetry': 'anything' });
    const next: NextFunction = jest.fn();
    const res = buildResponse();

    await optionalErrorMonitoringAuth(unconfigured, res, next);

    expect(unconfigured.monitoringTrustedInternal).toBe(false);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(503);
  });
});
