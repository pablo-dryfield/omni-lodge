import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import StaffFreeAccountCard from './StaffFreeAccountCard';
import { getMyStaffFreeAccount, type StaffFreeAccount, type StaffFreeHistoryEntry } from '../../api/staffFreeEntries';

jest.mock('../../api/staffFreeEntries', () => ({ getMyStaffFreeAccount: jest.fn() }));
class TestResizeObserver implements ResizeObserver { observe(): void {} unobserve(): void {} disconnect(): void {} }
global.ResizeObserver = TestResizeObserver;

const visit: StaffFreeHistoryEntry = {
  id: 1, counterId: 22, date: '2026-11-05', benefit: 'busy_night', label: 'Attendance exemption',
  checkedInBefore: 19, recordedBy: 'Sample Manager', recordedAt: '2026-11-05T19:00:00Z', overrideReason: null,
  cancelledAt: null, cancelledBy: null, cancellationReason: null,
  allowanceReturnedAt: '2026-11-05T20:00:00Z', allowanceReturnedAtCount: 20,
};
const summary = (): StaffFreeAccount => ({ visible: true, eligible: true, unlimited: false, allowance: 2, busyThreshold: 20,
  used: 0, remaining: 2, totalVisits: 1, history: [visit] });
const renderCard = () => render(<MantineProvider><StaffFreeAccountCard /></MantineProvider>);

beforeEach(() => {
  jest.clearAllMocks();
  window.matchMedia = jest.fn().mockImplementation(query => ({ matches: false, media: query, addEventListener: jest.fn(), removeEventListener: jest.fn(), addListener: jest.fn(), removeListener: jest.fn() }));
  (getMyStaffFreeAccount as jest.Mock).mockResolvedValue(summary());
});

it('shows personal remaining allowance and retains restored allowance details in history', async () => {
  renderCard();
  expect(await screen.findByText('2 of 2')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Staff visit history (1)' }));
  expect(await screen.findByText('5 Nov 2026')).toBeInTheDocument();
  expect(screen.getByText(/Allowance returned when 20 qualifying customers/)).toBeInTheDocument();
  expect(getMyStaffFreeAccount).toHaveBeenCalledWith(expect.any(AbortSignal));
});

it('shows the empty-history explanation on Account', async () => {
  (getMyStaffFreeAccount as jest.Mock).mockResolvedValue({ ...summary(), totalVisits: 0, history: [] });
  renderCard();
  fireEvent.click(await screen.findByRole('button', { name: 'Staff visit history (0)' }));
  expect(await screen.findByText(/Older anonymous free tickets are not attributed automatically/)).toBeInTheDocument();
});

it('keeps cancelled visits visible as corrections without presenting them as attendance', async () => {
  (getMyStaffFreeAccount as jest.Mock).mockResolvedValue({ ...summary(), totalVisits: 0, history: [{ ...visit,
    cancelledAt: '2026-11-05T21:00:00Z', cancelledBy: 'Sample Manager', cancellationReason: 'Wrong person selected',
  }] });
  renderCard();
  fireEvent.click(await screen.findByRole('button', { name: 'Staff visit history (1)' }));
  expect(await screen.findByText('Cancelled')).toBeInTheDocument();
  expect(screen.getByText('Correction by Sample Manager: Wrong person selected')).toBeInTheDocument();
});

it('shows unlimited allowance for eligible management roles', async () => {
  (getMyStaffFreeAccount as jest.Mock).mockResolvedValue({ ...summary(), unlimited: true, remaining: null });
  renderCard();
  expect(await screen.findByText('Unlimited')).toBeInTheDocument();
  expect(screen.getByText('Your role has unlimited off-duty entries.')).toBeInTheDocument();
});

it('hides the section for non-staff without history', async () => {
  (getMyStaffFreeAccount as jest.Mock).mockResolvedValue({ ...summary(), visible: false, eligible: false, history: [] });
  renderCard();
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Staff free crawls' })).not.toBeInTheDocument());
});

it('offers retry after a failed load', async () => {
  (getMyStaffFreeAccount as jest.Mock).mockRejectedValueOnce(new Error('Unavailable'));
  renderCard();
  expect(await screen.findByText('Unable to load your free-crawl history.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh free-crawl history' }));
  expect(await screen.findByText('2 of 2')).toBeInTheDocument();
});

it('only expands ten visits initially and allows more', async () => {
  (getMyStaffFreeAccount as jest.Mock).mockResolvedValue({ ...summary(), history: Array.from({ length: 12 }, (_, i) => ({ ...visit, id: i + 1, date: `2026-11-${String(i + 1).padStart(2, '0')}` })) });
  renderCard();
  fireEvent.click(await screen.findByRole('button', { name: 'Staff visit history (12)' }));
  const card = screen.getByRole('region', { name: 'Staff free crawls' });
  expect(within(card).queryByText('12 Nov 2026')).not.toBeInTheDocument();
  fireEvent.click(await within(card).findByRole('button', { name: 'Show more visits' }));
  expect(within(card).getByText('12 Nov 2026')).toBeInTheDocument();
});


it('shows paid visits and pending payment separately from the free allowance', async () => {
  (getMyStaffFreeAccount as jest.Mock).mockResolvedValue({ ...summary(), paidVisits: 3, pendingPaidVisits: 1,
    history: [{ ...visit, benefit: 'paid', label: 'Staff Ticket', paidAmount: 30, payment: { currency: 'PLN', methodName: 'Transfer', status: 'awaiting' }, allowanceReturnedAt: null }] });
  renderCard();
  expect(await screen.findByText('2 of 2')).toBeInTheDocument();
  expect(screen.getByText('1 awaiting payment')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Staff visit history (1)' }));
  expect(await screen.findByText('PLN 30.00 ? Transfer ? Awaiting payment')).toBeInTheDocument();
});
