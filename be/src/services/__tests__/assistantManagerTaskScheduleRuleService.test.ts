import {
  buildTaskDateGenerationCandidates,
  normalizeRequiredShiftTemplateIds,
  normalizeScheduledWorkdayPlacement,
  resolveAssigneeShiftRequirement,
  selectScheduledCandidatesForWeek,
  taskDateMatchesRequiredShiftTemplates,
} from '../assistantManagerTaskScheduleRuleService';

describe('assistant-manager task shift-template rules', () => {
  it('normalizes and deduplicates required shift-template IDs', () => {
    expect(normalizeRequiredShiftTemplateIds(['4', 4, 7, 0, 'invalid', null])).toEqual([4, 7]);
  });

  it('allows every date when no shift templates are required', () => {
    expect(taskDateMatchesRequiredShiftTemplates([], undefined)).toBe(true);
  });

  it('uses ANY semantics for required shift templates', () => {
    expect(taskDateMatchesRequiredShiftTemplates([4, 7], new Set([7, 9]))).toBe(true);
    expect(taskDateMatchesRequiredShiftTemplates([4, 7], new Set([8, 9]))).toBe(false);
  });
});

describe('assistant-manager task scheduled-workday placement', () => {
  const candidates = [
    { date: '2026-08-24' },
    { date: '2026-08-25' },
    { date: '2026-08-27' },
    { date: '2026-08-28' },
  ];
  const dates = (placement: 'start' | 'middle' | 'end', quota = 2) =>
    selectScheduledCandidatesForWeek(candidates, quota, placement, (candidate) => candidate.date)
      .map((candidate) => candidate.date);

  it('defaults invalid or missing placement values to the beginning', () => {
    expect(normalizeScheduledWorkdayPlacement(undefined)).toBe('start');
    expect(normalizeScheduledWorkdayPlacement('invalid')).toBe('start');
  });

  it('selects the first eligible scheduled workdays', () => {
    expect(dates('start')).toEqual(['2026-08-24', '2026-08-25']);
  });

  it('selects a centered contiguous block of eligible scheduled workdays', () => {
    expect(dates('middle')).toEqual(['2026-08-25', '2026-08-27']);
  });

  it('selects the last eligible scheduled workdays and keeps them chronological', () => {
    expect(dates('end')).toEqual(['2026-08-27', '2026-08-28']);
  });

  it('returns every eligible date when the quota exceeds availability', () => {
    expect(dates('end', 10)).toEqual(candidates.map((candidate) => candidate.date));
  });
});

describe('assistant-manager task assignee schedule enforcement', () => {
  const scheduledCandidates = [
    { userId: 11, shiftInfo: { id: 101 } },
    { userId: 11, shiftInfo: { id: 102 } },
    { userId: 12, shiftInfo: { id: 103 } },
  ];

  it('preserves scheduled-only behavior when the setting is absent', () => {
    expect(resolveAssigneeShiftRequirement(undefined)).toBe(true);
    expect(resolveAssigneeShiftRequirement({})).toBe(true);
  });

  it('supports the current and legacy off-day settings', () => {
    expect(resolveAssigneeShiftRequirement({ requireShift: false })).toBe(false);
    expect(resolveAssigneeShiftRequirement({ requireScheduledShift: false })).toBe(false);
    expect(resolveAssigneeShiftRequirement({ allowOffDays: true })).toBe(false);
  });

  it('uses only scheduled assignees when a shift is required', () => {
    expect(buildTaskDateGenerationCandidates({
      requireShift: true,
      scheduledCandidates,
      audienceUserIds: [11, 12, 13],
    })).toEqual([
      { userId: 11, shiftInfo: { id: 101 } },
      { userId: 12, shiftInfo: { id: 103 } },
    ]);
  });

  it('includes the full assignment audience when off-day tasks are allowed', () => {
    expect(buildTaskDateGenerationCandidates({
      requireShift: false,
      scheduledCandidates,
      audienceUserIds: [11, 12, 13, 13],
    })).toEqual([
      { userId: 11, shiftInfo: { id: 101 } },
      { userId: 12, shiftInfo: { id: 103 } },
      { userId: 13, shiftInfo: null },
    ]);
  });

  it('can place an off-shift weekly quota at the end of the calendar week', () => {
    const weekDates = [
      '2026-08-24',
      '2026-08-25',
      '2026-08-26',
      '2026-08-27',
      '2026-08-28',
      '2026-08-29',
      '2026-08-30',
    ];
    const candidates = weekDates.flatMap((taskDate) =>
      buildTaskDateGenerationCandidates({
        requireShift: false,
        scheduledCandidates: [],
        audienceUserIds: [13],
      }).map((candidate) => ({ ...candidate, taskDate })),
    );

    expect(selectScheduledCandidatesForWeek(
      candidates,
      2,
      'end',
      (candidate) => candidate.taskDate,
    ).map((candidate) => candidate.taskDate)).toEqual(['2026-08-29', '2026-08-30']);
  });
});
