import { fetchSession } from '../actions/sessionActions';
import { logoutUser } from '../actions/userActions';
import sessionReducer, { setProfilePhotoState } from './sessionReducer';

jest.mock('axios', () => ({
  __esModule: true,
  default: {
    isAxiosError: jest.fn(() => false),
  },
}));

jest.mock('../utils/axiosInstance', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

const hydrateSession = () =>
  sessionReducer(
    undefined,
    fetchSession.fulfilled(
      [
        {
          authenticated: true,
          userId: 28,
          firstName: 'Aimee',
          lastName: 'Guide',
          roleSlug: 'assistant-manager',
          roleName: 'Assistant Manager',
          userTypeId: 4,
          hasStoredProfilePhoto: true,
          profilePhotoVersion: '28-1788105600000',
        },
      ],
      'session-request',
      undefined,
    ),
  );

describe('sessionReducer session profile hydration', () => {
  it('hydrates the signed-in user and stable profile-photo metadata', () => {
    const state = hydrateSession();

    expect(state).toMatchObject({
      authenticated: true,
      checkingSession: false,
      loggedUserId: 28,
      user: 'Aimee Guide',
      firstName: 'Aimee',
      lastName: 'Guide',
      roleSlug: 'assistant-manager',
      roleName: 'Assistant Manager',
      userTypeId: 4,
      hasStoredProfilePhoto: true,
      profilePhotoVersion: '28-1788105600000',
      error: null,
    });
  });

  it('synchronously stores the current profile-photo state and version', () => {
    const state = sessionReducer(
      undefined,
      setProfilePhotoState({
        hasStoredProfilePhoto: true,
        profilePhotoVersion: '28-1788192000000',
      }),
    );

    expect(state.hasStoredProfilePhoto).toBe(true);
    expect(state.profilePhotoVersion).toBe('28-1788192000000');
  });

  it('synchronously clears the stored-photo flag and version on removal', () => {
    const state = sessionReducer(
      hydrateSession(),
      setProfilePhotoState({
        hasStoredProfilePhoto: false,
        profilePhotoVersion: null,
      }),
    );

    expect(state).toMatchObject({
      authenticated: true,
      loggedUserId: 28,
      user: 'Aimee Guide',
      hasStoredProfilePhoto: false,
      profilePhotoVersion: null,
    });
  });

  it('clears hydrated identity and photo state when session validation fails', () => {
    const state = sessionReducer(hydrateSession(), {
      type: fetchSession.rejected.type,
    });

    expect(state).toMatchObject({
      authenticated: false,
      checkingSession: false,
      loggedUserId: 0,
      user: '',
      roleSlug: null,
      roleName: null,
      userTypeId: null,
      firstName: null,
      lastName: null,
      hasStoredProfilePhoto: false,
      profilePhotoVersion: null,
    });
  });

  it.each([logoutUser.fulfilled.type, logoutUser.rejected.type])(
    'clears hydrated identity and photo state for %s',
    (actionType) => {
      const state = sessionReducer(hydrateSession(), { type: actionType });

      expect(state).toMatchObject({
        authenticated: false,
        loggedUserId: 0,
        user: '',
        roleSlug: null,
        roleName: null,
        userTypeId: null,
        firstName: null,
        lastName: null,
        hasStoredProfilePhoto: false,
        profilePhotoVersion: null,
      });
    },
  );
});
