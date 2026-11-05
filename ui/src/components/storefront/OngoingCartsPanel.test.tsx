import { MantineProvider } from '@mantine/core';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import OngoingCartsPanel from './OngoingCartsPanel';
import type { OngoingCart, OngoingCartPage } from '../../types/storefrontOngoingCarts';

const mockGet = jest.fn();
let mockMobile = false;
jest.mock('../../utils/axiosInstance', () => ({ __esModule: true, default: { get: (...args: unknown[]) => mockGet(...args) } }));
jest.mock('@mantine/hooks', () => ({ ...jest.requireActual('@mantine/hooks'), useMediaQuery: () => mockMobile }));

class TestResizeObserver implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
global.ResizeObserver = TestResizeObserver;

const cart: OngoingCart = {
  publicId: 'cart-one', status: 'active', customer: { fullName: 'Ada Guest', email: 'ada@example.com', phoneCountry: 'GB', phone: '7700900123' },
  quote: { items: [{ productId: 28, productName: 'Pub Crawl', quantity: 2, experienceDate: '2026-11-10', experienceTime: '21:00', addons: [], options: {} }] },
  total: 200, currency: 'PLN', lastActivityAt: '2026-11-05T10:00:00.000Z', recoveryDueAt: '2026-11-05T11:00:00.000Z',
  recoverySentAt: null, firstRecoverySentAt: null, lastRecoverySentAt: null, recoveryOpenedAt: null, recoveredAt: null,
  recoveryCount: 0, createdAt: '2026-11-05T09:00:00.000Z', orderPublicId: null, events: [],
};
const result = (page = 1, pageSize = 25, total = 301): OngoingCartPage => ({
  data: total ? [{ ...cart, publicId: `cart-${page}`, customer: { ...cart.customer, fullName: `Guest page ${page}` } }] : [],
  pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
  summary: { total, checkoutStarted: 180, recoverySent: 120, recoveryOpened: 45 },
  filters: { products: [{ value: '28', label: 'Pub Crawl' }], countries: ['GB', 'PL'], currencies: ['PLN', 'EUR'] },
});
const LocationProbe = () => <output data-testid="query">{useLocation().search}</output>;
const panel = (revision = 0) => <OngoingCartsPanel revision={revision} renderCustomer={entry => <span>{entry.customer.fullName}</span>} renderExperiences={entry => <span>{entry.quote.items[0].productName}</span>} renderActions={() => <button type="button">View activity</button>} />;
const renderPanel = (entry = '/bookings/payment-links?tab=ongoing', revision = 0) => render(
  <MemoryRouter initialEntries={[entry]}><MantineProvider>{panel(revision)}<LocationProbe /></MantineProvider></MemoryRouter>,
);
const latestParams = () => mockGet.mock.calls[mockGet.mock.calls.length - 1][1].params;
const choose = async (label: string, option: string) => {
  fireEvent.click(await screen.findByRole('textbox', { name: label }));
  fireEvent.click(await screen.findByRole('option', { name: option }));
};

