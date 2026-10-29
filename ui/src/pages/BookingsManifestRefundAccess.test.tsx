import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import BookingsManifestPage from './BookingsManifestPage';
import axiosInstance from '../utils/axiosInstance';
import type { RootState } from '../store/store';
import type { UnifiedOrder } from '../store/bookingPlatformsTypes';

let mockRoleSlug = 'food-tour-manager';
let mockCanUpdate = true;
let mockProductScope: number[] | null = [3];
const mockDispatch = jest.fn();
jest.mock('../store/hooks', () => ({
  useAppDispatch: () => mockDispatch,
  useAppSelector: (selector: (state: RootState) => unknown) => selector({
    session: { roleSlug: mockRoleSlug }, accessControl: { productTypeIds: mockProductScope },
  } as RootState),
}));
jest.mock('../hooks/useModuleAccess', () => ({
  useModuleAccess: () => ({ ready: true, loading: false, canView: true, canCreate: false, canUpdate: mockCanUpdate, canDelete: false }),
}));
jest.mock('../components/access/PageAccessGuard', () => ({ PageAccessGuard: ({ children }: { children: ReactNode }) => children }));
jest.mock('@mui/icons-material', () => ({
  Checkroom: () => null, LocalBar: () => null, MailOutline: () => null, PhotoCamera: () => null, WhatsApp: () => null,
}));
jest.mock('@mantine/hooks', () => ({ ...jest.requireActual('@mantine/hooks'), useMediaQuery: () => false }));
jest.mock('../utils/axiosInstance', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn() } }));
jest.mock('../components/bookings/BookingDetailsModal', () => ({
  __esModule: true, default: () => null, getBookingIdFromOrder: (order: UnifiedOrder) => order.rawData.bookingId,
}));

const extras = { cocktails: 0, tshirts: 0, photos: 0 };
const order = (fields: Partial<UnifiedOrder> = {}): UnifiedOrder => ({
  id: 'booking-test', platformBookingId: 'ftk_test', platform: 'direct', rawData: { bookingId: 99 },
  productId: 'food-tour', productName: 'Food Tour Krakow', date: '2027-01-10', timeslot: '14:00',
  quantity: 1, menCount: 0, womenCount: 0, customerName: 'Test Guest', customerEmail: 'guest@example.test',
  status: 'confirmed', paymentStatus: 'paid', paymentMethod: 'stripe', extras, ...fields,
});
const preview = {
  bookingId: 99, orderId: 'pi_test', refundAvailable: true, remainingAmount: 32900,
  stripe: { id: 'pi_test', type: 'payment_intent', amount: 32900, amountRefunded: 0, currency: 'pln', status: 'succeeded' },
  people: { quantity: 1, unitPrice: '329.00', totalPrice: '329.00', currency: 'PLN' }, addons: [],
};
const openBookingActions = async (booking = order(), refundPreview = preview) => {
  (axiosInstance.get as jest.Mock).mockImplementation(async (url: string) => {
    if (url.endsWith('/partial-refund-preview')) return { data: refundPreview };
    return { data: { manifest: [{
      productId: booking.productId, productName: booking.productName, date: booking.date, time: booking.timeslot,
      totalPeople: 1, men: 0, women: 0, extras, orders: [booking], platformBreakdown: [],
    }] } };
  });
  render(<MemoryRouter initialEntries={['/bookings/manifest?date=2027-01-10']}>
    <MantineProvider theme={{ components: { Modal: { defaultProps: { transitionProps: { duration: 0 } } } } }}>
      <BookingsManifestPage title="Bookings Manifest" />
    </MantineProvider>
  </MemoryRouter>);
  await act(async () => { await Promise.resolve(); });
  fireEvent.click(await screen.findByRole('button', { name: 'Actions', exact: true }));
  return screen.findByRole('dialog', { name: 'Actions - Test Guest' });
};
const openFullRefund = async (revokeBeforeSubmit = false) => {
  fireEvent.click(screen.getByRole('button', { name: 'Partial Refund', exact: true }));
  const unlock = await screen.findByRole('button', { name: 'Unlock refund amount editing' });
  await waitFor(() => expect(unlock).toBeEnabled());
  if (revokeBeforeSubmit) mockCanUpdate = false;
  fireEvent.click(unlock);
  fireEvent.change(screen.getByRole('textbox', { name: /Refund amount/ }), { target: { value: '329' } });
  const proceed = await screen.findByRole('button', { name: 'Proceed to Cancel', exact: true });
  expect(proceed).toBeEnabled();
  fireEvent.click(proceed);
};

beforeEach(() => {
  jest.clearAllMocks(); mockRoleSlug = 'food-tour-manager'; mockCanUpdate = true; mockProductScope = [3];
  (axiosInstance.post as jest.Mock).mockResolvedValue({ data: {} });
  jest.spyOn(window, 'confirm').mockReturnValue(true);
  jest.spyOn(window, 'alert').mockImplementation(() => undefined);
  Object.defineProperty(window, 'matchMedia', { writable: true, value: jest.fn(query => ({
    matches: false, media: query, onchange: null, addListener: jest.fn(), removeListener: jest.fn(),
    addEventListener: jest.fn(), removeEventListener: jest.fn(), dispatchEvent: jest.fn(),
  })) });
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
});
afterEach(() => jest.restoreAllMocks());

