import { partnerCounterWalkIns } from '../partnerCounterBaseline';
it('combines genuine Walk-Ins with reservations without counting their cash receipts twice', () => {
  const notes = '-- CASH-SNAPSHOT START --\n' + JSON.stringify({ channels: { 9: { tickets: [
    { key: 'normal', currencies: [{ people: 4, addons: { 1: 2, 3: 1 } }] },
    { key: 'booking-cash:100', currencies: [{ people: 7, addons: { 1: 2 } }] },
  ] } } }) + '\n-- CASH-SNAPSHOT END --';
  const result = partnerCounterWalkIns(notes, 9, 1);
  expect(result.people).toBe(2);
  expect(Object.fromEntries(result.addons)).toEqual({ 1: 2, 3: 1 });
  expect(partnerCounterWalkIns(notes, 8, 1).people).toBe(0);
});
it('handles absent and malformed snapshots safely', () => {
  expect(partnerCounterWalkIns(null, 9, 1).people).toBe(0);
  expect(partnerCounterWalkIns('-- CASH-SNAPSHOT START --bad-- CASH-SNAPSHOT END --', 9, 1).people).toBe(0);
});
