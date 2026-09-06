jest.mock('../../models/SocialMediaContent.js', () => ({
  __esModule: true,
  default: { findOne: jest.fn() },
}));
jest.mock('../../services/profilePhotoStorageService.js', () => ({
  openProfilePhotoStream: jest.fn(),
}));

import { EventEmitter } from 'events';
import type { Response } from 'express';
import { Op } from 'sequelize';
import SocialMediaContent from '../../models/SocialMediaContent';
import UserModelStub from '../../__mocks__/sequelizeModelStub';
import { openProfilePhotoStream } from '../../services/profilePhotoStorageService';
import type { AuthenticatedRequest } from '../../types/AuthenticatedRequest';
import { streamSocialMediaContributorPhoto } from '../socialMediaContributorPhotoController';

const findContribution = SocialMediaContent.findOne as jest.Mock;
const findUser = jest.fn();
Object.assign(UserModelStub, { findByPk: findUser });
const openPhoto = openProfilePhotoStream as jest.Mock;
const request = (id = '51') => ({
  authContext: { id: 7 }, params: { id },
}) as unknown as AuthenticatedRequest;

const buildResponse = () => {
  const response = Object.assign(new EventEmitter(), {
    status: jest.fn(), json: jest.fn(), setHeader: jest.fn(), destroy: jest.fn(), headersSent: false,
  });
  response.status.mockReturnValue(response);
  response.json.mockReturnValue(response);
  return response;
};

const buildStream = () => Object.assign(new EventEmitter(), {
  pipe: jest.fn(), unpipe: jest.fn(), destroy: jest.fn(),
});

describe('Social Media contributor photos', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    findContribution.mockResolvedValue({ id: 41 });
    findUser.mockResolvedValue({ id: 51, profilePhotoPath: 'drive:private-photo-id' });
  });

  it('requires authentication before any contributor or user query', async () => {
    const response = buildResponse();
    await streamSocialMediaContributorPhoto(
      { params: { id: '51' } } as unknown as AuthenticatedRequest, response as unknown as Response,
    );
    expect(response.status).toHaveBeenCalledWith(401);
    expect(findContribution).not.toHaveBeenCalled();
    expect(findUser).not.toHaveBeenCalled();
  });

  it.each(['0', '-1', '1.5', 'nope', '9007199254740992'])('rejects invalid contributor ID %s', async (id) => {
    const response = buildResponse();
    await streamSocialMediaContributorPhoto(request(id), response as unknown as Response);
    expect(response.status).toHaveBeenCalledWith(400);
    expect(findContribution).not.toHaveBeenCalled();
    expect(findUser).not.toHaveBeenCalled();
  });

  it('does not look up photos of users who are not contributors', async () => {
    findContribution.mockResolvedValue(null);
    const response = buildResponse();
    await streamSocialMediaContributorPhoto(request(), response as unknown as Response);
    expect(response.status).toHaveBeenCalledWith(404);
    expect(findUser).not.toHaveBeenCalled();
    expect(openPhoto).not.toHaveBeenCalled();
  });

  it('streams a proven contributor photo without fetching directory data', async () => {
    const stream = buildStream();
    openPhoto.mockResolvedValue({ stream, mimeType: 'image/webp' });
    const response = buildResponse();
    await streamSocialMediaContributorPhoto(request(), response as unknown as Response);

    expect(findContribution).toHaveBeenCalledWith({
      where: { [Op.or]: [{ createdBy: 51 }, { producedBy: 51 }, { publishedBy: 51 }] },
      attributes: ['id'],
    });
    expect(findContribution.mock.invocationCallOrder[0]).toBeLessThan(findUser.mock.invocationCallOrder[0]);
    expect(findUser).toHaveBeenCalledWith(51, { attributes: ['id', 'profilePhotoPath'] });
    expect(openPhoto).toHaveBeenCalledWith('drive:private-photo-id');
    expect(response.setHeader).toHaveBeenCalledWith('Content-Type', 'image/webp');
    expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, max-age=3600');
    expect(response.setHeader).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
    expect(response.setHeader).toHaveBeenCalledWith('Content-Security-Policy', "default-src 'none'; sandbox");
    expect(response.setHeader).toHaveBeenCalledWith('Cross-Origin-Resource-Policy', 'same-site');
    expect(stream.pipe).toHaveBeenCalledWith(response);
    response.emit('close');
    expect(stream.destroy).toHaveBeenCalled();
  });

  it.each([null, { id: 51, profilePhotoPath: null }])('returns the same missing-photo response for %p', async (user) => {
    findUser.mockResolvedValue(user);
    const response = buildResponse();
    await streamSocialMediaContributorPhoto(request(), response as unknown as Response);
    expect(response.status).toHaveBeenCalledWith(404);
    expect(response.json).toHaveBeenCalledWith({ message: 'Contributor photo was not found.' });
    expect(openPhoto).not.toHaveBeenCalled();
  });

  it('does not expose storage paths or upstream error details', async () => {
    openPhoto.mockRejectedValue(new Error('secret drive:file-id and storage path'));
    const response = buildResponse();
    await streamSocialMediaContributorPhoto(request(), response as unknown as Response);
    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith({ message: 'Unable to read the contributor photo.' });
  });

  it('returns 404 for missing remote storage', async () => {
    openPhoto.mockRejectedValue({ code: 404, message: 'private storage URL' });
    const response = buildResponse();
    await streamSocialMediaContributorPhoto(request(), response as unknown as Response);
    expect(response.status).toHaveBeenCalledWith(404);
    expect(response.json).toHaveBeenCalledWith({ message: 'Contributor photo was not found.' });
  });

  it.each([false, true])('handles a failed stream when headersSent=%s', async (headersSent) => {
    const stream = buildStream();
    openPhoto.mockResolvedValue({ stream, mimeType: 'image/jpeg' });
    const response = buildResponse();
    await streamSocialMediaContributorPhoto(request(), response as unknown as Response);
    response.headersSent = headersSent;
    stream.emit('error', new Error('private file details'));
    expect(stream.unpipe).toHaveBeenCalledWith(response);
    expect(stream.destroy).toHaveBeenCalled();
    if (headersSent) {
      expect(response.destroy).toHaveBeenCalled();
      expect(response.json).not.toHaveBeenCalled();
    } else {
      expect(response.status).toHaveBeenCalledWith(500);
      expect(response.json).toHaveBeenCalledWith({ message: 'Unable to read the contributor photo.' });
    }
  });

  it('returns 404 for a local file stream that no longer exists', async () => {
    const stream = buildStream();
    openPhoto.mockResolvedValue({ stream, mimeType: 'image/jpeg' });
    const response = buildResponse();
    await streamSocialMediaContributorPhoto(request(), response as unknown as Response);
    stream.emit('error', Object.assign(new Error('private path'), { code: 'ENOENT' }));
    expect(response.status).toHaveBeenCalledWith(404);
    expect(response.json).toHaveBeenCalledWith({ message: 'Contributor photo was not found.' });
  });
});
