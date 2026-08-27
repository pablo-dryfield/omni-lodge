jest.mock('../../config/whatsappConfig.js', () => ({
  getWhatsAppBriefConfig: jest.fn(() => ({ apiToken: 'reader-secret', retentionDays: 7 })),
  getWhatsAppWebhookConfig: jest.fn(() => ({
    verifyToken: 'verify', appSecret: 'app', wabaId: 'waba', phoneNumberId: 'phone', retentionDays: 7,
  })),
  getWhatsAppWebhookQueueConfig: jest.fn(() => ({
    activeKey: { id: 'key-1', material: Buffer.alloc(32) },
    decryptionKeys: new Map([['key-1', Buffer.alloc(32)]]),
  })),
}));
jest.mock('../../services/whatsappMessageService.js', () => ({
  WHATSAPP_MAX_QUERY_LIMIT: 100,
  WHATSAPP_MAX_RETENTION_DAYS: 7,
  getWhatsAppMessageContext: jest.fn(),
  getWhatsAppSourceStatus: jest.fn(),
  searchWhatsAppMessages: jest.fn(),
}));
jest.mock('../../services/configService.js', () => ({
  refreshConfigCacheKeys: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../utils/logger.js', () => ({
  __esModule: true,
  default: { error: jest.fn() },
}));

import type { Request, Response } from 'express';
import {
  getWhatsAppMessageContext,
  getWhatsAppSourceStatus,
  searchWhatsAppMessages,
} from '../../services/whatsappMessageService';
import {
  getWhatsAppBriefContext,
  getWhatsAppBriefMessages,
  getWhatsAppBriefStatus,
} from '../whatsappBriefController';

const mockContext = getWhatsAppMessageContext as jest.Mock;
const mockStatus = getWhatsAppSourceStatus as jest.Mock;
const mockSearch = searchWhatsAppMessages as jest.Mock;

const response = () => ({
  setHeader: jest.fn(),
  status: jest.fn().mockReturnThis(),
  json: jest.fn().mockReturnThis(),
});

const connectedStatus = {
  source: 'whatsapp',
  available: true,
  status: 'connected',
  historySyncStatus: 'complete',
  lastWebhookAt: '2026-08-27T06:00:00.000Z',
  lastSuccessfulIngestAt: '2026-08-27T06:00:00.000Z',
  lastMessageAt: '2026-08-27T05:59:00.000Z',
  lastErrorAt: null,
  lastErrorCode: null,
  retentionDays: 7,
};

describe('WhatsApp brief controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStatus.mockResolvedValue(connectedStatus);
  });

  it('reports connected source status without caching', async () => {
    const res = response();
    await getWhatsAppBriefStatus({} as Request, res as unknown as Response);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ available: true, configured: true }));
  });

  it('returns bounded recent messages and labels content as untrusted', async () => {
    const item = { citationRef: 'whatsapp:wamid.1', text: 'Please call me' };
    mockSearch.mockResolvedValue([item]);
    const req = {
      query: {
        since: new Date(Date.now() - 60_000).toISOString(),
        until: new Date(Date.now() - 1_000).toISOString(),
        limit: '5',
      },
    } as unknown as Request;
    const res = response();

    await getWhatsAppBriefMessages(req, res as unknown as Response);

    expect(mockSearch).toHaveBeenCalledWith(expect.objectContaining({ limit: 5, phoneNumberId: 'phone' }));
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ count: 1, messages: [item] }));
  });

  it('rejects a lookback beyond the retention window', async () => {
    const req = {
      query: {
        since: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
        until: new Date(Date.now() - 1_000).toISOString(),
      },
    } as unknown as Request;
    const res = response();

    await getWhatsAppBriefMessages(req, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it('returns only targeted context for a retained citation', async () => {
    mockContext.mockResolvedValue([{ citationRef: 'whatsapp:wamid.1' }]);
    const req = {
      params: { providerMessageId: 'wamid.1' },
      query: { before: '4', after: '1' },
    } as unknown as Request;
    const res = response();

    await getWhatsAppBriefContext(req, res as unknown as Response);

    expect(mockContext).toHaveBeenCalledWith({
      providerMessageId: 'wamid.1',
      before: 4,
      after: 1,
      phoneNumberId: 'phone',
    });
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
