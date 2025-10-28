import type { NextFunction, Response } from 'express';
import type { AuthenticatedRequest } from '../../types/AuthenticatedRequest';
import { requireRoles } from '../authorizationMiddleware';

const createRequest = (roleSlug: string | null): AuthenticatedRequest =>
  ({
    authContext: roleSlug
      ? {
          id: 1,
          userTypeId: 6,
          roleSlug,
        }
      : undefined,
  } as unknown as AuthenticatedRequest);

const createResponse = () => {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return res as unknown as Response & { status: jest.Mock; json: jest.Mock };
};

const next: NextFunction = jest.fn();

describe('requireRoles', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('allows administrator when admin role is permitted', () => {
    const middleware = requireRoles(['admin']);
    const req = createRequest('administrator');
    const res = createResponse();

    middleware(req, res, next);

    expect(res.status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('allows Administrator casing and aliases', () => {
    const middleware = requireRoles(['ADMINISTRATOR']);
    const req = createRequest('AdministRator');
    const res = createResponse();

    middleware(req, res, next);

    expect(res.status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('denies administrator when role is not permitted', () => {
    const middleware = requireRoles(['owner']);
    const req = createRequest('administrator');
    const res = createResponse();

    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith([{ message: 'Forbidden' }]);
    expect(next).not.toHaveBeenCalled();
  });
});
