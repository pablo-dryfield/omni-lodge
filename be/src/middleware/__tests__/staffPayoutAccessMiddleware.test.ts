import type { NextFunction, Response } from 'express';
import type { AuthenticatedRequest } from '../../types/AuthenticatedRequest';
import { hasModuleActionPermission } from '../authorizationMiddleware';
import { authorizeStaffPayoutView } from '../staffPayoutAccessMiddleware';

jest.mock('../authorizationMiddleware.js', () => ({
  hasModuleActionPermission: jest.fn(),
}));

const mockedHasPermission = hasModuleActionPermission as jest.Mock;

const createResponse = () => {
  const response = {
    status: jest.fn(),
    json: jest.fn(),
    setHeader: jest.fn(),
  };
  response.status.mockReturnValue(response);
  response.json.mockReturnValue(response);
  return response as unknown as Response & {
    status: jest.Mock;
    json: jest.Mock;
    setHeader: jest.Mock;
  };
};

describe('authorizeStaffPayoutView', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('prefers full access and records the server-authoritative all scope', async () => {
    mockedHasPermission.mockResolvedValueOnce(true);
    const req = {} as AuthenticatedRequest;
    const res = createResponse();
    const next = jest.fn() as NextFunction;

    await authorizeStaffPayoutView(req, res, next);

    expect(req.staffPayoutAccessScope).toBe('all');
    expect(mockedHasPermission).toHaveBeenCalledTimes(1);
    expect(mockedHasPermission).toHaveBeenCalledWith(req, 'staff-payouts-all', 'view');
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('uses self scope when only self access is configured', async () => {
    mockedHasPermission.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const req = {} as AuthenticatedRequest;
    const res = createResponse();
    const next = jest.fn() as NextFunction;

    await authorizeStaffPayoutView(req, res, next);

    expect(req.staffPayoutAccessScope).toBe('self');
    expect(mockedHasPermission).toHaveBeenNthCalledWith(2, req, 'staff-payouts-self', 'view');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('rejects before report work when neither module is allowed', async () => {
    mockedHasPermission.mockResolvedValue(false);
    const req = {} as AuthenticatedRequest;
    const res = createResponse();
    const next = jest.fn() as NextFunction;

    await authorizeStaffPayoutView(req, res, next);

    expect(req.staffPayoutAccessScope).toBeUndefined();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith([{ message: 'Forbidden' }]);
    expect(next).not.toHaveBeenCalled();
  });
});
