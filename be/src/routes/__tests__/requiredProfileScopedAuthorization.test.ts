import express from 'express';
import request from 'supertest';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../../types/AuthenticatedRequest';

jest.mock('../../middleware/authMiddleware.js', () => ({
  __esModule: true,
  default: async (req: AuthenticatedRequest, res: Response, next: () => void) => {
    if (!req.header('x-test-role')) { res.sendStatus(401); return; }
    req.authContext = {
      id: 7, userTypeId: 6, roleSlug: req.header('x-test-role')!,
      shiftRoleIds: [9], staffType: null,
    };
    req.productTypeScope = [3];
    const { enforceProductScopedApiBoundary } = require('../../middleware/productScopedApiBoundary');
    await enforceProductScopedApiBoundary(req, res, next);
  },
}));
jest.mock('../../services/productScopeService.js', () => ({
  getAllowedProductTypeIds: jest.fn(async (req: AuthenticatedRequest) => req.productTypeScope),
}));
jest.mock('../../middleware/authorizationMiddleware.js', () => ({
  hasModuleActionPermission: jest.fn(async () => false),
  authorizeModuleAction: () => (_req: unknown, res: Response) => res.sendStatus(403),
}));
jest.mock('../../controllers/productScopedManagementController.js', () => ({ handleProductScopedManagement: jest.fn() }));
jest.mock('../../middleware/staffPayoutReceiptAccessMiddleware.js', () => ({
  authenticateStaffPayoutReceiptAccess: (_req: unknown, res: Response) => res.sendStatus(403),
}));
jest.mock('../../controllers/staffPayoutReceiptAccessController.js', () => ({
  confirmStaffPayoutReceiptAccess: jest.fn(), exchangeStaffPayoutReceiptAccess: jest.fn(), getStaffPayoutReceiptAccess: jest.fn(),
}));
jest.mock('../../__mocks__/sequelizeModelStub.ts', () => ({ __esModule: true, default: { findByPk: jest.fn() } }));
jest.mock('../../models/ShiftRole.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/StaffProfile.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/RequiredAction.js', () => ({
  __esModule: true, default: { findAll: jest.fn(), findByPk: jest.fn(), create: jest.fn() },
}));
jest.mock('../../models/RequiredActionCompletion.js', () => ({
  __esModule: true, default: { findAll: jest.fn(), findOne: jest.fn(), findOrCreate: jest.fn(), create: jest.fn() },
}));
jest.mock('../../models/CerebroAcknowledgement.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/CerebroEntry.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/CerebroQuiz.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/CerebroQuizAttempt.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../services/scheduleService.js', () => ({
  listShiftChangeRequests: jest.fn(async () => []), listShiftChangeRequestsForUser: jest.fn(async () => []),
}));
jest.mock('../../services/profilePhotoStorageService.js', () => ({ storeProfilePhoto: jest.fn(), deleteProfilePhoto: jest.fn() }));
jest.mock('../../services/staffPayoutReceiptService.js', () => ({}));
jest.mock('../../services/volunteerStayService.js', () => ({ ensureDefaultVolunteerStay: jest.fn() }));
jest.mock('../../utils/logger.js', () => ({ __esModule: true, default: { error: jest.fn() } }));

import User from '../../__mocks__/sequelizeModelStub';
import RequiredAction from '../../models/RequiredAction';
import RequiredActionCompletion from '../../models/RequiredActionCompletion';
import { storeProfilePhoto } from '../../services/profilePhotoStorageService';
import { hasModuleActionPermission } from '../../middleware/authorizationMiddleware';
import router from '../requiredActionRoutes';

const app = express();
app.use(express.json());
app.use('/api/required-actions', router);
let action: Record<string, unknown>;
let user: { id: number; userTypeId: number; profilePhotoPath: string | null; update: jest.Mock };
const endpoint = '/api/required-actions/actions/42';

beforeEach(() => {
  jest.clearAllMocks();
  action = {
    id: 42, type: 'profile_fields', title: 'Upload profile photo', status: true,
    targetUserIds: [7], targetUserTypeIds: null, targetShiftRoleIds: null, targetStaffProfileTypes: null,
    startsAt: null, expiresAt: null, requiresCompletion: true, requiresSignature: false, payload: { fields: ['profilePhoto'] },
  };
  user = { id: 7, userTypeId: 6, profilePhotoPath: null, update: jest.fn(async changes => Object.assign(user, changes)) };
  (User.findByPk as jest.Mock).mockResolvedValue(user);
  (RequiredAction.findByPk as jest.Mock).mockResolvedValue(action);
  (RequiredAction.findAll as jest.Mock).mockImplementation(async () => [action]);
  (RequiredActionCompletion.findAll as jest.Mock).mockResolvedValue([]);
  (RequiredActionCompletion.findOne as jest.Mock).mockResolvedValue(null);
  (RequiredActionCompletion.findOrCreate as jest.Mock).mockResolvedValue([{}, true]);
  (storeProfilePhoto as jest.Mock).mockResolvedValue({ relativePath: 'test-profile/photo.png', driveWebViewLink: null });
});

