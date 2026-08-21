import { normalizeBookingExtrasSnapshot } from './bookingExtras';

describe('normalizeBookingExtrasSnapshot', () => {
  it('keeps supporting legacy extras snapshots', () => {
    expect(
      normalizeBookingExtrasSnapshot({
        extras: { cocktails: 2, tshirts: 1, photos: 3 },
      }),
    ).toEqual({ cocktails: 2, tshirts: 1, photos: 3 });
  });

  it('normalizes storefront add-on arrays for counter check-in and metric rebuilding', () => {
    expect(
      normalizeBookingExtrasSnapshot({
        addons: [
          { addonId: 1, name: 'Cocktails', quantity: 4 },
          { label: 'T-shirt', quantity: 2 },
          { category: 'Photo package', quantity: 1 },
        ],
        partyBreakdown: { men: 4, women: 0 },
      }),
    ).toEqual({ cocktails: 4, tshirts: 2, photos: 1 });
  });

  it('keeps canonical extras authoritative over stale raw add-on rows', () => {
    expect(
      normalizeBookingExtrasSnapshot({
        extras: { cocktails: 0, tshirts: 0, photos: 0 },
        addons: [{ addonId: 1, name: 'Cocktails', quantity: 4 }],
      }),
    ).toEqual({ cocktails: 0, tshirts: 0, photos: 0 });
  });

  it('ignores invalid, unknown, and non-positive storefront add-ons', () => {
    expect(
      normalizeBookingExtrasSnapshot({
        addons: [
          null,
          { name: 'Unknown extra', quantity: 5 },
          { name: 'Cocktails', quantity: -1 },
          { name: 'Photos', quantity: 'invalid' },
        ],
      }),
    ).toEqual({ cocktails: 0, tshirts: 0, photos: 0 });
  });
});
