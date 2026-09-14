import {
  buildAssistantManagerTaskDeepLink,
  normalizeAssistantManagerTaskDate,
  parseAssistantManagerTaskDeepLink,
} from './assistantManagerTaskDeepLink';

describe('assistant manager task deep links', () => {
  it('includes the task date so a task outside the current planner window can be loaded', () => {
    expect(buildAssistantManagerTaskDeepLink(21, '2026-09-07')).toBe(
      '/assistant-manager-tasks?section=dashboard&task=21&taskDate=2026-09-07',
    );
  });

  it('accepts only real ISO calendar dates', () => {
    expect(normalizeAssistantManagerTaskDate(' 2028-02-29 ')).toBe('2028-02-29');
    expect(normalizeAssistantManagerTaskDate('2026-02-29')).toBeNull();
    expect(normalizeAssistantManagerTaskDate('09/07/2026')).toBeNull();
  });

  it('omits an invalid optional date while keeping a usable task link', () => {
    expect(buildAssistantManagerTaskDeepLink(22, 'not-a-date')).toBe(
      '/assistant-manager-tasks?section=dashboard&task=22',
    );
  });

  it('honors a date only when it belongs to a valid requested task', () => {
    expect(parseAssistantManagerTaskDeepLink(new URLSearchParams(
      'task=21&taskDate=2026-09-07',
    ))).toEqual({ taskId: 21, taskDate: '2026-09-07' });
    expect(parseAssistantManagerTaskDeepLink(new URLSearchParams(
      'taskDate=2026-09-07',
    ))).toEqual({ taskId: null, taskDate: null });
    expect(parseAssistantManagerTaskDeepLink(new URLSearchParams(
      'task=invalid&taskDate=2026-09-07',
    ))).toEqual({ taskId: null, taskDate: null });
  });
});
