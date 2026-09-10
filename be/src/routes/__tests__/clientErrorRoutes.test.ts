import express, { type RequestHandler, type Response } from 'express';
import request from 'supertest';

jest.mock('../../middleware/optionalErrorMonitoringAuth.js', () => ({
  __esModule: true,
  default: ((_req: express.Request, _res: Response, next: () => void) => next()) as RequestHandler,
}));

jest.mock('../../controllers/clientErrorController.js', () => {
  const respond = jest.fn((_req: express.Request, res: Response) => res.status(204).send());
  return {
    ingestClientErrors: jest.fn(respond),
    ingestBrowserErrorReports: jest.fn(respond),
  };
});

import {
  ingestBrowserErrorReports,
  ingestClientErrors,
} from '../../controllers/clientErrorController.js';
import clientErrorRoutes from '../clientErrorRoutes.js';

const buildApp = () => {
  const app = express();
  app.use('/api/client-errors', clientErrorRoutes);
  return app;
};

describe('client error ingestion body limits', () => {
  beforeEach(() => jest.clearAllMocks());

  it('accepts a normal SDK batch through its route-owned JSON parser', async () => {
    const response = await request(buildApp())
      .post('/api/client-errors/batch')
      .send({ events: [{ eventId: 'one', message: 'Boom' }] });

    expect(response.status).toBe(204);
    expect(ingestClientErrors).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['/api/client-errors/batch', 'application/json', { events: [{ message: 'x'.repeat(70 * 1_024) }] }],
    ['/api/client-errors/browser-reports', 'application/reports+json', [{ type: 'crash', body: { data: 'x'.repeat(70 * 1_024) } }]],
  ] as const)('rejects an oversized report at %s', async (url, contentType, body) => {
    const response = await request(buildApp())
      .post(url)
      .set('content-type', contentType)
      .send(body);

    expect(response.status).toBe(413);
    expect(ingestClientErrors).not.toHaveBeenCalled();
    expect(ingestBrowserErrorReports).not.toHaveBeenCalled();
  });
});
