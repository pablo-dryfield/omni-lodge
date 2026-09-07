jest.mock('../../services/cleaningSubmissionService.js', () => ({ getCleaningPhotoStream: jest.fn(), getCleaningSubmission: jest.fn(),
  listMyCleaningSubmissions: jest.fn(), reviewCleaningSubmissionPhoto: jest.fn(), uploadCleaningSubmissionPhoto: jest.fn(), waiveCanceledCleaningTask: jest.fn() }));
jest.mock('../../utils/logger.js', () => ({ __esModule: true, default: { error: jest.fn() } }));
import HttpError from '../../errors/HttpError.js';
import { waiveCanceledCleaningTask } from '../../services/cleaningSubmissionService.js';
import { postWaiveCanceledCleaningTask } from '../cleaningSubmissionController.js';
const response = () => { const res: any = { status: jest.fn(), json: jest.fn() }; res.status.mockReturnValue(res); return res; };
describe('canceled cleaning waiver controller', () => {
  beforeEach(() => jest.clearAllMocks());
  it('delegates only the authenticated actor and validated task ID with the reason/version body', async () => {
    const body = { reason: 'No shift ran', expectedUpdatedAt: '2026-09-07T10:00:00Z' }; const res = response();
    (waiveCanceledCleaningTask as jest.Mock).mockResolvedValue({ taskLogId: 12, status: 'waived' });
    await postWaiveCanceledCleaningTask({ params: { taskLogId: '12' }, authContext: { id: 9, roleSlug: 'manager' }, body } as any, res);
    expect(waiveCanceledCleaningTask).toHaveBeenCalledWith({ actorId: 9, roleSlug: 'manager', taskLogId: 12, body });
    expect(res.json).toHaveBeenCalledWith({ taskLogId: 12, status: 'waived' });
  });
  it('rejects unauthenticated or invalid identifiers before calling the service', async () => {
    let res = response();
    await postWaiveCanceledCleaningTask({ params: { taskLogId: '12' } } as any, res); expect(res.status).toHaveBeenCalledWith(401);
    res = response();
    await postWaiveCanceledCleaningTask({ params: { taskLogId: '12x' }, authContext: { id: 9, roleSlug: 'manager' } } as any, res); expect(res.status).toHaveBeenCalledWith(400);
    expect(waiveCanceledCleaningTask).not.toHaveBeenCalled();
  });
  it('preserves explicit permission, schedule and payroll errors for the UI', async () => {
    for (const status of [400, 403, 409]) {
      const res = response(); (waiveCanceledCleaningTask as jest.Mock).mockRejectedValueOnce(new HttpError(status, 'Blocked'));
      await postWaiveCanceledCleaningTask({ params: { taskLogId: '12' }, authContext: { id: 9, roleSlug: 'manager' }, body: {} } as any, res);
      expect(res.status).toHaveBeenCalledWith(status); expect(res.json).toHaveBeenCalledWith({ message: 'Blocked' });
    }
  });
});
