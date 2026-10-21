import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import type { ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import BookingsPage from './BookingsPage';
import BookingsManifestPage from './BookingsManifestPage';
import axiosInstance from '../utils/axiosInstance';
import type { RootState } from '../store/store';

let mockRoleSlug: string | null = 'food-tour-owner';
let mockProductTypeIds = [3];
let mockIsMobile = false;
const mockDispatch = jest.fn();
const mockSanityMount = jest.fn();

jest.mock('../store/hooks', () => ({
  useAppDispatch: () => mockDispatch,
  useAppSelector: (selector: (state: RootState) => unknown) => selector({
    session: { roleSlug: mockRoleSlug },
    accessControl: { productTypeIds: mockProductTypeIds },
  } as RootState),
}));
jest.mock('../hooks/useModuleAccess', () => ({
  useModuleAccess: () => ({ ready: true, loading: false, canView: true, canCreate: false, canUpdate: false, canDelete: false }),
}));
jest.mock('../components/access/PageAccessGuard', () => ({
  PageAccessGuard: ({ children }: { children: ReactNode }) => children,
}));
jest.mock('@mantine/hooks', () => ({
  ...jest.requireActual('@mantine/hooks'),
  useMediaQuery: () => mockIsMobile,
}));
jest.mock('../utils/axiosInstance', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn() } }));
jest.mock('../components/BookingsGrid', () => ({ BookingsGrid: () => null }));
jest.mock('../components/bookings/BookingsSummaryWorkspace', () => ({ __esModule: true, default: () => null }));
jest.mock('../components/bookings/BookingDetailsModal', () => ({
  __esModule: true, default: () => null, getBookingIdFromOrder: () => null,
}));
jest.mock('../components/bookings/BookingsSanityCheck', () => ({
  __esModule: true,
  default: () => { mockSanityMount(); return <div data-testid="sanity-content">Company-wide diagnostics</div>; },
}));

const LocationProbe = () => <output data-testid="location">{useLocation().search}</output>;
const page = (manifest: boolean, entry = manifest ? '/bookings/manifest' : '/bookings') => (
  <MemoryRouter initialEntries={[entry]}>
    <MantineProvider>
      {manifest ? <BookingsManifestPage title="Bookings Manifest" /> : <BookingsPage title="Bookings" />}
      <LocationProbe />
    </MantineProvider>
  </MemoryRouter>
);

const renderPage = async (manifest: boolean, entry?: string) => {
  const view = render(page(manifest, entry));
  await act(async () => { await Promise.resolve(); });
  return view;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockRoleSlug = 'food-tour-owner';
  mockProductTypeIds = [3];
  mockIsMobile = false;
  (axiosInstance.get as jest.Mock).mockResolvedValue({
    data: { products: [], orders: [], manifest: [], summary: { totalPeople: 0, men: 0, women: 0 } },
  });
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: jest.fn().mockImplementation((query: string) => ({
      matches: false, media: query, onchange: null,
      addListener: jest.fn(), removeListener: jest.fn(),
      addEventListener: jest.fn(), removeEventListener: jest.fn(), dispatchEvent: jest.fn(),
    })),
  });
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
});

describe.each([false, true])('booking navigation (manifest=%s)', manifest => {
  describe.each([false, true])('mobile=%s', mobile => {
    it.each(['food-tour-owner', 'manager'])('hides Sanity Check from %s', async role => {
      mockRoleSlug = role;
      mockProductTypeIds = role === 'food-tour-owner' ? [3] : [];
      mockIsMobile = mobile;
      await renderPage(manifest);
      if (mobile) fireEvent.click(await screen.findByRole('button', { name: manifest ? 'Manifest' : 'Calendar', exact: true }));
      await screen.findByText(manifest ? 'No active bookings found for the selected date.' : 'No bookings match the current filters.');
      expect(screen.queryByText('Sanity Check')).not.toBeInTheDocument();
      expect(mockSanityMount).not.toHaveBeenCalled();
    });

    it.each(['admin', 'owner'])('shows Sanity Check to %s', async role => {
      mockRoleSlug = role;
      mockProductTypeIds = [];
      mockIsMobile = mobile;
      await renderPage(manifest);
      if (mobile) fireEvent.click(await screen.findByRole('button', { name: manifest ? 'Manifest' : 'Calendar', exact: true }));
      expect(await screen.findByText('Sanity Check')).toBeInTheDocument();
    });
  });
});

it.each(['food-tour-owner', 'manager', null])('does not mount diagnostics for a crafted URL as %s', async role => {
  mockRoleSlug = role;
  mockProductTypeIds = role === 'food-tour-owner' ? [3] : [];
  await renderPage(false, '/bookings?tab=sanity');
  await screen.findByText('No bookings match the current filters.');
  expect(mockSanityMount).not.toHaveBeenCalled();
  expect(screen.queryByTestId('sanity-content')).not.toBeInTheDocument();
});

it('lets an administrator open diagnostics directly', async () => {
  mockRoleSlug = 'administrator';
  mockProductTypeIds = [];
  await renderPage(false, '/bookings?tab=sanity');
  expect(await screen.findByTestId('sanity-content')).toBeInTheDocument();
});

it('unmounts diagnostics if the active session loses the global role', async () => {
  mockRoleSlug = 'owner';
  mockProductTypeIds = [];
  const view = await renderPage(false, '/bookings?tab=sanity');
  expect(await screen.findByTestId('sanity-content')).toBeInTheDocument();
  mockRoleSlug = 'food-tour-owner';
  mockProductTypeIds = [3];
  view.rerender(page(false, '/bookings?tab=sanity'));
  await act(async () => { await Promise.resolve(); });
  await waitFor(() => expect(screen.queryByTestId('sanity-content')).not.toBeInTheDocument());
});
