import { Response } from 'express';
import { AuthenticatedRequest } from '../types/AuthenticatedRequest';
import { openProfilePhotoStream } from '../services/profilePhotoStorageService.js';

const ALLOWED_PROFILE_PHOTO_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

export const checkSession = (req: AuthenticatedRequest, res: Response) => {
    res.setHeader('Cache-Control', 'private, no-store');
    if (typeof req.user === 'object' && req.user !== null && 'id' in req.user) {
        const userId = req.user.id;
        res.json([{
          authenticated: true,
          userId,
          firstName: req.authContext?.firstName ?? null,
          lastName: req.authContext?.lastName ?? null,
          roleSlug: req.authContext?.roleSlug ?? null,
          roleName: req.authContext?.roleName ?? null,
          userTypeId: req.authContext?.userTypeId ?? null,
          hasStoredProfilePhoto: Boolean(req.authContext?.profilePhotoPath),
          profilePhotoVersion: req.authContext?.profilePhotoVersion ?? null,
        }]);
    } else {
        res.status(401).json([{ authenticated: false, message: "Invalid session or user not found." }]);
    }
};

export const streamSessionProfilePhoto = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  res.setHeader('Cache-Control', 'private, no-store');
  const profilePhotoPath = req.authContext?.profilePhotoPath ?? null;
  if (!profilePhotoPath) {
    res.status(404).json([{ message: 'Profile photo not found' }]);
    return;
  }

  try {
    const { stream, mimeType } = await openProfilePhotoStream(profilePhotoPath);
    const normalizedMimeType = mimeType.trim().toLowerCase();
    if (!ALLOWED_PROFILE_PHOTO_MIME_TYPES.has(normalizedMimeType)) {
      stream.destroy();
      res.status(415).json([{ message: 'Stored profile photo is not a supported image' }]);
      return;
    }
    res.setHeader('Content-Type', normalizedMimeType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=3600, must-revalidate');
    res.vary('Cookie');
    res.vary('Authorization');
    stream.on('error', () => {
      if (!res.headersSent) {
        res.status(500).json([{ message: 'Unable to read profile photo' }]);
      } else {
        res.end();
      }
    });
    stream.pipe(res);
  } catch {
    res.status(500).json([{ message: 'Unable to read profile photo' }]);
  }
};
