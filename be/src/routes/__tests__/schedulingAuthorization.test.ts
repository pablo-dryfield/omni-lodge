import express, { type RequestHandler } from 'express';
import request from 'supertest';
import { requireRoles } from '../../middleware/authorizationMiddleware';
import { MANAGER_ROLES, isSchedulingManagerRole } from '../schedulingRoles';
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
  it.each(MANAGER_ROLES)('allows %s role to access manager-only scheduling actions', async (roleSlug) => {
    const app = buildApp(roleSlug);
    const response = await request(app).get('/schedules/shift-templates');
    expect(response.status).toBe(204);
  });

  it('rejects guide role for manager-only access', async () => {
    const app = buildApp('guide');
    const response = await request(app).get('/schedules/shift-templates');
    expect(response.status).toBe(403);
  });

  it('rejects a request without an authenticated role', async () => {
    const app = buildApp(null);
    const response = await request(app).get('/schedules/shift-templates');
    expect(response.status).toBe(403);
  });

  it.each(MANAGER_ROLES)('uses the same manager role set for required-action decisions (%s)', (roleSlug) => {
    expect(isSchedulingManagerRole(roleSlug)).toBe(true);
  });

  it('does not treat a guide as a scheduling manager in required actions', () => {
    expect(isSchedulingManagerRole('guide')).toBe(false);
  });
});
