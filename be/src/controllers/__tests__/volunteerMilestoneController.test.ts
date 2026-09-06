import type { Response } from 'express';
import HttpError from '../../errors/HttpError.js';
import type { AuthenticatedRequest } from '../../types/AuthenticatedRequest.js';

jest.mock('../../services/volunteerMilestoneService.js', () => ({
  getVolunteerMilestoneProgress: jest.fn(),
  listActiveVolunteerMilestoneProgress: jest.fn(),
  recordVolunteerAttendance: jest.fn(),
  saveVolunteerManagementFeedback: jest.fn(),
}));

import { getVolunteerMilestoneProgress } from '../../services/volunteerMilestoneService.js';
import { getMyVolunteerMilestones } from '../volunteerMilestoneController.js';

const response = (): Response => {
  const res = {} as Response;
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('volunteer milestone controller ownership', () => {
  beforeEach(() => jest.clearAllMocks());

  it('derives the self-service subject only from auth context and preserves period', async () => {
    const payload = { user: { id: 91 } };
    (getVolunteerMilestoneProgress as jest.Mock).mockResolvedValue(payload);
    const req = {
      authContext: { id: 91, userTypeId: 6, roleSlug: 'guide' },
      query: { period: '2026-02', userId: '42' },
      params: {},
    } as unknown as AuthenticatedRequest;
    const res = response();

    await getMyVolunteerMilestones(req, res);

    expect(getVolunteerMilestoneProgress).toHaveBeenCalledWith(91, '2026-02', { selfAccess: true });
    expect(res.json).toHaveBeenCalledWith(payload);
  });

  it('returns a clear forbidden response when the signed-in user is not a volunteer', async () => {
    (getVolunteerMilestoneProgress as jest.Mock).mockRejectedValue(
      new HttpError(403, 'Volunteer milestones are available only to volunteers.'),
    );
    const req = {
      authContext: { id: 91, userTypeId: 6, roleSlug: 'guide' },
      query: {},
      params: {},
    } as unknown as AuthenticatedRequest;
    const res = response();

    await getMyVolunteerMilestones(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      message: 'Volunteer milestones are available only to volunteers.',
    });
  });
});
