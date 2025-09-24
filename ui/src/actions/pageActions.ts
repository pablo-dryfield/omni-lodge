import { createAsyncThunk } from "@reduxjs/toolkit";
import axiosInstance from "../utils/axiosInstance";
import { ServerResponse } from "../types/general/ServerResponse";
import { Page } from "../types/pages/Page";

export const fetchPages = createAsyncThunk(
  "pages/fetchPages",
  async (_, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.get<ServerResponse<Partial<Page>>>("/api/pages", {
        withCredentials: true,
      });
      return response.data;
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue("An unknown error occurred");
    }
  }
);

export const createPage = createAsyncThunk(
  "pages/createPage",
  async (pageData: Partial<Page>, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.post<Partial<Page>[]>("/api/pages", pageData, {
        withCredentials: true,
      });
      return response.data[0];
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue("An unknown error occurred");
    }
  }
);

export const updatePage = createAsyncThunk(
  "pages/updatePage",
  async (
    { pageId, pageData }: { pageId: number; pageData: Partial<Page> },
    { rejectWithValue }
  ) => {
    try {
      const response = await axiosInstance.put<Partial<Page>[]>(
        `/api/pages/${pageId}`,
        pageData,
        {
          withCredentials: true,
        }
      );
      return response.data[0];
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue("An unknown error occurred");
    }
  }
);

export const deletePage = createAsyncThunk(
  "pages/deletePage",
  async (pageId: number, { rejectWithValue }) => {
    try {
      await axiosInstance.delete(`/api/pages/${pageId}`, {
        withCredentials: true,
      });
      return pageId;
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue("An unknown error occurred");
    }
  }
);
