import { evaluateAddonAvailability, validateAddonAvailability } from '../storefrontAddonAvailabilityService';

describe('add-on experience weekday availability', () => {
  it('preserves unrestricted legacy add-ons including undated bookings', () => {
    expect(evaluateAddonAvailability({}, null)).toMatchObject({ available: true });
  });
  it.each([['2026-11-06', true], ['2026-11-07', true], ['2026-11-08', false], ['2026-11-09', false]])(
    'checks the experience date %s, independently of the purchase date', (date, expected) => {
      expect(evaluateAddonAvailability({ availability: { daysOfWeek: [5, 6], unavailableMessage: 'Weekends only' } }, date))
        .toEqual({ available: expected, message: expected ? null : 'Weekends only', requiresExperienceDate: false });
    },
  );
  it('uses ISO Sunday 7 and Monday 1', () => {
    expect(evaluateAddonAvailability({ availability: { daysOfWeek: [7] } }, '2026-11-08').available).toBe(true);
    expect(evaluateAddonAvailability({ availability: { daysOfWeek: [1] } }, '2026-11-09').available).toBe(true);
  });
  it.each([null, '', 'bad', '2026-02-30'])('requires a valid date for restricted add-ons (%s)', (date) => {
    expect(evaluateAddonAvailability({ availability: { daysOfWeek: [1] } }, date))
      .toMatchObject({ available: false, requiresExperienceDate: true });
  });
  it('disables an add-on regardless of weekday and provides a fallback message', () => {
    expect(evaluateAddonAvailability({ availability: { enabled: false, daysOfWeek: [5] } }, '2026-11-06'))
      .toEqual({ available: false, message: expect.any(String), requiresExperienceDate: false });
  });
  it.each([null, [], 'false', { enabled: 'false' }, { daysOfWeek: [] }, { daysOfWeek: [0] },
    { daysOfWeek: [8] }, { daysOfWeek: ['1'] }, { daysOfWeek: [1, 1] }, { daysOfWeek: [1.5] },
    { unavailableMessage: 12 }, { unavailableMessage: 'x'.repeat(501) }])('rejects invalid saved rules %j', (rules) => {
    expect(() => validateAddonAvailability(rules)).toThrow();
  });
  it('accepts omitted rules, disabling, and selected days', () => {
    [undefined, {}, { enabled: false }, { daysOfWeek: [1, 7], unavailableMessage: 'Closed today' }]
      .forEach((rules) => expect(() => validateAddonAvailability(rules)).not.toThrow());
  });
});
