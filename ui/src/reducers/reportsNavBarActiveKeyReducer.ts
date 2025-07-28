import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { ReportsNavBarActiveKey } from '../types/general/ReportsNavBarActiveKey';

const initialState: ReportsNavBarActiveKey = "";

const reportsNavBarActiveKeySlice = createSlice({
  name: 'reportsNavBarActiveKey',
  initialState,
  reducers: {
    setCurrentReportsNavBarActiveKey: (_, action: PayloadAction<string>) => action.payload,
  },
});

export const { setCurrentReportsNavBarActiveKey } = reportsNavBarActiveKeySlice.actions;
export default reportsNavBarActiveKeySlice.reducer;
