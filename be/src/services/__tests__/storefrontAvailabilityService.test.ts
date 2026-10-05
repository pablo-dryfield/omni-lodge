import {
  collectAvailabilityRedirectProductIds,
  evaluateStorefrontAvailability,
  normalizeStorefrontAvailability,
  withAvailabilityRedirectSlugs,
} from '../storefrontAvailabilityService';

describe('storefront availability rules', () => {
  it('blocks configured product dates and preserves redirect targets', () => {
    const result = evaluateStorefrontAvailability({
      availability: {
        blockedDates: [{
          date: '2026-12-31',
          reason: 'Use the New Year party product.',
          redirectProductId: 91,
          redirectProductSlug: 'new-year-party-91',
        }],
      },
    }, {
      experienceDate: '2026-12-31',
      experienceTime: '21:00',
      now: new Date('2026-12-30T12:00:00Z'),
    });

    expect(result).toEqual(expect.objectContaining({
      available: false,
      reason: 'blocked_date',
      message: 'Use the New Year party product.',
      redirectProductId: 91,
      redirectProductSlug: 'new-year-party-91',
    }));
  });

  it('uses a zero minute default cutoff before the product start time', () => {
    const result = evaluateStorefrontAvailability({}, {
      experienceDate: '2026-08-29',
      experienceTime: '21:00',
      now: new Date('2026-08-29T18:45:00Z'),
    });

    expect(result).toEqual(expect.objectContaining({
      available: true,
      reason: 'available',
      cutoffMinutes: 0,
    }));
  });

  it('lets a date override reopen a blocked date with its own cutoff', () => {
    const config = {
      availability: {
        cutoffMinutes: 360,
        blockedDates: [{ date: '2026-10-31' }],
        dateOverrides: [{
          date: '2026-10-31',
          mode: 'available' as const,
          cutoffMinutes: 30,
        }],
      },
    };

    expect(evaluateStorefrontAvailability(config, {
      experienceDate: '2026-10-31',
      experienceTime: '21:00',
      now: new Date('2026-10-31T17:30:00Z'),
    })).toEqual(expect.objectContaining({
      available: true,
      cutoffMinutes: 30,
    }));

    expect(evaluateStorefrontAvailability(config, {
      experienceDate: '2026-10-31',
      experienceTime: '21:00',
      now: new Date('2026-10-31T19:45:00Z'),
    })).toEqual(expect.objectContaining({
      available: false,
      reason: 'cutoff',
      cutoffMinutes: 30,
    }));
  });

  it('fixes an event to one configured date', () => {
    const config = {
      availability: {
        dateMode: 'fixed' as const,
        fixedDate: '2026-12-31',
      },
    };

    expect(evaluateStorefrontAvailability(config, {
      experienceDate: null,
      experienceTime: '21:00',
      now: new Date('2026-12-30T12:00:00Z'),
    })).toEqual(expect.objectContaining({
      available: true,
      reason: 'available',
    }));

    expect(evaluateStorefrontAvailability(config, {
      experienceDate: '2026-12-30',
      experienceTime: '21:00',
      now: new Date('2026-12-30T12:00:00Z'),
    })).toEqual(expect.objectContaining({
      available: false,
      reason: 'fixed_date_mismatch',
      message: 'This experience is only available on 31 Dec 2026.',
    }));
  });

  it('limits allowed-date products to configured dates only', () => {
    const config = {
      availability: {
        dateMode: 'allowed_dates' as const,
        allowedDates: ['2026-10-31', '2026-12-31'],
      },
    };

    expect(evaluateStorefrontAvailability(config, {
      experienceDate: '2026-10-31',
      experienceTime: '21:00',
      now: new Date('2026-10-30T12:00:00Z'),
    })).toEqual(expect.objectContaining({
      available: true,
      reason: 'available',
    }));

    expect(evaluateStorefrontAvailability(config, {
      experienceDate: '2026-11-01',
      experienceTime: '21:00',
      now: new Date('2026-10-30T12:00:00Z'),
    })).toEqual(expect.objectContaining({
      available: false,
      reason: 'not_allowed_date',
      message: 'This date is not available for this experience.',
    }));
  });

  it('normalizes malformed availability entries out of product config', () => {
    expect(normalizeStorefrontAvailability({
      dateMode: 'allowed dates only',
      fixedDate: 'not-a-date',
      allowedDates: ['2026-10-31', 'bad', '2026-10-31'],
      cutoffMinutes: '45',
      blockedDates: [
        { date: '2026-12-31', redirectProductId: '91' },
        { date: '12/31/2026' },
      ],
      dateOverrides: [
        { date: '2026-10-31', mode: 'blocked', enabled: false },
        { date: 'not-a-date' },
      ],
    })).toEqual({
      dateMode: 'allowed_dates',
      allowedDates: ['2026-10-31'],
      cutoffMinutes: 45,
      blockedDates: [{ date: '2026-12-31', redirectProductId: 91 }],
      dateOverrides: [{ date: '2026-10-31', enabled: false, mode: 'blocked' }],
    });
  });

  it('collects and attaches redirect product slugs', () => {
    const config = {
      availability: {
        blockedDates: [{ date: '2026-12-31', redirectProductId: 91 }],
        dateOverrides: [{ date: '2026-10-31', mode: 'blocked' as const, redirectProductId: 92 }],
      },
    };

    expect(collectAvailabilityRedirectProductIds(config)).toEqual([91, 92]);
    expect(withAvailabilityRedirectSlugs(
      config,
      new Map([[91, 'nye-91'], [92, 'halloween-92']]),
    )).toEqual({
      availability: {
        blockedDates: [{ date: '2026-12-31', redirectProductId: 91, redirectProductSlug: 'nye-91' }],
        dateOverrides: [{
          date: '2026-10-31',
          enabled: true,
          mode: 'blocked',
          redirectProductId: 92,
          redirectProductSlug: 'halloween-92',
        }],
      },
    });
  });
});
