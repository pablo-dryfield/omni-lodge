import express from 'express';
import request from 'supertest';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../../types/AuthenticatedRequest';

jest.mock('../../middleware/authMiddleware.js', () => ({
  __esModule: true,
  default: (req: AuthenticatedRequest, _res: unknown, next: () => void) => {
    const rawId = req.header('x-test-admin-id');
    req.authContext = rawId
      ? {
          id: Number(rawId),
          userTypeId: 1,
          roleSlug: req.header('x-test-role') ?? 'admin',
        }
      : undefined;
    next();
  },
}));
jest.mock('../../controllers/whatsappAdminController.js', () => ({
  getWhatsAppAdminStatusController: jest.fn((_req: AuthenticatedRequest, res: Response) => {
    res.json({ status: { connected: false } });
  }),
  createWhatsAppEmbeddedSignupAttemptController: jest.fn((_req: AuthenticatedRequest, res: Response) => {
    res.status(201).json({ attempt: { id: 'attempt-id' } });
  }),
  completeWhatsAppEmbeddedSignupAttemptController: jest.fn((_req: AuthenticatedRequest, res: Response) => {
    res.json({ status: { connected: true } });
  }),
}));

import whatsappAdminRoutes from '../whatsappAdminRoutes';

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/integrations/whatsapp/admin', whatsappAdminRoutes);
  return app;
};

describe('WhatsApp admin routes', () => {
  const basePath = '/api/integrations/whatsapp/admin';

  it('requires an authenticated administrator', async () => {
    const app = buildApp();

    const unauthenticated = await request(app).get(`${basePath}/status`);
    const wrongRole = await request(app)
      .get(`${basePath}/status`)
      .set('x-test-admin-id', '501')
      .set('x-test-role', 'guide');
    const admin = await request(app)
      .get(`${basePath}/status`)
      .set('x-test-admin-id', '502');

    expect(unauthenticated.status).toBe(403);
    expect(wrongRole.status).toBe(403);
    expect(admin.status).toBe(200);
    expect(admin.headers['cache-control']).toBe('no-store');
  });

  it('rate-limits attempts by authenticated admin instead of shared proxy IP', async () => {
    const app = buildApp();
    const sendAttempt = (adminId: number) => request(app)
      .post(`${basePath}/embedded-signup/attempts`)
      .set('x-test-admin-id', String(adminId))
      .send({ password: 'confirmed-password' });

    const responses = [];
    for (let index = 0; index < 6; index += 1) {
      responses.push(await sendAttempt(601));
    }
    const differentAdmin = await sendAttempt(602);

    expect(responses.slice(0, 5).every((response) => response.status === 201)).toBe(true);
    expect(responses[5]?.status).toBe(429);
    expect(responses[5]?.headers['cache-control']).toBe('no-store');
    expect(differentAdmin.status).toBe(201);
  });

  it('accepts nonce-only completion for safe subscribed-attempt recovery', async () => {
    const app = buildApp();
    const response = await request(app)
      .post(`${basePath}/embedded-signup/attempts/91f93227-93a5-4e7f-8837-c830d4f22934/complete`)
      .set('x-test-admin-id', '701')
      .send({ nonce: 'n'.repeat(43) });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: { connected: true } });
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('does not echo invalid completion material from validation errors', async () => {
    const app = buildApp();
    const sensitiveInput = 'authorization-code-that-must-not-be-echoed';
    const response = await request(app)
      .post(`${basePath}/embedded-signup/attempts/not-a-uuid/complete`)
      .set('x-test-admin-id', '702')
      .send({ nonce: 'invalid', code: sensitiveInput, session: [] });

    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).not.toContain(sensitiveInput);
    expect(response.headers['cache-control']).toBe('no-store');
  });
});
