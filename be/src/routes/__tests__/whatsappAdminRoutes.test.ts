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
  archiveManagedWhatsAppTemplatesController: jest.fn((_req: AuthenticatedRequest, res: Response) => {
    res.json({ templates: [] });
  }),
  createManagedWhatsAppTemplateController: jest.fn((_req: AuthenticatedRequest, res: Response) => {
    res.status(201).json({ template: { metaTemplateId: '123' } });
  }),
  deleteManagedWhatsAppTemplateController: jest.fn((_req: AuthenticatedRequest, res: Response) => {
    res.json({ deleted: true });
  }),
  getManagedWhatsAppTemplateEventsController: jest.fn((_req: AuthenticatedRequest, res: Response) => {
    res.json({ events: [] });
  }),
  getWhatsAppAdminStatusController: jest.fn((_req: AuthenticatedRequest, res: Response) => {
    res.json({ status: { connected: false } });
  }),
  getWhatsAppTemplateVariablesController: jest.fn((_req: AuthenticatedRequest, res: Response) => {
    res.json({ variables: [] });
  }),
  listManagedWhatsAppTemplatesController: jest.fn((_req: AuthenticatedRequest, res: Response) => {
    res.json({ templates: [] });
  }),
  previewManagedWhatsAppTemplateController: jest.fn((_req: AuthenticatedRequest, res: Response) => {
    res.json({ preview: { body: 'Preview' } });
  }),
  searchWhatsAppTemplateBookingsController: jest.fn((_req: AuthenticatedRequest, res: Response) => {
    res.json({ bookings: [] });
  }),
  sendManagedWhatsAppTemplateController: jest.fn((_req: AuthenticatedRequest, res: Response) => {
    res.status(202).json({ messageId: 'wamid.managed-message-id' });
  }),
  syncManagedWhatsAppTemplatesController: jest.fn((req: AuthenticatedRequest, res: Response) => {
    if (req.body?.password === 'wrong-password') {
      res.status(403).json([{ message: 'Password confirmation is required.' }]);
      return;
    }
    res.json({ templates: [] });
  }),
  unarchiveManagedWhatsAppTemplatesController: jest.fn((_req: AuthenticatedRequest, res: Response) => {
    res.json({ templates: [] });
  }),
  unpauseManagedWhatsAppTemplateController: jest.fn((_req: AuthenticatedRequest, res: Response) => {
    res.json({ template: { metaTemplateId: '123' } });
  }),
  updateManagedWhatsAppTemplateController: jest.fn((_req: AuthenticatedRequest, res: Response) => {
    res.json({ template: { metaTemplateId: '123' } });
  }),
  createWhatsAppEmbeddedSignupAttemptController: jest.fn((_req: AuthenticatedRequest, res: Response) => {
    res.status(201).json({ attempt: { id: 'attempt-id' } });
  }),
  completeWhatsAppEmbeddedSignupAttemptController: jest.fn((_req: AuthenticatedRequest, res: Response) => {
    res.json({ status: { connected: true } });
  }),
  sendWhatsAppTemplateMessageController: jest.fn((_req: AuthenticatedRequest, res: Response) => {
    res.status(202).json({ messageId: 'wamid.accepted-message-id' });
  }),
  getWhatsAppMessageTemplatesController: jest.fn((_req: AuthenticatedRequest, res: Response) => {
    res.json({
      templates: [{ name: 'simple_notice', language: 'en_US', category: 'UTILITY' }],
    });
  }),
  repairWhatsAppWebhookSubscriptionController: jest.fn((_req: AuthenticatedRequest, res: Response) => {
    res.json({ repaired: true, status: { webhookSubscriptionStatus: 'verified' } });
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

  it('accepts a strictly validated password-confirmed subscription repair', async () => {
    const app = buildApp();
    const response = await request(app)
      .post(`${basePath}/webhook-subscription/repair`)
      .set('x-test-admin-id', '751')
      .send({ password: 'confirmed-password' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      repaired: true,
      status: { webhookSubscriptionStatus: 'verified' },
    });
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it.each([{}, { password: '' }, { password: 'x'.repeat(513) }])(
    'rejects an invalid subscription repair password body %#',
    async (bodyValue) => {
      const app = buildApp();
      const response = await request(app)
        .post(`${basePath}/webhook-subscription/repair`)
        .set('x-test-admin-id', '752')
        .send(bodyValue);

      expect(response.status).toBe(400);
      expect(response.headers['cache-control']).toBe('no-store');
    },
  );

  it('accepts only a boolean offboarding confirmation flag', async () => {
    const app = buildApp();
    const accepted = await request(app)
      .post(`${basePath}/embedded-signup/attempts`)
      .set('x-test-admin-id', '801')
      .send({ password: 'confirmed-password', reconnectAfterOffboarding: true });
    const rejected = await request(app)
      .post(`${basePath}/embedded-signup/attempts`)
      .set('x-test-admin-id', '802')
      .send({ password: 'confirmed-password', reconnectAfterOffboarding: 'true' });

    expect(accepted.status).toBe(201);
    expect(rejected.status).toBe(400);
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

  it('accepts a strictly validated E.164 template request from an administrator', async () => {
    const app = buildApp();
    const response = await request(app)
      .post(`${basePath}/messages/template`)
      .set('x-test-admin-id', '901')
      .send({
        password: 'confirmed-password',
        recipient: '+48502484066',
        templateName: 'hello_world',
        languageCode: 'en_US',
      });

    expect(response.status).toBe(202);
    expect(response.body).toEqual({ messageId: 'wamid.accepted-message-id' });
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('lists safe sendable templates for an administrator', async () => {
    const app = buildApp();
    const response = await request(app)
      .get(`${basePath}/messages/templates`)
      .set('x-test-admin-id', '903');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      templates: [{ name: 'simple_notice', language: 'en_US', category: 'UTILITY' }],
    });
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('exposes the managed-template library, variables, booking search, and preview routes', async () => {
    const app = buildApp();
    const headers = { 'x-test-admin-id': '904' };

    const [templates, variables, bookings, preview] = await Promise.all([
      request(app).get(`${basePath}/templates`).set(headers),
      request(app).get(`${basePath}/templates/variables`).set(headers),
      request(app).post(`${basePath}/templates/bookings/search`).set(headers).send({ q: 'alex' }),
      request(app).post(`${basePath}/templates/preview`).set(headers).send({
        metaTemplateId: '123456789',
        bookingId: 42,
      }),
    ]);

    expect(templates.status).toBe(200);
    expect(templates.body).toEqual({ templates: [] });
    expect(variables.body).toEqual({ variables: [] });
    expect(bookings.body).toEqual({ bookings: [] });
    expect(preview.body).toEqual({ preview: { body: 'Preview' } });
  });

  it('strictly validates password-gated managed-template writes', async () => {
    const app = buildApp();
    const path = `${basePath}/templates/sync`;

    const missingPassword = await request(app)
      .post(path)
      .set('x-test-admin-id', '905')
      .send({});
    const accepted = await request(app)
      .post(path)
      .set('x-test-admin-id', '905')
      .send({ password: 'confirmed-password' });

    expect(missingPassword.status).toBe(400);
    expect(accepted.status).toBe(200);
    expect(accepted.body).toEqual({ templates: [] });
  });

  it('strictly rate-limits password confirmation failures by administrator account', async () => {
    const app = buildApp();
    const sync = (adminId: number, password: string) => request(app)
      .post(`${basePath}/templates/sync`)
      .set('x-test-admin-id', String(adminId))
      .send({ password });

    const legitimateResponses = [];
    for (let index = 0; index < 6; index += 1) {
      legitimateResponses.push(await sync(906, 'confirmed-password'));
    }
    expect(legitimateResponses.every((response) => response.status === 200)).toBe(true);

    const failures = [];
    for (let index = 0; index < 6; index += 1) {
      failures.push(await sync(907, 'wrong-password'));
    }
    const differentAdmin = await sync(908, 'wrong-password');

    expect(failures.slice(0, 5).every((response) => response.status === 403)).toBe(true);
    expect(failures[5]?.status).toBe(429);
    expect(failures[5]?.body).toEqual([{
      message: 'Too many password confirmation failures. Try again later.',
    }]);
    expect(differentAdmin.status).toBe(403);
  });

  it.each([
    { recipient: '48502484066', templateName: 'hello_world', languageCode: 'en_US' },
    { recipient: '+48502484066 ', templateName: 'hello_world', languageCode: 'en_US' },
    { recipient: '+48502484066', templateName: 'Hello World', languageCode: 'en_US' },
    { recipient: '+48502484066', templateName: 'hello_world', languageCode: 'EN-us' },
  ])('rejects malformed template requests before the controller runs', async (input) => {
    const app = buildApp();
    const response = await request(app)
      .post(`${basePath}/messages/template`)
      .set('x-test-admin-id', '902')
      .send({ password: 'confirmed-password', ...input });

    expect(response.status).toBe(400);
    expect(response.headers['cache-control']).toBe('no-store');
  });
});
