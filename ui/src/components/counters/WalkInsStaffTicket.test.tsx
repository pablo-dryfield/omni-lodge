import { useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import WalkInsPanel, { type WalkInChannelState } from './WalkInsPanel';
import { getStaffFreeEntries, type StaffFreeOverview } from '../../api/staffFreeEntries';
import { emptyStaffFreeDraft } from '../../utils/staffFreeDraft';
jest.mock('../../api/staffFreeEntries', () => ({ getStaffFreeEntries: jest.fn() }));
const data: StaffFreeOverview = {
  enabled: true, checkedIn: 10, policy: { allowance: 2, busyThreshold: 20, minimumPricePercent: 50, paidTicketPrice: 30 },
  staff: [{ id: 7, name: 'Sam Guide', staffType: 'volunteer', unlimited: false, used: 2, remaining: 0, totalVisits: 2, alreadyCheckedIn: false, onShift: false,
    decision: { allowed: false, benefit: null, message: 'Lifetime allowance used.', canOverride: true } }], entries: [],
};
const changed = jest.fn();
function Harness() {
  const [value, setValue] = useState<Record<number, WalkInChannelState>>({});
  const [draft, setDraft] = useState(emptyStaffFreeDraft);
  return <WalkInsPanel channels={[{ id: 5, name: 'Walk-In', sortOrder: 1, paymentMethodId: 4, paymentMethodName: 'Transfer', cashPrice: 100, cashPaymentEligible: true, walkInTicketPrices: [] }]}
    staffFreeEntry={{ counterId: 1, reservationOrders: [], draft, onDraftChange: setDraft }}
    types={[]} addons={[]} paymentMethods={[{ id: 4, name: 'Transfer' }]} freePeople={{}} freeAddons={{}} disabled={false}
    value={value} onChange={(id, next) => { changed(next); setValue(previous => ({ ...previous, [id]: next })); }} onFreeChange={() => {}} getAddonPrice={() => null} />;
}
beforeEach(() => { jest.clearAllMocks(); Object.defineProperty(window, 'crypto', { configurable: true, value: { randomUUID: jest.requireActual('crypto').randomUUID } }); (getStaffFreeEntries as jest.Mock).mockResolvedValue(data); });
it('records named PLN 30 tickets, retains awaiting attendance and keeps one staff card', async () => {
  render(<Harness />);
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Ticket type' }));
  fireEvent.click(await screen.findByRole('option', { name: /Staff Ticket/ }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Add ticket' })).not.toBeDisabled());
  fireEvent.click(screen.getByRole('button', { name: 'Add ticket' }));
  const input = await screen.findByRole('combobox', { name: 'Staff Ticket members' });
  fireEvent.change(input, { target: { value: 'Sam' } });
  fireEvent.click(await screen.findByRole('option', { name: 'Sam Guide' }));
  const next = changed.mock.calls.at(-1)![0] as WalkInChannelState;
  expect(next.tickets[next.ticketOrder[0]]).toMatchObject({ name: 'Staff Ticket', ticketType: 'staff_paid', staffGuests: [{ userId: 7, name: 'Sam Guide' }], paymentStatus: 'awaiting', currencies: { PLN: { people: 1, cash: '30', unitPrice: 30 } } });
  expect(screen.getByRole('button', { name: 'Add ticket' })).toBeDisabled();
  const card = screen.getByRole('group', { name: 'Staff Ticket ticket' });
  expect(within(card).getByText('1 staff')).toBeInTheDocument();
  expect(within(card).queryByRole('spinbutton')).not.toBeInTheDocument();
});
