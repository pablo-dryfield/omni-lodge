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
        state.error = (action.payload as string) ?? action.error.message ?? 'Login failed';
      })
      .addCase(logoutUser.fulfilled, (state) => {
        state.loggedUserId = 0;
        state.authenticated = false;
        state.user = '';
        state.roleSlug = null;
        state.roleName = null;
        state.userTypeId = null;
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
        state.error = null;
      })
      .addCase(fetchSession.rejected, (state) => {
        state.checkingSession = false;
        state.authenticated = false;
        state.roleSlug = null;
        state.roleName = null;
        state.userTypeId = null;
      });
  },
});

export const { setUser, setAuthenticated, clearSessionError } = sessionSlice.actions;
export default sessionSlice.reducer;
