import { emptyStaffFreeDraft } from '../../utils/staffFreeDraft';
import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import WalkInsPanel, { type WalkInChannelState } from './WalkInsPanel';
import { checkInStaffFree, getStaffFreeEntries, type StaffFreeOverview } from '../../api/staffFreeEntries';
import type { UnifiedOrder } from '../../store/bookingPlatformsTypes';

jest.mock('../../api/staffFreeEntries', () => ({ getStaffFreeEntries: jest.fn(), checkInStaffFree: jest.fn(), cancelStaffFree: jest.fn(), getStaffFreeHistory: jest.fn() }));

const overview = (): StaffFreeOverview => ({
  enabled: true, checkedIn: 19, policy: { allowance: 2, busyThreshold: 20, minimumPricePercent: 50 },
  qualification: { count: 19, totalCustomers: 19, free: 0, belowMinimum: 0, unpriced: 0, normalPrices: { PLN: 110 }, minimumPercent: 50 },
  staff: [{ id: 7, name: 'Sample Volunteer', staffType: 'volunteer', unlimited: false, used: 1, remaining: 1, totalVisits: 4, alreadyCheckedIn: false, onShift: false,
    decision: { allowed: true, benefit: 'allowance', message: 'Uses one free crawl.', canOverride: false } }], entries: [],
});
const prepare = jest.fn();
const changed = jest.fn();
const ticketChanged = jest.fn();
const freeChanged = jest.fn();
function renderPanel(staffFreeCount = 0) {
  const channel = { sortOrder: 1, paymentMethodId: 4, paymentMethodName: 'Cash', cashPrice: 110, cashPaymentEligible: true, walkInTicketPrices: [{ ticketType: 'normal', currencyCode: 'PLN', price: 110 }] };
  function Harness() { const [draft, setDraft] = useState(emptyStaffFreeDraft); return <WalkInsPanel
    staffFreeEntry={{ counterId: 1, reservationOrders: [], draft, onDraftChange: setDraft }} staffFreeCount={staffFreeCount}
    channels={[{ ...channel, id: 5, name: 'Walk-In' }, { ...channel, id: 8, name: 'Hostel Atlantis' }]}
    types={[{ id: 'normal', name: 'Normal', enabled: true }]} addons={[]} paymentMethods={[{ id: 4, name: 'Cash' }]}
    value={{}} freePeople={{}} freeAddons={{}} disabled={false} getAddonPrice={() => null} onChange={ticketChanged} onFreeChange={freeChanged}
  />; }
  return render(<Harness />);
}
beforeEach(() => {
  jest.clearAllMocks(); Object.defineProperty(window, 'crypto', { configurable: true, value: { randomUUID: jest.requireActual('crypto').randomUUID } }); prepare.mockResolvedValue(true); changed.mockResolvedValue(undefined);
  (getStaffFreeEntries as jest.Mock).mockResolvedValue(overview());
});
async function openStaffTicket() {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: /^Ticket type/ }));
  fireEvent.click(screen.getByRole('option', { name: /^Staff Free/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Add ticket' }));
  const input = await screen.findByRole('combobox', { name: 'Staff member' });
  await waitFor(() => expect(input).not.toBeDisabled());
  return input;
}
it('opens one inline Staff Free card and records named visits without creating anonymous tickets', async () => {
  const initial = overview();
  initial.staff.push({ ...initial.staff[0], id: 8, name: 'Second Volunteer', used: 0, remaining: 2, totalVisits: 0 });
  (getStaffFreeEntries as jest.Mock).mockResolvedValue(initial);
  renderPanel();
  const input = await openStaffTicket();
  expect(screen.getByRole('group', { name: 'Staff Free ticket' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Add ticket' })).toBeDisabled();
  expect(screen.queryByText(/Add more staff inside the Staff Free card below/)).not.toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: /^Currency/ })).toHaveAttribute('aria-disabled', 'true');
  expect(ticketChanged).not.toHaveBeenCalled();
  expect(freeChanged).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: 'Sample' } });
  fireEvent.click(await screen.findByRole('option', { name: /Sample Volunteer/ }));
  expect(screen.getByRole('button', { name: 'Walk-In (1)' })).toBeInTheDocument();
  expect(screen.getByText('1 guests')).toBeInTheDocument();
  expect(checkInStaffFree).not.toHaveBeenCalled();
  expect(prepare).not.toHaveBeenCalled(); expect(changed).not.toHaveBeenCalled();
  const nextInput = screen.getByRole('combobox', { name: 'Staff member' });
  fireEvent.change(nextInput, { target: { value: 'Second' } });
  fireEvent.click(await screen.findByRole('option', { name: /Second Volunteer/ }));
  expect(screen.getByRole('button', { name: 'Walk-In (2)' })).toBeInTheDocument();
  expect(screen.getAllByRole('group', { name: 'Staff Free ticket' })).toHaveLength(1);
  expect(screen.queryByRole('button', { name: /Check in staff/i })).not.toBeInTheDocument();
  fireEvent.mouseDown(screen.getByRole('combobox', { name: /^Ticket type/ }));
  expect(screen.getByRole('option', { name: /^Staff Free/ })).toHaveAttribute('aria-disabled', 'true');
  expect(getStaffFreeEntries).toHaveBeenCalledTimes(1);
  expect(ticketChanged).not.toHaveBeenCalled();
  expect(freeChanged).not.toHaveBeenCalled();
});
it('only offers Staff Free under Walk-In and preserves recorded staff counts when switching channels', async () => {
  const saved = overview(); saved.entries = [{ id: 3, userId: 7, name: 'Sample Volunteer', benefit: 'busy_night', label: 'Busy night', checkedInBefore: 20, overrideReason: null, createdAt: '2026-11-05T19:00:00Z' }];
  (getStaffFreeEntries as jest.Mock).mockResolvedValue(saved);
  renderPanel(1);
  await screen.findByRole('group', { name: 'Staff Free ticket' });
  expect(screen.getByText('1 guests')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Others' }));
  fireEvent.click(screen.getByRole('menuitemradio', { name: 'Hostel Atlantis (0)' }));
  await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  expect(screen.queryByRole('group', { name: 'Staff Free ticket' })).not.toBeInTheDocument();
  fireEvent.mouseDown(screen.getByRole('combobox', { name: /^Ticket type/ }));
  expect(screen.queryByRole('option', { name: /^Staff Free/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('option', { name: /^Normal/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Walk-In (1)' }));
  expect(screen.getByRole('group', { name: 'Staff Free ticket' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Others' })).toBeInTheDocument();
});
it.each(['disabled product', 'forbidden'])('hides Staff Free for %s', async mode => {
  if (mode === 'forbidden') (getStaffFreeEntries as jest.Mock).mockRejectedValue({ isAxiosError: true, response: { status: 403 } });
  else (getStaffFreeEntries as jest.Mock).mockResolvedValue({ ...overview(), enabled: false });
  renderPanel();
  await waitFor(() => expect(getStaffFreeEntries).toHaveBeenCalled());
  fireEvent.mouseDown(screen.getByRole('combobox', { name: /^Ticket type/ }));
  await waitFor(() => expect(screen.queryByRole('option', { name: /^Staff Free/ })).not.toBeInTheDocument());
  expect(screen.queryByRole('group', { name: 'Staff Free ticket' })).not.toBeInTheDocument();
});
it('counts unsaved Walk-In additions immediately alongside live reservations without an extra server call', async () => {
  const data = overview(); data.staff[0] = { ...data.staff[0], used: 2, remaining: 0, decision: { allowed: false, benefit: null, canOverride: true, message: 'Lifetime allowance used.' } };
  (getStaffFreeEntries as jest.Mock).mockResolvedValue(data);
  const orders: UnifiedOrder[] = [{ id: '1', platformBookingId: 'TEST', productId: '28', productName: 'Pub Crawl', date: '2026-11-05', timeslot: '21:00', quantity: 19, menCount: 0, womenCount: 0, customerName: 'Customer', platform: 'omnilodge', status: 'confirmed', attendedTotal: 19, rawData: { currency: 'PLN', priceGross: 2090, addonsAmount: 0 } }];
  function Harness() {
    const [tickets, setTickets] = useState<Record<number, WalkInChannelState>>({});
    const [draft, setDraft] = useState(emptyStaffFreeDraft);
    return <WalkInsPanel staffFreeEntry={{ counterId: 1, reservationOrders: orders, draft, onDraftChange: setDraft }}
      channels={[{ id: 5, name: 'Walk-In', sortOrder: 1, paymentMethodId: 4, paymentMethodName: 'Cash', cashPrice: 110, cashPaymentEligible: true, walkInTicketPrices: [{ ticketType: 'normal', currencyCode: 'PLN', price: 110 }] }]}
      types={[{ id: 'normal', name: 'Normal', enabled: true }]} addons={[]} paymentMethods={[{ id: 4, name: 'Cash' }]}
      value={tickets} freePeople={{}} freeAddons={{}} disabled={false} getAddonPrice={() => null}
      onChange={(id, next) => setTickets(prev => ({ ...prev, [id]: next }))} onFreeChange={freeChanged} />;
  }
  render(<Harness />);
  const input = await openStaffTicket();
  fireEvent.change(input, { target: { value: 'Sample' } });
  fireEvent.click(await screen.findByRole('option', { name: /Sample Volunteer/ }));
  expect(screen.getByText('19 / 20')).toBeInTheDocument();
  expect(screen.getByLabelText('Override for Sample Volunteer')).toBeInTheDocument();
  fireEvent.mouseDown(screen.getByRole('combobox', { name: /^Ticket type/ }));
  fireEvent.click(screen.getByRole('option', { name: /^Normal/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Add ticket' }));
  expect(screen.getByText('20 / 20')).toBeInTheDocument();
  expect(screen.queryByLabelText('Override for Sample Volunteer')).not.toBeInTheDocument();
  expect(getStaffFreeEntries).toHaveBeenCalledTimes(1);
  expect(prepare).not.toHaveBeenCalled();
  expect(checkInStaffFree).not.toHaveBeenCalled();
});
