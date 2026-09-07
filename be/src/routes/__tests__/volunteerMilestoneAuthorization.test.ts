import express, { type RequestHandler, type Response } from 'express';
import request from 'supertest';
import type { AuthenticatedRequest } from '../../types/AuthenticatedRequest.js';

jest.mock('../../middleware/authMiddleware.js', () => ({
  __esModule: true,
  default: ((req: AuthenticatedRequest, res: Response, next: () => void) => {
    const roleSlug = req.header('x-test-role');
    if (!roleSlug) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }
    req.authContext = { id: 91, userTypeId: 6, roleSlug };
    next();
  }) as RequestHandler,
}));

jest.mock('../../models/VolunteerShiftAttendance.js', () => ({
  __esModule: true,
  VOLUNTEER_ATTENDANCE_STATUSES: ['attended', 'late', 'absent', 'excused'],
  default: {},
}));

jest.mock('../../middleware/authorizationMiddleware.js', () => ({
  authorizeModuleAction: (moduleSlug: string, actionKey: string) => (
    req: AuthenticatedRequest,
    res: Response,
    next: () => void,
  ) => {
    const actions = String(req.header('x-test-actions') ?? '').split(',');
    if (moduleSlug !== 'volunteer-progress' || !actions.includes(actionKey)) {
      res.status(403).json([{ message: 'Forbidden' }]);
      return;
    }
    next();
  },
  requireRoles: (roleSlugs: readonly string[]) => {
    const normalized = new Set(roleSlugs.map((role) => role.toLowerCase().replace(/_/gu, '-')));
    return (req: AuthenticatedRequest, res: Response, next: () => void) => {
      const role = req.authContext?.roleSlug?.toLowerCase().replace(/_/gu, '-');
      const canonical = role === 'administrator' ? 'admin' : role === 'mgr' ? 'manager' : role;
      if (!canonical || !normalized.has(canonical)) {
        res.status(403).json([{ message: 'Forbidden' }]);
        return;
      }
      next();
    };
  },
}));

jest.mock('../../controllers/volunteerMilestoneController.js', () => {
  const respond = jest.fn((_req: AuthenticatedRequest, res: Response) => res.status(204).send());
  return {
    getMyVolunteerMilestones: jest.fn(respond),
    getVolunteerMilestones: jest.fn(respond),
    listVolunteerMilestones: jest.fn(respond),
    putVolunteerAttendance: jest.fn(respond),
    putVolunteerManagementFeedback: jest.fn(respond),
    createVolunteerStay: jest.fn(respond),
    updateVolunteerStay: jest.fn(respond),
    putVolunteerStayFeedback: jest.fn(respond),
    streamVolunteerProfilePhoto: jest.fn(respond),
  };
});

import {
  getMyVolunteerMilestones,
  getVolunteerMilestones,
  listVolunteerMilestones,
  putVolunteerAttendance,
  putVolunteerManagementFeedback,
  createVolunteerStay,
  updateVolunteerStay,
  putVolunteerStayFeedback,
  streamVolunteerProfilePhoto,
} from '../../controllers/volunteerMilestoneController.js';
import volunteerMilestoneRoutes from '../volunteerMilestoneRoutes.js';

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/volunteerMilestones', volunteerMilestoneRoutes);
  return app;
};

