jest.mock('../../models/StaffProfile.js', () => ({
  __esModule: true,
  default: { findOne: jest.fn() },
}));
jest.mock('../../models/StaffProfileTypePeriod.js', () => ({
  __esModule: true,
  default: { findOne: jest.fn() },
}));
jest.mock('../../models/VolunteerStay.js', () => ({
  __esModule: true,
  default: { findOne: jest.fn() },
}));

import UserModelStub from '../../__mocks__/sequelizeModelStub.js';
import StaffProfile from '../../models/StaffProfile.js';
import StaffProfileTypePeriod from '../../models/StaffProfileTypePeriod.js';
import VolunteerStay from '../../models/VolunteerStay.js';
import { getVolunteerProfilePhotoRecord } from '../volunteerProfilePhotoService.js';

const userModel = Object.assign(UserModelStub, { findByPk: jest.fn() });
const updatedAt = new Date('2026-09-05T14:30:00.000Z');

describe('volunteer profile photo lookup', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    userModel.findByPk.mockResolvedValue({
      id: 42,
      profilePhotoPath: '  drive:private-photo-id  ',
      updatedAt,
    });
    (StaffProfile.findOne as jest.Mock).mockResolvedValue({ userId: 42 });
    (StaffProfileTypePeriod.findOne as jest.Mock).mockResolvedValue(null);
    (VolunteerStay.findOne as jest.Mock).mockResolvedValue(null);
  });

  it('returns a private storage reference for a current volunteer with stable cache metadata', async () => {
    await expect(getVolunteerProfilePhotoRecord(42)).resolves.toEqual({
      storagePath: 'drive:private-photo-id',
      profilePhotoVersion: `42-${updatedAt.getTime()}`,
    });
    expect(userModel.findByPk).toHaveBeenCalledWith(42, {
      attributes: ['id', 'profilePhotoPath', 'updatedAt'],
    });
  });

  it('allows a historical volunteer represented by a staff-type period or saved stay', async () => {
    (StaffProfile.findOne as jest.Mock).mockResolvedValue(null);
    (StaffProfileTypePeriod.findOne as jest.Mock).mockResolvedValue({ id: 9 });
    await expect(getVolunteerProfilePhotoRecord(42)).resolves.toMatchObject({
      storagePath: 'drive:private-photo-id',
    });

    (StaffProfileTypePeriod.findOne as jest.Mock).mockResolvedValue(null);
    (VolunteerStay.findOne as jest.Mock).mockResolvedValue({ id: 12 });
    await expect(getVolunteerProfilePhotoRecord(42)).resolves.toMatchObject({
      storagePath: 'drive:private-photo-id',
    });
  });

  it.each([
    ['an unrelated user', { profile: null, period: null, stay: null, path: 'drive:private-photo-id' }],
    ['a volunteer without a stored photo', { profile: { userId: 42 }, period: null, stay: null, path: null }],
  ])('returns the same not-found response for %s', async (_label, fixture) => {
    (StaffProfile.findOne as jest.Mock).mockResolvedValue(fixture.profile);
    (StaffProfileTypePeriod.findOne as jest.Mock).mockResolvedValue(fixture.period);
    (VolunteerStay.findOne as jest.Mock).mockResolvedValue(fixture.stay);
    userModel.findByPk.mockResolvedValue({ id: 42, profilePhotoPath: fixture.path, updatedAt });

    await expect(getVolunteerProfilePhotoRecord(42)).rejects.toMatchObject({
      status: 404,
      message: 'Volunteer profile photo was not found.',
    });
  });
});
