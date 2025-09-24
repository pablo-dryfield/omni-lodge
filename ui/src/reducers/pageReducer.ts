import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { Page } from "../types/pages/Page";
import { DataState } from "../types/general/DataState";
import { ServerResponse } from "../types/general/ServerResponse";
import { createPage, deletePage, fetchPages, updatePage } from "../actions/pageActions";

const initialState: DataState<Partial<Page>> = [
  {
    loading: false,
    data: [
      {
        data: [],
        columns: [],
      },
    ],
    error: null,
  },
];

const pageSlice = createSlice({
  name: "pages",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchPages.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(
        fetchPages.fulfilled,
        (state, action: PayloadAction<ServerResponse<Partial<Page>>>) => {
          state[0].loading = false;
          state[0].data = action.payload;
          state[0].error = null;
        }
      )
      .addCase(fetchPages.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error = action.error.message || "Failed to fetch pages";
      })
      .addCase(createPage.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(createPage.fulfilled, (state, action: PayloadAction<Partial<Page> | undefined>) => {
        state[0].loading = false;
        if (action.payload) {
          state[0].data[0].data.push(action.payload);
        }
        state[0].error = null;
      })
      .addCase(createPage.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error = action.error.message || "Failed to create page";
      })
      .addCase(updatePage.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(updatePage.fulfilled, (state, action: PayloadAction<Partial<Page> | undefined>) => {
        state[0].loading = false;
        if (action.payload?.id !== undefined) {
          state[0].data[0].data = state[0].data[0].data.map((page) =>
            page.id === action.payload?.id ? action.payload : page
          );
        }
        state[0].error = null;
      })
      .addCase(updatePage.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error = action.error.message || "Failed to update page";
      })
      .addCase(deletePage.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(deletePage.fulfilled, (state, action: PayloadAction<number>) => {
        state[0].loading = false;
        state[0].data[0].data = state[0].data[0].data.filter(
          (page) => page.id !== action.payload
        );
        state[0].error = null;
      })
      .addCase(deletePage.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error = action.error.message || "Failed to delete page";
      });
  },
});

export default pageSlice.reducer;
