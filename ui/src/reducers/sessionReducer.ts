import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { SessionState } from '../types/general/SessionState';
import { loginUser, logoutUser } from '../actions/userActions';
import { fetchSession } from '../actions/sessionActions';

const initialState: SessionState = {
  user: '',
  authenticated: false,
  checkingSession: false,
  loggedUserId: 0,
  roleSlug: null,
  roleName: null,
  userTypeId: null,
  firstName: null,
  lastName: null,
  hasStoredProfilePhoto: false,
  profilePhotoVersion: null,
  notificationInboxPollingEnabled: false,
  error: null,
};

const sessionSlice = createSlice({
  name: 'session',
  initialState,
  reducers: {
    setUser: (state, action: PayloadAction<string>) => {
      state.user = action.payload;
      state.error = null;
    },
    setAuthenticated: (state, action: PayloadAction<boolean>) => {
      state.authenticated = action.payload;
    },
    setProfilePhotoState: (
      state,
      action: PayloadAction<{
        hasStoredProfilePhoto: boolean;
        profilePhotoVersion: string | null;
      }>,
    ) => {
      state.hasStoredProfilePhoto = action.payload.hasStoredProfilePhoto;
      state.profilePhotoVersion = action.payload.profilePhotoVersion;
    },
    clearSessionError: (state) => {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loginUser.pending, (state) => {
        state.error = null;
      })
      .addCase(loginUser.fulfilled, (state, action) => {
        state.loggedUserId = action.payload[0].userId;
        state.authenticated = true;
        state.error = null;
      })
      .addCase(loginUser.rejected, (state, action) => {
        state.loggedUserId = 0;
        state.authenticated = false;
        state.roleSlug = null;
        state.roleName = null;
        state.userTypeId = null;
        state.firstName = null;
        state.lastName = null;
        state.hasStoredProfilePhoto = false;
        state.profilePhotoVersion = null;
        state.notificationInboxPollingEnabled = false;
        state.error = (action.payload as string) ?? action.error.message ?? 'Login failed';
      })
      .addCase(logoutUser.fulfilled, (state) => {
        state.loggedUserId = 0;
        state.authenticated = false;
        state.user = '';
        state.roleSlug = null;
        state.roleName = null;
        state.userTypeId = null;
        state.firstName = null;
        state.lastName = null;
        state.hasStoredProfilePhoto = false;
        state.profilePhotoVersion = null;
        state.notificationInboxPollingEnabled = false;
        state.error = null;
      })
      .addCase(logoutUser.rejected, (state) => {
        state.loggedUserId = 0;
        state.authenticated = false;
        state.user = '';
        state.roleSlug = null;
        state.roleName = null;
        state.userTypeId = null;
        state.firstName = null;
        state.lastName = null;
        state.hasStoredProfilePhoto = false;
        state.profilePhotoVersion = null;
        state.notificationInboxPollingEnabled = false;
        state.error = null;
      })
      .addCase(fetchSession.pending, (state) => {
        state.checkingSession = true;
      })
      .addCase(fetchSession.fulfilled, (state, action) => {
        state.loggedUserId = action.payload[0].userId;
        state.authenticated = true;
        state.checkingSession = false;
        state.roleSlug = action.payload[0].roleSlug ?? null;
        state.roleName = action.payload[0].roleName ?? null;
        state.userTypeId = action.payload[0].userTypeId ?? null;
        state.firstName = action.payload[0].firstName ?? null;
        state.lastName = action.payload[0].lastName ?? null;
        state.user = [state.firstName, state.lastName].filter(Boolean).join(' ').trim();
        state.hasStoredProfilePhoto = action.payload[0].hasStoredProfilePhoto ?? false;
        state.profilePhotoVersion = action.payload[0].profilePhotoVersion ?? null;
        state.notificationInboxPollingEnabled =
          action.payload[0].notificationInboxPollingEnabled ?? false;
        state.error = null;
      })
      .addCase(fetchSession.rejected, (state) => {
        state.checkingSession = false;
        state.authenticated = false;
        state.loggedUserId = 0;
        state.user = '';
        state.roleSlug = null;
        state.roleName = null;
        state.userTypeId = null;
        state.firstName = null;
        state.lastName = null;
        state.hasStoredProfilePhoto = false;
        state.profilePhotoVersion = null;
        state.notificationInboxPollingEnabled = false;
      });
  },
});

export const { setUser, setAuthenticated, setProfilePhotoState, clearSessionError } = sessionSlice.actions;
export default sessionSlice.reducer;
