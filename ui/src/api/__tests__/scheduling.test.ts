import { formatScheduleWeekLabel, getUpcomingWeeks } from '../scheduling';

describe('scheduling helpers', () => {
  it('formats week label', () => {
    expect(formatScheduleWeekLabel(2025, 5)).toBe('Week 05 / 2025');
    expect(formatScheduleWeekLabel(2025, 12)).toBe('Week 12 / 2025');
  });

  it('returns sequential upcoming weeks', () => {
    const items = getUpcomingWeeks(3);
    expect(items).toHaveLength(3);
    const isoValues = items.map((item) => item.value);
    const unique = new Set(isoValues);
    expect(unique.size).toBe(3);
  });
});

