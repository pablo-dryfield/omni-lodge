jest.mock('../../config/whatsappConfig.js', () => ({
  getWhatsAppWebhookConfig: jest.fn(),
  getWhatsAppWebhookVerificationConfig: jest.fn(),
}));
jest.mock('../../services/configService.js', () => ({
  refreshConfigCacheKeys: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../services/whatsappWebhookQueueService.js', () => ({
  enqueueWhatsAppWebhook: jest.fn(),
  hashWhatsAppWebhookDelivery: jest.fn(),
}));
jest.mock('../../jobs/whatsappWebhookQueue.cron.js', () => ({
  kickWhatsAppWebhookQueue: jest.fn(),
}));
jest.mock('../../services/errorMonitoringService.js', () => ({
  captureBackendExceptionSafe: jest.fn(),
}));
jest.mock('../../services/whatsappWebhookParser.js', () => {
  class MockWhatsAppWebhookValidationError extends Error {
    readonly safeCode: string;

    constructor(safeCode: string, message: string) {
      super(message);
      this.name = 'WhatsAppWebhookValidationError';
      this.safeCode = safeCode;
    }
  }
  return {
    parseMetaWebhook: jest.fn(),
    verifyMetaWebhookSignature: jest.fn(),
    WhatsAppWebhookValidationError: MockWhatsAppWebhookValidationError,
  };
});
jest.mock('../../utils/logger.js', () => ({
  __esModule: true,
  default: { info: jest.fn(), error: jest.fn() },
}));

import type { Request, Response } from 'express';
import {
  getWhatsAppWebhookConfig,
  getWhatsAppWebhookVerificationConfig,
} from '../../config/whatsappConfig';
import { kickWhatsAppWebhookQueue } from '../../jobs/whatsappWebhookQueue.cron';
import { captureBackendExceptionSafe } from '../../services/errorMonitoringService';
import {
  parseMetaWebhook,
  verifyMetaWebhookSignature,
  WhatsAppWebhookValidationError,
} from '../../services/whatsappWebhookParser';
import {
  enqueueWhatsAppWebhook,
  hashWhatsAppWebhookDelivery,
} from '../../services/whatsappWebhookQueueService';
import { receiveWhatsAppWebhook, verifyWhatsAppWebhook } from '../whatsappWebhookController';

const mockConfig = getWhatsAppWebhookConfig as jest.Mock;
const mockVerificationConfig = getWhatsAppWebhookVerificationConfig as jest.Mock;
const mockEnqueue = enqueueWhatsAppWebhook as jest.Mock;
const mockHash = hashWhatsAppWebhookDelivery as jest.Mock;
const mockKick = kickWhatsAppWebhookQueue as jest.Mock;
const mockCapture = captureBackendExceptionSafe as jest.Mock;
const mockParse = parseMetaWebhook as jest.Mock;
const mockSignature = verifyMetaWebhookSignature as jest.Mock;

const response = () => ({
  locals: {} as Record<string, unknown>,
  status: jest.fn().mockReturnThis(),
  type: jest.fn().mockReturnThis(),
  send: jest.fn().mockReturnThis(),
});

describe('WhatsApp webhook controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockConfig.mockReturnValue({
      verifyToken: 'verify-secret',
      appSecret: 'app-secret',
      wabaId: 'waba-1',
      phoneNumberId: 'phone-1',
      retentionDays: 7,
    });
    mockVerificationConfig.mockReturnValue({ verifyToken: 'verify-secret' });
  });

  it('returns Meta challenge using only the verification-token configuration', async () => {
    const req = {
      query: {
        'hub.mode': 'subscribe',
        'hub.challenge': 'challenge-value',
        'hub.verify_token': 'verify-secret',
      },
    } as unknown as Request;
    const res = response();

    mockConfig.mockImplementation(() => {
      throw new Error('full webhook config is incomplete');
    });
    await verifyWhatsAppWebhook(req, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith('challenge-value');
  });

  it('rejects a mismatched verification token', async () => {
    const req = {
      query: {
        'hub.mode': 'subscribe',
        'hub.challenge': 'challenge-value',
        'hub.verify_token': 'wrong',
      },
    } as unknown as Request;
    const res = response();

    await verifyWhatsAppWebhook(req, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.send).not.toHaveBeenCalledWith('challenge-value');
  });

  it('verifies the exact raw body before parsing and persists the normalized batch', async () => {
    const rawBody = Buffer.from('{"object":"whatsapp_business_account"}');
    const batch = { events: [{ kind: 'message' }] };
    mockSignature.mockReturnValue(true);
    mockParse.mockReturnValue(batch);
    mockHash.mockReturnValue('a'.repeat(64));
    mockEnqueue.mockResolvedValue({ queued: true, duplicate: false });
    const req = {
      body: rawBody,
      get: jest.fn().mockImplementation((name: string) =>
        name === 'x-hub-signature-256' ? 'sha256=abc' : undefined),
    } as unknown as Request;
    const res = response();

    await receiveWhatsAppWebhook(req, res as unknown as Response);

    expect(mockSignature).toHaveBeenCalledWith(rawBody, 'sha256=abc', 'app-secret');
    expect(mockParse).toHaveBeenCalledWith(rawBody, { wabaId: 'waba-1', phoneNumberId: 'phone-1' });
    expect(mockEnqueue).toHaveBeenCalledWith({
      batch,
      deliveryHash: 'a'.repeat(64),
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockKick).toHaveBeenCalledTimes(1);
  });

  it('rejects an invalid signature before parsing', async () => {
    mockSignature.mockReturnValue(false);
    const req = {
      body: Buffer.from('{}'),
      get: jest.fn().mockReturnValue('sha256=bad'),
    } as unknown as Request;
    const res = response();

    await receiveWhatsAppWebhook(req, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockParse).not.toHaveBeenCalled();
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('captures a static validation code without retaining the webhook payload', async () => {
    const validationError = new WhatsAppWebhookValidationError(
      'UNEXPECTED_WABA_ID',
      'WhatsApp webhook has an unexpected WABA id',
    );
    mockSignature.mockReturnValue(true);
    mockParse.mockImplementation(() => {
      throw validationError;
    });
    const req = {
      body: Buffer.from('{"private":"payload"}'),
      get: jest.fn().mockReturnValue('sha256=valid'),
    } as unknown as Request;
    const res = response();

    await receiveWhatsAppWebhook(req, res as unknown as Response);

    expect(mockCapture).toHaveBeenCalledWith(validationError, req, {
      statusCode: 400,
      reference: 'WHATSAPP_WEBHOOK_UNEXPECTED_WABA_ID',
    });
    expect(validationError.message).not.toContain('private');
    expect(validationError.safeCode).toBe('UNEXPECTED_WABA_ID');
    expect(res.locals.errorMonitoringExceptionCaptured).toBe(true);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith('Invalid webhook payload.');
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('reports unexpected parser failures as server errors', async () => {
    const parserError = new Error('Parser invariant failed');
    mockSignature.mockReturnValue(true);
    mockParse.mockImplementation(() => {
      throw parserError;
    });
    const req = {
      body: Buffer.from('{}'),
      get: jest.fn().mockReturnValue('sha256=valid'),
    } as unknown as Request;
    const res = response();

    await receiveWhatsAppWebhook(req, res as unknown as Response);

    expect(mockCapture).toHaveBeenCalledWith(parserError, req, {
      statusCode: 500,
      reference: 'WHATSAPP_WEBHOOK_PARSE_FAILURE',
    });
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith('Webhook parsing failed.');
  });
});