it.each(['food-tour-owner', 'food-tour-manager', 'food-tour-guide'])(
  'lets %s save their own required picture and removes the blocking requirement', async role => {
    const before = await request(app).get('/api/required-actions/me').set('x-test-role', role);
    expect(before.status).toBe(200);
    expect(before.body.summary.blocking).toBe(1);
    const result = await request(app).post(`${endpoint}/profile-fields`).set('x-test-role', role)
      .field('values', JSON.stringify({ userId: 999, userTypeId: 1, approved: true }))
      .attach('profilePhoto', Buffer.from('test-image'), { filename: 'photo.png', contentType: 'image/png' });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ completed: true });
    expect(storeProfilePhoto).toHaveBeenCalledWith(expect.objectContaining({ userId: 7 }));
    expect(user.update).toHaveBeenCalledWith({ profilePhotoPath: 'test-profile/photo.png', profilePhotoUrl: null });
    expect(RequiredActionCompletion.create).toHaveBeenCalledWith(expect.objectContaining({ requiredActionId: 42, userId: 7, status: 'completed' }));
    const after = await request(app).get('/api/required-actions/me').set('x-test-role', role);
    expect(after.body).toEqual({ actions: [], summary: { total: 0, blocking: 0 } });
    expect(hasModuleActionPermission).not.toHaveBeenCalled();
  },
);

it('records the signed-in user being prompted, without directory management access', async () => {
  expect((await request(app).post(`${endpoint}/prompted`).set('x-test-role', 'food-tour-guide').send({ userId: 999 })).status).toBe(200);
  expect(RequiredActionCompletion.findOrCreate).toHaveBeenCalledWith(expect.objectContaining({ where: { requiredActionId: 42, userId: 7 } }));
});

describe.each(['profile-fields', 'prompted'])('%s audience and window validation', suffix => {
  it.each([
    ['another user', { targetUserIds: [999] }],
    ['another user type', { targetUserTypeIds: [999] }],
    ['another shift role', { targetShiftRoleIds: [999] }],
    ['another staff profile', { targetStaffProfileTypes: ['long_term'] }],
    ['not started', { startsAt: new Date(Date.now() + 86_400_000) }],
    ['expired', { expiresAt: new Date(Date.now() - 86_400_000) }],
  ])('denies %s before changing photos or completion records', async (_name, overrides) => {
    Object.assign(action, overrides);
    const result = await request(app).post(`${endpoint}/${suffix}`).set('x-test-role', 'food-tour-owner').send({ values: {}, userId: 999 });
    expect(result.status).toBe(403);
    expect(storeProfilePhoto).not.toHaveBeenCalled();
    expect(user.update).not.toHaveBeenCalled();
    expect(RequiredActionCompletion.create).not.toHaveBeenCalled();
    expect(RequiredActionCompletion.findOrCreate).not.toHaveBeenCalled();
  });

  it('denies requests outside the profile onboarding feature', async () => {
    action.type = 'customer_email';
    expect((await request(app).post(`${endpoint}/${suffix}`).set('x-test-role', 'food-tour-owner').send({})).status).toBe(suffix === 'profile-fields' ? 404 : 403);
    expect(RequiredActionCompletion.create).not.toHaveBeenCalled();
    expect(RequiredActionCompletion.findOrCreate).not.toHaveBeenCalled();
  });

  it('does not process inactive requirements', async () => {
    action.status = false;
    expect((await request(app).post(`${endpoint}/${suffix}`).set('x-test-role', 'food-tour-owner').send({})).status).toBe(404);
    expect(RequiredActionCompletion.create).not.toHaveBeenCalled();
  });
});

it('preserves required-field and signature checks rather than bypassing onboarding', async () => {
  expect((await request(app).post(`${endpoint}/profile-fields`).set('x-test-role', 'food-tour-owner').send({ values: {} })).status).toBe(400);
  action.requiresSignature = true;
  expect((await request(app).post(`${endpoint}/profile-fields`).set('x-test-role', 'food-tour-owner').send({ values: {} })).status).toBe(400);
  expect(RequiredActionCompletion.create).not.toHaveBeenCalled();
});

it.each([
  ['post', '/api/required-actions/actions'], ['patch', `${endpoint}/status`],
  ['post', `${endpoint}/complete`], ['post', '/api/required-actions/schedule-swaps/42/manager-decision'],
] as const)('does not expose %s %s to scoped accounts', async (method, path) => {
  expect((await request(app)[method](path).set('x-test-role', 'food-tour-owner').send({ status: true })).status).toBe(403);
  expect(RequiredAction.create).not.toHaveBeenCalled();
  expect(RequiredActionCompletion.create).not.toHaveBeenCalled();
});

it('still requires authentication before reading requirements or accepting a picture', async () => {
  expect((await request(app).post(`${endpoint}/profile-fields`).send({ values: {} })).status).toBe(401);
  expect(RequiredAction.findByPk).not.toHaveBeenCalled();
  expect(storeProfilePhoto).not.toHaveBeenCalled();
});
