import { bookingTableCalendarDate, sourceReceivedCalendarDate } from './revenueBookingTableDate';

const parts = (date?: Date) => date && [date.getFullYear(), date.getMonth() + 1, date.getDate(), date.getHours()];
it('uses a local midnight date-picker value, not a UTC date parsed in the browser timezone', () => {
  expect(parts(bookingTableCalendarDate('2026-10-22'))).toEqual([2026, 10, 22, 0]);
});
it.each([null, undefined, '', '-', 'invalid', '2026-02-30', '2026-13-01', '2026-10-22T21:00:00Z'])(
  'leaves invalid or missing calendar dates undefined: %s', value => expect(bookingTableCalendarDate(value)).toBeUndefined(),
);
it.each([
  ['2026-10-21T22:30:00Z', [2026, 10, 22, 0]],
  ['2026-10-24T22:30:00Z', [2026, 10, 25, 0]],
  ['2026-10-25T22:30:00Z', [2026, 10, 25, 0]],
  ['2026-10-25T23:30:00Z', [2026, 10, 26, 0]],
  ['2026-03-28T23:30:00Z', [2026, 3, 29, 0]],
])('uses Warsaw date boundaries across midnight and DST for %s', (timestamp, expected) => {
  expect(parts(sourceReceivedCalendarDate(timestamp))).toEqual(expected);
});
it.each([null, undefined, '', 'invalid'])('keeps unknown source dates empty: %s', value => {
  expect(sourceReceivedCalendarDate(value)).toBeUndefined();
});
