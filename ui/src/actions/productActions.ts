import { createAsyncThunk } from '@reduxjs/toolkit';
import axiosInstance from './../utils/axiosInstance';
import { ServerResponse } from '../types/general/ServerResponse';
import { Product } from '../types/products/Product';

/**
 * Fetches a list of products from the server.
 * @returns A promise that resolves to the list of products or an error message string.
 * @throws Will throw an error if the server response is not as expected or if there is a network issue.
 */
export const fetchProducts = createAsyncThunk(
  'products/fetchProducts',
  async (_, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.get<ServerResponse<Partial<Product>>>('/api/products', {
        withCredentials: true
      });
      return response.data;
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue('An unknown error occurred');
    }
  }
);


/**
 * Fetches a list of active products from the server.
 * @returns A promise that resolves to the list of products or an error message string.
 * @throws Will throw an error if the server response is not as expected or if there is a network issue.
 */
export const fetchActiveProducts = createAsyncThunk(
  'products/fetchProducts',
  async (_, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.get<ServerResponse<Partial<Product>>>('/api/products/active', {
        withCredentials: true
      });
      return response.data;
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue('An unknown error occurred');
    }
  }
);

/**
 * Creates a new product with the provided data.
 * @param productData - The data for the new product to be created.
 * @returns A promise that resolves to the created product's data or an error message string.
 * @throws Will throw an error if the server response is not as expected or if there is a network issue.
 */
export const createProduct = createAsyncThunk(
  'products/createProduct',
  async (productData: Partial<Product>, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.post<Partial<Product>>('/api/products', productData, {
        withCredentials: true
      });
      return response.data;
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue('An unknown error occurred');
    }
  }
);

/**
 * Updates a product with the given ID using the provided data.
 * @param productId - The ID of the product to update.
 * @param productData - The new data for updating the product.
 * @returns A promise that resolves to the updated product's data or an error message string.
 * @throws Will throw an error if the server response is not as expected or if there is a network issue.
 */
export const updateProduct = createAsyncThunk(
  'products/updateProduct',
  async ({ productId, productData }: { productId: number; productData: Partial<Product>; }, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.put<Partial<Product>>(`/api/products/${productId}`, productData, {
        withCredentials: true
      });
      return response.data;
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue('An unknown error occurred');
    }
  }
);

/**
 * Deletes a product with the specified ID.
 * @param productId - The ID of the product to be deleted.
 * @returns A promise that resolves to the ID of the deleted product or an error message string.
 * @throws Will throw an error if the server response is not as expected or if there is a network issue.
 */
export const deleteProduct = createAsyncThunk(
  'products/deleteProduct',
  async (productId: number, { rejectWithValue }) => {
    try {
      await axiosInstance.delete(`/api/products/${productId}`, {
        withCredentials: true
      });
      return productId;
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue('An unknown error occurred');
    }
  }
);