import type { NightReportVenue } from '../types/nightReports/NightReport';
import { getCounterVenueCounts } from './counterVenueCounts';
import { buildCounterNightReportVenues } from './counterNightReportVenues';

const venue = (changes: Partial<NightReportVenue>): NightReportVenue => ({
  id: 1, orderIndex: 1, routeIndex: 1, venueId: 10, venueName: 'Open bar',
  totalPeople: 14, isOpenBar: true, normalCount: 12, cocktailsCount: 2, brunchCount: 0,
  stayDurationMinutes: null, compensationTermId: 1, compensationType: 'open_bar',
  compensationDirection: 'payable', rateApplied: 346, rateUnit: 'per_person',
  payoutAmount: 346, currencyCode: 'PLN', ...changes,
});

describe('counter save to Venue Numbers', () => {
  it.each([
    { peopleAttended: 14, cocktailsAttended: 2, freePeople: 0, normal: 14, total: 16 },
    { peopleAttended: 6, cocktailsAttended: 2, freePeople: 1, normal: 7, total: 9 },
  ])('saves $normal normal and 2 cocktail guests while preserving commission details', (attendance) => {
    const original = [venue({}), venue({
      id: 2, orderIndex: 2, venueId: 20, venueName: 'Duration-based commission venue',
      isOpenBar: false, totalPeople: 19, normalCount: null, cocktailsCount: null,
      brunchCount: null, stayDurationMinutes: 60, compensationType: 'commission',
    })];
    const before = JSON.parse(JSON.stringify(original));
    const result = buildCounterNightReportVenues(original, getCounterVenueCounts(attendance));

    expect(result[0]).toMatchObject({ normalCount: attendance.normal, cocktailsCount: 2, totalPeople: attendance.total });
    expect(result[1]).toEqual({
      orderIndex: 2, routeIndex: 1, venueId: 20, venueName: 'Duration-based commission venue',
      totalPeople: 19, isOpenBar: false, normalCount: null, cocktailsCount: null,
      brunchCount: null, stayDurationMinutes: 60,
    });
    expect(original).toEqual(before);
  });

  it('keeps route assignments and other open bars when their allocations match the counter', () => {
    const original = [
      venue({ normalCount: 5, cocktailsCount: 1, totalPeople: 6 }),
      venue({ id: 2, routeIndex: 2, venueId: 11, normalCount: 2, cocktailsCount: 1, totalPeople: 3 }),
      venue({ id: 3, routeIndex: 2, orderIndex: 2, venueId: 20, isOpenBar: false, stayDurationMinutes: 60 }),
    ];
    const result = buildCounterNightReportVenues(original, { normalCount: 7, cocktailsCount: 2, brunchCount: 0 });
    expect(result).toHaveLength(3);
    expect(result[1]).toMatchObject({ routeIndex: 2, orderIndex: 1, venueId: 11, normalCount: 2, cocktailsCount: 1 });
    expect(result[2]).toMatchObject({ routeIndex: 2, orderIndex: 2, stayDurationMinutes: 60 });
  });

  it('refuses to guess a changed attendance allocation between multiple open bars', () => {
    const original = [venue({}), venue({ id: 2, routeIndex: 2 })];
    expect(() => buildCounterNightReportVenues(original, { normalCount: 14, cocktailsCount: 2 }))
      .toThrow('Update their attendance in Venue Numbers');
    expect(original[1].isOpenBar).toBe(true);
  });

  it('preserves legacy brunch counts only when the counter has no brunch bucket', () => {
    const original = [venue({ brunchCount: 3 })];
    expect(buildCounterNightReportVenues(original, { normalCount: 4, cocktailsCount: 2 })[0])
      .toMatchObject({ brunchCount: 3, totalPeople: 9 });
    expect(buildCounterNightReportVenues(original, { normalCount: 4, cocktailsCount: 2, brunchCount: 0 })[0])
      .toMatchObject({ brunchCount: 0, totalPeople: 6 });
  });
});