it.each(['viator', 'getyourguide', 'rezdy', 'fareharbor', 'freetour', 'airbnb', 'xperiencepoland', 'civitatis'])(
  'offers clearly distinguished force actions for external platform %s', async platform => {
    const actions = await openBookingActions(order({ platform }));
    expect(within(actions).getByRole('button', { name: 'Force amend' })).toBeEnabled();
    expect(within(actions).getByRole('button', { name: 'Force cancel' })).toBeEnabled();
    expect(within(actions).queryByRole('button', { name: 'Cancel', exact: true })).not.toBeInTheDocument();
    expect(axiosInstance.post).not.toHaveBeenCalled();
  },
);
it.each(['food-tour-guide', 'assistant-manager', 'unrelated-role'])('does not expose privileged local actions to scoped %s', async role => {
  mockRoleSlug = role;
  const actions = await openBookingActions(order({ platform: 'viator' }));
  expect(within(actions).queryByRole('button', { name: 'Force cancel' })).not.toBeInTheDocument();
  expect(within(actions).queryByRole('button', { name: 'Force amend' })).not.toBeInTheDocument();
});
it('retains integrated Ecwid controls alongside the explicit local correction controls for global managers', async () => {
  mockRoleSlug = 'manager'; mockProductScope = null;
  const actions = await openBookingActions(order({ platform: 'ecwid' }));
  for (const name of ['Force amend', 'Force cancel', 'Amend', 'Cancel']) {
    expect(within(actions).getByRole('button', { name, exact: true })).toBeEnabled();
  }
  expect(axiosInstance.post).not.toHaveBeenCalled();
});

it.each(['food-tour-owner', 'food-tour-manager'])('shows Cancel for %s on an eligible Direct booking', async role => {
  mockRoleSlug = role;
  const actions = await openBookingActions();
  expect(within(actions).getByRole('button', { name: 'Cancel', exact: true })).toBeEnabled();
  expect(within(actions).getByRole('button', { name: 'Partial Refund' })).toBeEnabled();
  expect(axiosInstance.post).not.toHaveBeenCalled();
});
it.each(['food-tour-owner', 'food-tour-manager'])('shows Cancel for %s on an eligible OmniLodge booking', async role => {
  mockRoleSlug = role;
  const actions = await openBookingActions(order({ platform: 'omnilodge' }));
  expect(within(actions).getByRole('button', { name: 'Cancel', exact: true })).toBeEnabled();
});
it('hands a full Direct refund to cancellation instead of posting a partial refund', async () => {
  await openBookingActions(); await openFullRefund();
  await waitFor(() => expect(axiosInstance.post).toHaveBeenCalledWith('/bookings/99/direct-actions/cancellation'));
  expect((axiosInstance.post as jest.Mock).mock.calls).toHaveLength(1);
});
it('opens the storefront cancellation confirmation for a full refund without submitting it prematurely', async () => {
  await openBookingActions(order({ platform: 'omnilodge' })); await openFullRefund();
  expect(await screen.findByRole('dialog', { name: 'Cancel booking ftk_test' })).toBeInTheDocument();
  expect(axiosInstance.post).not.toHaveBeenCalled();
});
it('previews the selected booking refund amount in its email, not the entire mixed-product charge', async () => {
  const actions = await openBookingActions(order({ platform: 'omnilodge' }), {
    ...preview, remainingAmount: 24900,
    stripe: { ...preview.stripe, amount: 70000, amountRefunded: 5000 },
  });
  fireEvent.click(within(actions).getByRole('button', { name: 'Cancel', exact: true }));
  const confirmation = await screen.findByRole('dialog', { name: 'Cancel booking ftk_test' });
  expect(await within(confirmation).findByText('Refund for this booking')).toBeInTheDocument();
  const emailButton = within(confirmation).getByRole('button', { name: 'Preview Email' });
  await waitFor(() => expect(emailButton).toBeEnabled());
  fireEvent.click(emailButton);
  await waitFor(() => expect(axiosInstance.post).toHaveBeenCalledWith('/bookings/emails/render-preview',
    expect.objectContaining({ templateContext: expect.objectContaining({ refundedAmount: 249 }) }), expect.anything()));
  expect((axiosInstance.post as jest.Mock).mock.calls.every(call => call[0] === '/bookings/emails/render-preview')).toBe(true);
});
it('keeps the refund modal open and explains missing cancellation authority instead of silently exiting', async () => {
  await openBookingActions();
  await openFullRefund(true);
  expect(await screen.findByText(/A full refund cancels the booking. Your current account/)).toBeInTheDocument();
  expect(window.confirm).not.toHaveBeenCalled();
  expect(axiosInstance.post).not.toHaveBeenCalled();
});
it.each(['food-tour-guide', 'unrelated-role'])('does not offer refund controls to scoped %s', async role => {
  mockRoleSlug = role;
  const actions = await openBookingActions();
  expect(within(actions).queryByRole('button', { name: 'Cancel', exact: true })).not.toBeInTheDocument();
  expect(within(actions).queryByRole('button', { name: 'Partial Refund', exact: true })).not.toBeInTheDocument();
});
it('uses the Direct cancellation path for a scoped Food Tour product regardless of its display title', async () => {
  await openBookingActions(order({ productName: 'Late Night Bites' })); await openFullRefund();
  await waitFor(() => expect(axiosInstance.post).toHaveBeenCalledWith('/bookings/99/direct-actions/cancellation'));
});
it.each([{ paymentMethod: 'bank_transfer' }, { paymentStatus: 'unpaid' }, { platform: 'viator' }])(
  'retains payment and platform restrictions %j', async fields => {
    const actions = await openBookingActions(order(fields));
    expect(within(actions).queryByRole('button', { name: 'Cancel', exact: true })).not.toBeInTheDocument();
    expect(within(actions).queryByRole('button', { name: 'Partial Refund' })).not.toBeInTheDocument();
  },
);
