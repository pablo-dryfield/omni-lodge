import { createRef, useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import StaffFreeEntryPanel, { type StaffFreeEntryHandle } from './StaffFreeEntryPanel';
import { cancelStaffFree, checkInStaffFree, getStaffFreeEntries, type StaffFreeOverview } from '../../api/staffFreeEntries';
import type { StaffFreeLiveAttendance } from '../../utils/staffFreeLiveQualification';
import { emptyStaffFreeDraft, restoreStaffFreeDraft, type StaffFreeDraft } from '../../utils/staffFreeDraft';
jest.mock('../../api/staffFreeEntries', () => ({ getStaffFreeEntries: jest.fn(), checkInStaffFree: jest.fn(), cancelStaffFree: jest.fn() }));

const overview = (): StaffFreeOverview => ({
  enabled: true, checkedIn: 19, policy: { allowance: 2, busyThreshold: 20, minimumPricePercent: 50 },
  qualification: { count: 19, totalCustomers: 24, free: 2, belowMinimum: 3, unpriced: 0, normalPrices: { PLN: 110 }, minimumPercent: 50 },
  staff: [{ id: 7, name: 'Sample Volunteer', staffType: 'volunteer', unlimited: false, used: 1, remaining: 1, totalVisits: 4, alreadyCheckedIn: false, onShift: false,
    decision: { allowed: true, benefit: 'allowance', message: 'Uses one free crawl. 0 will remain.', canOverride: false } }], entries: [],
});
const live: StaffFreeLiveAttendance = { reservationOrders: [{
  id: '1', platformBookingId: 'TEST', productId: '28', productName: 'Pub Crawl', date: '2026-11-05', timeslot: '21:00',
  quantity: 25, menCount: 0, womenCount: 0, customerName: 'Sample Customer', platform: 'omnilodge', status: 'confirmed',
  attendedTotal: 19, rawData: { bookingId: 1, currency: 'PLN', priceGross: 2750, addonsAmount: 0 },
}], walkIns: {}, freePeople: {} };

const changed = jest.fn();
const validate = jest.fn();
function Harness({ attendance = live, initial = emptyStaffFreeDraft() }: { attendance?: StaffFreeLiveAttendance; initial?: StaffFreeDraft }) {
  const [draft, setDraft] = useState(initial);
  const ref = createRef<StaffFreeEntryHandle>();
  return <><button onClick={() => ref.current?.open()}>Open staff</button><StaffFreeEntryPanel {...attendance} ref={ref} counterId={1} disabled={false} draft={draft}
    onDraftChange={next => { changed(next); setDraft(next); }} onValidationChange={validate} /></>;
}
beforeEach(() => { jest.clearAllMocks(); (getStaffFreeEntries as jest.Mock).mockResolvedValue(overview()); });
async function selectStaff(name = 'Sample Volunteer') {
  const input = await screen.findByRole('combobox', { name: 'Staff member' });
  await waitFor(() => expect(input).not.toBeDisabled());
  fireEvent.change(input, { target: { value: name } });
  fireEvent.click(await screen.findByRole('option', { name: new RegExp(name) }));
}
it('stages a selected staff member without writing to the server or showing a check-in button', async () => {
  render(<Harness />); fireEvent.click(screen.getByText('Open staff')); await selectStaff();
  expect(screen.getByText('1 staff')).toBeInTheDocument();
  expect(screen.getByText('1 of 2 free crawls remaining')).toBeInTheDocument();
  expect(changed).toHaveBeenLastCalledWith({ additions: [{ userId: 7, name: 'Sample Volunteer', override: false, overrideReason: '' }], removals: [] });
  expect(checkInStaffFree).not.toHaveBeenCalled(); expect(cancelStaffFree).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: /Check in staff/i })).not.toBeInTheDocument();
  expect(screen.queryByText(/Uses one free crawl/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByText('Allowance rules'));
  expect(screen.getByText(/Assistant Managers, Managers, Owners and Administrators have unlimited/)).toBeInTheDocument();
  expect(screen.queryByText(/This count includes unsaved/)).not.toBeInTheDocument();
});
it('restores pending selections and incomplete override reasons without admitting anyone', async () => {
  const data = overview(); data.staff[0].used = 2; data.staff[0].remaining = 0;
  (getStaffFreeEntries as jest.Mock).mockResolvedValue(data);
  const initial = restoreStaffFreeDraft(JSON.parse(JSON.stringify({ additions: [{ userId: 7, name: 'Sample Volunteer', override: true, overrideReason: 'Farewell' }], removals: [] })));
  render(<Harness initial={initial} />);
  expect(await screen.findByRole('textbox', { name: /Override reason for Sample Volunteer/ })).toHaveValue('Farewell');
  await waitFor(() => expect(validate).toHaveBeenLastCalledWith(null));
  expect(checkInStaffFree).not.toHaveBeenCalled();
});
it('lets the user remove a pending selection without creating or cancelling a saved visit', async () => {
  render(<Harness />); fireEvent.click(screen.getByText('Open staff')); await selectStaff();
  fireEvent.click(screen.getByRole('button', { name: 'Remove Sample Volunteer' }));
  expect(changed).toHaveBeenLastCalledWith(emptyStaffFreeDraft());
  expect(checkInStaffFree).not.toHaveBeenCalled(); expect(cancelStaffFree).not.toHaveBeenCalled();
});
it('requires an override and reason below the threshold, then removes the requirement as live attendance grows', async () => {
  const data = overview(); data.staff[0].used = 2; data.staff[0].remaining = 0;
  (getStaffFreeEntries as jest.Mock).mockResolvedValue(data);
  const view = render(<Harness />); fireEvent.click(screen.getByText('Open staff')); await selectStaff();
  await waitFor(() => expect(validate).toHaveBeenLastCalledWith(expect.stringContaining('override and reason')));
  fireEvent.click(screen.getByLabelText('Override for Sample Volunteer'));
  fireEvent.change(screen.getByRole('textbox', { name: /Override reason for Sample Volunteer/ }), { target: { value: 'Farewell evening' } });
  await waitFor(() => expect(validate).toHaveBeenLastCalledWith(null));
  fireEvent.click(screen.getByLabelText('Override for Sample Volunteer'));
  view.rerender(<Harness attendance={{ ...live, reservationOrders: live.reservationOrders!.map(row => ({ ...row, attendedTotal: 20 })) }} />);
  await waitFor(() => expect(validate).toHaveBeenLastCalledWith(null));
  expect(screen.queryByLabelText('Override for Sample Volunteer')).not.toBeInTheDocument();
  view.rerender(<Harness />);
  await waitFor(() => expect(validate).toHaveBeenLastCalledWith(expect.stringContaining('override and reason')));
});
it('disables duplicate and on-duty choices while keeping unsaved staff in one card', async () => {
  const data = overview(); data.staff.push({ ...data.staff[0], id: 8, name: 'On Duty', onShift: true });
  (getStaffFreeEntries as jest.Mock).mockResolvedValue(data);
  render(<Harness />); fireEvent.click(screen.getByText('Open staff')); await selectStaff();
  const input = screen.getByRole('combobox', { name: 'Staff member' });
  fireEvent.change(input, { target: { value: 'Sample' } });
  expect(await screen.findByRole('option', { name: /Sample Volunteer/ })).toHaveAttribute('aria-disabled', 'true');
  fireEvent.change(input, { target: { value: 'On Duty' } });
  expect(await screen.findByRole('option', { name: /On Duty/ })).toHaveAttribute('aria-disabled', 'true');
  expect(screen.getAllByRole('group', { name: 'Staff Free ticket' })).toHaveLength(1);
});
it('stages removal of a saved visit with its reason and lets the user undo that draft', async () => {
  const data = overview(); data.entries = [{ id: 3, userId: 7, name: 'Sample Volunteer', benefit: 'allowance', label: 'Allowance used', checkedInBefore: 19, overrideReason: null, createdAt: '2026-11-05T19:00:00Z' }];
  (getStaffFreeEntries as jest.Mock).mockResolvedValue(data);
  render(<Harness />);
  fireEvent.click(await screen.findByRole('button', { name: 'Undo entry for Sample Volunteer' }));
  expect(screen.getByRole('button', { name: 'Remove entry' })).toBeDisabled();
  fireEvent.change(screen.getByRole('textbox', { name: /Reason for correction/ }), { target: { value: 'Wrong person' } });
  fireEvent.click(screen.getByRole('button', { name: 'Remove entry' }));
  expect(changed).toHaveBeenLastCalledWith({ additions: [], removals: [{ entryId: 3, name: 'Sample Volunteer', reason: 'Wrong person' }] });
  expect(screen.getByText('Removal pending')).toBeInTheDocument();
  expect(cancelStaffFree).not.toHaveBeenCalled();
  fireEvent.click(await screen.findByRole('button', { name: 'Keep entry for Sample Volunteer' }));
  expect(changed).toHaveBeenLastCalledWith(emptyStaffFreeDraft());
});
it.each(['assistant_manager', 'management'] as const)('keeps %s entries unlimited while staging', async benefit => {
  const data = overview(); data.staff[0] = { ...data.staff[0], unlimited: true, used: 99, remaining: null, decision: { allowed: true, benefit, canOverride: false, message: 'Unlimited off-duty staff entry.' } };
  (getStaffFreeEntries as jest.Mock).mockResolvedValue(data);
  render(<Harness />); fireEvent.click(screen.getByText('Open staff')); await selectStaff();
  expect(screen.getByText('Unlimited entries')).toBeInTheDocument();
  await waitFor(() => expect(validate).toHaveBeenLastCalledWith(null));
  expect(checkInStaffFree).not.toHaveBeenCalled();
});
it('preserves a draft and blocks saving while staff details cannot be fetched', async () => {
  (getStaffFreeEntries as jest.Mock).mockRejectedValue(new Error('Unavailable'));
  render(<Harness initial={{ additions: [{ userId: 7, name: 'Sample Volunteer', override: false, overrideReason: '' }], removals: [] }} />);
  expect(await screen.findByText('Unavailable')).toBeInTheDocument();
  await waitFor(() => expect(validate).toHaveBeenLastCalledWith('Unavailable'));
  expect(screen.getByText('Sample Volunteer')).toBeInTheDocument();
});
