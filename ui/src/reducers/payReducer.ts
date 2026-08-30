import { createSlice } from '@reduxjs/toolkit';
import { type Pay } from '../types/pays/Pay';
import { type ServerResponse } from '../types/general/ServerResponse';
import {
  fetchPays,
  type StaffPayoutBootstrapResponse,
} from '../actions/payActions';

type PayState = [{
  loading: boolean;
  data: ServerResponse<Pay>;
  error: string | null;
  finance: StaffPayoutBootstrapResponse['finance'];
  compensationComponents: StaffPayoutBootstrapResponse['compensationComponents'];
  accessScope: StaffPayoutBootstrapResponse['scope'] | null;
  canManagePayouts: boolean;
  currentRequestId: string | null;
}];

const initialState: PayState = [
  {
    loading: false,
    data: [
      {
        data: [],
        columns: [],
      },
    ],
    error: null,
    finance: null,
    compensationComponents: null,
    accessScope: null,
    canManagePayouts: false,
    currentRequestId: null,
  },
];

const paySlice = createSlice({
  name: 'pays',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchPays.pending, (state, action) => {
        state[0].loading = true;
        state[0].currentRequestId = action.meta.requestId;
      })
      .addCase(fetchPays.fulfilled, (state, action) => {
        if (state[0].currentRequestId !== action.meta.requestId) {
          return;
        }
        state[0].loading = false;
        state[0].currentRequestId = null;
        state[0].data = action.payload.pays;
        state[0].error = null;
        state[0].finance = action.payload.finance;
        state[0].compensationComponents = action.payload.compensationComponents;
        state[0].accessScope = action.payload.scope;
        state[0].canManagePayouts = action.payload.canManagePayouts;
      })
      .addCase(fetchPays.rejected, (state, action) => {
        if (state[0].currentRequestId !== action.meta.requestId) {
          return;
        }
        state[0].loading = false;
        state[0].currentRequestId = null;
        const payloadMessage = (action.payload as string) ?? null;
        state[0].error = payloadMessage ?? action.error.message ?? 'Failed to fetch pays';
      });
  },
});

export default paySlice.reducer;
