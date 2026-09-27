jest.mock('../../config/whatsappConfig.js', () => ({ getWhatsAppTestConfig: jest.fn() }));
jest.mock('../../services/whatsappOutboundMessageService.js', () => ({
  sendWhatsAppTemplateMessage: jest.fn(),
}));
jest.mock('../../models/WhatsAppMessage.js', () => ({
  __esModule: true,
  default: { findOne: jest.fn() },
}));

import type { Request, Response } from 'express';
import { getWhatsAppTestConfig } from '../../config/whatsappConfig';
import WhatsAppMessage from '../../models/WhatsAppMessage';
import { sendWhatsAppTemplateMessage } from '../../services/whatsappOutboundMessageService';
import {
  getWhatsAppDeliveryTestStatus,
  sendWhatsAppDeliveryTest,
} from '../whatsappTestController';

const response = () => ({
  setHeader: jest.fn(),
  status: jest.fn().mockReturnThis(),
  json: jest.fn().mockReturnThis(),
});
const messageModel = WhatsAppMessage as unknown as { findOne: jest.Mock };

describe('WhatsApp delivery test controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    messageModel.findOne.mockReset();
    (getWhatsAppTestConfig as jest.Mock).mockReturnValue({
      recipient: '+48502484066',
      templateName: 'existing_template',
      languageCode: 'en_US',
    });
  });

  it('sends only the server-configured recipient and template', async () => {
    (sendWhatsAppTemplateMessage as jest.Mock).mockResolvedValue({ messageId: 'wamid.1' });
    const res = response();
    await sendWhatsAppDeliveryTest({ body: { recipient: '+19999999999' } } as Request, res as unknown as Response);
    expect(sendWhatsAppTemplateMessage).toHaveBeenCalledWith({
      recipient: '+48502484066',
      templateName: 'existing_template',
      languageCode: 'en_US',
    });
    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.json).toHaveBeenCalledWith({ messageId: 'wamid.1', status: 'accepted' });
  });

  it('reports a webhook delivery status without exposing message content', async () => {
    messageModel.findOne.mockResolvedValue({
      deliveryStatus: 'delivered',
      statusUpdatedAt: new Date('2026-09-27T14:00:00.000Z'),
    });
    const res = response();
    await getWhatsAppDeliveryTestStatus(
      { params: { messageId: 'wamid.1' } } as unknown as Request,
      res as unknown as Response,
    );
    expect(res.json).toHaveBeenCalledWith({
      messageId: 'wamid.1',
      status: 'delivered',
      statusUpdatedAt: '2026-09-27T14:00:00.000Z',
      failure: null,
    });
  });

  it('reports bounded provider failure diagnostics from the signed webhook', async () => {
    messageModel.findOne.mockResolvedValue({
      deliveryStatus: 'failed',
      statusUpdatedAt: new Date('2026-09-27T14:00:00.000Z'),
      deliveryErrorCode: '131026',
      deliveryErrorTitle: 'Message undeliverable',
      deliveryErrorDetails: 'The recipient could not receive this message.',
    });
    const res = response();
    await getWhatsAppDeliveryTestStatus(
      { params: { messageId: 'wamid.failed' } } as unknown as Request,
      res as unknown as Response,
    );
    expect(res.json).toHaveBeenCalledWith({
      messageId: 'wamid.failed',
      status: 'failed',
      statusUpdatedAt: '2026-09-27T14:00:00.000Z',
      failure: {
        code: '131026',
        title: 'Message undeliverable',
        details: 'The recipient could not receive this message.',
      },
    });
  });

  it('distinguishes a missing webhook status from Meta acceptance', async () => {
    messageModel.findOne.mockResolvedValue(null);
    const res = response();
    await getWhatsAppDeliveryTestStatus(
      { params: { messageId: 'wamid.pending' } } as unknown as Request,
      res as unknown as Response,
    );
    expect(res.json).toHaveBeenCalledWith({
      messageId: 'wamid.pending',
      status: 'awaiting_webhook',
      statusUpdatedAt: null,
      failure: null,
    });
  });
});
