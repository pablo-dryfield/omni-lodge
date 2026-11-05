import type { StaffFreeOverview, StaffFreePerson } from '../api/staffFreeEntries';
import type { UnifiedOrder } from '../store/bookingPlatformsTypes';
import { getLiveStaffFreeDecision, getLiveStaffFreeQualification, type StaffFreeLiveAttendance } from './staffFreeLiveQualification';

const booking = (overrides: Partial<UnifiedOrder> = {}): UnifiedOrder => ({
  id: '1', platformBookingId: 'TEST', productId: '28', productName: 'Pub Crawl', date: '2026-11-05', timeslot: '21:00',
  quantity: 20, menCount: 10, womenCount: 10, customerName: 'Sample', platform: 'omnilodge', status: 'confirmed',
  attendedTotal: 19, rawData: { bookingId: 1, priceGross: 1100, addonsAmount: 0, currency: 'PLN' }, ...overrides,
});
const attendance = (reservationOrders: UnifiedOrder[] = [booking()]): StaffFreeLiveAttendance => ({ reservationOrders, walkIns: {}, freePeople: {} });
const calculate = (input: StaffFreeLiveAttendance, minimumPercent = 50) => getLiveStaffFreeQualification(input, { PLN: 110, EUR: 30 }, minimumPercent)!;
const policy: StaffFreeOverview['policy'] = { allowance: 2, busyThreshold: 20, minimumPricePercent: 50 };
const person: StaffFreePerson = {
  id: 7, name: 'Volunteer', staffType: 'volunteer', unlimited: false, used: 2, remaining: 0, totalVisits: 4,
  alreadyCheckedIn: false, onShift: false, decision: { allowed: false, benefit: null, message: 'Lifetime allowance used.', canOverride: true },
};

