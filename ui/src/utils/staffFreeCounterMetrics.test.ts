import type { StaffFreeCounterMetrics } from '../api/staffFreeEntries';
import type { UnifiedOrder } from '../store/bookingPlatformsTypes';
import { getLiveStaffFreeMetricCount } from './staffFreeCounterMetrics';
import { getCounterVenueCounts } from './counterVenueCounts';
import type { StaffFreeLiveAttendance } from './staffFreeLiveQualification';
import { emptyStaffFreeDraft, staffFreeDraftCount } from './staffFreeDraft';

const metrics: StaffFreeCounterMetrics = {
  qualifyingCustomers: 19, busyThreshold: 20, minimumPricePercent: 50, normalPrices: { PLN: 110 }, includedCount: 3, excludedCount: 0,
};
const booking = (attendedTotal: number, priceGross = 2200): UnifiedOrder => ({
  id: '1', platformBookingId: 'TEST', productId: '28', productName: 'Pub Crawl', date: '2026-11-07', timeslot: '21:00',
  quantity: 20, menCount: 10, womenCount: 10, customerName: 'Sample', platform: 'omnilodge', status: 'confirmed',
  attendedTotal, rawData: { bookingId: 1, priceGross, addonsAmount: 0, currency: 'PLN' },
});
const attendance = (count: number): StaffFreeLiveAttendance => ({ reservationOrders: [booking(count)], walkIns: {}, freePeople: {} });

it('includes staff below 20 and excludes them as the live count reaches 20, without needing a save', () => {
  const live = attendance(19);
  expect(getLiveStaffFreeMetricCount(3, metrics, live)).toBe(3);
  live.reservationOrders = [booking(20)];
  expect(getLiveStaffFreeMetricCount(3, metrics, live)).toBe(0);
  live.reservationOrders = [booking(18)];
  expect(getLiveStaffFreeMetricCount(3, metrics, live)).toBe(3);
});

it('does not allow complimentary, cheap or staff entries to cause the exemption', () => {
  const live = attendance(19);
  live.freePeople = { 5: { qty: 3 } };
  live.reservationOrders = [booking(19), { ...booking(1, 0), id: 'free', quantity: 1, rawData: { bookingId: 2, priceGross: 0, addonsAmount: 0, currency: 'PLN' } }];
  expect(getLiveStaffFreeMetricCount(3, metrics, live)).toBe(3);
  live.reservationOrders = [booking(20, 1099.99)];
  expect(getLiveStaffFreeMetricCount(3, metrics, live)).toBe(3);
});

it('reflects a qualifying Walk-In and the configurable price and attendance thresholds', () => {
  const live = attendance(19);
  live.walkIns = { 5: { ticketOrder: ['normal'], tickets: { normal: {
    name: 'Normal', currencyOrder: ['PLN'], currencies: { PLN: { people: 1, cash: '55', addons: {} } },
  } } } };
  expect(getLiveStaffFreeMetricCount(3, metrics, live)).toBe(0);
  expect(getLiveStaffFreeMetricCount(3, { ...metrics, minimumPricePercent: 75 }, live)).toBe(3);
  expect(getLiveStaffFreeMetricCount(3, { ...metrics, busyThreshold: 25 }, live)).toBe(3);
});

it('uses saved qualification while reservations are loading or unavailable', () => {
  const live = { ...attendance(0), reservationOrders: null };
  expect(getLiveStaffFreeMetricCount(3, { ...metrics, qualifyingCustomers: 20, includedCount: 0, excludedCount: 3 }, live)).toBe(0);
  expect(getLiveStaffFreeMetricCount(3, metrics, live)).toBe(3);
});

it('keeps history/draft counts while only contributing eligible staff to Venue Numbers', () => {
  const draft = emptyStaffFreeDraft();
  draft.additions.push({ userId: 9, name: 'Pending', override: false, overrideReason: '' });
  draft.removals.push({ entryId: 1, name: 'Removed', reason: 'Correction' });
  const entries = [{ id: 1, userId: 7 }, { id: 2, userId: 8 }];
  const staffCount = staffFreeDraftCount(entries, draft);
  expect(staffCount).toBe(2);
  const countedStaff = getLiveStaffFreeMetricCount(staffCount, metrics, attendance(20));
  expect(getCounterVenueCounts({ peopleAttended: 18, cocktailsAttended: 2, freePeople: 1 + countedStaff }))
    .toEqual({ normalCount: 19, cocktailsCount: 2, brunchCount: 0, totalPeople: 21 });
  expect(entries).toHaveLength(2);
  expect(draft.additions).toHaveLength(1);
  expect(getLiveStaffFreeMetricCount(staffCount, metrics, attendance(19))).toBe(2);
});
