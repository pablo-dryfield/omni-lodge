jest.mock('bcryptjs', () => ({
  __esModule: true,
  default: { compare: jest.fn() },
}));
jest.mock('../../services/whatsappEmbeddedSignupService.js', () => ({
  getWhatsAppAdminStatus: jest.fn(),
  createWhatsAppEmbeddedSignupAttempt: jest.fn(),
  completeWhatsAppEmbeddedSignupAttempt: jest.fn(),
}));

import bcrypt from 'bcryptjs';
import type { Response } from 'express';
import SequelizeModelStub from '../../__mocks__/sequelizeModelStub';
import HttpError from '../../errors/HttpError';
import {
  completeWhatsAppEmbeddedSignupAttempt,
  createWhatsAppEmbeddedSignupAttempt,
  getWhatsAppAdminStatus,
} from '../../services/whatsappEmbeddedSignupService';
import type { AuthenticatedRequest } from '../../types/AuthenticatedRequest';
import {
  completeWhatsAppEmbeddedSignupAttemptController,
  createWhatsAppEmbeddedSignupAttemptController,
  getWhatsAppAdminStatusController,
} from '../whatsappAdminController';

const response = () => ({
  set: jest.fn().mockReturnThis(),
  status: jest.fn().mockReturnThis(),
  json: jest.fn().mockReturnThis(),
});

const mockCompare = bcrypt.compare as jest.Mock;
const userModel = SequelizeModelStub as unknown as { findByPk: jest.Mock };
userModel.findByPk = jest.fn();
const mockCreate = createWhatsAppEmbeddedSignupAttempt as jest.Mock;
const mockComplete = completeWhatsAppEmbeddedSignupAttempt as jest.Mock;
const mockStatus = getWhatsAppAdminStatus as jest.Mock;

describe('WhatsApp admin controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    userModel.findByPk.mockResolvedValue({ id: 7, password: 'password-hash' });
    mockCompare.mockResolvedValue(true);
  });

  it('requires password re-authentication and returns the exact launch contract', async () => {
    const payload = {
      attempt: {
        id: '91f93227-93a5-4e7f-8837-c830d4f22934',
        nonce: 'n'.repeat(43),
        expiresAt: '2026-08-27T10:10:00.000Z',
      },
      launch: {
        appId: '828737393371751',
        configId: '123456789',
        graphApiVersion: 'v25.0',
      },
    };
    mockCreate.mockResolvedValue(payload);
    const req = {
      authContext: { id: 7, roleSlug: 'admin' },
      body: { password: 'confirmed-password' },
    } as unknown as AuthenticatedRequest;
    const res = response();

    await createWhatsAppEmbeddedSignupAttemptController(req, res as unknown as Response);

    expect(userModel.findByPk).toHaveBeenCalledWith(7);
    expect(mockCompare).toHaveBeenCalledWith('confirmed-password', 'password-hash');
    expect(mockCreate).toHaveBeenCalledWith(7);
    expect(res.set).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(payload);
  });

  it('does not create an attempt when password confirmation fails', async () => {
    mockCompare.mockResolvedValue(false);
    const req = {
      authContext: { id: 7, roleSlug: 'admin' },
      body: { password: 'wrong' },
    } as unknown as AuthenticatedRequest;
    const res = response();

    await createWhatsAppEmbeddedSignupAttemptController(req, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('returns only the safe status from completion and status endpoints', async () => {
    const safeStatus = { connected: true, businessAccessTokenConfigured: true };
    mockComplete.mockResolvedValue(safeStatus);
    mockStatus.mockResolvedValue(safeStatus);
    const completionReq = {
      authContext: { id: 7, roleSlug: 'admin' },
      params: { id: '91f93227-93a5-4e7f-8837-c830d4f22934' },
      body: { nonce: 'n'.repeat(43), code: 'code', session: {} },
    } as unknown as AuthenticatedRequest;
    const completionRes = response();

    await completeWhatsAppEmbeddedSignupAttemptController(
      completionReq,
      completionRes as unknown as Response,
    );
    expect(completionRes.json).toHaveBeenCalledWith({ status: safeStatus });
    expect(completionRes.set).toHaveBeenCalledWith('Cache-Control', 'no-store');

    const statusRes = response();
    await getWhatsAppAdminStatusController({} as AuthenticatedRequest, statusRes as unknown as Response);
    expect(statusRes.json).toHaveBeenCalledWith({ status: safeStatus });
    expect(statusRes.set).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });

  it('does not echo unexpected provider or credential error messages', async () => {
    mockComplete.mockRejectedValue(new Error('provider response contained a secret token'));
    const req = {
      authContext: { id: 7, roleSlug: 'admin' },
      params: { id: '91f93227-93a5-4e7f-8837-c830d4f22934' },
      body: { nonce: 'n'.repeat(43), code: 'code', session: {} },
    } as unknown as AuthenticatedRequest;
    const res = response();

    await completeWhatsAppEmbeddedSignupAttemptController(req, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith([{ message: 'Unexpected server error.' }]);
    expect(JSON.stringify(res.json.mock.calls)).not.toContain('secret token');
  });

  it('whitelists only a syntactically safe error code from HttpError details', async () => {
    mockComplete.mockRejectedValueOnce(new HttpError(502, 'Safe onboarding failure.', {
      code: 'META_400_OAUTHEXCEPTION_190',
      providerBody: 'credential material',
    }));
    const req = {
      authContext: { id: 7, roleSlug: 'admin' },
      params: { id: '91f93227-93a5-4e7f-8837-c830d4f22934' },
      body: { nonce: 'n'.repeat(43), code: 'code', session: {} },
    } as unknown as AuthenticatedRequest;
    const safeRes = response();

    await completeWhatsAppEmbeddedSignupAttemptController(
      req,
      safeRes as unknown as Response,
    );

    expect(safeRes.json).toHaveBeenCalledWith([{
      message: 'Safe onboarding failure.',
      details: { code: 'META_400_OAUTHEXCEPTION_190' },
    }]);
    expect(JSON.stringify(safeRes.json.mock.calls)).not.toContain('credential material');

    mockComplete.mockRejectedValueOnce(new HttpError(502, 'Safe onboarding failure.', {
      code: 'unsafe code: token=value',
    }));
    const unsafeRes = response();
    await completeWhatsAppEmbeddedSignupAttemptController(
      req,
      unsafeRes as unknown as Response,
    );
    expect(unsafeRes.json).toHaveBeenCalledWith([{ message: 'Safe onboarding failure.' }]);
  });
});
