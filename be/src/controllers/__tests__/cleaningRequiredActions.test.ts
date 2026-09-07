jest.mock('../../models/ShiftRole.js', () => ({ __esModule: true, default: { findAll: jest.fn(), findByPk: jest.fn(), create: jest.fn() } }));
jest.mock('../../models/StaffProfile.js', () => ({ __esModule: true, default: { findAll: jest.fn(), findByPk: jest.fn(), create: jest.fn() } }));
jest.mock('../../models/RequiredAction.js', () => ({ __esModule: true, default: { findAll: jest.fn(), findByPk: jest.fn(), create: jest.fn() } }));
jest.mock('../../models/RequiredActionCompletion.js', () => ({ __esModule: true, default: { findAll: jest.fn(), findByPk: jest.fn(), create: jest.fn() } }));
jest.mock('../../models/CerebroAcknowledgement.js', () => ({ __esModule: true, default: { findAll: jest.fn(), findByPk: jest.fn(), create: jest.fn() } }));
jest.mock('../../models/CerebroEntry.js', () => ({ __esModule: true, default: { findAll: jest.fn(), findByPk: jest.fn(), create: jest.fn() } }));
jest.mock('../../models/CerebroQuiz.js', () => ({ __esModule: true, default: { findAll: jest.fn(), findByPk: jest.fn(), create: jest.fn() } }));
jest.mock('../../models/CerebroQuizAttempt.js', () => ({ __esModule: true, default: { findAll: jest.fn(), findByPk: jest.fn(), create: jest.fn() } }));
jest.mock('../../services/scheduleService.js', () => ({ listShiftChangeRequests: jest.fn().mockResolvedValue([]), listShiftChangeRequestsForUser: jest.fn().mockResolvedValue([]) }));
jest.mock('../../services/profilePhotoStorageService.js', () => ({}));
jest.mock('../../services/staffPayoutReceiptService.js', () => ({}));
jest.mock('../../services/cleaningSubmissionService.js', () => ({ getCleaningReviewActionPayload: jest.fn() }));
jest.mock('../../utils/logger.js', () => ({ __esModule: true, default: { error: jest.fn() } }));
import type { Request, Response } from 'express';
import ModelStub from '../../__mocks__/sequelizeModelStub';
import RequiredAction from '../../models/RequiredAction.js';
import RequiredActionCompletion from '../../models/RequiredActionCompletion.js';
import { getCleaningReviewActionPayload } from '../../services/cleaningSubmissionService.js';
import { listMyRequiredActions, createRequiredAction, completeRequiredAction, updateRequiredActionStatus } from '../requiredActionController.js';

const user = ModelStub as { findByPk: jest.Mock };
const action = { id: 8, type: 'cleaning_review', title: 'Cleaning review', body: null, requiresCompletion: false,
  status: true, targetUserIds: [12], payload: { cleaningSubmission: { submissionId: 4, revision: 2 } } };
const requestValue = () => ({ authContext: { id: 12, roleSlug: 'guide', userTypeId: 3 }, params: { id: '8' }, body: {} }) as unknown as Request;
const responseValue = () => { const res = { status: jest.fn(), json: jest.fn() }; res.status.mockReturnValue(res); return res as unknown as Response; };
beforeEach(() => {
  jest.clearAllMocks();
  user.findByPk = jest.fn().mockResolvedValue({ id: 12, userTypeId: 3, shiftRoles: [] });
  (RequiredAction.findAll as jest.Mock).mockResolvedValue([action]);
  (RequiredAction.findByPk as jest.Mock).mockResolvedValue(action);
  (RequiredActionCompletion.findAll as jest.Mock).mockResolvedValue([]);
  (getCleaningReviewActionPayload as jest.Mock).mockResolvedValue({ submissionId: 4, revision: 2, pendingPhotos: 1 });
});
it('includes a cleaning review popup while keeping it nonblocking', async () => {
  const res = responseValue();
  await listMyRequiredActions(requestValue(), res);
  expect(res.status).toHaveBeenCalledWith(200);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
    actions: [expect.objectContaining({ type: 'cleaning_review', blocking: false, requiresSignature: false })],
    summary: { total: 1, blocking: 0 },
  }));
  expect(getCleaningReviewActionPayload).toHaveBeenCalledWith(8, 4, 12);
});
it('omits reviews when live reviewer authorization was withdrawn', async () => {
  (getCleaningReviewActionPayload as jest.Mock).mockResolvedValue(null);
  const res = responseValue();
  await listMyRequiredActions(requestValue(), res);
  expect(res.json).toHaveBeenCalledWith({ actions: [], summary: { total: 0, blocking: 0 } });
});
it.each([completeRequiredAction, updateRequiredActionStatus])('blocks generic acknowledgements and cancellation of review requests', async (handler) => {
  const res = responseValue();
  await handler(requestValue(), res);
  expect(res.status).toHaveBeenCalledWith(400);
  expect(RequiredActionCompletion.create).not.toHaveBeenCalled();
});
it('cannot fabricate cleaning requests through the generic create endpoint', async () => {
  const req = requestValue();
  req.body = { type: 'cleaning_review', title: 'Forged' };
  const res = responseValue();
  await createRequiredAction(req, res);
  expect(res.status).toHaveBeenCalledWith(400);
  expect(RequiredAction.create).not.toHaveBeenCalled();
});

