import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { SessionState } from '../types/general/SessionState';
import { loginUser, logoutUser } from '../actions/userActions';
import { fetchSession } from '../actions/sessionActions';

// Define the initial state using that type
const initialState: SessionState = {
    user: "",
    authenticated: false,
    checkingSession: false,
    loggedUserId: 0,
};

const sessionSlice = createSlice({
  name: 'session',
  initialState,
  reducers: {
    setUser: (state, action: PayloadAction<string>) => {
      state.user = action.payload;
    },
    setAuthenticated: (state, action: PayloadAction<boolean>) => {
      state.authenticated = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder
    .addCase(loginUser.fulfilled, (state, action) => {
      state.loggedUserId = action.payload[0].userId;
      state.authenticated = true;
    })
    .addCase(logoutUser.fulfilled, (state) => {
      state.loggedUserId = 0;
      state.authenticated = false;
      state.user = "";
    })
    .addCase(fetchSession.pending, (state) => {
      state.checkingSession = true;
    })
    .addCase(fetchSession.fulfilled, (state, action) => {
      state.loggedUserId = action.payload[0].userId;
      state.authenticated = true;
      state.checkingSession = false;
    })
    .addCase(fetchSession.rejected, (state) => {
      state.checkingSession = false;
      state.authenticated = false;
    });
  }
});

export const { setUser , setAuthenticated } = sessionSlice.actions;
export default sessionSlice.reducer;