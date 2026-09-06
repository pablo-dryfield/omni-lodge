import type { Response } from 'express';
import { Op } from 'sequelize';
import SocialMediaContent from '../models/SocialMediaContent.js';
import User from '../models/User.js';
import { openProfilePhotoStream } from '../services/profilePhotoStorageService.js';
import type { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';

const PHOTO_NOT_FOUND = 'Contributor photo was not found.';
const PHOTO_READ_FAILED = 'Unable to read the contributor photo.';

/** The route must require the social-media-content module's view permission. */
export const streamSocialMediaContributorPhoto = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  res.setHeader('Cache-Control', 'private, no-store');
  if (!Number.isSafeInteger(req.authContext?.id) || Number(req.authContext?.id) <= 0) {
    res.status(401).json({ message: 'Authentication is required.' });
    return;
  }
  const rawId = req.params.id;
  const userId = Number(rawId);
  if (!/^[1-9]\d*$/u.test(rawId ?? '') || !Number.isSafeInteger(userId)) {
    res.status(400).json({ message: 'Contributor ID must be a positive integer.' });
    return;
  }

  try {
    // A board viewer can see its contributors, without gaining access to the
    // user directory or learning whether an unrelated user has a photo.
    const contribution = await SocialMediaContent.findOne({
      where: { [Op.or]: [{ createdBy: userId }, { producedBy: userId }, { publishedBy: userId }] },
      attributes: ['id'],
    });
    if (!contribution) {
      res.status(404).json({ message: PHOTO_NOT_FOUND });
      return;
    }
    const user = await User.findByPk(userId, { attributes: ['id', 'profilePhotoPath'] });
    if (!user?.profilePhotoPath) {
      res.status(404).json({ message: PHOTO_NOT_FOUND });
      return;
    }

    const { stream, mimeType } = await openProfilePhotoStream(user.profilePhotoPath);
    if (res.destroyed) {
      stream.destroy();
      return;
    }
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    // The development UI and API use different ports; production may use an
    // API subdomain. Allow same-site images without making them public.
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    stream.once('error', (error: NodeJS.ErrnoException) => {
      stream.unpipe(res);
      stream.destroy();
      if (res.headersSent) {
        res.destroy();
        return;
      }
      const notFound = error.code === 'ENOENT';
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.status(notFound ? 404 : 500).json({ message: notFound ? PHOTO_NOT_FOUND : PHOTO_READ_FAILED });
    });
    res.once('close', () => stream.destroy());
    stream.pipe(res);
  } catch (error) {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    const code = (error as { code?: unknown } | null)?.code;
    const notFound = code === 404 || code === 'ENOENT';
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.status(notFound ? 404 : 500).json({ message: notFound ? PHOTO_NOT_FOUND : PHOTO_READ_FAILED });
  }
};
