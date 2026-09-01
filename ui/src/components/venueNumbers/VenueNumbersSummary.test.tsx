import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import type {
  VenuePayoutSummary,
  VenuePayoutVenueBreakdown,
} from '../../types/nightReports/VenuePayoutSummary';
import axiosInstance from '../../utils/axiosInstance';
import { shareVenueSummaryImage } from '../../utils/venueNumbersShareImage';
import VenueNumbersSummary from './VenueNumbersSummary';

const mockDispatch = jest.fn();

jest.mock('../../utils/axiosInstance', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
    delete: jest.fn(),
  },
}));

jest.mock('../../utils/venueNumbersShareImage', () => ({
  shareVenueSummaryImage: jest.fn(),
}));

jest.mock('../../store/hooks', () => ({
  useAppDispatch: () => mockDispatch,
  useAppSelector: () => ({ data: [] }),
}));

jest.mock('../../actions/financeActions', () => ({
  createFinanceTransaction: jest.fn(),
}));

jest.mock('../../reducers/financeReducer', () => ({
  setFinanceBasics: jest.fn((payload) => ({ type: 'finance/setFinanceBasics', payload })),
}));

jest.mock('../../reducers/venueReducer', () => ({
  setVenuesData: jest.fn((payload) => ({ type: 'venues/setVenuesData', payload })),
}));

const mockedGet = axiosInstance.get as jest.Mock;
const mockedShareVenueSummaryImage = shareVenueSummaryImage as jest.MockedFunction<
  typeof shareVenueSummaryImage
>;

const emptyLedger = {
  opening: 0,
  due: 0,
  paid: 0,
  closing: 0,
};

const commissionOnlyVenue: VenuePayoutVenueBreakdown = {
  rowKey: 'venue-11-PLN',
  venueId: 11,
  venueName: 'Commission House',
  currency: 'PLN',
  allowsOpenBar: false,
  receivable: 240,
  receivableCollected: 100,
  receivableOutstanding: 140,
  payable: 0,
  payableCollected: 0,
  payableOutstanding: 0,
  net: 240,
  totalPeople: 12,
  totalPeopleReceivable: 12,
  totalPeoplePayable: 0,
  daily: [
    {
      date: '2026-08-07',
      reportId: 701,
      totalPeople: 12,
      amount: 240,
      direction: 'receivable',
      normalCount: 0,
      cocktailsCount: 0,
      brunchCount: 0,
      stayDurationMinutes: 90,
    },
  ],
  receivableLedger: { ...emptyLedger, due: 240, paid: 100, closing: 140 },
  payableLedger: emptyLedger,
};

const openBarVenue: VenuePayoutVenueBreakdown = {
  rowKey: 'venue-22-PLN',
  venueId: 22,
  venueName: 'Open Bar Club',
  currency: 'PLN',
  allowsOpenBar: true,
  receivable: 0,
  receivableCollected: 0,
  receivableOutstanding: 0,
  payable: 180,
  payableCollected: 50,
  payableOutstanding: 130,
  net: -180,
  totalPeople: 9,
  totalPeopleReceivable: 0,
  totalPeoplePayable: 9,
  daily: [
    {
      date: '2026-08-14',
      reportId: 702,
      totalPeople: 9,
      amount: 180,
      direction: 'payable',
      normalCount: 5,
      cocktailsCount: 3,
      brunchCount: 1,
    },
  ],
  receivableLedger: emptyLedger,
  payableLedger: { ...emptyLedger, due: 180, paid: 50, closing: 130 },
};

const summary: VenuePayoutSummary = {
  period: 'this_month',
  range: {
    startDate: '2026-08-01',
    endDate: '2026-08-31',
  },
  rangeIsCanonical: true,
  totalsByCurrency: [
    {
      currency: 'PLN',
      receivable: 240,
      receivableCollected: 100,
      receivableOutstanding: 140,
      payable: 180,
      payableCollected: 50,
      payableOutstanding: 130,
      net: 60,
      receivableLedger: { ...emptyLedger, due: 240, paid: 100, closing: 140 },
      payableLedger: { ...emptyLedger, due: 180, paid: 50, closing: 130 },
    },
  ],
  venues: [commissionOnlyVenue, openBarVenue],
};

describe('VenueNumbersSummary sharing', () => {
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

    mockedGet.mockResolvedValue({
      data: {
        venues: [{ data: [], columns: [] }],
        finance: { accounts: [], categories: [], vendors: [], clients: [] },
        summary: [{ data: [summary], columns: [] }],
      },
    });
    mockedShareVenueSummaryImage.mockResolvedValue('copied');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('shares a venue with its full breakdown while its detail row remains collapsed', async () => {
    render(
      <MemoryRouter initialEntries={['/venueNumbers?tab=summary&summaryPeriod=this_month']}>
        <MantineProvider>
          <VenueNumbersSummary />
        </MantineProvider>
      </MemoryRouter>,
    );

    const shareButtons = await screen.findAllByRole('button', { name: 'Share' });
    expect(shareButtons).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Expand venue details' })).toHaveLength(2);

    fireEvent.click(shareButtons[0]);

    await waitFor(() => {
      expect(mockedShareVenueSummaryImage).toHaveBeenCalledWith({
        venue: commissionOnlyVenue,
        startDate: '2026-08-01',
        endDate: '2026-08-31',
      });
    });
    expect(screen.getAllByRole('button', { name: 'Expand venue details' })).toHaveLength(2);
    expect(
      await screen.findByText('Commission House image copied to the clipboard.'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'Expand venue details' })[0]);
    expect(await screen.findByText('Stay Duration')).toBeInTheDocument();
    expect(screen.getByText('1h 30m')).toBeInTheDocument();
  });
});
