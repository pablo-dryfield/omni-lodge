jest.mock('../../config/whatsappConfig.js', () => ({ getWhatsAppTestConfig: jest.fn() }));
jest.mock('../../services/configService.js', () => ({
  refreshConfigCacheKeys: jest.fn().mockResolvedValue(undefined),
}));

import type { NextFunction, Request, Response } from 'express';
import { getWhatsAppTestConfig } from '../../config/whatsappConfig';
import { whatsappTestAuth } from '../whatsappTestAuth';

const mockConfig = getWhatsAppTestConfig as jest.Mock;
const response = () => ({
  setHeader: jest.fn(),
  status: jest.fn().mockReturnThis(),
  json: jest.fn().mockReturnThis(),
});

describe('whatsappTestAuth', () => {
  const next: NextFunction = jest.fn();
  beforeEach(() => {
    jest.clearAllMocks();
    mockConfig.mockReturnValue({ apiToken: 'a'.repeat(32) });
  });

  it('accepts only the dedicated bearer token', async () => {
    const req = { get: jest.fn().mockReturnValue(`Bearer ${'a'.repeat(32)}`) } as unknown as Request;
    const res = response();
    await whatsappTestAuth(req, res as unknown as Response, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('rejects a different token', async () => {
    const req = { get: jest.fn().mockReturnValue(`Bearer ${'b'.repeat(32)}`) } as unknown as Request;
    const res = response();
    await whatsappTestAuth(req, res as unknown as Response, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('fails closed when test sending is not configured', async () => {
    mockConfig.mockImplementation(() => { throw new Error('missing'); });
    const req = { get: jest.fn() } as unknown as Request;
    const res = response();
    await whatsappTestAuth(req, res as unknown as Response, next);
    expect(res.status).toHaveBeenCalledWith(503);
  });
});
