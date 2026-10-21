type CounterVenueAttendance = {
  peopleAttended: number;
  cocktailsAttended?: number;
  brunchAttended?: number;
  freePeople?: number;
  freeCocktails?: number;
  freeBrunch?: number;
};

const normalizeCount = (value = 0): number =>
  Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;

/** Convert counter attendance buckets into mutually exclusive open-bar counts. */
export const getCounterVenueCounts = ({
  peopleAttended,
  cocktailsAttended,
  brunchAttended,
  freePeople,
  freeCocktails,
  freeBrunch,
}: CounterVenueAttendance) => {
  const cocktailsCount = normalizeCount(cocktailsAttended) + normalizeCount(freeCocktails);
  const brunchCount = normalizeCount(brunchAttended) + normalizeCount(freeBrunch);
  // Counter people already excludes paid cocktail guests. Only free cocktail
  // upgrades and brunch guests still need to move out of this normal bucket.
  const normalCount = Math.max(
    0,
    normalizeCount(peopleAttended) + normalizeCount(freePeople) - normalizeCount(freeCocktails) - brunchCount,
  );

  return {
    normalCount,
    cocktailsCount,
    brunchCount,
    totalPeople: normalCount + cocktailsCount + brunchCount,
  };
};