it('uses unsaved attendance, supports undo, and counts all attendees including those with add-ons', () => {
  const input = attendance();
  expect(calculate(input).count).toBe(19);
  input.reservationOrders = [booking({ attendedTotal: 20, attendedExtras: { cocktails: 4, tshirts: 0, photos: 0 } })];
  expect(calculate(input).count).toBe(20);
  input.reservationOrders = [booking({ attendedTotal: 18 })];
  expect(calculate(input).count).toBe(18);
});
it('uses the whole booking average and only counts checked-in guests, once per booking', () => {
  const row = booking({ quantity: 3, attendedTotal: 2, rawData: { bookingId: 1, priceGross: 164.99, addonsAmount: 0, currency: 'PLN' } });
  expect(calculate(attendance([row, { ...row, id: 'duplicate' }]))).toMatchObject({ count: 0, totalCustomers: 2, belowMinimum: 2 });
  row.rawData.priceGross = 165;
  expect(calculate(attendance([row]))).toMatchObject({ count: 2, totalCustomers: 2 });
});
it('ignores cancelled and unchecked bookings and caps attendance at the party size', () => {
  expect(calculate(attendance([
    booking({ status: 'cancelled' }), booking({ id: '2', rawData: { bookingId: 2 }, attendedTotal: 0 }),
    booking({ id: '3', quantity: 2, attendedTotal: 5, rawData: { bookingId: 3, priceGross: 110, addonsAmount: 0, currency: 'PLN' } }),
  ]))).toMatchObject({ count: 2, totalCustomers: 2 });
});
it('deducts add-ons, discounts, tips and refunds but never channel commission', () => {
  const row = booking({ quantity: 2, attendedTotal: 2, rawData: {
    currency: 'PLN', priceGross: 220, addonsAmount: 30, discountAmount: 40, tipAmount: 20, refundedAmount: 20, priceNet: 50, commissionAmount: 60,
  } });
  expect(calculate(attendance([row])).count).toBe(2);
  row.rawData.refundedAmount = 20.01;
  expect(calculate(attendance([row]))).toMatchObject({ count: 0, belowMinimum: 2 });
});
it('uses priced add-on snapshots, skips included add-ons and excludes unknown add-on prices', () => {
  const row = booking({ quantity: 1, attendedTotal: 1, rawData: {
    currency: 'PLN', priceGross: 85, addonsSnapshot: { addons: [{ quantity: 1, unitPrice: 30 }, { quantity: 1, isIncluded: true }] },
  } });
  expect(calculate(attendance([row])).count).toBe(1);
  row.rawData.addonsSnapshot.addons = [{ quantity: 1 }];
  expect(calculate(attendance([row]))).toMatchObject({ count: 0, unpriced: 1 });
  row.rawData.addonsSnapshot = { extras: { cocktails: 1 } };
  expect(calculate(attendance([row])).unpriced).toBe(1);
});
it('excludes free guests and unknown prices rather than counting them as paying customers', () => {
  const rows = [
    booking({ id: 'free', quantity: 1, rawData: { bookingId: 1, currency: 'PLN', priceGross: 0, addonsAmount: 0 } }),
    booking({ id: 'missing', quantity: 1, rawData: { bookingId: 2, currency: 'PLN' } }),
    booking({ id: 'currency', quantity: 1, rawData: { bookingId: 3, currency: 'USD', priceGross: 100, addonsAmount: 0 } }),
  ];
  const input = attendance(rows); input.freePeople = { 5: { qty: 3 } };
  expect(calculate(input)).toMatchObject({ count: 0, totalCustomers: 6, free: 4, unpriced: 2 });
});
it('immediately reflects manual ticket quantity, price, add-ons, currencies and removal', () => {
  const input = attendance([]);
  const row = { people: 2, cash: '170', addons: { 1: 2 }, addonUnitPrices: { 1: 30 } };
  input.walkIns = { 5: { ticketOrder: ['custom'], tickets: {
    custom: { name: 'Group', currencyOrder: ['PLN', 'EUR'], currencies: { PLN: row, EUR: { people: 1, cash: '15', addons: {} } } },
  } } };
  expect(calculate(input)).toMatchObject({ count: 3, totalCustomers: 3 });
  row.cash = '169.99';
  expect(calculate(input)).toMatchObject({ count: 1, belowMinimum: 2 });
  row.people = 3;
  expect(calculate(input).belowMinimum).toBe(3);
  delete input.walkIns[5];
  expect(calculate(input).count).toBe(0);
});
it('does not double-count online cash collections as walk-ins', () => {
  const input = attendance();
  input.walkIns = { 5: { ticketOrder: ['booking-cash:xperiencepoland:1'], tickets: {
    'booking-cash:xperiencepoland:1': { name: 'Collection', currencyOrder: ['PLN'], currencies: { PLN: { people: 19, cash: '1100', addons: {} } } },
  } } };
  expect(calculate(input).count).toBe(19);
});
it('distinguishes blank custom amounts from free tickets, and unknown add-on prices from zero', () => {
  const input = attendance([]);
  const row = { people: 1, cash: '', addons: {} as Record<number, number> };
  input.walkIns = { 5: { ticketOrder: ['custom'], tickets: { custom: { name: 'Group', currencyOrder: ['PLN'], currencies: { PLN: row } } } } };
  expect(calculate(input).unpriced).toBe(1);
  row.cash = '0';
  expect(calculate(input).free).toBe(1);
  row.cash = '110'; row.addons = { 1: 1 };
  expect(calculate(input).unpriced).toBe(1);
});
it('honours the configurable minimum and does not substitute saved attendance while loading', () => {
  expect(calculate(attendance(), 60)).toMatchObject({ count: 0, belowMinimum: 19 });
  expect(calculate({ ...attendance(), reservationOrders: null })).toBeNull();
});
it('switches an exhausted allowance to a busy-night exemption and back using live counts', () => {
  expect(getLiveStaffFreeDecision(person, 19, policy)).toMatchObject({ allowed: false, canOverride: true });
  expect(getLiveStaffFreeDecision(person, 20, policy)).toMatchObject({ allowed: true, benefit: 'busy_night' });
  const previouslyBusy = { ...person, decision: getLiveStaffFreeDecision(person, 20, policy) };
  expect(getLiveStaffFreeDecision(previouslyBusy, 19, policy)).toMatchObject({ allowed: false, canOverride: true });
  expect(getLiveStaffFreeDecision({ ...person, used: 1 }, 19, policy)).toMatchObject({ allowed: true, benefit: 'allowance' });
  expect(getLiveStaffFreeDecision(person, 10, { ...policy, busyThreshold: 10 })).toMatchObject({ benefit: 'busy_night' });
});
it('keeps on-duty and identity restrictions', () => {
  const restricted = { allowed: false, benefit: null, canOverride: false, message: 'Assigned to work this pub crawl.' };
  expect(getLiveStaffFreeDecision({ ...person, onShift: true, decision: restricted }, 30, policy)).toEqual(restricted);
  expect(getLiveStaffFreeDecision({ ...person, decision: restricted }, 30, policy)).toEqual(restricted);
});
it.each(['assistant_manager', 'management'] as const)('preserves the server-confirmed %s benefit as live attendance changes', benefit => {
  const decision = { allowed: true, benefit, canOverride: false, message: 'Unlimited off-duty staff entry.' };
  const unlimited = { ...person, unlimited: true, remaining: null, decision };
  expect(getLiveStaffFreeDecision(unlimited, 0, policy)).toEqual(decision);
  expect(getLiveStaffFreeDecision(unlimited, 25, policy)).toEqual(decision);
  const restricted = { allowed: false, benefit: null, canOverride: false, message: 'Assigned to work this pub crawl.' };
  expect(getLiveStaffFreeDecision({ ...unlimited, onShift: true, decision: restricted }, 25, policy)).toEqual(restricted);
});
