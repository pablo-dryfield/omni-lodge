import { configureStore } from '@reduxjs/toolkit';
import { MantineProvider } from '@mantine/core';
import { act, render, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import axiosInstance from '../../utils/axiosInstance';
import userTypes from '../../reducers/userTypeReducer';
import productTypes from '../../reducers/productTypeReducer';
import type { UserType } from '../../types/userTypes/UserType';
import UserTypeList from './UserTypeList';

jest.mock('../../utils/axiosInstance', () => ({ __esModule: true, default: {
  get: jest.fn(), put: jest.fn(), post: jest.fn(),
} }));
jest.mock('../../hooks/useModuleAccess', () => ({ useModuleAccess: () => ({
  ready: true, canView: true, canCreate: true, canUpdate: true, canDelete: true,
}) }));
let mockActions: {
  handleUpdate: (original: Partial<UserType>, updated: Partial<UserType>) => Promise<void>;
};
jest.mock('../../utils/Table', () => ({ __esModule: true, default: ({ actions }: any) => {
  mockActions = actions;
  return null;
} }));

const original = { id: 16, name: 'Food Tour Owner', slug: 'food-tour-owner', productTypeIds: [], updatedBy: 1 };
beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(window, 'matchMedia', { writable: true, value: jest.fn().mockImplementation(query => ({
    matches: false, media: query, onchange: null,
    addListener: jest.fn(), removeListener: jest.fn(),
    addEventListener: jest.fn(), removeEventListener: jest.fn(), dispatchEvent: jest.fn(),
  })) });
  (axiosInstance.get as jest.Mock).mockImplementation(async (url: string) => ({ data: [{
    data: url === '/userTypes' ? [original] : [{ id: 3, name: 'Food Tour Krakow' }], columns: [],
  }] }));
});

const renderList = async () => {
  const store = configureStore({ reducer: {
    userTypes, productTypes,
    session: () => ({ loggedUserId: 1 }),
    navigation: () => ({ currentPage: 'User Types' }),
  } });
  render(<Provider store={store}><MantineProvider><UserTypeList /></MantineProvider></Provider>);
  await waitFor(() => expect(store.getState().userTypes[0].data[0].data).toHaveLength(1));
  return { store };
};

it('passes a scope-only update through and uses the returned record without a second fetch', async () => {
  (axiosInstance.put as jest.Mock).mockResolvedValue({ data: [{ ...original, productTypeIds: [3] }] });
  const { store } = await renderList();
  await act(async () => mockActions.handleUpdate(original, { ...original, productTypeIds: [3] }));
  expect(axiosInstance.put).toHaveBeenCalledWith('/userTypes/16', { productTypeIds: [3], updatedBy: 1 }, { withCredentials: true });
  expect(store.getState().userTypes[0].data[0].data[0].productTypeIds).toEqual([3]);
  expect(axiosInstance.get).toHaveBeenCalledTimes(2); // Initial user types and product types only.
});

it('rejects a failed save to the editor without refetching and clearing its error', async () => {
  (axiosInstance.put as jest.Mock).mockRejectedValue({ response: { data: [{ message: 'Product type is unavailable' }] } });
  const { store } = await renderList();
  await act(async () => {
    await expect(mockActions.handleUpdate(original, { ...original, productTypeIds: [3] })).rejects.toBe('Product type is unavailable');
  });
  expect(store.getState().userTypes[0].error).toBe('Product type is unavailable');
  expect(axiosInstance.get).toHaveBeenCalledTimes(2);
});
