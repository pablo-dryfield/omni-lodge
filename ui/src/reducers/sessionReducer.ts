import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { SessionState } from '../types/general/SessionState';
import { loginUser } from '../actions/userActions';
import { fetchSession } from '../actions/sessionActions';

// Define the initial state using that type
const initialState: SessionState = {
    user:"",
    password:"",
    authenticated: false,
    checkingSession: true,
    loggedUserId: 0,
};

const sessionSlice = createSlice({
  name: 'session',
  initialState,
  reducers: {
    setUser: (state, action: PayloadAction<string>) => {
      state.user = action.payload;
    },
    setPassword: (state, action: PayloadAction<string>) => {
      state.password = action.payload;
    },
    setAuthenticated: (state, action: PayloadAction<boolean>) => {
      state.authenticated = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder.addCase(loginUser.fulfilled, (state, action: PayloadAction<[{message: string, userId: number}]>) => {
      state.loggedUserId = action.payload[0].userId;
      state.authenticated = true;
    })
    .addCase(fetchSession.pending, (state) => {
      state.checkingSession = true;
    })
    .addCase(fetchSession.fulfilled, (state, action) => {
      state.authenticated = true;
      state.checkingSession = false;
    })
    .addCase(fetchSession.rejected, (state) => {
      state.checkingSession = false;
      state.authenticated = false;
    });
  }
});

export const { setUser , setPassword, setAuthenticated } = sessionSlice.actions;
export default sessionSlice.reducer;