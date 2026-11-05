import HttpError from '../errors/HttpError.js';
import type { StorefrontMeetingPoint } from '../types/storefront.js';

export const normalizeMeetingPointPhoto = (value: StorefrontMeetingPoint | null | undefined) => {
  const photoAlt = typeof value?.photoAlt === 'string' ? value.photoAlt.trim() : '';
  const rawUrl = typeof value?.photoUrl === 'string' ? value.photoUrl.trim() : '';
  let photoUrl = '';
  if (rawUrl) {
    try {
      const parsed = new URL(rawUrl);
      if (['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password) photoUrl = parsed.toString();
    } catch { /* Invalid persisted URLs are never rendered as email images. */ }
  }
  return { photoUrl, photoAlt };
};

export const validateMeetingPointPhoto = (value: StorefrontMeetingPoint | null | undefined): void => {
  if (value?.photoUrl !== undefined && (typeof value.photoUrl !== 'string'
    || value.photoUrl.length > 2048 || (value.photoUrl.trim() && !normalizeMeetingPointPhoto(value).photoUrl))) {
    throw new HttpError(400, 'Meeting point photo must have a valid public HTTP or HTTPS URL.');
  }
  if (value?.photoAlt !== undefined && (typeof value.photoAlt !== 'string' || value.photoAlt.length > 500)) {
    throw new HttpError(400, 'Meeting point photo description must be text of at most 500 characters.');
  }
};

export const meetingPointTemplateContext = (meetingPoint?: StorefrontMeetingPoint | null): Record<string, unknown> => {
  const { photoUrl, photoAlt } = normalizeMeetingPointPhoto(meetingPoint);
  return {
    meetingPoint: { ...meetingPoint, photoUrl, photoAlt },
    meetingPointPhotoUrl: photoUrl,
    meetingPointPhotoAlt: photoAlt || meetingPoint?.name || 'Meeting point',
  };
};
