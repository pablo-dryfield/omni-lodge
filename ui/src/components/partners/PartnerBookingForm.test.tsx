import { fireEvent, render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { PartnerBookingForm } from './PartnerBookingForm';
import { partnerApi, type PartnerOverview } from '../../api/partners';
jest.mock('../../api/partners', () => ({ partnerApi: { post: jest.fn() }, partnerError: () => 'Request rejected', paymentLabel: (value: string) => value, formatPartnerMoney: (value: number) => `PLN ${value.toFixed(2)}` }));
const overview = { partner: { id: 9, agreement: { paymentModes: ['platform', 'partner', 'arrival'] } }, catalog: [{ id: 28, name: 'Pub Crawl', config: { startTimes: ['17:00', '19:30'], minParticipants: 1, maxParticipants: 50 }, addons: [] }], offerings: [] } as unknown as PartnerOverview;
beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(window, 'matchMedia', { writable: true, value: jest.fn().mockImplementation(() => ({ matches: false, addEventListener: jest.fn(), removeEventListener: jest.fn(), addListener: jest.fn(), removeListener: jest.fn() })) });
  Object.defineProperty(global, 'crypto', { configurable: true, value: { randomUUID: () => 'test-reference' } });
  Object.defineProperty(global, 'ResizeObserver', { configurable: true, value: jest.fn().mockImplementation(() => ({ observe: jest.fn(), unobserve: jest.fn(), disconnect: jest.fn() })) });
});
const show = (data = overview) => render(<MantineProvider><PartnerBookingForm overview={data} onCreated={jest.fn()} /></MantineProvider>);
it('shows a useful empty state without allowing unauthorized product selection', () => {
  show({ ...overview, catalog: [] });
  expect(screen.getByText('No products assigned')).toBeInTheDocument();
  expect(screen.queryByText('Confirm booking')).not.toBeInTheDocument();
});
it('explains a paused booking system without offering a new payment link', () => {
  show({ ...overview, bookingsEnabled: false });
  expect(screen.getByText('Partner bookings paused')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Create payment link' })).not.toBeInTheDocument();
});
it('adds independent experience lines and removes only the selected line', () => {
  show();
  fireEvent.click(screen.getByRole('button', { name: 'Experience' }));
  expect(screen.getByText('Experience 2')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Remove experience 1' }));
  expect(screen.queryByText('Experience 2')).not.toBeInTheDocument();
});
it('uses the group-approval flow without claiming a confirmed booking', () => {
  show();
  fireEvent.click(screen.getByLabelText('Submit as a group request for management approval'));
  expect(screen.getByRole('button', { name: 'Submit group request' })).toBeInTheDocument();
});
it('displays a server rejection without showing a success state', async () => {
  (partnerApi.post as jest.Mock).mockRejectedValue(new Error('Forbidden'));
  show();
  fireEvent.click(screen.getByRole('button', { name: 'Check price' }));
  expect(await screen.findByText('Request rejected')).toBeInTheDocument();
  expect(screen.queryByText('Booking created')).not.toBeInTheDocument();
});
it('renders the authoritative server quote instead of calculating a client price', async () => {
  (partnerApi.post as jest.Mock).mockResolvedValue({ total: 193.45, items: [{ productName: 'Pub Crawl', quantity: 2, total: 193.45 }] });
  show();
  fireEvent.click(screen.getByRole('button', { name: 'Check price' }));
  expect(await screen.findByRole('heading', { name: 'PLN 193.45' })).toBeInTheDocument();
});
it('keeps separate quantities for mixed add-on sizes', async () => {
  (partnerApi.post as jest.Mock).mockResolvedValue({ total: 180, items: [] });
  show({ ...overview, catalog: [{ ...overview.catalog[0], addons: [{ id: 8, name: 'T-Shirts', price: { amount: 40 }, config: {}, inventory: { variantSelectionRequired: true, variants: [{ value: 'M', label: 'Medium', inStock: true }, { value: 'L', label: 'Large', inStock: true }] } }] }] });
  fireEvent.change(screen.getByLabelText('Medium'), { target: { value: '1' } });
  fireEvent.change(screen.getByLabelText('Large'), { target: { value: '1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Check price' }));
  expect(await screen.findByRole('heading', { name: 'PLN 180.00' })).toBeInTheDocument();
  expect(partnerApi.post).toHaveBeenCalledWith(9, 'quote', expect.objectContaining({ items: [expect.objectContaining({ addons: [{ addonId: 8, quantity: 2, variants: [{ value: 'M', quantity: 1 }, { value: 'L', quantity: 1 }] }] })] }));
});
it('submits full amendment selections with the notification preference and stable reference', async () => {
  const created = jest.fn();
  (partnerApi.post as jest.Mock).mockResolvedValueOnce({ total: 300, items: [{ productName: 'Pub Crawl', quantity: 3, total: 300 }] }).mockResolvedValueOnce({ id: 77, status: 'pending_payment', checkoutUrl: 'https://checkout.stripe.com/example' });
  render(<MantineProvider><PartnerBookingForm overview={overview} onCreated={created} amending={{ id: 22, reference: 'original', customer: { firstName: 'Alex', lastName: 'Morgan', email: 'customer@example.com' }, items: [{ productId: 28, quantity: 2, experienceDate: '2027-03-10', experienceTime: '17:00' }], paymentMode: 'platform' } as any} /></MantineProvider>);
  fireEvent.change(screen.getByLabelText(/^Guests/), { target: { value: '3' } });
  fireEvent.change(screen.getByLabelText(/^Reason for amendment/), { target: { value: 'Customer added a guest' } });
  fireEvent.click(screen.getByLabelText('Notify the customer by email'));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm amendment' }));
  expect(await screen.findByText('Amendment submitted')).toBeInTheDocument();
  expect(partnerApi.post).toHaveBeenNthCalledWith(1, 9, 'bookings/22/amend/quote', expect.objectContaining({ items: [expect.objectContaining({ quantity: 3 })] }));
  expect(partnerApi.post).toHaveBeenNthCalledWith(2, 9, 'bookings/22/amend', expect.objectContaining({ reference: 'test-reference', notifyCustomer: false, reason: 'Customer added a guest', items: [expect.objectContaining({ quantity: 3 })] }));
  expect(created).toHaveBeenCalledTimes(1);
});