describe('Ongoing carts browsing', () => {
  beforeEach(() => {
    window.matchMedia = jest.fn().mockImplementation(query => ({ matches: false, media: query, addEventListener: jest.fn(), removeEventListener: jest.fn(), addListener: jest.fn(), removeListener: jest.fn() }));
    mockMobile = false;
    mockGet.mockReset().mockImplementation((_url, options) => Promise.resolve({ data: result(Number(options.params.page), Number(options.params.pageSize)) }));
    Element.prototype.scrollIntoView = jest.fn();
  });

  it('shows full-result counts while fetching only one page, then navigates without snapping back', async () => {
    renderPanel();
    expect(await screen.findByText('Guest page 1')).toBeInTheDocument();
    expect(latestParams()).toMatchObject({ page: 1, pageSize: '25', sort: 'activity_desc' });
    expect(screen.getByText('301')).toBeInTheDocument();
    expect(screen.getByText('180')).toBeInTheDocument();
    expect(screen.getByText(/Showing 1–25 of 301 carts/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(await screen.findByText('Guest page 2')).toBeInTheDocument();
    expect(latestParams().page).toBe(2);
    expect(screen.getByTestId('query')).toHaveTextContent('cartPage=2');
    expect(screen.queryByText('Guest page 1')).not.toBeInTheDocument();
  });

  it('combines search, status, product and dates only after Apply and preserves unrelated URL state', async () => {
    renderPanel('/bookings/payment-links?tab=ongoing&keep=example&cartPage=3');
    await screen.findByText('Guest page 3');
    fireEvent.change(screen.getByLabelText('Search carts'), { target: { value: 'Ada' } });
    await choose('Status', 'Checkout started');
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    await choose('Product', 'Pub Crawl');
    fireEvent.change(screen.getByLabelText('Experience from'), { target: { value: '2026-11-01' } });
    fireEvent.change(screen.getByLabelText('Experience to'), { target: { value: '2026-11-30' } });
    expect(mockGet).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(latestParams()).toMatchObject({ page: 1, search: 'Ada', status: 'checkout_started', productId: '28', experienceFrom: '2026-11-01', experienceTo: '2026-11-30' }));
    await screen.findByText('Guest page 1');
    const query = new URLSearchParams(screen.getByTestId('query').textContent || '');
    expect(query.get('tab')).toBe('ongoing');
    expect(query.get('keep')).toBe('example');
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(latestParams()).toMatchObject({ search: '', status: '', productId: '', experienceFrom: '', experienceTo: '' }));
  });

  it('resets pagination when sorting or changing page size', async () => {
    renderPanel('/bookings/payment-links?tab=ongoing&cartPage=3');
    await screen.findByText('Guest page 3');
    fireEvent.click(screen.getByRole('button', { name: 'Sort by Customer' }));
    await waitFor(() => expect(latestParams()).toMatchObject({ sort: 'customer_asc', page: 1 }));
    await screen.findByText('Guest page 1');
    expect(screen.getByRole('columnheader', { name: /Customer/ })).toHaveAttribute('aria-sort', 'ascending');
    await choose('Carts per page', '50 per page');
    await waitFor(() => expect(latestParams()).toMatchObject({ pageSize: '50', page: 1 }));
  });

  it('rejects inverted dates and requires currency for amount filters', async () => {
    renderPanel();
    await screen.findByText('Guest page 1');
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    expect(screen.getByLabelText('Minimum amount')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Experience from'), { target: { value: '2026-11-30' } });
    fireEvent.change(screen.getByLabelText('Experience to'), { target: { value: '2026-11-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(screen.getByText('Start date cannot be after end date.')).toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledTimes(1);
    await choose('Currency', 'PLN');
    expect(screen.getByLabelText('Minimum amount')).toBeEnabled();
  });

  it('ignores stale responses when the page changes', async () => {
    let resolveOld!: (value: { data: OngoingCartPage }) => void;
    mockGet.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
    renderPanel();
    const initialSignal = mockGet.mock.calls[0][1].signal;
    fireEvent.change(screen.getByLabelText('Search carts'), { target: { value: 'new search' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await screen.findByText('Guest page 1');
    await act(async () => { resolveOld({ data: result(9) }); });
    expect(initialSignal.aborted).toBe(true);
    expect(screen.queryByText('Guest page 9')).not.toBeInTheDocument();
    expect(latestParams().search).toBe('new search');
  });

  it('clamps a stale page after removal without trapping the user there', async () => {
    mockGet.mockImplementation((_url, options) => Promise.resolve({ data: result(1, Number(options.params.pageSize), 24) }));
    renderPanel('/bookings/payment-links?tab=ongoing&cartPage=2');
    await screen.findByText('Guest page 1');
    await waitFor(() => expect(new URLSearchParams(screen.getByTestId('query').textContent || '').get('cartPage')).toBe('1'));
    expect(latestParams().page).toBe(1);
  });

  it('keeps existing actions in mobile cards and provides an accessible retry after a failure', async () => {
    mockMobile = true;
    mockGet.mockRejectedValueOnce(new Error('Connection lost'));
    renderPanel();
    expect(await screen.findByText('Connection lost')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText('Guest page 1');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View activity' })).toBeInTheDocument();
    expect(within(screen.getByLabelText('Ongoing carts browser')).getByText('Pub Crawl')).toBeInTheDocument();
  });
});
