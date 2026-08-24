import {
  normalizeBookingExtrasSnapshot,
  normalizeBookingTshirtSizeSnapshot,
} from './bookingExtras';

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

describe('normalizeBookingTshirtSizeSnapshot', () => {
  it('extracts and combines storefront T-shirt variants', () => {
    expect(
      normalizeBookingTshirtSizeSnapshot({
        addons: [
          {
            name: 'T-Shirts',
            quantity: 4,
            variants: [
              { value: 'S', quantity: 1 },
              { value: ' m ', quantity: 2 },
              { value: 'M', quantity: 1 },
            ],
          },
          { name: 'Instant Photos', quantity: 1, variants: [{ value: 'XL', quantity: 1 }] },
        ],
      }),
    ).toEqual({ S: 1, M: 3 });
  });

  it('supports bare and older single-value storefront snapshots', () => {
    expect(
      normalizeBookingTshirtSizeSnapshot([
        { label: 'T-shirt', value: 'xl', quantity: 2 },
        { name: 'T-Shirts', value: true, quantity: 1 },
      ]),
    ).toEqual({ XL: 2 });
  });

  it('ignores missing and malformed size selections without inventing sizes', () => {
    expect(
      normalizeBookingTshirtSizeSnapshot({
        addons: [
          { name: 'T-Shirts', quantity: 3, variants: [{ value: 'M', quantity: 2 }] },
          { name: 'T-Shirts', quantity: 1, variants: [{ value: 'L', quantity: 0 }] },
          { name: 'T-Shirts', quantity: 1, variants: [{ value: '', quantity: 1 }] },
        ],
      }),
    ).toEqual({ M: 2 });
  });
});
