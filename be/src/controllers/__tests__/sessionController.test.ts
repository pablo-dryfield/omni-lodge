jest.mock('../../services/profilePhotoStorageService.js', () => ({
  openProfilePhotoStream: jest.fn(),
}));

import type { Response } from 'express';
import { openProfilePhotoStream } from '../../services/profilePhotoStorageService';
import type { AuthenticatedRequest } from '../../types/AuthenticatedRequest';
import { checkSession, streamSessionProfilePhoto } from '../sessionController';

const mockedOpenProfilePhotoStream = openProfilePhotoStream as jest.Mock;

const createResponse = () => {
  const response = {
    status: jest.fn(),
    json: jest.fn(),
    setHeader: jest.fn(),
    vary: jest.fn(),
    end: jest.fn(),
    headersSent: false,
  };
  response.status.mockReturnValue(response);
  response.json.mockReturnValue(response);
  response.vary.mockReturnValue(response);
  return response as unknown as Response & {
    status: jest.Mock;
    json: jest.Mock;
    setHeader: jest.Mock;
    vary: jest.Mock;
    end: jest.Mock;
    headersSent: boolean;
  };
};

const createStream = () => {
  const stream = {
    on: jest.fn(),
    pipe: jest.fn(),
    destroy: jest.fn(),
  };
  stream.on.mockReturnValue(stream);
  stream.pipe.mockReturnValue(stream);
  return stream;
};

describe('session controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('checkSession', () => {
    it('returns safe current-user metadata without exposing the stored photo path', () => {
      const request = {
        user: { id: 28 },
        authContext: {
          id: 28,
          userTypeId: 3,
          roleSlug: 'assistant-manager',
          roleName: 'Assistant Manager',
          firstName: 'Aimee',
          lastName: 'Kelly',
          profilePhotoPath: 'drive:private-file-id',
          profilePhotoVersion: '28-1788105600000',
        },
      } as unknown as AuthenticatedRequest;
      const response = createResponse();

      checkSession(request, response);

      expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
      expect(response.json).toHaveBeenCalledWith([{
        authenticated: true,
        userId: 28,
        firstName: 'Aimee',
        lastName: 'Kelly',
        roleSlug: 'assistant-manager',
        roleName: 'Assistant Manager',
        userTypeId: 3,
        hasStoredProfilePhoto: true,
        profilePhotoVersion: '28-1788105600000',
      }]);
      const payload = response.json.mock.calls[0][0][0] as Record<string, unknown>;
      expect(payload).not.toHaveProperty('profilePhotoPath');
      expect(payload).not.toHaveProperty('profilePhotoUrl');
    });

    it('returns 401 when no authenticated user is attached', () => {
      const request = {} as AuthenticatedRequest;
      const response = createResponse();

      checkSession(request, response);

      expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
      expect(response.status).toHaveBeenCalledWith(401);
      expect(response.json).toHaveBeenCalledWith([{
        authenticated: false,
        message: 'Invalid session or user not found.',
      }]);
    });
  });

  describe('streamSessionProfilePhoto', () => {
    it('returns 404 without touching storage when the current user has no stored photo', async () => {
      const request = {
        authContext: {
          id: 28,
          userTypeId: 3,
          roleSlug: 'assistant-manager',
          profilePhotoPath: null,
        },
      } as unknown as AuthenticatedRequest;
      const response = createResponse();

      await streamSessionProfilePhoto(request, response);

      expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
      expect(response.status).toHaveBeenCalledWith(404);
      expect(response.json).toHaveBeenCalledWith([{ message: 'Profile photo not found' }]);
      expect(mockedOpenProfilePhotoStream).not.toHaveBeenCalled();
    });

    it('streams the authenticated user photo with private image response headers', async () => {
      const stream = createStream();
      mockedOpenProfilePhotoStream.mockResolvedValue({ stream, mimeType: 'image/jpeg' });
      const request = {
        authContext: {
          id: 28,
          userTypeId: 3,
          roleSlug: 'assistant-manager',
          profilePhotoPath: 'drive:private-file-id',
        },
      } as unknown as AuthenticatedRequest;
      const response = createResponse();

      await streamSessionProfilePhoto(request, response);

      expect(mockedOpenProfilePhotoStream).toHaveBeenCalledTimes(1);
      expect(mockedOpenProfilePhotoStream).toHaveBeenCalledWith('drive:private-file-id');
      expect(response.setHeader).toHaveBeenCalledWith('Content-Type', 'image/jpeg');
      expect(response.setHeader).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
      expect(response.setHeader).toHaveBeenCalledWith(
        'Cache-Control',
        'private, max-age=3600, must-revalidate',
      );
      expect(response.vary).toHaveBeenNthCalledWith(1, 'Cookie');
      expect(response.vary).toHaveBeenNthCalledWith(2, 'Authorization');
      expect(response.setHeader).not.toHaveBeenCalledWith('Vary', expect.anything());
      expect(stream.on).toHaveBeenCalledWith('error', expect.any(Function));
      expect(stream.pipe).toHaveBeenCalledWith(response);
      expect(stream.destroy).not.toHaveBeenCalled();
      expect(response.status).not.toHaveBeenCalled();
    });

    it('rejects and destroys a stored payload that is not an image', async () => {
      const stream = createStream();
      mockedOpenProfilePhotoStream.mockResolvedValue({ stream, mimeType: 'application/pdf' });
      const request = {
        authContext: {
          id: 28,
          userTypeId: 3,
          roleSlug: 'assistant-manager',
          profilePhotoPath: 'drive:unexpected-file-id',
        },
      } as unknown as AuthenticatedRequest;
      const response = createResponse();

      await streamSessionProfilePhoto(request, response);

      expect(mockedOpenProfilePhotoStream).toHaveBeenCalledWith('drive:unexpected-file-id');
      expect(stream.destroy).toHaveBeenCalledTimes(1);
      expect(stream.pipe).not.toHaveBeenCalled();
      expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
      expect(response.status).toHaveBeenCalledWith(415);
      expect(response.json).toHaveBeenCalledWith([{
        message: 'Stored profile photo is not a supported image',
      }]);
    });

    it('rejects SVG even though its MIME type begins with image', async () => {
      const stream = createStream();
      mockedOpenProfilePhotoStream.mockResolvedValue({ stream, mimeType: 'image/svg+xml' });
      const request = {
        authContext: {
          id: 28,
          userTypeId: 3,
          roleSlug: 'assistant-manager',
          profilePhotoPath: 'drive:svg-file-id',
        },
      } as unknown as AuthenticatedRequest;
      const response = createResponse();

      await streamSessionProfilePhoto(request, response);

      expect(mockedOpenProfilePhotoStream).toHaveBeenCalledWith('drive:svg-file-id');
      expect(stream.destroy).toHaveBeenCalledTimes(1);
      expect(stream.pipe).not.toHaveBeenCalled();
      expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
      expect(response.status).toHaveBeenCalledWith(415);
      expect(response.json).toHaveBeenCalledWith([{
        message: 'Stored profile photo is not a supported image',
      }]);
    });
  });
});
