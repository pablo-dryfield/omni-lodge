import { configureStore } from '@reduxjs/toolkit';
import axiosInstance from '../utils/axiosInstance';
import reducer from '../reducers/userTypeReducer';
import { createUserType, updateUserType } from './userTypeActions';

jest.mock('../utils/axiosInstance', () => ({ __esModule: true, default: { put: jest.fn(), post: jest.fn() } }));
const record = { id: 16, name: 'Food Tour Owner', productTypeIds: [3] };
beforeEach(() => { jest.clearAllMocks(); });

it('unwraps the API array and immediately updates the selected product types in Redux', async () => {
  const store = configureStore({ reducer, preloadedState: [{ loading: false, error: null, data: [{ data: [{ ...record, productTypeIds: [] }], columns: [] }] }] });
  (axiosInstance.put as jest.Mock).mockResolvedValue({ data: [record] });
  await expect(store.dispatch(updateUserType({ userTypeId: 16, userTypeData: { productTypeIds: [3] } })).unwrap()).resolves.toEqual(record);
  expect(store.getState()[0].data[0].data[0].productTypeIds).toEqual([3]);
});

it('propagates the actual validation error instead of hiding it behind Rejected', async () => {
  const store = configureStore({ reducer });
  (axiosInstance.put as jest.Mock).mockRejectedValue({ response: { data: { errors: [{ msg: 'Name must not be empty' }] } } });
  await expect(store.dispatch(updateUserType({ userTypeId: 16, userTypeData: { name: '' } })).unwrap()).rejects.toBe('Name must not be empty');
  expect(store.getState()[0].error).toBe('Name must not be empty');
});

it('unwraps newly created user types without inserting a nested array', async () => {
  const store = configureStore({ reducer });
  (axiosInstance.post as jest.Mock).mockResolvedValue({ data: [record] });
  await store.dispatch(createUserType(record)).unwrap();
  expect(store.getState()[0].data[0].data).toEqual([record]);
});
