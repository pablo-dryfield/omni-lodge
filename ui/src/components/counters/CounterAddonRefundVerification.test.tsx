import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import CounterAddonRefundVerificationPanel from './CounterAddonRefundVerification';
import { counterAddonRefund, type CounterAddonRefundResult, type CounterAddonRefundVerification } from '../../api/counterAddonRefunds';

jest.mock('../../api/counterAddonRefunds', () => ({ counterAddonRefund: jest.fn() }));
const expectedExtras = { cocktails: 3, photos: 0, tshirts: 0 };
const extras = { cocktails: 2 };
const verification: CounterAddonRefundVerification = {
  status: 'verified', selectionKey: 'selection', amount: 8000, currency: 'PLN', bookingAmount: 30000,
  refundedAmount: 8000, availableRefundAmount: 8000,
  message: 'Stripe confirms a previous successful partial refund covers these add-ons.',
  refunds: [{ id: 're_previous', amount: 8000, status: 'succeeded', created: 1800000000 }], addons: [],
};
const result = (value: CounterAddonRefundVerification, applied = false): CounterAddonRefundResult => ({
  bookingId: 21, applied, verification: value, metricsUpdated: true, order: null,
});

beforeEach(() => jest.resetAllMocks());

it('only queries Stripe when Verify is clicked and shows the existing refund', async () => {
  (counterAddonRefund as jest.Mock).mockResolvedValue(result(verification));
  render(<CounterAddonRefundVerificationPanel bookingId={21} extras={extras} expectedExtras={expectedExtras} onRectified={jest.fn()} />);
  expect(counterAddonRefund).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
  await screen.findByRole('button', { name: 'Rectify the booking' });
  expect(screen.getByText(/re_previous: 80.00 PLN/)).toBeInTheDocument();
  expect(counterAddonRefund).toHaveBeenCalledWith(21, 'verify', { cocktails: 2, photos: 0, tshirts: 0 }, undefined, expectedExtras);
});

it('rectifies against the verified selection without issuing another refund', async () => {
  const onRectified = jest.fn();
  const applied = { ...result(verification, true), order: { id: '21' } };
  (counterAddonRefund as jest.Mock).mockResolvedValueOnce(result(verification)).mockResolvedValueOnce(applied);
  render(<CounterAddonRefundVerificationPanel bookingId={21} extras={extras} expectedExtras={expectedExtras} autoVerify onRectified={onRectified} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Rectify the booking' }));
  await waitFor(() => expect(onRectified).toHaveBeenCalledWith(applied));
  expect(counterAddonRefund).toHaveBeenLastCalledWith(21, 'rectify', { cocktails: 2, photos: 0, tshirts: 0 }, 'selection', expectedExtras);
  expect((counterAddonRefund as jest.Mock).mock.calls.some((call) => call[1] === 'refund')).toBe(false);
});

it.each(['pending', 'insufficient', 'full_refund', 'manual_review'] as const)('does not enable rectification for %s evidence', async (status) => {
  (counterAddonRefund as jest.Mock).mockResolvedValue(result({ ...verification, status, message: `Stripe status: ${status}` }));
  render(<CounterAddonRefundVerificationPanel bookingId={21} extras={extras} expectedExtras={expectedExtras} autoVerify onRectified={jest.fn()} />);
  await screen.findByText(`Stripe status: ${status}`);
  expect(screen.queryByRole('button', { name: 'Rectify the booking' })).not.toBeInTheDocument();
});

it('keeps refund authorization empty after a Stripe lookup failure', async () => {
  const onVerificationChange = jest.fn();
  (counterAddonRefund as jest.Mock).mockRejectedValue(new Error('Network failed'));
  render(<CounterAddonRefundVerificationPanel bookingId={21} extras={extras} expectedExtras={expectedExtras} autoVerify onRectified={jest.fn()} onVerificationChange={onVerificationChange} />);
  await screen.findByText(/Refund controls remain blocked/);
  expect(onVerificationChange).toHaveBeenLastCalledWith(null);
  expect(screen.queryByRole('button', { name: 'Rectify the booking' })).not.toBeInTheDocument();
});

it('discards evidence from a previous booking after the selected customer changes', async () => {
  let finishOldRequest!: (value: CounterAddonRefundResult) => void;
  (counterAddonRefund as jest.Mock).mockImplementationOnce(() => new Promise((resolve) => { finishOldRequest = resolve; }))
    .mockResolvedValueOnce(result({ ...verification, status: 'clear', message: 'Current booking has no refund.' }));
  const { rerender } = render(<CounterAddonRefundVerificationPanel bookingId={21} extras={extras} expectedExtras={expectedExtras} autoVerify onRectified={jest.fn()} />);
  await waitFor(() => expect(counterAddonRefund).toHaveBeenCalledTimes(1));
  rerender(<CounterAddonRefundVerificationPanel bookingId={22} extras={extras} expectedExtras={expectedExtras} autoVerify onRectified={jest.fn()} />);
  await screen.findByText('Current booking has no refund.');
  finishOldRequest(result(verification));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Rectify the booking' })).not.toBeInTheDocument());
});
