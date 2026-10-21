import { getCounterVenueCounts } from './counterVenueCounts';

describe('counter attendance to Venue Numbers', () => {
  it('keeps six normal guests, one free guest and two cocktail guests as nine attendees', () => {
    expect(getCounterVenueCounts({
      peopleAttended: 6,
      cocktailsAttended: 2,
      freePeople: 1,
    })).toEqual({ normalCount: 7, cocktailsCount: 2, brunchCount: 0, totalPeople: 9 });
  });

  it('does not subtract cocktail guests from the already-normal people bucket', () => {
    expect(getCounterVenueCounts({ peopleAttended: 11, cocktailsAttended: 4 }))
      .toEqual({ normalCount: 11, cocktailsCount: 4, brunchCount: 0, totalPeople: 15 });
  });

  it('keeps a cocktail-only night operating instead of losing its attendees', () => {
    expect(getCounterVenueCounts({ peopleAttended: 0, cocktailsAttended: 2 }))
      .toEqual({ normalCount: 0, cocktailsCount: 2, brunchCount: 0, totalPeople: 2 });
  });

  it('moves a free cocktail upgrade out of normal without adding an extra guest', () => {
    expect(getCounterVenueCounts({
      peopleAttended: 6,
      cocktailsAttended: 2,
      freeCocktails: 1,
    })).toEqual({ normalCount: 5, cocktailsCount: 3, brunchCount: 0, totalPeople: 8 });
  });

  it('counts a free guest with a cocktail upgrade only once', () => {
    expect(getCounterVenueCounts({
      peopleAttended: 6,
      cocktailsAttended: 2,
      freePeople: 1,
      freeCocktails: 1,
    })).toEqual({ normalCount: 6, cocktailsCount: 3, brunchCount: 0, totalPeople: 9 });
  });

  it('preserves brunch guests as a subset of the people bucket', () => {
    expect(getCounterVenueCounts({ peopleAttended: 6, brunchAttended: 6 }))
      .toEqual({ normalCount: 0, cocktailsCount: 0, brunchCount: 6, totalPeople: 6 });
  });

  it('keeps free brunch guests out of normal counts', () => {
    expect(getCounterVenueCounts({
      peopleAttended: 6,
      brunchAttended: 6,
      freePeople: 1,
      freeBrunch: 1,
    })).toEqual({ normalCount: 0, cocktailsCount: 0, brunchCount: 7, totalPeople: 7 });
  });

  it('preserves mixed normal, cocktail and brunch buckets without overlap', () => {
    expect(getCounterVenueCounts({
      peopleAttended: 6,
      cocktailsAttended: 2,
      brunchAttended: 2,
    })).toEqual({ normalCount: 4, cocktailsCount: 2, brunchCount: 2, totalPeople: 8 });
  });

  it('counts normal-only guests unchanged', () => {
    expect(getCounterVenueCounts({ peopleAttended: 6 }))
      .toEqual({ normalCount: 6, cocktailsCount: 0, brunchCount: 0, totalPeople: 6 });
  });

  it('counts a free-only night', () => {
    expect(getCounterVenueCounts({ peopleAttended: 0, freePeople: 1 }))
      .toEqual({ normalCount: 1, cocktailsCount: 0, brunchCount: 0, totalPeople: 1 });
  });

  it('leaves an empty night at zero', () => {
    expect(getCounterVenueCounts({ peopleAttended: 0 }))
      .toEqual({ normalCount: 0, cocktailsCount: 0, brunchCount: 0, totalPeople: 0 });
  });

  it('normalizes invalid counts without producing negative or non-finite totals', () => {
    expect(getCounterVenueCounts({
      peopleAttended: Number.NaN,
      cocktailsAttended: -1,
      brunchAttended: Number.POSITIVE_INFINITY,
      freePeople: -2,
    })).toEqual({ normalCount: 0, cocktailsCount: 0, brunchCount: 0, totalPeople: 0 });
  });
});
