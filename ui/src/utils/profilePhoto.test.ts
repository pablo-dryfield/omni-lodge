import axiosInstance from './axiosInstance';
import { buildUserProfilePhotoUrl } from './profilePhoto';

jest.mock('./axiosInstance', () => ({
  __esModule: true,
  default: {
    defaults: {
      baseURL: 'https://api.example.test/api/',
    },
  },
}));

describe('buildUserProfilePhotoUrl', () => {
  beforeEach(() => {
    axiosInstance.defaults.baseURL = 'https://api.example.test/api/';
  });

  it('builds the authenticated session photo URL with a stable cache version', () => {
    const dateNowSpy = jest.spyOn(Date, 'now');
    const params = {
      user: { id: 28, hasStoredProfilePhoto: true },
      cacheOverride: '28-1788105600000',
      resourcePath: '/session/profile-photo',
    };

    expect(buildUserProfilePhotoUrl(params)).toBe(
      'https://api.example.test/api/session/profile-photo?v=28-1788105600000',
    );
    expect(buildUserProfilePhotoUrl(params)).toBe(
      'https://api.example.test/api/session/profile-photo?v=28-1788105600000',
    );
    expect(dateNowSpy).not.toHaveBeenCalled();

    dateNowSpy.mockRestore();
  });

  it('returns null when the session reports that no profile photo is stored', () => {
    expect(
      buildUserProfilePhotoUrl({
        user: { id: 28, hasStoredProfilePhoto: false },
        cacheOverride: '28-1788105600000',
        resourcePath: '/session/profile-photo',
      }),
    ).toBeNull();
  });

  it('keeps an existing external photo URL as the no-stored-path fallback', () => {
    expect(
      buildUserProfilePhotoUrl({
        user: {
          id: 28,
          hasStoredProfilePhoto: false,
          profilePhotoUrl: '  https://cdn.example.test/users/28.jpg  ',
        },
        resourcePath: '/session/profile-photo',
      }),
    ).toBe('https://cdn.example.test/users/28.jpg');
  });
});
