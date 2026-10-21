import { configureStore } from '@reduxjs/toolkit';
import { MantineProvider } from '@mantine/core';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import userTypes from '../../reducers/userTypeReducer';
import axiosInstance from '../../utils/axiosInstance';
import { createFoodTourUserType, updateFoodTourUserType } from '../../api/userTypes';
import FoodTourUserTypesPanel from './FoodTourUserTypesPanel';

jest.mock('../../utils/axiosInstance', () => ({ __esModule: true, default: { get: jest.fn() } }));
jest.mock('../../api/userTypes', () => ({ createFoodTourUserType: jest.fn(), updateFoodTourUserType: jest.fn() }));
jest.mock('../../hooks/useModuleAccess', () => ({ useModuleAccess: () => ({ ready: true, canCreate: true, canUpdate: true }) }));

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
    { id: 18, name: 'Food Tour Owner — Team member', slug: 'food-tour-owner-member', description: 'Original description' },
  ], columns: [] }] });
});

async function renderPanel() {
  const store = configureStore({ reducer: { userTypes } });
  render(<Provider store={store}><MantineProvider><FoodTourUserTypesPanel /></MantineProvider></Provider>);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Create user type' })).toBeEnabled());
  return { store };
}
async function openCreator() {
  const { store } = await renderPanel();
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
  expect(screen.queryByText('Food Tour-only user types', { exact: true })).not.toBeInTheDocument();
  expect(screen.queryByText(/New roles are always restricted to Food Tour/)).not.toBeInTheDocument();
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

it('edits the existing role name and description without permission or scope controls', async () => {
  let complete!: (value: unknown) => void;
  (updateFoodTourUserType as jest.Mock).mockReturnValue(new Promise(resolve => { complete = resolve; }));
  await renderPanel();
  await userEvent.click(screen.getByRole('button', { name: 'Edit Food Tour Owner — Team member' }));
  await screen.findByRole('dialog', { name: 'Edit Food Tour user type' });
  expect(screen.getByLabelText(/^Name/)).toHaveValue('Food Tour Owner — Team member');
  expect(screen.getByLabelText('Description')).toHaveValue('Original description');
  expect(screen.queryByRole('textbox', { name: /^Permission template/ })).not.toBeInTheDocument();
  expect(screen.getByLabelText('Product type')).toHaveAttribute('readonly');
  await userEvent.clear(screen.getByLabelText(/^Name/));
  await userEvent.type(screen.getByLabelText(/^Name/), 'Food Tour Guide');
  await userEvent.clear(screen.getByLabelText('Description'));
  await userEvent.type(screen.getByLabelText('Description'), 'Tour guiding staff');
  await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(updateFoodTourUserType).toHaveBeenCalledWith(18, { name: 'Food Tour Guide', description: 'Tour guiding staff' });
  await act(async () => { complete({ id: 18, name: 'Food Tour Guide' }); });
  expect(await screen.findByText('Food Tour Guide updated. Users, permissions and product scope are unchanged.')).toBeInTheDocument();
  expect(createFoodTourUserType).not.toHaveBeenCalled();
});

it('retains edits and shows the API error when saving fails', async () => {
  let fail!: (reason: unknown) => void;
  (updateFoodTourUserType as jest.Mock).mockReturnValue(new Promise((_resolve, reject) => { fail = reject; }));
  await renderPanel();
  await userEvent.click(screen.getByRole('button', { name: 'Edit Food Tour Manager' }));
  await screen.findByRole('dialog', { name: 'Edit Food Tour user type' });
  await userEvent.clear(screen.getByLabelText(/^Name/));
  await userEvent.type(screen.getByLabelText(/^Name/), 'Food Tour Coordinator');
  await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await act(async () => { fail({ response: { data: [{ message: 'Role is no longer in your scope' }] } }); });
  expect(await screen.findByText('Role is no longer in your scope')).toBeInTheDocument();
  expect(screen.getByLabelText(/^Name/)).toHaveValue('Food Tour Coordinator');
});
