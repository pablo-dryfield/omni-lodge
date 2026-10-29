import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import BookingLocalActionModal from './BookingLocalActionModal';
import axiosInstance from '../../utils/axiosInstance';
import type { UnifiedOrder } from '../../store/bookingPlatformsTypes';
jest.mock('../../utils/axiosInstance', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn() } }));
jest.mock('@mantine/hooks', () => ({ ...jest.requireActual('@mantine/hooks'), useMediaQuery: () => false }));
const order = { id: 'test', platform: 'viator', platformBookingId: 'TEST-42', customerName: 'Test Guest', productName: 'Pub Crawl',
  date: '2027-01-10', timeslot: '21:00', quantity: 2 } as UnifiedOrder;
const preview = { booking: { id: 42, status: 'confirmed', platform: 'viator', platformBookingId: 'TEST-42',
  experienceStartAt: '2027-01-10T20:00:00.000Z', updatedAt: '2027-01-01T00:00:00.000Z' }, hasCustomerEmail: true };
const success = { message: 'Booking cancelled in OmniLodge only.', notifications: {
  customer: { status: 'sent' }, internal: { status: 'sent' },
}, notificationAuditSaved: true };
const saved = jest.fn(); const close = jest.fn();
const renderModal = (operation: 'amend' | 'cancel' = 'cancel', canManage = true) => {
  render(<MantineProvider theme={{ components: { Modal: { defaultProps: { transitionProps: { duration: 0 } } } } }}>
    <BookingLocalActionModal bookingId={42} order={order} operation={operation} canManage={canManage} onClose={close} onSaved={saved} />
  </MantineProvider>);
};
beforeEach(() => {
  jest.clearAllMocks(); (axiosInstance.get as jest.Mock).mockResolvedValue({ data: preview });
  (axiosInstance.post as jest.Mock).mockResolvedValue({ data: success });
  Object.defineProperty(window, 'matchMedia', { writable: true, value: jest.fn(query => ({
    matches: false, media: query, onchange: null, addListener: jest.fn(), removeListener: jest.fn(),
    addEventListener: jest.fn(), removeEventListener: jest.fn(), dispatchEvent: jest.fn(),
  })) });
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
});
it('makes external-platform and no-refund scope explicit and requires a reason before submitting', async () => {
  renderModal();
  const confirm = await screen.findByRole('button', { name: 'Confirm force cancellation' });
  expect(screen.getByText(/does not update viator/)).toBeInTheDocument();
  expect(confirm).toBeDisabled(); expect(axiosInstance.post).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.getByLabelText(/Reason for this force action/)).toBeEnabled());
  fireEvent.change(screen.getByLabelText(/Reason for this force action/), { target: { value: 'Confirmed with customer' } });
  expect(confirm).toBeEnabled(); fireEvent.click(confirm);
  await waitFor(() => expect(axiosInstance.post).toHaveBeenCalledWith('/bookings/42/local-actions/cancel', {
    expectedUpdatedAt: preview.booking.updatedAt, reason: 'Confirmed with customer', sendCustomerEmail: true,
  }));
  expect(await screen.findByText('Booking cancelled in OmniLodge only.')).toBeInTheDocument();
  expect(saved).toHaveBeenCalledTimes(1); expect(screen.queryByRole('button', { name: 'Confirm force cancellation' })).not.toBeInTheDocument();
});
it('requires a real date/time change and sends a Warsaw date/time amendment, not a provider request', async () => {
  renderModal('amend');
  const reason = await screen.findByLabelText(/Reason for this force action/);
  await waitFor(() => expect(reason).toBeEnabled());
  fireEvent.change(reason, { target: { value: 'Customer agreed to a later start' } });
  expect(screen.getByRole('button', { name: 'Confirm force amendment' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText(/New date \(Warsaw\)/), { target: { value: '2027-01-11' } });
  fireEvent.change(screen.getByLabelText(/New time \(Warsaw\)/), { target: { value: '22:00' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm force amendment' }));
  await waitFor(() => expect(axiosInstance.post).toHaveBeenCalledWith('/bookings/42/local-actions/amend', expect.objectContaining({
    pickupDate: '2027-01-11', pickupTime: '22:00', expectedUpdatedAt: preview.booking.updatedAt,
  })));
});
it('supports missing customer email without hiding the correction', async () => {
  (axiosInstance.get as jest.Mock).mockResolvedValue({ data: { ...preview, hasCustomerEmail: false } });
  renderModal();
  expect(await screen.findByText(/No customer email is saved/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText(/Reason for this force action/), { target: { value: 'Verified platform cancellation' } });
  expect(screen.getByRole('button', { name: 'Confirm force cancellation' })).toBeEnabled();
  expect(screen.getByRole('checkbox', { name: 'Send customer notification' })).toBeDisabled();
});
it('does not allow an account with revoked authority to submit', async () => {
  renderModal('cancel', false);
  await waitFor(() => expect(screen.getByLabelText(/Reason for this force action/)).toBeEnabled());
  fireEvent.change(screen.getByLabelText(/Reason for this force action/), { target: { value: 'Reason' } });
  expect(screen.getByRole('button', { name: 'Confirm force cancellation' })).toBeDisabled();
  expect(axiosInstance.post).not.toHaveBeenCalled();
});
it('reports stale state without claiming success, and refreshes before another attempt', async () => {
  (axiosInstance.post as jest.Mock).mockRejectedValue({ response: { data: { message: 'The booking changed. Refresh and review it before trying again.' } } });
  renderModal(); await waitFor(() => expect(screen.getByLabelText(/Reason for this force action/)).toBeEnabled());
  fireEvent.change(screen.getByLabelText(/Reason for this force action/), { target: { value: 'Reason' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm force cancellation' }));
  expect(await screen.findByText(/The booking changed/)).toBeInTheDocument(); expect(saved).not.toHaveBeenCalled();
  (axiosInstance.get as jest.Mock).mockResolvedValue({ data: { ...preview, booking: { ...preview.booking, updatedAt: '2027-01-02T00:00:00.000Z' } } });
  fireEvent.click(screen.getByRole('button', { name: 'Refresh booking' }));
  await waitFor(() => expect(axiosInstance.get).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm force cancellation' })).toBeEnabled());
  (axiosInstance.post as jest.Mock).mockResolvedValue({ data: success });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm force cancellation' }));
  await waitFor(() => expect(axiosInstance.post).toHaveBeenLastCalledWith('/bookings/42/local-actions/cancel', expect.objectContaining({ expectedUpdatedAt: '2027-01-02T00:00:00.000Z' })));
});
it('shows delivery problems after a successful correction without offering to repeat the mutation', async () => {
  (axiosInstance.post as jest.Mock).mockResolvedValue({ data: { ...success,
    notifications: { customer: { status: 'failed', reason: 'Delivery failed' }, internal: { status: 'sent' } } } });
  renderModal(); await waitFor(() => expect(screen.getByLabelText(/Reason for this force action/)).toBeEnabled());
  fireEvent.change(screen.getByLabelText(/Reason for this force action/), { target: { value: 'Reason' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm force cancellation' }));
  expect(await screen.findByText(/Customer email: failed/)).toBeInTheDocument();
  expect(screen.getByText(/Do not repeat the action to retry an email/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Confirm force cancellation' })).not.toBeInTheDocument();
});
it('does not submit on opening or abandoning the dialog', async () => {
  renderModal(); fireEvent.click(screen.getByRole('button', { name: 'Keep booking unchanged' }));
  expect(close).toHaveBeenCalled(); expect(axiosInstance.post).not.toHaveBeenCalled();
});
