import {
  buildStorefrontAddonsSnapshot,
  getStorefrontExperienceStartAt,
  getStorefrontPartyBreakdown,
  mergeStorefrontAddonsSnapshot,
} from '../storefrontBookingProjectionService';

describe('storefront booking projection', () => {
  it('preserves the storefront men and women selection', () => {
    expect(
      getStorefrontPartyBreakdown({ participants: { men: 1, women: 0 } }, 1),
    ).toEqual({ men: 1, women: 0 });

    expect(
      buildStorefrontAddonsSnapshot([], { participants: { men: 1, women: 0 } }, 1),
    ).toEqual({ addons: [], partyBreakdown: { men: 1, women: 0 } });
  });

  it('creates the Warsaw start timestamp from the selected date and time', () => {
    expect(getStorefrontExperienceStartAt('2026-08-07', '21:00')?.toISOString()).toBe(
      '2026-08-07T19:00:00.000Z',
    );
    expect(getStorefrontExperienceStartAt('2026-08-07', null)).toBeNull();
  });

  it('repairs a legacy array snapshot without dropping its add-ons', () => {
    const addons = [{ name: 'Photos', quantity: 1 }];
    expect(
      mergeStorefrontAddonsSnapshot(addons, addons, { participants: { men: 0, women: 2 } }, 2),
    ).toEqual({ addons, partyBreakdown: { men: 0, women: 2 } });
  });

  it('returns a new object when repairing an object snapshot', () => {
    const current = { addons: [] };
    const repaired = mergeStorefrontAddonsSnapshot(
      current,
      [],
      { participants: { men: 1, women: 0 } },
      1,
    );

    expect(repaired).not.toBe(current);
    expect(current).toEqual({ addons: [] });
    expect(repaired.partyBreakdown).toEqual({ men: 1, women: 0 });
  });
});
