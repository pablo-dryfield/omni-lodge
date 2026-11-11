import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { getBookingPaymentDetails, getBookingPaymentEvents } from '../../api/bookingPayments';
import BookingPaymentPanel from './BookingPaymentPanel';
import { paymentFixture, eventsFixture } from './__fixtures__/bookingPayments';

jest.mock('../../api/bookingPayments', () => ({ getBookingPaymentDetails: jest.fn(), getBookingPaymentEvents: jest.fn() }));
const details = getBookingPaymentDetails as jest.Mock;
const events = getBookingPaymentEvents as jest.Mock;
const panel = (active = true, bookingId = 42) => <MantineProvider><BookingPaymentPanel bookingId={bookingId} active={active} /></MantineProvider>;
beforeEach(() => {
  jest.resetAllMocks(); details.mockResolvedValue(paymentFixture); events.mockResolvedValue(eventsFixture);
  Object.defineProperty(window, 'matchMedia', { writable: true, value: jest.fn().mockImplementation(query => ({ matches: false, media: query, addEventListener: jest.fn(), removeEventListener: jest.fn(), addListener: jest.fn(), removeListener: jest.fn() })) });
  Object.defineProperty(global, 'ResizeObserver', { writable: true, value: jest.fn().mockImplementation(() => ({ observe: jest.fn(), unobserve: jest.fn(), disconnect: jest.fn() })) });
});

it('loads lazily, renders masked card details, and reuses the overview on a tab revisit', async () => {
  const { rerender } = render(panel(false)); expect(details).not.toHaveBeenCalled();
  rerender(panel());
  expect(await screen.findByText('Mastercard •••• 0858')).toBeInTheDocument();
  expect(screen.getByText(/can cover multiple bookings/)).toHaveTextContent('120.00 PLN');
  expect(screen.getByText('Partially refunded')).toBeInTheDocument();
  expect(screen.getByText('Apple Pay')).toBeInTheDocument(); expect(screen.getByText('Expires 03/2029')).toBeInTheDocument();
  await waitFor(() => expect(events).toHaveBeenCalledTimes(1));
  rerender(panel(false)); rerender(panel()); expect(details).toHaveBeenCalledTimes(1);
});

it('shows event request references without inventing an HTTP method or status', async () => {
  render(panel()); await screen.findByText('Payment succeeded');
  fireEvent.click(screen.getByRole('tab', { name: 'Logs' }));
  expect(screen.getByText('req_Original')).toHaveAttribute('href', expect.stringContaining('/logs/req_Original'));
  expect(screen.getByText('GET /v1/payment_intents/pi_One')).toBeInTheDocument();
  expect(screen.getByText(/full HTTP request logs/)).toBeInTheDocument(); expect(screen.queryByText(/POST/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Stripe events' }));
  expect(screen.getByText(/retains events for 30 days/)).toBeInTheDocument(); expect(screen.getAllByText('evt_One')).toHaveLength(2);
});

it('appends and deduplicates bounded event pages', async () => {
  events.mockResolvedValueOnce({ ...eventsFixture, hasMore: true, nextCursor: '1794401000.evt_One' }).mockResolvedValueOnce(eventsFixture);
  render(panel()); const more = await screen.findByRole('button', { name: 'Search older Stripe events' }); fireEvent.click(more);
  await waitFor(() => expect(events).toHaveBeenCalledWith(42, '1794401000.evt_One', expect.any(AbortSignal)));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Search older Stripe events' })).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole('tab', { name: 'Stripe events' })); expect(screen.getAllByText('evt_One')).toHaveLength(2); // One per responsive presentation, with no duplicate event within either.
});

it('retains the last overview when a refresh fails and permits retry', async () => {
  render(panel()); await screen.findByText('Mastercard •••• 0858'); await screen.findByText('Payment succeeded');
  details.mockRejectedValueOnce(new Error('offline')); fireEvent.click(screen.getByRole('button', { name: 'Refresh payment' }));
  expect(await screen.findByText('Refresh failed')).toBeInTheDocument(); expect(screen.getByText('Mastercard •••• 0858')).toBeInTheDocument();
});

it('displays non-Stripe saved information without requesting event history', async () => {
  details.mockResolvedValue({ ...paymentFixture, payment: null, merchant: null, state: 'not_stripe', message: 'This booking uses a bank transfer.', activity: [], requests: [] });
  render(panel()); expect(await screen.findByText('120.00 PLN')).toBeInTheDocument();
  expect(screen.getByText('This booking uses a bank transfer.')).toBeInTheDocument(); expect(events).not.toHaveBeenCalled();
});

it('offers a retry after initial failure', async () => {
  details.mockRejectedValueOnce(new Error('offline')); render(panel()); fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('Mastercard •••• 0858')).toBeInTheDocument();
});

it('returns to Activity if the payment linkage becomes unavailable while viewing events', async () => {
  render(panel()); await screen.findByText('Mastercard •••• 0858');
  await waitFor(() => expect(events).toHaveBeenCalled());
  fireEvent.click(screen.getByRole('tab', { name: 'Stripe events' }));
  details.mockResolvedValueOnce({ ...paymentFixture, payment: null, merchant: null, state: 'not_linked', message: 'No linked payment.' });
  fireEvent.click(screen.getByRole('button', { name: 'Refresh payment' }));
  await screen.findByText('No linked payment.');
  expect(screen.getByRole('tab', { name: 'Activity' })).toHaveAttribute('aria-selected', 'true');
});

it('rejects history for a payment that changed while the request was in progress', async () => {
  events.mockResolvedValue({ ...eventsFixture, paymentId: 'pi_Other' }); render(panel());
  expect(await screen.findByText(/linked Stripe payment changed/)).toBeInTheDocument();
  expect(screen.queryByText('Payment succeeded')).not.toBeInTheDocument();
});

it('ignores stale overview responses after the selected booking changes', async () => {
  let resolve!: (value: typeof paymentFixture) => void;
  details.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const { rerender } = render(panel()); rerender(panel(true, 43));
  await screen.findByText('Mastercard •••• 0858');
  await act(async () => resolve({ ...paymentFixture, payment: null, message: 'STALE' }));
  expect(screen.queryByText('STALE')).not.toBeInTheDocument();
});
