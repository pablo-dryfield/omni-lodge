import dayjs from 'dayjs';
import { resolveAssistantManagerTaskPlannerRange } from './assistantManagerTaskPlannerRange.js';

describe('resolveAssistantManagerTaskPlannerRange', () => {
  it('preserves a week span when the planner begins inside the requested week', () => {
    const range = resolveAssistantManagerTaskPlannerRange({
      requestedStart: dayjs('2026-08-24').startOf('day'),
      requestedEnd: dayjs('2026-08-30').endOf('day'),
      plannerStartDate: dayjs('2026-08-29').startOf('day'),
      preserveRequestedSpan: true,
    });

    expect(range.start.format('YYYY-MM-DD')).toBe('2026-08-29');
    expect(range.end.format('YYYY-MM-DD')).toBe('2026-09-04');
  });

  it('clamps a custom range without extending it when it overlaps the planner start', () => {
    const range = resolveAssistantManagerTaskPlannerRange({
      requestedStart: dayjs('2026-08-24').startOf('day'),
      requestedEnd: dayjs('2026-08-30').endOf('day'),
      plannerStartDate: dayjs('2026-08-29').startOf('day'),
      preserveRequestedSpan: false,
    });

    expect(range.start.format('YYYY-MM-DD')).toBe('2026-08-29');
    expect(range.end.format('YYYY-MM-DD')).toBe('2026-08-30');
  });

  it('moves an entirely pre-planner custom range so the response is never reversed', () => {
    const range = resolveAssistantManagerTaskPlannerRange({
      requestedStart: dayjs('2026-08-10').startOf('day'),
      requestedEnd: dayjs('2026-08-12').endOf('day'),
      plannerStartDate: dayjs('2026-08-29').startOf('day'),
      preserveRequestedSpan: false,
    });

    expect(range.start.format('YYYY-MM-DD')).toBe('2026-08-29');
    expect(range.end.format('YYYY-MM-DD')).toBe('2026-08-31');
  });
});
