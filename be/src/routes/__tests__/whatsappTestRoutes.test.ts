import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';

jest.mock('../../middleware/whatsappTestAuth.js', () => ({
  whatsappTestAuth: (_req: Request, _res: Response, next: NextFunction) => next(),
}));
jest.mock('../../controllers/whatsappTestController.js', () => ({
  sendWhatsAppDeliveryTest: jest.fn((_req: Request, res: Response) => {
    res.status(202).json({ messageId: 'wamid.accepted-message-id', status: 'accepted' });
  }),
  getWhatsAppDeliveryTestStatus: jest.fn((_req: Request, res: Response) => {
    res.json({
      messageId: 'wamid.accepted-message-id',
      status: 'awaiting_webhook',
      statusUpdatedAt: null,
      failure: null,
    });
  }),
}));

import { sendWhatsAppDeliveryTest } from '../../controllers/whatsappTestController';
import whatsappTestRoutes from '../whatsappTestRoutes';

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/integrations/whatsapp/test', whatsappTestRoutes);
  return app;
};

describe('WhatsApp test routes', () => {
  it('allows consecutive authenticated delivery-test requests', async () => {
    const app = buildApp();

    const first = await request(app)
      .post('/api/integrations/whatsapp/test/messages')
      .send({});
    const second = await request(app)
      .post('/api/integrations/whatsapp/test/messages')
      .send({});

    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(sendWhatsAppDeliveryTest).toHaveBeenCalledTimes(2);
  });
});
