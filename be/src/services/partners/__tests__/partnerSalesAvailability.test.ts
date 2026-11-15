import { partnerCalendar } from '../partnerSalesAvailability';

it('uses the booking timezone and rejects past days without depending on the browser timezone', () => {
  const result = partnerCalendar({}, '2026-11', undefined, [28], new Date('2026-11-14T23:30:00Z'));
  expect(result.today).toBe('2026-11-15');
  expect(result.days).toHaveLength(30);
  expect(result.days.find(day => day.date === '2026-11-14')?.available).toBe(false);
  expect(result.days.find(day => day.date === '2026-11-15')?.available).toBe(true);
});

it('honours date overrides over blocked dates and does not disclose unapproved redirects', () => {
  const config = { availability: { blockedDates: [{ date: '2026-11-19' }, { date: '2026-11-20', redirectProductId: 99 }], dateOverrides: [{ date: '2026-11-19', mode: 'available' as const }] } };
  const result = partnerCalendar(config, '2026-11', undefined, [28], new Date('2026-11-15T10:00:00Z'));
  expect(result.days.find(day => day.date === '2026-11-19')?.available).toBe(true);
  expect(result.days.find(day => day.date === '2026-11-20')).toMatchObject({ available: false, redirectProductId: null });
});

it('keeps fixed events and their separate departure cutoffs intact', () => {
  const config = { defaultStartTime: '17:00', availability: { dateMode: 'fixed' as const, fixedDate: '2026-12-31', cutoffMinutes: 30 } };
  const now = new Date('2026-12-31T16:00:00Z');
  const early = partnerCalendar(config, '2026-12', '17:00', [32], now);
  const late = partnerCalendar(config, '2026-12', '19:30', [32], now);
  expect(early.days.find(day => day.date === '2026-12-31')?.available).toBe(false);
  expect(late.days.find(day => day.date === '2026-12-31')?.available).toBe(true);
  expect(late.days.find(day => day.date === '2026-12-30')?.available).toBe(false);
});

it('only offers configured dates for an allowlist calendar', () => {
  const result = partnerCalendar({ availability: { dateMode: 'allowed_dates', allowedDates: ['2026-11-20'] } }, '2026-11', undefined, [], new Date('2026-11-15T10:00:00Z'));
  expect(result.days.filter(day => day.available).map(day => day.date)).toEqual(['2026-11-20']);
});

it.each([['2026-13', undefined], ['2026-01-01', undefined], [['2026-11'], undefined], ['2026-11', '25:00'], ['2026-11', ['21:00']]])('rejects malformed calendar requests: %j / %j', (month, time) => {
  expect(() => partnerCalendar({}, month, time, [])).toThrow();
});
