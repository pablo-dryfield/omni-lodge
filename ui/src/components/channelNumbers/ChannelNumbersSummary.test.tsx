import { MantineProvider } from '@mantine/core';
import type { ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';

import {
  fetchChannelNumbersBootstrap,
  fetchChannelNumbersDetails,
} from '../../api/channelNumbers';
import type {
  ChannelNumbersSummary as ChannelNumbersSummaryType,
} from '../../types/channelNumbers/ChannelNumbersSummary';
import ChannelNumbersSummary from './ChannelNumbersSummary';

const mockDispatch = jest.fn();

jest.mock('../../api/channelNumbers', () => ({
  fetchChannelNumbersBootstrap: jest.fn(),
  fetchChannelNumbersDetails: jest.fn(),
  recordChannelCashCollection: jest.fn(),
}));

jest.mock('../../store/hooks', () => ({
  useAppDispatch: () => mockDispatch,
  useAppSelector: () => ({ data: [] }),
}));

jest.mock('../../actions/financeActions', () => ({
  createFinanceTransaction: jest.fn(),
}));

jest.mock('recharts', () => ({
  ...jest.requireActual('recharts'),
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

const mockedFetchBootstrap = fetchChannelNumbersBootstrap as jest.MockedFunction<
  typeof fetchChannelNumbersBootstrap
>;
const mockedFetchDetails = fetchChannelNumbersDetails as jest.MockedFunction<
  typeof fetchChannelNumbersDetails
>;

const summaryWithProductTypes: ChannelNumbersSummaryType = {
  startDate: '2026-08-01',
  endDate: '2026-08-31',
  channels: [
    {
      channelId: 1,
      channelName: 'Storefront',
      normal: 105,
      normalNonShow: 0,
      addons: {},
      addonNonShow: {},
      total: 105,
      products: {
        '10': {
          productId: 10,
          normal: 2,
          nonShow: 0,
          addons: {},
          addonNonShow: {},
          total: 2,
        },
        '20': {
          productId: 20,
          normal: 3,
          nonShow: 0,
          addons: {},
          addonNonShow: {},
          total: 3,
        },
        '30': {
          productId: 30,
          normal: 100,
          nonShow: 0,
          addons: {},
          addonNonShow: {},
          total: 100,
        },
      },
    },
  ],
  addons: [],
  productTypes: [
    { id: 1, name: 'Main Product' },
    { id: 2, name: 'Activities' },
    { id: 3, name: 'Food Tour Krakow' },
  ],
  products: [
    {
      id: 10,
      name: 'Pub Crawl',
      productTypeId: 1,
      productTypeName: 'Main Product',
      addonKeys: [],
    },
    {
      id: 20,
      name: 'Boat Party',
      productTypeId: 2,
      productTypeName: 'Activities',
      addonKeys: [],
    },
    {
      id: 30,
      name: 'Food Tour Krakow',
      productTypeId: 3,
      productTypeName: 'Food Tour Krakow',
      addonKeys: [],
    },
  ],
  productTotals: {
    '10': {
      productId: 10,
      normal: 2,
      nonShow: 0,
      addons: {},
      addonNonShow: {},
      total: 2,
    },
    '20': {
      productId: 20,
      normal: 3,
      nonShow: 0,
      addons: {},
      addonNonShow: {},
      total: 3,
    },
    '30': {
      productId: 30,
      normal: 100,
      nonShow: 0,
      addons: {},
      addonNonShow: {},
      total: 100,
    },
  },
  totals: {
    normal: 105,
    normalNonShow: 0,
    addons: {},
    addonNonShow: {},
    total: 105,
  },
  cashSummary: {
    rangeIsCanonical: true,
    channels: [],
    entries: [],
    totals: [],
  },
};

const LocationProbe = () => {
  const location = useLocation();
  return <output data-testid="location-search">{location.search}</output>;
};

const getCurrentSearchParams = () =>
  new URLSearchParams(screen.getByTestId('location-search').textContent ?? '');

const expectMetricValue = (label: string, value: string) => {
  expect(
    within(screen.getByRole('region', { name: `${label} metric` })).getByText(value),
  ).toBeInTheDocument();
};

const TestNavigation = () => {
  const navigate = useNavigate();
  return (
    <>
      <button
        type="button"
        onClick={() =>
          navigate(
            '/channelNumbers?startDate=2026-08-01&endDate=2026-08-31&period=thisMonth&productTypes=1,2,3',
          )
        }
      >
        Change product filter
      </button>
      <button
        type="button"
        onClick={() =>
          navigate('/channelNumbers?startDate=2026-09-01&endDate=2026-09-30&period=custom')
        }
      >
        Change dates
      </button>
    </>
  );
};

describe('ChannelNumbersSummary requests', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: jest.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: jest.fn(),
        removeListener: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        dispatchEvent: jest.fn(),
      })),
    });
    Object.defineProperty(global, 'ResizeObserver', {
      writable: true,
      value: jest.fn().mockImplementation(() => ({
        observe: jest.fn(),
        unobserve: jest.fn(),
        disconnect: jest.fn(),
      })),
    });

    mockedFetchBootstrap.mockResolvedValue({
      summary: summaryWithProductTypes,
      trend: {
        currentYear: 2026,
        previousYear: 2025,
        current: { startDate: '2026-01-01', endDate: '2026-12-31', entries: [] },
        previous: { startDate: '2025-01-01', endDate: '2025-12-31', entries: [] },
        previousYearMetadata: {
          addons: [],
          productTypes: summaryWithProductTypes.productTypes,
          products: summaryWithProductTypes.products,
        },
      },
      finance: { accounts: [], categories: [], vendors: [], clients: [] },
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('loads the page with one bootstrap request and no automatic detail requests', async () => {
    render(
      <MemoryRouter
        initialEntries={[
          '/channelNumbers?startDate=2026-08-01&endDate=2026-08-31&period=thisMonth&source=shared',
        ]}
      >
        <MantineProvider>
          <LocationProbe />
          <ChannelNumbersSummary />
        </MantineProvider>
      </MemoryRouter>,
    );

    expect((await screen.findAllByText('Platform total')).length).toBeGreaterThan(0);
    expect(mockedFetchBootstrap).toHaveBeenCalledTimes(1);
    expect(mockedFetchBootstrap).toHaveBeenCalledWith({
      startDate: '2026-08-01',
      endDate: '2026-08-31',
      signal: expect.any(AbortSignal),
    });
    expect(mockedFetchDetails).not.toHaveBeenCalled();
    await waitFor(() => expect(getCurrentSearchParams().get('productTypes')).toBe('1,2'));
    expect(getCurrentSearchParams().get('source')).toBe('shared');
    expectMetricValue('Platform total', '5');
  });

  it.each([
    ['3', '100'],
    ['1,2,3', '105'],
  ])('preserves the explicit product type selection %s', async (productTypes, total) => {
    render(
      <MemoryRouter
        initialEntries={[
          `/channelNumbers?startDate=2026-08-01&endDate=2026-08-31&period=thisMonth&productTypes=${productTypes}`,
        ]}
      >
        <MantineProvider>
          <LocationProbe />
          <ChannelNumbersSummary />
        </MantineProvider>
      </MemoryRouter>,
    );

    expect((await screen.findAllByText('Attendees')).length).toBeGreaterThan(0);
    expect(getCurrentSearchParams().get('productTypes')).toBe(productTypes);
    expectMetricValue('Platform total', total);
    expect(mockedFetchBootstrap).toHaveBeenCalledTimes(1);
    expect(mockedFetchDetails).not.toHaveBeenCalled();
  });

  it('does not reload for client-side product filters and makes one request for a date change', async () => {
    render(
      <MemoryRouter
        initialEntries={[
          '/channelNumbers?startDate=2026-08-01&endDate=2026-08-31&period=thisMonth',
        ]}
      >
        <MantineProvider>
          <TestNavigation />
          <LocationProbe />
          <ChannelNumbersSummary />
        </MantineProvider>
      </MemoryRouter>,
    );

    expect((await screen.findAllByText('Platform total')).length).toBeGreaterThan(0);
    expect(mockedFetchBootstrap).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Change product filter' }));
    await waitFor(() => expect(mockedFetchBootstrap).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: 'Change dates' }));
    await waitFor(() => expect(mockedFetchBootstrap).toHaveBeenCalledTimes(2));
    await act(async () => {
      await mockedFetchBootstrap.mock.results[1].value;
    });
    expect(mockedFetchBootstrap).toHaveBeenLastCalledWith({
      startDate: '2026-09-01',
      endDate: '2026-09-30',
      signal: expect.any(AbortSignal),
    });
    expect(mockedFetchDetails).not.toHaveBeenCalled();
  });
});