describe('volunteer milestone route authorization and contract', () => {
  beforeEach(() => jest.clearAllMocks());

  it('allows a guide to read only their own selected historical period', async () => {
    const response = await request(buildApp())
      .get('/api/volunteerMilestones/me?period=2026-02')
      .set('x-test-role', 'guide')
      .set('x-test-actions', 'view');
    expect(response.status).toBe(204);
    expect(getMyVolunteerMilestones).toHaveBeenCalledTimes(1);
    expect((getMyVolunteerMilestones as jest.Mock).mock.calls[0][0].query.period).toBe('2026-02');
  });

  it('prevents a guide from listing or reading another volunteer', async () => {
    const app = buildApp();
    const list = await request(app)
      .get('/api/volunteerMilestones?period=2026-02')
      .set('x-test-role', 'guide')
      .set('x-test-actions', 'view');
    const detail = await request(app)
      .get('/api/volunteerMilestones/42?period=2026-02')
      .set('x-test-role', 'guide')
      .set('x-test-actions', 'view');
    expect([list.status, detail.status]).toEqual([403, 403]);
    expect(listVolunteerMilestones).not.toHaveBeenCalled();
    expect(getVolunteerMilestones).not.toHaveBeenCalled();
  });

  it.each(['admin', 'owner', 'manager', 'assistant_manager'])('allows %s to list volunteer summaries', async (role) => {
    const response = await request(buildApp())
      .get('/api/volunteerMilestones?period=2026-02')
      .set('x-test-role', role)
      .set('x-test-actions', 'view');
    expect(response.status).toBe(204);
  });

  it('allows a volunteer to load only their own progress photo', async () => {
    const app = buildApp();
    const own = await request(app)
      .get('/api/volunteerMilestones/91/profile-photo')
      .set('x-test-role', 'guide')
      .set('x-test-actions', 'view');
    const other = await request(app)
      .get('/api/volunteerMilestones/42/profile-photo')
      .set('x-test-role', 'guide')
      .set('x-test-actions', 'view');

    expect([own.status, other.status]).toEqual([204, 403]);
    expect(streamVolunteerProfilePhoto).toHaveBeenCalledTimes(1);
    expect((streamVolunteerProfilePhoto as jest.Mock).mock.calls[0][0].params.userId).toBe(91);
    expect(getVolunteerMilestones).not.toHaveBeenCalled();
  });

  it.each(['admin', 'owner', 'manager', 'assistant_manager'])(
    'allows %s to load another volunteer photo with view permission',
    async (role) => {
      const response = await request(buildApp())
        .get('/api/volunteerMilestones/42/profile-photo')
        .set('x-test-role', role)
        .set('x-test-actions', 'view');
      expect(response.status).toBe(204);
    },
  );

  it('requires view permission and validates the photo subject before dispatch', async () => {
    const app = buildApp();
    const noPermission = await request(app)
      .get('/api/volunteerMilestones/91/profile-photo')
      .set('x-test-role', 'guide');
    const invalid = await request(app)
      .get('/api/volunteerMilestones/not-a-user/profile-photo')
      .set('x-test-role', 'manager')
      .set('x-test-actions', 'view');
    expect([noPermission.status, invalid.status]).toEqual([403, 400]);
    expect(streamVolunteerProfilePhoto).not.toHaveBeenCalled();
  });

  it('requires both a management role and update permission for attendance', async () => {
    const app = buildApp();
    const guide = await request(app)
      .put('/api/volunteerMilestones/attendance/55')
      .set('x-test-role', 'guide')
      .set('x-test-actions', 'update')
      .send({ status: 'attended' });
    const viewOnlyManager = await request(app)
      .put('/api/volunteerMilestones/attendance/55')
      .set('x-test-role', 'manager')
      .set('x-test-actions', 'view')
      .send({ status: 'attended' });
    const manager = await request(app)
      .put('/api/volunteerMilestones/attendance/55')
      .set('x-test-role', 'manager')
      .set('x-test-actions', 'update')
      .send({ status: 'late', notes: 'Arrived five minutes late.' });

    expect([guide.status, viewOnlyManager.status, manager.status]).toEqual([403, 403, 204]);
    expect(putVolunteerAttendance).toHaveBeenCalledTimes(1);
  });

  it('uses the period path contract and update permission for feedback', async () => {
    const response = await request(buildApp())
      .patch('/api/volunteerMilestones/42/2026-02/feedback')
      .set('x-test-role', 'manager')
      .set('x-test-actions', 'update')
      .send({ approved: false, feedback: 'Keep building consistency.' });
    expect(response.status).toBe(204);
    expect(putVolunteerManagementFeedback).toHaveBeenCalledTimes(1);
    expect((putVolunteerManagementFeedback as jest.Mock).mock.calls[0][0].params.period).toBe('2026-02');
  });

  it('rejects invalid periods, attendance statuses, and unknown mutation fields', async () => {
    const app = buildApp();
    const invalidPeriod = await request(app)
      .get('/api/volunteerMilestones/me?period=2026-13')
      .set('x-test-role', 'guide')
      .set('x-test-actions', 'view');
    const invalidStatus = await request(app)
      .put('/api/volunteerMilestones/attendance/55')
      .set('x-test-role', 'manager')
      .set('x-test-actions', 'update')
      .send({ status: 'scheduled' });
    const unknownField = await request(app)
      .patch('/api/volunteerMilestones/42/2026-02/feedback')
      .set('x-test-role', 'manager')
      .set('x-test-actions', 'update')
      .send({ approved: false, rating: 5 });
    expect([invalidPeriod.status, invalidStatus.status, unknownField.status]).toEqual([400, 400, 400]);
  });

  it('lets Social Media volunteers view saved stays but rejects invalid or mixed selectors', async () => {
    const app = buildApp();
    const own = await request(app).get('/api/volunteerMilestones/me?stayId=12')
      .set('x-test-role', 'social-media').set('x-test-actions', 'view');
    const invalid = await request(app).get('/api/volunteerMilestones/me?stayId=-2')
      .set('x-test-role', 'guide').set('x-test-actions', 'view');
    const mixed = await request(app).get('/api/volunteerMilestones/me?stayId=12&period=2026-08')
      .set('x-test-role', 'guide').set('x-test-actions', 'view');
    expect([own.status, invalid.status, mixed.status]).toEqual([204, 400, 400]);
    expect(getMyVolunteerMilestones).toHaveBeenCalledTimes(1);
  });

  it.each(['guide', 'social-media'])('denies %s all stay management writes even with update module permission', async (role) => {
    const app = buildApp();
    const create = await request(app).post('/api/volunteerMilestones/91/stays')
      .set('x-test-role', role).set('x-test-actions', 'update').send({});
    const update = await request(app).patch('/api/volunteerMilestones/91/stays/12')
      .set('x-test-role', role).set('x-test-actions', 'update').send({ expectedRevision: 1 });
    const feedback = await request(app).patch('/api/volunteerMilestones/91/stays/12/feedback')
      .set('x-test-role', role).set('x-test-actions', 'update').send({ expectedRevision: 1, approved: true });
    expect([create.status, update.status, feedback.status]).toEqual([403, 403, 403]);
    expect(createVolunteerStay).not.toHaveBeenCalled();
    expect(updateVolunteerStay).not.toHaveBeenCalled();
    expect(putVolunteerStayFeedback).not.toHaveBeenCalled();
  });

  it('requires module update and expectedRevision for manager stay edits', async () => {
    const app = buildApp();
    const readOnly = await request(app).post('/api/volunteerMilestones/42/stays')
      .set('x-test-role', 'manager').set('x-test-actions', 'view').send({});
    const missingRevision = await request(app).patch('/api/volunteerMilestones/42/stays/12')
      .set('x-test-role', 'manager').set('x-test-actions', 'update').send({ changeReason: 'Extend stay' });
    const updated = await request(app).patch('/api/volunteerMilestones/42/stays/12')
      .set('x-test-role', 'manager').set('x-test-actions', 'update')
      .send({ expectedRevision: 1, changeReason: 'Extend stay', endDate: '2026-12-05' });
    expect([readOnly.status, missingRevision.status, updated.status]).toEqual([403, 400, 204]);
    expect(updateVolunteerStay).toHaveBeenCalledTimes(1);
  });

  it('creates stays and approves feedback using their separate manager endpoints', async () => {
    const app = buildApp();
    const created = await request(app).post('/api/volunteerMilestones/42/stays')
      .set('x-test-role', 'owner').set('x-test-actions', 'update')
      .send({ startDate: '2026-08-05', endDate: '2026-11-05', position: 'guide' });
    const approved = await request(app).patch('/api/volunteerMilestones/42/stays/12/feedback')
      .set('x-test-role', 'administrator').set('x-test-actions', 'update')
      .send({ expectedRevision: 1, approved: true, feedback: 'All stay targets met' });
    const forged = await request(app).post('/api/volunteerMilestones/42/stays')
      .set('x-test-role', 'owner').set('x-test-actions', 'update').send({ createdBy: 1 });
    expect([created.status, approved.status, forged.status]).toEqual([204, 204, 400]);
    expect(createVolunteerStay).toHaveBeenCalledTimes(1);
    expect(putVolunteerStayFeedback).toHaveBeenCalledTimes(1);
  });
});
