jest.mock('../../config/whatsappConfig.js', () => ({
  getWhatsAppBriefConfig: jest.fn(),
}));
jest.mock('../../services/configService.js', () => ({
  refreshConfigCacheKeys: jest.fn().mockResolvedValue(undefined),
}));

import type { NextFunction, Request, Response } from 'express';
import { getWhatsAppBriefConfig } from '../../config/whatsappConfig';
import { refreshConfigCacheKeys } from '../../services/configService';
import { whatsappBriefAuth } from '../whatsappBriefAuth';

const mockConfig = getWhatsAppBriefConfig as jest.Mock;
const mockRefreshConfigCacheKeys = refreshConfigCacheKeys as jest.Mock;

const response = () => ({
  setHeader: jest.fn(),
  status: jest.fn().mockReturnThis(),
  json: jest.fn().mockReturnThis(),
});

describe('whatsappBriefAuth', () => {
  const next: NextFunction = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockConfig.mockReturnValue({ apiToken: 'reader-secret', retentionDays: 7 });
  });

  it('accepts the dedicated Bearer token after refreshing shared config', async () => {
    const req = { get: jest.fn().mockReturnValue('Bearer reader-secret') } as unknown as Request;
    const res = response();

    await whatsappBriefAuth(req, res as unknown as Response, next);

    expect(mockRefreshConfigCacheKeys).toHaveBeenCalledWith(['WHATSAPP_BRIEF_API_TOKEN']);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejects missing or incorrect credentials without a JWT fallback', async () => {
    const req = { get: jest.fn().mockReturnValue('Bearer wrong') } as unknown as Request;
    const res = response();

    await whatsappBriefAuth(req, res as unknown as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.setHeader).toHaveBeenCalledWith('WWW-Authenticate', 'Bearer');
  });

  it('fails closed when the reader is not configured', async () => {
    mockConfig.mockImplementation(() => {
      throw new Error('missing');
    });
    const req = { get: jest.fn() } as unknown as Request;
    const res = response();

    await whatsappBriefAuth(req, res as unknown as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(503);
  });
});
