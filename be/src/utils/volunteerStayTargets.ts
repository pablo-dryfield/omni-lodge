export type VolunteerPosition = 'guide' | 'social_media';

export type VolunteerMonthlyTargets = {
  reviews: number;
  guidingShifts: number;
  promotionShifts: number;
  socialMediaShifts: number;
  cleaningTasks: number;
  attendancePercent: number;
};

export const DEFAULT_VOLUNTEER_MONTHLY_TARGETS: Readonly<VolunteerMonthlyTargets> = Object.freeze({
  reviews: 15,
  guidingShifts: 12,
  promotionShifts: 12,
  socialMediaShifts: 16,
  cleaningTasks: 5,
  attendancePercent: 90,
});

export type VolunteerStayTargetInput = {
  startDate: string;
  endDate: string;
  /** Exclusive date boundary: use tomorrow to include all of today's local date. */
  asOfDate: string;
  position: VolunteerPosition;
  monthlyTargets?: Partial<VolunteerMonthlyTargets>;
};

export type VolunteerStayTargetResult = {
  equivalentMonths: number;
  elapsedMonths: number;
  targets: VolunteerMonthlyTargets;
  expectedToDate: VolunteerMonthlyTargets;
};

const parseDateOnly = (value: string, field: string): Date => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new RangeError(`${field} must be a valid YYYY-MM-DD date`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new RangeError(`${field} must be a valid YYYY-MM-DD date`);
  }
  return date;
};

const anniversary = (arrival: Date, months: number): Date => {
  const monthIndex = arrival.getUTCMonth() + months;
  const lastDay = new Date(0);
  lastDay.setUTCFullYear(arrival.getUTCFullYear(), monthIndex + 1, 0);
  const result = new Date(0);
  result.setUTCFullYear(
    lastDay.getUTCFullYear(),
    lastDay.getUTCMonth(),
    Math.min(arrival.getUTCDate(), lastDay.getUTCDate()),
  );
  return result;
};

/** Each anniversary is derived from the original arrival day, never the previous anniversary. */
const monthsBetween = (arrival: Date, boundary: Date): number => {
  if (boundary.getTime() <= arrival.getTime()) return 0;
  let fullMonths = (boundary.getUTCFullYear() - arrival.getUTCFullYear()) * 12
    + boundary.getUTCMonth() - arrival.getUTCMonth();
  if (anniversary(arrival, fullMonths).getTime() > boundary.getTime()) fullMonths -= 1;
  const previous = anniversary(arrival, fullMonths).getTime();
  const next = anniversary(arrival, fullMonths + 1).getTime();
  return fullMonths + (boundary.getTime() - previous) / (next - previous);
};

const normalizeMonthlyTargets = (
  overrides: Partial<VolunteerMonthlyTargets> | undefined,
): VolunteerMonthlyTargets => {
  if (overrides !== undefined && (!overrides || typeof overrides !== 'object' || Array.isArray(overrides))) {
    throw new RangeError('monthlyTargets must be an object');
  }
  const targets = { ...DEFAULT_VOLUNTEER_MONTHLY_TARGETS, ...overrides };
  for (const key of Object.keys(targets)) {
    if (!Object.prototype.hasOwnProperty.call(DEFAULT_VOLUNTEER_MONTHLY_TARGETS, key)) {
      throw new RangeError(`Unknown monthly target: ${key}`);
    }
    const value = targets[key as keyof VolunteerMonthlyTargets];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) {
      throw new RangeError(`${key} must be a finite non-negative monthly target`);
    }
  }
  if (targets.attendancePercent > 100) throw new RangeError('attendancePercent must be between 0 and 100');
  return targets;
};

const scale = (rate: number, months: number): number => {
  const target = rate * months;
  if (!Number.isFinite(target) || target > Number.MAX_SAFE_INTEGER) {
    throw new RangeError('The stay target exceeds the supported numeric range');
  }
  return target === 0 ? 0 : target;
};

const wholeCountTarget = (rate: number, months: number): number => {
  const target = scale(rate, months);
  const nearest = Math.round(target);
  const tolerance = Math.min(1e-9, Number.EPSILON * Math.max(1, target) * 8);
  // Remove only machine-precision noise around positive integer boundaries.
  // A genuinely positive tiny target must still require one whole task.
  return nearest > 0 && Math.abs(target - nearest) <= tolerance ? nearest : Math.ceil(target);
};

const targetsForMonths = (
  monthly: VolunteerMonthlyTargets,
  months: number,
  position: VolunteerPosition,
): VolunteerMonthlyTargets => ({
  // Requirements are whole activities. Earned review credits remain fractional
  // in the stay service and are compared against this rounded-up target.
  reviews: wholeCountTarget(monthly.reviews, months),
  guidingShifts: position === 'guide' ? wholeCountTarget(monthly.guidingShifts, months) : 0,
  promotionShifts: position === 'guide' ? wholeCountTarget(monthly.promotionShifts, months) : 0,
  socialMediaShifts: position === 'social_media' ? wholeCountTarget(monthly.socialMediaShifts, months) : 0,
  cleaningTasks: wholeCountTarget(monthly.cleaningTasks, months),
  // Attendance is a percentage threshold, not a count prorated by stay length.
  attendancePercent: monthly.attendancePercent,
});

/**
 * Date-only, timezone-independent targets for [startDate, endDate). A month is
 * an arrival anniversary interval, including end-of-month clamping. Expected
 * progress uses the same arrival anchor and clamps asOfDate to the stay.
 */
export const calculateVolunteerStayTargets = (
  input: VolunteerStayTargetInput,
): VolunteerStayTargetResult => {
  const arrival = parseDateOnly(input.startDate, 'startDate');
  const departure = parseDateOnly(input.endDate, 'endDate');
  const asOf = parseDateOnly(input.asOfDate, 'asOfDate');
  if (departure.getTime() <= arrival.getTime()) throw new RangeError('endDate must be after startDate');
  if (input.position !== 'guide' && input.position !== 'social_media') {
    throw new RangeError('position must be guide or social_media');
  }
  const monthly = normalizeMonthlyTargets(input.monthlyTargets);
  const equivalentMonths = monthsBetween(arrival, departure);
  const elapsedMonths = monthsBetween(
    arrival,
    new Date(Math.max(arrival.getTime(), Math.min(asOf.getTime(), departure.getTime()))),
  );
  return {
    equivalentMonths,
    elapsedMonths,
    targets: targetsForMonths(monthly, equivalentMonths, input.position),
    expectedToDate: targetsForMonths(monthly, elapsedMonths, input.position),
  };
};
