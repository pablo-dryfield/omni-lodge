import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen } from '@testing-library/react';
import HomeVolunteerProgress from './HomeVolunteerProgress';

const mockNavigate = jest.fn();
const mockQuery = jest.fn();
let mockState = { session: { loggedUserId: 42, staffType: 'volunteer', roleSlug: 'guide' } };
let mockAllowed = true;
let mockAccess = { ready: true, canView: true };
jest.mock('react-router-dom', () => ({ useNavigate: () => mockNavigate }));
jest.mock('../../store/hooks', () => ({ useAppSelector: (select: (state: typeof mockState) => unknown) => select(mockState) }));
jest.mock('../../selectors/accessControlSelectors', () => ({ selectAllowedPageSlugs: () => new Set(mockAllowed ? ['volunteer-progress'] : []) }));
jest.mock('../../hooks/useModuleAccess', () => ({ useModuleAccess: () => mockAccess }));
jest.mock('../../api/volunteerMilestones', () => ({ useVolunteerStayProgress: (...args: unknown[]) => mockQuery(...args), getVolunteerMilestoneErrorMessage: () => 'Please try again.' }));
jest.mock('../volunteer/VolunteerStayProgress', () => ({ VolunteerOverviewCard: ({ report, onOpen }: { report: { starsEarned: number }; onOpen: () => void }) =>
  <button onClick={onOpen}>{report.starsEarned}/5 stars</button> }));

const view = (configuredVisible = true, audienceReady = true) => render(<MantineProvider>
  <HomeVolunteerProgress configuredVisible={configuredVisible} audienceReady={audienceReady} />
</MantineProvider>);
beforeEach(() => {
  jest.clearAllMocks();
  mockState = { session: { loggedUserId: 42, staffType: 'volunteer', roleSlug: 'guide' } };
  mockAllowed = true; mockAccess = { ready: true, canView: true };
  mockQuery.mockReturnValue({ data: { starsEarned: 3 }, isLoading: false, refetch: jest.fn() });
  Object.defineProperty(window, 'matchMedia', { writable: true, value: jest.fn().mockImplementation(() => ({ matches: false, addEventListener: jest.fn(), removeEventListener: jest.fn() })) });
});
it('shows the volunteer own progress and opens the full progress page', () => {
  view();
  expect(mockQuery).toHaveBeenCalledWith(null, null, true);
  fireEvent.click(screen.getByText('3/5 stars'));
  expect(mockNavigate).toHaveBeenCalledWith('/volunteer-progress');
});
it('does not fetch progress for other staff profiles even when their role is a manager', () => {
  mockState.session.staffType = 'long_term'; mockState.session.roleSlug = 'manager';
  view();
  expect(mockQuery).toHaveBeenCalledWith(null, null, false);
  expect(screen.queryByText('3/5 stars')).not.toBeInTheDocument();
});
it.each([[false, true], [true, false]])('respects Home Experience visibility %s and loaded audiences %s', (visible, ready) => {
  view(visible, ready);
  expect(mockQuery).toHaveBeenCalledWith(null, null, false);
  expect(screen.queryByText('3/5 stars')).not.toBeInTheDocument();
});
it.each(['page', 'module', 'loading'])('requires %s access before fetching', condition => {
  if (condition === 'page') mockAllowed = false;
  if (condition === 'module') mockAccess.canView = false;
  if (condition === 'loading') mockAccess.ready = false;
  view();
  expect(mockQuery).toHaveBeenCalledWith(null, null, false);
});
it('shows a recoverable error rather than hiding failed progress', () => {
  const refetch = jest.fn(); mockQuery.mockReturnValue({ error: new Error('offline'), refetch });
  view(); expect(screen.getByText('Please try again.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh progress' })); expect(refetch).toHaveBeenCalled();
});
