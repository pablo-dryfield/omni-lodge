import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import type { ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import ReviewCounters from './ReviewCounters';

let mockRoleSlug = 'admin';
let mockUserId = 42;
let mockCanUpdateReviews = true;
let mockCanDeleteReviews = true;

jest.mock('../store/hooks', () => ({
  useAppSelector: (selector: (state: { session: { roleSlug: string; loggedUserId: number } }) => unknown) =>
    selector({ session: { roleSlug: mockRoleSlug, loggedUserId: mockUserId } }),
}));

jest.mock('../components/access/PageAccessGuard', () => ({
  PageAccessGuard: ({ children }: { children: ReactNode }) => children,
}));

jest.mock('../hooks/useModuleAccess', () => ({
  useModuleAccess: () => ({
    ready: true,
    loading: false,
    canView: true,
    canCreate: true,
    canUpdate: mockCanUpdateReviews,
    canDelete: mockCanDeleteReviews,
  }),
}));

jest.mock('../components/reviews/ReviewOverviewDashboard', () => ({
  __esModule: true,
  default: ({ month, onMonthChange, canManage, canUpdateManualCredits, canDeleteManualCredits, currentUserId }: { month: string; onMonthChange: (month: string) => void; canManage: boolean; canUpdateManualCredits: boolean; canDeleteManualCredits: boolean; currentUserId: number }) => (
    <div>
      <output data-testid="selected-month">{month}</output>
      <output data-testid="can-manage">{String(canManage)}</output>
      <output data-testid="can-update-manual-credits">{String(canUpdateManualCredits)}</output>
      <output data-testid="can-delete-manual-credits">{String(canDeleteManualCredits)}</output>
      <output data-testid="current-user-id">{currentUserId}</output>
      <button type="button" onClick={() => onMonthChange('2026-09')}>Change month</button>
      {canManage && <div>Daily Review Totals</div>}
    </div>
  ),
}));

jest.mock('../components/reviews/ReviewArchivePanel', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('../components/reviews/DailyReviewTrend', () => ({
  __esModule: true,
  default: () => <div>Daily Review Totals</div>,
}));
jest.mock('../components/reviewCounters/ReviewCounterList', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('../components/reviewCounters/ReviewAnalyticsPanel', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('../components/reviewCounters/ReviewMonthlySummary', () => ({
  __esModule: true,
  default: () => null,
}));

const LocationProbe = () => {
  const location = useLocation();
  return <output data-testid="location-search">{location.search}</output>;
};

const renderPage = (entry: string) =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <MantineProvider>
        <ReviewCounters />
        <LocationProbe />
      </MantineProvider>
    </MemoryRouter>,
  );

describe('ReviewCounters month query', () => {
  beforeEach(() => {
    mockRoleSlug = 'admin';
    mockUserId = 42;
    mockCanUpdateReviews = true;
    mockCanDeleteReviews = true;
    jest.useFakeTimers();
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
    jest.setSystemTime(new Date('2026-07-31T22:30:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('normalizes invalid query values to the current Warsaw month', async () => {
    renderPage('/reviews?tab=invalid&month=2026-13&source=shortcut');

    expect(screen.getByTestId('selected-month')).toHaveTextContent('2026-08');
    await waitFor(() => {
      const query = new URLSearchParams(screen.getByTestId('location-search').textContent ?? '');
      expect(query.get('tab')).toBe('overview');
    });
    const normalizedQuery = new URLSearchParams(screen.getByTestId('location-search').textContent ?? '');
    expect(normalizedQuery.get('month')).toBe('2026-08');
    expect(normalizedQuery.get('source')).toBe('shortcut');
  });

  it('keeps a valid deep-linked month and updates it from the dashboard', async () => {
    renderPage('/reviews?tab=overview&month=2026-02');

    expect(screen.getByTestId('selected-month')).toHaveTextContent('2026-02');
    fireEvent.click(screen.getByRole('button', { name: 'Change month' }));

    await waitFor(() => {
      expect(screen.getByTestId('selected-month')).toHaveTextContent('2026-09');
    });
    const updatedQuery = new URLSearchParams(screen.getByTestId('location-search').textContent ?? '');
    expect(updatedQuery.get('month')).toBe('2026-09');
  });

  it('hides manager-only review tools from other roles', () => {
    mockRoleSlug = 'receptionist';
    renderPage('/reviews?tab=overview&month=2026-08');

    expect(screen.getByTestId('can-manage')).toHaveTextContent('false');
    expect(screen.getByTestId('current-user-id')).toHaveTextContent('42');
    expect(screen.queryByText('Daily Review Totals')).not.toBeInTheDocument();
    expect(screen.queryByText('Previous review-counter history')).not.toBeInTheDocument();
  });

  it.each(['owner', 'manager', 'admin', 'administrator'])(
    'shows manager-only review tools to the %s role',
    (roleSlug) => {
      mockRoleSlug = roleSlug;
      renderPage('/reviews?tab=overview&month=2026-08');

      expect(screen.getByTestId('can-manage')).toHaveTextContent('true');
      expect(screen.getByText('Daily Review Totals')).toBeInTheDocument();
      expect(screen.getByText('Previous review-counter history')).toBeInTheDocument();
    },
  );

  it('passes the module delete permission separately from the manager role', () => {
    mockRoleSlug = 'manager';
    mockCanUpdateReviews = false;
    mockCanDeleteReviews = false;
    renderPage('/reviews?tab=overview&month=2026-08');

    expect(screen.getByTestId('can-manage')).toHaveTextContent('true');
    expect(screen.getByTestId('can-update-manual-credits')).toHaveTextContent('false');
    expect(screen.getByTestId('can-delete-manual-credits')).toHaveTextContent('false');
  });
});
