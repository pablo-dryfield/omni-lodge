import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import axiosInstance from '../../utils/axiosInstance';
import ReviewOverviewDashboard from './ReviewOverviewDashboard';

jest.mock('../../utils/axiosInstance', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  },
}));

jest.mock('../reviewCounters/ReviewMonthlySummary', () => ({
  __esModule: true,
  default: () => null,
}));

const mockedGet = axiosInstance.get as jest.Mock;
const mockedPatch = axiosInstance.patch as jest.Mock;
const mockedDelete = axiosInstance.delete as jest.Mock;

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

  it('removes an exact manual addition and reloads the monthly totals', async () => {
    const baseSummary = {
      reviewCount: 2,
      deletedCount: 0,
      unassignedCount: 0,
      unassignedReviews: [],
      users: [],
      manualCategoryTotals: { noName: 0, bad: 0 },
      lock: null,
    };
    const beforeRemoval = {
      ...baseSummary,
      staff: [
        {
          userId: 42,
          name: 'Current User',
          assigned: 2,
          manual: 1,
          reviewCount: 2,
          deletedReviewCount: 0,
          total: 3,
          platforms: [
            {
              platform: 'google',
              assigned: 2,
              manual: 1,
              reviewCount: 2,
              deletedReviewCount: 0,
              total: 3,
              reviews: [],
              deletedReviews: [],
              manualEntries: [
                { id: 77, date: '2026-08-01', credit: 1, notes: 'Correction' },
              ],
            },
          ],
        },
      ],
    };
    const afterRemoval = {
      ...baseSummary,
      staff: [
        {
          ...beforeRemoval.staff[0],
          manual: 0,
          total: 2,
          platforms: [
            {
              ...beforeRemoval.staff[0].platforms[0],
              manual: 0,
              total: 2,
              manualEntries: [],
            },
          ],
        },
      ],
    };
    let summaryRequestCount = 0;
    mockedGet.mockImplementation((url: string) => {
      if (url === '/reviews/archive/summary') {
        summaryRequestCount += 1;
        return Promise.resolve({ data: summaryRequestCount === 1 ? beforeRemoval : afterRemoval });
      }
      return Promise.resolve({ data: { users: [] } });
    });
    mockedDelete.mockResolvedValue({ data: null });

    render(
      <MantineProvider>
        <ReviewOverviewDashboard
          canManage
          canDeleteManualCredits
          currentUserId={42}
          month="2026-08"
          onMonthChange={jest.fn()}
        />
      </MantineProvider>,
    );

    const staffNames = await screen.findAllByText('Current User');
    fireEvent.click(staffNames[0]);
    const platformButtons = await screen.findAllByRole('button', { name: /Google/i });
    fireEvent.click(platformButtons[0]);
    const removeButtons = await screen.findAllByRole('button', {
      name: 'Remove 1.000 manual addition for Current User',
    });
    fireEvent.click(removeButtons[0]);

    const dialog = await screen.findByRole('dialog', { name: 'Remove manual addition?' });
    expect(within(dialog).getByText('Correction')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove addition' }));

    await waitFor(() => {
      expect(mockedDelete).toHaveBeenCalledWith('/reviews/archive/manual-credits/77');
    });
    await waitFor(() => {
      expect(summaryRequestCount).toBe(2);
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Remove manual addition?' })).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.queryByRole('button', {
        name: 'Remove 1.000 manual addition for Current User',
      })).not.toBeInTheDocument();
    });
  });

  it('edits an exact manual addition and shows its refreshed description', async () => {
    const baseSummary = {
      reviewCount: 2,
      deletedCount: 0,
      unassignedCount: 0,
      unassignedReviews: [],
      users: [
        {
          id: 42,
          firstName: 'Current',
          lastName: 'User',
          username: 'current-user',
        },
      ],
      manualCategoryTotals: { noName: 0, bad: 0 },
      lock: null,
    };
    const beforeEdit = {
      ...baseSummary,
      staff: [
        {
          userId: 42,
          name: 'Current User',
          assigned: 2,
          manual: 1,
          reviewCount: 2,
          deletedReviewCount: 0,
          total: 3,
          platforms: [
            {
              platform: 'google',
              assigned: 2,
              manual: 1,
              reviewCount: 2,
              deletedReviewCount: 0,
              total: 3,
              reviews: [],
              deletedReviews: [],
              manualEntries: [
                { id: 77, date: '2026-08-01', credit: 1, notes: 'Original description' },
              ],
            },
          ],
        },
      ],
    };
    const afterEdit = {
      ...baseSummary,
      staff: [
        {
          ...beforeEdit.staff[0],
          manual: 0.5,
          total: 2.5,
          platforms: [
            {
              ...beforeEdit.staff[0].platforms[0],
              manual: 0.5,
              total: 2.5,
              manualEntries: [
                { id: 77, date: '2026-08-01', credit: 0.5, notes: 'Updated description' },
              ],
            },
          ],
        },
      ],
    };
    let summaryRequestCount = 0;
    mockedGet.mockImplementation((url: string) => {
      if (url === '/reviews/archive/summary') {
        summaryRequestCount += 1;
        return Promise.resolve({ data: summaryRequestCount === 1 ? beforeEdit : afterEdit });
      }
      return Promise.resolve({ data: { users: [] } });
    });
    mockedPatch.mockResolvedValue({ data: { credit: afterEdit.staff[0].platforms[0].manualEntries[0] } });

    render(
      <MantineProvider>
        <ReviewOverviewDashboard
          canManage
          canUpdateManualCredits
          currentUserId={42}
          month="2026-08"
          onMonthChange={jest.fn()}
        />
      </MantineProvider>,
    );

    const staffNames = await screen.findAllByText('Current User');
    fireEvent.click(staffNames[0]);
    const platformButtons = await screen.findAllByRole('button', { name: /Google/i });
    fireEvent.click(platformButtons[0]);
    expect(screen.getAllByText('Description').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Original description').length).toBeGreaterThan(0);

    const editButtons = await screen.findAllByRole('button', {
      name: 'Edit 1.000 manual addition for Current User',
    });
    fireEvent.click(editButtons[0]);

    const dialog = await screen.findByRole('dialog', { name: 'Edit manual addition' });
    fireEvent.change(within(dialog).getByLabelText(/Credit amount/), { target: { value: '0.5' } });
    fireEvent.change(within(dialog).getByLabelText(/Description/), {
      target: { value: 'Updated description' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(mockedPatch).toHaveBeenCalledWith('/reviews/archive/manual-credits/77', {
        userId: 42,
        platform: 'google',
        credit: 0.5,
        notes: 'Updated description',
      });
    });
    await waitFor(() => {
      expect(summaryRequestCount).toBe(2);
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Edit manual addition' })).not.toBeInTheDocument();
    });
    expect((await screen.findAllByText('Updated description')).length).toBeGreaterThan(0);
  });
});
