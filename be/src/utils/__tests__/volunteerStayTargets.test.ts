import {
  calculateVolunteerStayTargets,
  DEFAULT_VOLUNTEER_MONTHLY_TARGETS,
  type VolunteerStayTargetInput,
} from '../volunteerStayTargets';

const calculate = (overrides: Partial<VolunteerStayTargetInput> = {}) => calculateVolunteerStayTargets({
  startDate: '2026-08-15', endDate: '2026-09-30', asOfDate: '2026-09-30', position: 'guide', ...overrides,
});

describe('volunteer stay targets', () => {
  it('uses 1.5 months for August 15 through September 30 and preserves fractional review credits', () => {
    const result = calculate();
    expect(result.equivalentMonths).toBe(1.5);
    expect(result.elapsedMonths).toBe(1.5);
    expect(result.targets).toEqual({
      reviews: 22.5, guidingShifts: 18, promotionShifts: 18, socialMediaShifts: 0,
      cleaningTasks: 8, attendancePercent: 90,
    });
    expect(result.expectedToDate).toEqual(result.targets);
  });

  it.each([
    ['2026-08-15', '2026-09-15', 1],
    ['2026-08-01', '2026-09-01', 1],
    ['2026-08-15', '2026-10-15', 2],
    ['2026-08-15', '2026-11-15', 3],
    ['2026-12-15', '2027-01-15', 1],
  ])('uses complete anniversary months for %s to %s', (startDate, endDate, months) => {
    const result = calculate({ startDate, endDate, asOfDate: endDate });
    expect(result.equivalentMonths).toBe(months);
    expect(result.targets.reviews).toBe(15 * months);
    expect(result.targets.cleaningTasks).toBe(5 * months);
  });

  it('handles two-thirds of a month without rounding each elapsed day', () => {
    const result = calculate({ startDate: '2026-04-01', endDate: '2026-04-21', asOfDate: '2026-04-11' });
    expect(result.equivalentMonths).toBeCloseTo(2 / 3, 14);
    expect(result.elapsedMonths).toBeCloseTo(1 / 3, 14);
    expect(result.targets).toMatchObject({ reviews: 10, guidingShifts: 8, cleaningTasks: 4 });
    expect(result.expectedToDate).toMatchObject({ reviews: 5, guidingShifts: 4, cleaningTasks: 2 });
  });

  it('derives January 31 anniversaries from arrival without February drift', () => {
    expect(calculate({ startDate: '2026-01-31', endDate: '2026-02-28', asOfDate: '2026-02-28' }).equivalentMonths).toBe(1);
    const result = calculate({ startDate: '2026-01-31', endDate: '2026-03-31', asOfDate: '2026-03-28' });
    expect(result.equivalentMonths).toBe(2);
    expect(result.elapsedMonths).toBeCloseTo(1 + 28 / 31, 14);
    expect(calculate({ startDate: '2026-01-31', endDate: '2026-03-31', asOfDate: '2026-02-28' }).elapsedMonths).toBe(1);
  });

  it('uses leap-day anniversary boundaries and UTC calendar days across DST changes', () => {
    expect(calculate({ startDate: '2024-01-31', endDate: '2024-02-29', asOfDate: '2024-02-29' }).equivalentMonths).toBe(1);
    expect(calculate({ startDate: '2024-02-29', endDate: '2025-02-28', asOfDate: '2025-02-28' }).equivalentMonths).toBe(12);
    expect(calculate({ startDate: '2026-03-01', endDate: '2026-04-01', asOfDate: '2026-03-31' }).elapsedMonths).toBeCloseTo(30 / 31, 14);
  });

  it('uses role-specific shifts and keeps common targets', () => {
    expect(calculate({ position: 'social_media' }).targets).toEqual({
      reviews: 22.5, guidingShifts: 0, promotionShifts: 0, socialMediaShifts: 24,
      cleaningTasks: 8, attendancePercent: 90,
    });
  });

  it('clamps expected progress before arrival and after departure', () => {
    expect(calculate({ asOfDate: '2026-08-01' })).toMatchObject({
      elapsedMonths: 0,
      expectedToDate: { reviews: 0, guidingShifts: 0, promotionShifts: 0, socialMediaShifts: 0, cleaningTasks: 0, attendancePercent: 90 },
    });
    expect(calculate({ asOfDate: '2026-08-15' }).elapsedMonths).toBe(0);
    const after = calculate({ asOfDate: '2027-08-15' });
    expect(after.elapsedMonths).toBe(after.equivalentMonths);
    expect(after.expectedToDate).toEqual(after.targets);
  });

  it('uses an explicit exclusive as-of boundary and handles a one-day stay', () => {
    const result = calculate({ startDate: '2026-08-15', endDate: '2026-08-16', asOfDate: '2026-08-16' });
    expect(result.equivalentMonths).toBeCloseTo(1 / 31, 14);
    expect(result.targets.reviews).toBeCloseTo(15 / 31, 14);
    expect(result.targets).toMatchObject({ guidingShifts: 1, promotionShifts: 1, cleaningTasks: 1 });
  });

  it('removes only floating-point noise when ceiling whole-task targets', () => {
    const result = calculate({
      startDate: '2026-08-01', endDate: '2026-09-01', asOfDate: '2026-09-01',
      monthlyTargets: { guidingShifts: 12 + Number.EPSILON * 8, cleaningTasks: 5.00001, promotionShifts: 1e-15 },
    });
    expect(result.targets.guidingShifts).toBe(12);
    expect(result.targets.cleaningTasks).toBe(6);
    expect(result.targets.promotionShifts).toBe(1);
  });

  it('supports explicit zero targets and retains tiny fractional review targets', () => {
    const result = calculate({ monthlyTargets: { reviews: 1e-12, guidingShifts: 0, promotionShifts: 0, cleaningTasks: 0 } });
    expect(result.targets.reviews).toBe(1.5e-12);
    expect(result.targets).toMatchObject({ guidingShifts: 0, promotionShifts: 0, cleaningTasks: 0 });
    expect(DEFAULT_VOLUNTEER_MONTHLY_TARGETS.reviews).toBe(15);
  });

  it.each(['2026-02-29', '2026-04-31', '2026-13-01', '2026-00-01', '2026-08-00', '2026-8-15', '', '2026-08-15T00:00:00Z'])('rejects invalid date %s', (value) => {
    for (const key of ['startDate', 'endDate', 'asOfDate']) {
      expect(() => calculate({ [key]: value })).toThrow(RangeError);
    }
  });

  it.each(['2026-08-15', '2026-08-14'])('rejects departure %s that is not after arrival', (endDate) => {
    expect(() => calculate({ endDate })).toThrow('endDate must be after startDate');
  });

  it.each([-1, NaN, Infinity, -Infinity, Number.MAX_VALUE])('rejects unsafe monthly target %s', (reviews) => {
    expect(() => calculate({ monthlyTargets: { reviews } })).toThrow(RangeError);
  });

  it('rejects invalid percentages, positions, and overflowing scaled targets', () => {
    expect(() => calculate({ monthlyTargets: { attendancePercent: 101 } })).toThrow(RangeError);
    expect(() => calculate({ position: 'other' as never })).toThrow(RangeError);
    expect(() => calculate({ monthlyTargets: { reviews: Number.MAX_SAFE_INTEGER } })).toThrow(RangeError);
  });
});
