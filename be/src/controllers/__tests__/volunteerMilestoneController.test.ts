import type { Response } from 'express';
import HttpError from '../../errors/HttpError.js';
import type { AuthenticatedRequest } from '../../types/AuthenticatedRequest.js';

jest.mock('../../services/volunteerMilestoneService.js', () => ({
  getVolunteerMilestoneProgress: jest.fn(),
  listActiveVolunteerMilestoneProgress: jest.fn(),
  recordVolunteerAttendance: jest.fn(),
  saveVolunteerManagementFeedback: jest.fn(),
}));
jest.mock('../../services/volunteerStayService.js', () => ({
  getVolunteerStayProgress: jest.fn(),
  listVolunteerStayProgress: jest.fn(),
  saveVolunteerStay: jest.fn(),
  saveVolunteerStayFeedback: jest.fn(),
}));
jest.mock('../../services/volunteerProfilePhotoService.js', () => ({
  getVolunteerProfilePhotoRecord: jest.fn(),
}));
jest.mock('../../services/profilePhotoStorageService.js', () => ({
  openProfilePhotoStream: jest.fn(),
}));

import { getVolunteerMilestoneProgress, listActiveVolunteerMilestoneProgress } from '../../services/volunteerMilestoneService.js';
import { getVolunteerStayProgress, listVolunteerStayProgress, saveVolunteerStay, saveVolunteerStayFeedback } from '../../services/volunteerStayService.js';
import { getVolunteerProfilePhotoRecord } from '../../services/volunteerProfilePhotoService.js';
import { openProfilePhotoStream } from '../../services/profilePhotoStorageService.js';
import {
  createVolunteerStay,
  getMyVolunteerMilestones,
  getVolunteerMilestones,
  listVolunteerMilestones,
  putVolunteerStayFeedback,
  streamVolunteerProfilePhoto,
  updateVolunteerStay,
} from '../volunteerMilestoneController.js';

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
    (getVolunteerStayProgress as jest.Mock).mockRejectedValue(
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

  it('defaults self-service to saved stays and never trusts a client-supplied user ID', async () => {
    const payload = { mode: 'stay', stay: { id: 12, userId: 91 } };
    (getVolunteerStayProgress as jest.Mock).mockResolvedValue(payload);
    const res = response();
    await getMyVolunteerMilestones({
      authContext: { id: 91 }, params: {}, query: { stayId: '12', userId: '42' },
    } as unknown as AuthenticatedRequest, res);
    expect(getVolunteerStayProgress).toHaveBeenCalledWith(91, { selfAccess: true, stayId: 12 });
    expect(getVolunteerMilestoneProgress).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(payload);
  });

  it('loads default stay summaries but retains explicit calendar summary requests', async () => {
    (listVolunteerStayProgress as jest.Mock).mockResolvedValue({ mode: 'stay', volunteers: [] });
    (listActiveVolunteerMilestoneProgress as jest.Mock).mockResolvedValue({ period: { month: '2026-08' } });
    const req = { authContext: { id: 99 }, params: {}, query: {} } as unknown as AuthenticatedRequest;
    await listVolunteerMilestones(req, response());
    expect(listVolunteerStayProgress).toHaveBeenCalledTimes(1);
    req.query.period = '2026-08';
    await listVolunteerMilestones(req, response());
    expect(listActiveVolunteerMilestoneProgress).toHaveBeenCalledWith('2026-08');
  });

  it('passes a selected historical stay and the correct person to manager detail', async () => {
    (getVolunteerStayProgress as jest.Mock).mockResolvedValue({ mode: 'stay' });
    await getVolunteerMilestones({
      authContext: { id: 99 }, params: { userId: '42' }, query: { stayId: '12' },
    } as unknown as AuthenticatedRequest, response());
    expect(getVolunteerStayProgress).toHaveBeenCalledWith(42, { stayId: 12 });
  });

  it('streams an eligible volunteer photo with private, image-safe headers', async () => {
    const stream = {
      once: jest.fn(), unpipe: jest.fn(), destroy: jest.fn(), pipe: jest.fn(),
    };
    (getVolunteerProfilePhotoRecord as jest.Mock).mockResolvedValue({
      storagePath: 'drive:private-file-id', profilePhotoVersion: '42-1788775200000',
    });
    (openProfilePhotoStream as jest.Mock).mockResolvedValue({ stream, mimeType: 'image/jpeg' });
    const res = response();
    res.setHeader = jest.fn().mockReturnValue(res);
    res.vary = jest.fn().mockReturnValue(res);
    res.once = jest.fn().mockReturnValue(res);
    Object.defineProperties(res, {
      destroyed: { value: false, configurable: true },
      headersSent: { value: false, configurable: true },
    });

    await streamVolunteerProfilePhoto({
      authContext: { id: 99 }, params: { userId: '42' }, query: {},
    } as unknown as AuthenticatedRequest, res);

    expect(getVolunteerProfilePhotoRecord).toHaveBeenCalledWith(42);
    expect(openProfilePhotoStream).toHaveBeenCalledWith('drive:private-file-id');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'image/jpeg');
    expect(res.setHeader).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, max-age=3600, must-revalidate');
    expect(res.vary).toHaveBeenCalledWith('Cookie');
    expect(res.vary).toHaveBeenCalledWith('Authorization');
    expect(stream.pipe).toHaveBeenCalledWith(res);
  });

  it('does not stream unsupported stored content as a profile photo', async () => {
    const stream = { once: jest.fn(), unpipe: jest.fn(), destroy: jest.fn(), pipe: jest.fn() };
    (getVolunteerProfilePhotoRecord as jest.Mock).mockResolvedValue({
      storagePath: 'drive:private-file-id', profilePhotoVersion: '42-1',
    });
    (openProfilePhotoStream as jest.Mock).mockResolvedValue({ stream, mimeType: 'image/svg+xml' });
    const res = response();
    res.setHeader = jest.fn().mockReturnValue(res);
    Object.defineProperties(res, {
      destroyed: { value: false, configurable: true },
      headersSent: { value: false, configurable: true },
    });

    await streamVolunteerProfilePhoto({ params: { userId: '42' } } as unknown as AuthenticatedRequest, res);

    expect(stream.destroy).toHaveBeenCalled();
    expect(stream.pipe).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(415);
    expect(res.json).toHaveBeenCalledWith({ message: 'Stored profile photo is not a supported image.' });
  });

  it('returns a generic not-found response without leaking a stored path', async () => {
    (getVolunteerProfilePhotoRecord as jest.Mock).mockRejectedValue(
      new HttpError(404, 'Volunteer profile photo was not found.'),
    );
    const res = response();
    res.setHeader = jest.fn().mockReturnValue(res);
    Object.defineProperty(res, 'headersSent', { value: false, configurable: true });

    await streamVolunteerProfilePhoto({ params: { userId: '42' } } as unknown as AuthenticatedRequest, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ message: 'Volunteer profile photo was not found.' });
    expect(openProfilePhotoStream).not.toHaveBeenCalled();
  });

  it('takes stay ownership and actor identity from the route and authentication', async () => {
    (saveVolunteerStay as jest.Mock).mockResolvedValue({ mode: 'stay', stay: { id: 12 } });
    const body = { startDate: '2026-08-05', endDate: '2026-11-05' };
    const req = { authContext: { id: 99 }, params: { userId: '42', stayId: '12' }, body, query: {} } as unknown as AuthenticatedRequest;
    const createdResponse = response();
    await createVolunteerStay(req, createdResponse);
    expect(saveVolunteerStay).toHaveBeenLastCalledWith({ userId: 42, body, actorId: 99 });
    expect(createdResponse.status).toHaveBeenCalledWith(201);
    await updateVolunteerStay(req, response());
    expect(saveVolunteerStay).toHaveBeenLastCalledWith({ userId: 42, stayId: 12, body, actorId: 99 });
  });

  it('returns stay revision conflicts without saving calendar feedback', async () => {
    (saveVolunteerStayFeedback as jest.Mock).mockRejectedValue(new HttpError(409, 'This stay changed since it was opened.'));
    const res = response();
    const body = { expectedRevision: 2, approved: true, feedback: 'Good work' };
    await putVolunteerStayFeedback({
      authContext: { id: 99 }, params: { userId: '42', stayId: '12' }, body, query: {},
    } as unknown as AuthenticatedRequest, res);
    expect(saveVolunteerStayFeedback).toHaveBeenCalledWith({ userId: 42, stayId: 12, body, actorId: 99 });
    expect(res.status).toHaveBeenCalledWith(409);
  });
});
