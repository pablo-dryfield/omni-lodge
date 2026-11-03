import type { NightReportVenue, NightReportVenueInput } from '../types/nightReports/NightReport';

type Attendance = {
  normalCount: number;
  cocktailsCount: number;
  brunchCount?: number;
};

/** Update open-bar attendance without discarding saved route or commission details. */
export const buildCounterNightReportVenues = (
  venues: NightReportVenue[],
  attendance: Attendance,
): NightReportVenueInput[] => {
  const inputs = venues.map((venue): NightReportVenueInput => ({
    orderIndex: venue.orderIndex,
    routeIndex: venue.routeIndex,
    venueId: venue.venueId ?? undefined,
    venueName: venue.venueName,
    totalPeople: venue.totalPeople,
    isOpenBar: venue.isOpenBar,
    normalCount: venue.normalCount,
    cocktailsCount: venue.cocktailsCount,
    brunchCount: venue.brunchCount,
    stayDurationMinutes: venue.stayDurationMinutes,
  }));
  const openBars = inputs.filter((venue) => venue.isOpenBar);
  const brunchCount = attendance.brunchCount
    ?? openBars.reduce((sum, venue) => sum + (venue.brunchCount ?? 0), 0);

  // The counter has aggregate attendance, so it cannot allocate a changed total
  // between multiple open bars. Preserve those allocations instead of deleting
  // other routes or applying the whole counter to one route.
  if (openBars.length > 1) {
    const sum = (key: 'normalCount' | 'cocktailsCount' | 'brunchCount') =>
      openBars.reduce((total, venue) => total + (venue[key] ?? 0), 0);
    if (sum('normalCount') !== attendance.normalCount
      || sum('cocktailsCount') !== attendance.cocktailsCount || sum('brunchCount') !== brunchCount) {
      throw new Error('This report has multiple open bars. Update their attendance in Venue Numbers to match the counter, then save again.');
    }
    return inputs;
  }

  const openBar = openBars[0] ?? inputs[0];
  const counts = {
    normalCount: attendance.normalCount,
    cocktailsCount: attendance.cocktailsCount,
    brunchCount,
    totalPeople: attendance.normalCount + attendance.cocktailsCount + brunchCount,
  };
  if (!openBar) {
    return [{ orderIndex: 1, routeIndex: 1, venueName: 'Select Open Bar', isOpenBar: true, ...counts }];
  }
  return inputs.map((venue) => venue === openBar ? { ...venue, isOpenBar: true, ...counts } : venue);
};
