import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import HomeExternalRefunds from './HomeExternalRefunds';
import { canLoadHomeExternalRefunds } from './homeExternalRefundAccess';
const mockQuery = jest.fn();
const mockMutate = jest.fn();
let mockRole = 'assistant-manager';
let mockAccess = { ready: true, canView: true, canUpdate: true };
jest.mock('../../hooks/useModuleAccess', () => ({ useModuleAccess: () => mockAccess }));
jest.mock('../../store/hooks', () => ({ useAppSelector: (select: (state: unknown) => unknown) => select({ session: { roleSlug: mockRole } }) }));
jest.mock('../../api/homeExternalRefunds', () => ({
  useHomeExternalRefunds: (...args: unknown[]) => mockQuery(...args),
  useExternalRefundAction: () => ({ mutateAsync: mockMutate, isPending: false }),
  externalRefundError: (error: Error) => error.message,
}));
const data = { data: [{ bookingId: 41, customerName: 'Diane Jender', platform: 'viator', platformBookingId: 'BR-1', productName: 'Pub Crawl', experienceDate: '2026-11-13',
  actions: [{ id: 'refund-1', addonKey: 'cocktails', quantity: 2, counterId: 77, reason: null }] }], meta: { totalBookings: 9, limit: 8, offset: 0 } };
const view = (visible = true, ready = true) => render(<MantineProvider><MemoryRouter><HomeExternalRefunds configuredVisible={visible} audienceReady={ready} /></MemoryRouter></MantineProvider>);
beforeEach(() => {
  jest.clearAllMocks(); mockRole = 'assistant-manager'; mockAccess = { ready: true, canView: true, canUpdate: true };
  mockQuery.mockReturnValue({ data, isLoading: false, isFetching: false, refetch: jest.fn() });
  mockMutate.mockResolvedValue({});
  Object.defineProperty(window, 'matchMedia', { writable: true, value: jest.fn(() => ({ matches: false, addEventListener: jest.fn(), removeEventListener: jest.fn() })) });
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
});
it('shows the name, platform, add-ons, actions and exact source counter', () => {
  view();
  expect(mockQuery).toHaveBeenCalledWith(true, 0, 8);
  expect(screen.getByText('Diane Jender')).toBeInTheDocument();
  expect(screen.getByText('Viator')).toBeInTheDocument();
  expect(screen.getByText(/2.*Cocktails/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Counter' })).toHaveAttribute('href', '/counters?counterId=77&mode=edit&step=summary');
});
it.each([[false, true], [true, false]])('does not fetch when visibility or audience is unresolved (%s, %s)', (visible, ready) => {
  view(visible, ready); expect(mockQuery).toHaveBeenCalledWith(false, 0, 8);
  expect(screen.queryByText('Diane Jender')).not.toBeInTheDocument();
});
it.each(['guide', 'partner', 'food-tour-guide'])('does not expose refunds to %s', role => {
  mockRole = role; view(); expect(mockQuery).toHaveBeenCalledWith(false, 0, 8);
});
it('completes the exact existing task only after confirming the external refund', async () => {
  view(); fireEvent.click(screen.getByRole('button', { name: 'Complete Cocktails refund for Diane Jender' }));
  expect(mockMutate).not.toHaveBeenCalled();
  fireEvent.click(await screen.findByRole('button', { name: 'Confirm completed' }));
  await waitFor(() => expect(mockMutate).toHaveBeenCalledWith({ bookingId: 41, actionId: 'refund-1', operation: 'complete' }));
  expect(await screen.findByText(/Booking add-ons and counter metrics updated/)).toBeInTheDocument();
});
it('deletes through the same task identity and explains that this records no refund', async () => {
  view(); fireEvent.click(screen.getByRole('button', { name: 'Delete Cocktails refund for Diane Jender' }));
  expect(await screen.findByText(/without recording a refund/)).toBeInTheDocument();
  fireEvent.click(await screen.findByRole('button', { name: 'Delete task' }));
  await waitFor(() => expect(mockMutate).toHaveBeenCalledWith({ bookingId: 41, actionId: 'refund-1', operation: 'delete' }));
  expect(await screen.findByText(/Pending refund deleted/)).toBeInTheDocument();
});
it('keeps failed actions open with an actionable error and no false success', async () => {
  mockMutate.mockRejectedValue(new Error('Counter update failed'));
  view(); fireEvent.click(screen.getByRole('button', { name: 'Complete Cocktails refund for Diane Jender' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Confirm completed' }));
  expect(await screen.findByText('Counter update failed')).toBeInTheDocument();
  expect(screen.queryByText(/Booking add-ons and counter metrics updated/)).not.toBeInTheDocument();
});
it('paginates across all outstanding bookings', () => {
  view(); fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  expect(mockQuery).toHaveBeenLastCalledWith(true, 8, 8);
});
it('shows a recoverable fetch error', () => {
  const refetch = jest.fn(); mockQuery.mockReturnValue({ error: new Error('offline'), refetch });
  view(); expect(screen.getByText('offline')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' })); expect(refetch).toHaveBeenCalled();
});
it('never grants access through a visibility rule alone', () => {
  expect(canLoadHomeExternalRefunds(false, true, 'manager')).toBe(false);
  expect(canLoadHomeExternalRefunds(true, false, 'manager')).toBe(false);
  expect(canLoadHomeExternalRefunds(true, true, 'Administrator')).toBe(true);
});
