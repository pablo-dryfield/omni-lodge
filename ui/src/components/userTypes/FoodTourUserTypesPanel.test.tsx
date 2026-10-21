import { configureStore } from '@reduxjs/toolkit';
import { MantineProvider } from '@mantine/core';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import userTypes from '../../reducers/userTypeReducer';
import axiosInstance from '../../utils/axiosInstance';
import { createFoodTourUserType } from '../../api/userTypes';
import FoodTourUserTypesPanel from './FoodTourUserTypesPanel';

jest.mock('../../utils/axiosInstance', () => ({ __esModule: true, default: { get: jest.fn() } }));
jest.mock('../../api/userTypes', () => ({ createFoodTourUserType: jest.fn() }));
jest.mock('../../hooks/useModuleAccess', () => ({ useModuleAccess: () => ({ ready: true, canCreate: true }) }));

beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(window, 'matchMedia', { writable: true, value: jest.fn().mockImplementation(query => ({
    matches: false, media: query, onchange: null, addListener: jest.fn(), removeListener: jest.fn(),
    addEventListener: jest.fn(), removeEventListener: jest.fn(), dispatchEvent: jest.fn(),
  })) });
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  HTMLElement.prototype.scrollIntoView = jest.fn();
  (axiosInstance.get as jest.Mock).mockResolvedValue({ data: [{ data: [
    { id: 15, name: 'Food Tour Manager', slug: 'food-tour-manager' },
    { id: 16, name: 'Food Tour Owner', slug: 'food-tour-owner' },
  ], columns: [] }] });
});

async function openCreator() {
  const store = configureStore({ reducer: { userTypes } });
  render(<Provider store={store}><MantineProvider><FoodTourUserTypesPanel /></MantineProvider></Provider>);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Create user type' })).toBeEnabled());
  await userEvent.click(screen.getByRole('button', { name: 'Create user type' }));
  await screen.findByRole('dialog', { name: 'Create Food Tour user type' });
  return store;
}
async function fillCreator() {
  await userEvent.type(screen.getByLabelText(/^Name/), 'Guide');
  await userEvent.click(screen.getByRole('textbox', { name: /^Permission template/ }));
  await userEvent.click(await screen.findByRole('option', { name: 'Food Tour Manager', exact: true }));
}

it('fixes the product scope and exposes no company-wide permission tools', async () => {
  await openCreator();
  expect(screen.getByLabelText('Product type')).toHaveValue('Food Tour (restricted)');
  expect(screen.getByLabelText('Product type')).toHaveAttribute('readonly');
  expect(screen.getByRole('button', { name: 'Create', exact: true })).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Permissions' })).not.toBeInTheDocument();
  expect(screen.queryByText('Add all permissions')).not.toBeInTheDocument();
});
it('creates a role from an explicit template and refreshes available user types', async () => {
  let complete!: (value: unknown) => void;
  (createFoodTourUserType as jest.Mock).mockReturnValue(new Promise(resolve => { complete = resolve; }));
  await openCreator(); await fillCreator();
  await userEvent.click(screen.getByRole('button', { name: 'Create', exact: true }));
  await waitFor(() => expect(createFoodTourUserType).toHaveBeenCalledWith({ name: 'Food Tour Guide', description: '', sourceUserTypeId: 15 }));
  await act(async () => { complete({ id: 99, name: 'Food Tour Guide' }); });
  expect(await screen.findByText('Food Tour Guide created. You can now select it when adding a user.')).toBeInTheDocument();
  expect(axiosInstance.get).toHaveBeenCalledTimes(2);
});
it('shows the server error without closing the form or losing the selected template', async () => {
  let fail!: (reason: unknown) => void;
  (createFoodTourUserType as jest.Mock).mockReturnValue(new Promise((_resolve, reject) => { fail = reject; }));
  await openCreator(); await fillCreator();
  await userEvent.click(screen.getByRole('button', { name: 'Create', exact: true }));
  await act(async () => { fail({ response: { data: [{ message: 'This record already exists' }] } }); });
  expect(await screen.findByText('This record already exists')).toBeInTheDocument();
  expect(screen.getByLabelText(/^Name/)).toHaveValue('Food Tour Guide');
  expect(screen.getByRole('textbox', { name: /^Permission template/ })).toHaveValue('Food Tour Manager');
});
it('cancels without creating a role', async () => {
  await openCreator(); await fillCreator();
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(createFoodTourUserType).not.toHaveBeenCalled();
});
