import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import HomeVolunteerProgress from './HomeVolunteerProgress';
import axiosInstance from '../../utils/axiosInstance';

let mockRole = 'guide';
jest.mock('react-router-dom', () => ({ useNavigate: () => jest.fn() }));
jest.mock('../../store/hooks', () => ({ useAppSelector: (select: (state: unknown) => unknown) => select({
  session: { loggedUserId: 42, staffType: 'volunteer', roleSlug: mockRole },
}) }));
jest.mock('../../selectors/accessControlSelectors', () => ({ selectAllowedPageSlugs: () => new Set(['volunteer-progress']) }));
jest.mock('../../hooks/useModuleAccess', () => ({ useModuleAccess: () => ({ ready: true, canView: true }) }));
jest.mock('../../utils/axiosInstance', () => ({ __esModule: true, default: { get: jest.fn() } }));
jest.mock('../volunteer/VolunteerStayProgress', () => ({ VolunteerOverviewCard: ({ report }: { report: { starsEarned: number } }) =>
  <div>{report.starsEarned}/5 stars</div> }));

const mockGet = axiosInstance.get as jest.Mock;
let client: QueryClient;
beforeEach(() => {
  jest.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // Match the real route authorization: volunteers can read /me, not /:userId.
  mockGet.mockImplementation((url: string) => url === '/volunteerMilestones/me'
    ? Promise.resolve({ data: { starsEarned: 3 } })
    : Promise.reject({ response: { status: 403, data: [{ message: 'Forbidden' }] } }));
  Object.defineProperty(window, 'matchMedia', { writable: true, value: jest.fn().mockImplementation(() => ({
    matches: false, addEventListener: jest.fn(), removeEventListener: jest.fn(),
  })) });
});
afterEach(() => client.clear());

it.each(['guide', 'assistant_manager'])('loads the current volunteer using the self endpoint for role %s', async role => {
  mockRole = role;
  render(<QueryClientProvider client={client}><MantineProvider>
    <HomeVolunteerProgress configuredVisible audienceReady />
  </MantineProvider></QueryClientProvider>);
  expect(await screen.findByText('3/5 stars')).toBeInTheDocument();
  expect(mockGet).toHaveBeenCalledTimes(1);
  expect(mockGet).toHaveBeenCalledWith('/volunteerMilestones/me', { params: {} });
  expect(screen.queryByText('Forbidden')).not.toBeInTheDocument();
});
