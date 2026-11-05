import { buildWalkInSummary, formatWalkInSummaryNotes, staffRowsFromNotes } from './walkInSummary';
const channels = [{ id: 5, name: 'Walk-In' }, { id: 8, name: 'Hostel Atlantis' }];
const addons = [{ addonId: 2, name: 'Cocktails' }];
it('includes every populated channel, custom tickets, currencies, free reasons and add-ons without inflating people', () => {
  const rows = buildWalkInSummary(new Map([[8, { currency: 'PLN', amount: 60, qty: 2, tickets: [
    { key: 'entry:1', name: 'Friends', paymentMethodName: 'Transfer', paymentStatus: 'awaiting', currencies: [{ currency: 'PLN', people: 2, cash: 60, addons: { 2: 1 } }] },
    { key: 'empty', name: 'Normal', currencies: [{ currency: 'EUR', people: 0, cash: 0, addons: {} }] },
  ] }]]), new Map([[5, { people: { qty: 1, note: 'Birthday guest' }, addons: { 2: { qty: 1, note: 'Birthday drink' } } }]]), channels, addons);
  expect(rows).toHaveLength(2);
  expect(rows.reduce((n, row) => n + row.guests, 0)).toBe(3);
  expect(rows[0]).toMatchObject({ channelName: 'Hostel Atlantis', payment: 'Transfer · Awaiting payment', guests: 2 });
  expect(formatWalkInSummaryNotes(rows)).toContain('Birthday guest');
  expect(formatWalkInSummaryNotes(rows)).toContain('Cocktails: 1 (Reason: Birthday drink)');
});
it('does not duplicate online cash collections in Walk-Ins', () => {
  expect(buildWalkInSummary(new Map([[5, { currency: 'PLN', amount: 100, qty: 1, tickets: [{ key: 'booking-cash:xperiencepoland:99', name: 'Reservation', currencies: [{ currency: 'PLN', people: 1, cash: 100, addons: {} }] }] }]]), new Map(), channels, addons)).toEqual([]);
});
it('shows named paid staff and their ticket amount while retaining awaiting-payment attendance', () => {
  const rows = buildWalkInSummary(new Map([[5, { currency: 'PLN', amount: 30, qty: 1, tickets: [{ name: 'Staff Ticket', staffGuests: [{ userId: 7, name: 'Sam' }], paymentMethodName: 'Transfer', paymentStatus: 'awaiting', currencies: [{ currency: 'PLN', people: 1, cash: 30, addons: {} }] }] }]]), new Map(), channels, addons);
  expect(rows[0]).toMatchObject({ guests: 1, amount: 30, staff: [{ name: 'Sam', label: 'Staff Ticket - PLN 30.00' }] });
  expect(formatWalkInSummaryNotes(rows)).toContain('Awaiting payment');
});
it('shows named free staff and override reasons from saved notes', () => {
  const rows = staffRowsFromNotes('-- STAFF-ENTRIES START --\n[{"userId":7,"name":"Sam","label":"Manager override","reason":"Farewell"}]\n-- STAFF-ENTRIES END --', channels);
  expect(rows[0]).toMatchObject({ ticket: 'Staff Free', guests: 1, channelId: 5 });
  expect(formatWalkInSummaryNotes(rows)).toContain('Sam — Manager override (Reason: Farewell)');
  expect(staffRowsFromNotes('-- STAFF-ENTRIES START --bad-- STAFF-ENTRIES END --', channels)).toEqual([]);
});

it('retains the saved channel label when catalog data is not loaded', () => {
  const rows = buildWalkInSummary(new Map([[8, { channelName: 'Hostel Atlantis', currency: 'PLN', amount: 100, qty: 1 }]]), new Map(), [], []);
  expect(formatWalkInSummaryNotes(rows)).toContain('Hostel Atlantis');
});
