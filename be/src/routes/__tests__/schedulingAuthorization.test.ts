import express, { type RequestHandler } from 'express';
import request from 'supertest';
import { requireRoles } from '../../middleware/authorizationMiddleware';
import { MANAGER_ROLES } from '../schedulingRoles';
import type { AuthenticatedRequest } from '../../types/AuthenticatedRequest';

const withRole = (roleSlug: string | null): RequestHandler => {
  return (req, _res, next) => {
    (req as AuthenticatedRequest).authContext = roleSlug
      ? { id: 1, userTypeId: 6, roleSlug }
      : undefined;
    next();
  };
};

const buildApp = (roleSlug: string | null) => {
  const app = express();
  app.get(
    '/schedules/shift-templates',
    withRole(roleSlug),
    requireRoles(MANAGER_ROLES),
    (_req, res) => res.status(204).send(),
  );
  return app;
};

describe('scheduling manager protection', () => {
  it('allows administrator role to read shift templates', async () => {
    const app = buildApp('administrator');
    const response = await request(app).get('/schedules/shift-templates');
    expect(response.status).toBe(204);
  });

  it('allows manager role to read shift templates', async () => {
    const app = buildApp('manager');
    const response = await request(app).get('/schedules/shift-templates');
    expect(response.status).toBe(204);
  });

  it('rejects guide role for manager-only access', async () => {
    const app = buildApp('guide');
    const response = await request(app).get('/schedules/shift-templates');
    expect(response.status).toBe(403);
  });
});
