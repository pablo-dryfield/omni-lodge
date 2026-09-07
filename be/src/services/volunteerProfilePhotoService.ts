import HttpError from '../errors/HttpError.js';
import StaffProfile from '../models/StaffProfile.js';
import StaffProfileTypePeriod from '../models/StaffProfileTypePeriod.js';
import User from '../models/User.js';
import VolunteerStay from '../models/VolunteerStay.js';

const PHOTO_NOT_FOUND = 'Volunteer profile photo was not found.';

export type VolunteerProfilePhotoRecord = {
  storagePath: string;
  profilePhotoVersion: string;
};

/**
 * Resolve a private profile photo only when the subject belongs to the
 * Volunteer Progress population. The storage path remains server-side.
 */
export const getVolunteerProfilePhotoRecord = async (
  userId: number,
): Promise<VolunteerProfilePhotoRecord> => {
  const [user, profile, historicalPeriod, stay] = await Promise.all([
    User.findByPk(userId, { attributes: ['id', 'profilePhotoPath', 'updatedAt'] }),
    StaffProfile.findOne({ where: { userId, staffType: 'volunteer' }, attributes: ['userId'] }),
    StaffProfileTypePeriod.findOne({ where: { userId, staffType: 'volunteer' }, attributes: ['id'] }),
    VolunteerStay.findOne({ where: { userId }, attributes: ['id'] }),
  ]);

  const storagePath = typeof user?.profilePhotoPath === 'string'
    ? user.profilePhotoPath.trim()
    : '';
  if (!user || (!profile && !historicalPeriod && !stay) || !storagePath) {
    throw new HttpError(404, PHOTO_NOT_FOUND);
  }

  const updatedAt = user.updatedAt instanceof Date
    ? user.updatedAt.getTime()
    : new Date(user.updatedAt ?? 0).getTime();
  return {
    storagePath,
    profilePhotoVersion: `${user.id}-${Number.isFinite(updatedAt) ? updatedAt : 0}`,
  };
};
