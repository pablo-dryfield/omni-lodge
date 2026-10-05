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

  it('uses a 30 minute default cutoff before the product start time', () => {
    const result = evaluateStorefrontAvailability({}, {
      experienceDate: '2026-08-29',
      experienceTime: '21:00',
      now: new Date('2026-08-29T18:45:00Z'),
    });

    expect(result).toEqual(expect.objectContaining({
      available: false,
      reason: 'cutoff',
      cutoffMinutes: 30,
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

  it('normalizes malformed availability entries out of product config', () => {
    expect(normalizeStorefrontAvailability({
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
