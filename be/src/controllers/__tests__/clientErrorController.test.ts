jest.mock('../../services/errorMonitoringService.js', () => ({
  ingestClientErrorBatch: jest.fn(),
  ingestBrowserReports: jest.fn(),
}));

import type { Request, Response } from 'express';

import { ingestBrowserErrorReports, ingestClientErrors } from '../clientErrorController.js';
import { ingestBrowserReports, ingestClientErrorBatch } from '../../services/errorMonitoringService.js';

const ingest = ingestClientErrorBatch as jest.Mock;
const ingestReports = ingestBrowserReports as jest.Mock;

const setup = () => {
  const req = {
    body: { events: [{ eventId: 'one', message: 'Boom' }] },
    monitoringUserId: 7,
    monitoringTrustedInternal: true,
    ip: '127.0.0.1',
    socket: {},
    get: jest.fn().mockReturnValue('Test browser'),
  } as unknown as Request;
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const res = { status } as unknown as Response;
  return { req, res, status, json };
};

describe('client error ingestion controller', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 503 so the durable client queue retries persistence failures', async () => {
    ingest.mockResolvedValue({
      accepted: 0,
      rejected: 1,
      eventIds: [],
      errors: [{ index: 0, message: 'Event could not be stored.', retryable: true }],
    });
    const { req, res, status } = setup();

    await ingestClientErrors(req, res);

    expect(status).toHaveBeenCalledWith(503);
    expect(ingest).toHaveBeenCalledWith(req.body.events, expect.objectContaining({
      userId: 7,
      trustedInternal: true,
    }));
  });

  it('accepts the batch when rejected entries are permanently invalid', async () => {
    ingest.mockResolvedValue({
      accepted: 0,
      rejected: 1,
      eventIds: [],
      errors: [{ index: 0, message: 'Event message is required.', retryable: false }],
    });
    const { req, res, status } = setup();

    await ingestClientErrors(req, res);

    expect(status).toHaveBeenCalledWith(202);
  });

  it('asks browsers to retry when a valid report could not be persisted', async () => {
    ingestReports.mockResolvedValue({ accepted: 0, rejected: 1, retryableRejected: 1 });
    const { req, res, status } = setup();

    await ingestBrowserErrorReports(req, res);

    expect(status).toHaveBeenCalledWith(503);
    expect(ingestReports).toHaveBeenCalledWith(req.body, expect.objectContaining({
      userId: 7,
      trustedInternal: true,
    }));
  });

  it('acknowledges malformed reports without causing retry loops', async () => {
    ingestReports.mockResolvedValue({ accepted: 0, rejected: 1, retryableRejected: 0 });
    const { req, res, status } = setup();

    await ingestBrowserErrorReports(req, res);

    expect(status).toHaveBeenCalledWith(202);
  });
});
