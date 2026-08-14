import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import axiosInstance from '../../utils/axiosInstance';
import ReviewOverviewDashboard from './ReviewOverviewDashboard';

jest.mock('../../utils/axiosInstance', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  },
}));

jest.mock('../reviewCounters/ReviewMonthlySummary', () => ({
  __esModule: true,
  default: () => null,
}));

const mockedGet = axiosInstance.get as jest.Mock;

describe('ReviewOverviewDashboard', () => {
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
    mockedGet.mockImplementation((url: string) => {
      if (url === '/reviews/archive/summary') {
        return Promise.resolve({
          data: {
            staff: [],
            reviewCount: 2,
            deletedCount: 0,
            unassignedCount: 2,
            manualCategoryTotals: { noName: 0, bad: 0 },
            lock: null,
          },
        });
      }
      return Promise.resolve({ data: { users: [] } });
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('does not crash when an older summary response omits unassigned review details', async () => {
    render(
      <MantineProvider>
        <ReviewOverviewDashboard canManage month="2026-08" onMonthChange={jest.fn()} />
      </MantineProvider>,
    );

    const card = await screen.findByRole('button', { name: 'View 2 reviews needing assignment' });
    fireEvent.click(card);

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('2 unassigned')).toBeInTheDocument();
    expect(screen.getByText(/details are not available in the current response/i)).toBeInTheDocument();
    expect(mockedGet).toHaveBeenCalledTimes(1);
  });

  it('shows a non-manager only their own ledger total', async () => {
    mockedGet.mockImplementation((url: string) => {
      if (url === '/reviews/archive/summary') {
        return Promise.resolve({
          data: {
            staff: [
              {
                userId: 42,
                name: 'Current User',
                assigned: 3,
                manual: 0.5,
                reviewCount: 3,
                deletedReviewCount: 0,
                total: 3.5,
                platforms: [],
              },
              {
                userId: 99,
                name: 'Another User',
                assigned: 8,
                manual: 0,
                reviewCount: 8,
                deletedReviewCount: 0,
                total: 8,
                platforms: [],
              },
            ],
            reviewCount: 11,
            deletedCount: 0,
            unassignedCount: 0,
            unassignedReviews: [],
            manualCategoryTotals: { noName: 0, bad: 0 },
            lock: null,
          },
        });
      }
      return Promise.resolve({ data: { users: [] } });
    });

    render(
      <MantineProvider>
        <ReviewOverviewDashboard currentUserId={42} month="2026-08" onMonthChange={jest.fn()} />
      </MantineProvider>,
    );

    const personalKpi = await screen.findByRole('group', { name: 'Your reviews total' });
    expect(within(personalKpi).getByText('Reviews')).toBeInTheDocument();
    await waitFor(() => {
      expect(within(personalKpi).getByText('3.500')).toBeInTheDocument();
    });
    expect(screen.queryByText('Needs assignment')).not.toBeInTheDocument();
  });
});
