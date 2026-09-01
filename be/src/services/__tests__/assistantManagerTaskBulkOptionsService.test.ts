import {
  mergeAssistantManagerTaskBulkOptions,
  parseAssistantManagerTaskBulkOptionsPayload,
} from '../assistantManagerTaskBulkOptionsService';

describe('assistant-manager task bulk options payload validation', () => {
  it('accepts the supported options without coercing their values', () => {
    expect(parseAssistantManagerTaskBulkOptionsPayload({
      templateIds: [3, 8],
      options: {
        requireShift: false,
        requireSocialMediaPlan: true,
        completionWindowMode: 'strict',
        priority: 'high',
        notifyAtStart: true,
        scheduledWorkdayPlacement: 'end',
        requiredShiftTemplateIds: [4, 9],
      },
    })).toEqual({
      templateIds: [3, 8],
      options: {
        requireShift: false,
        requireSocialMediaPlan: true,
        completionWindowMode: 'strict',
        priority: 'high',
        notifyAtStart: true,
        scheduledWorkdayPlacement: 'end',
        requiredShiftTemplateIds: [4, 9],
      },
    });
  });

  it('allows an empty required shift-template list so the gate can be cleared', () => {
    expect(parseAssistantManagerTaskBulkOptionsPayload({
      templateIds: [3],
      options: { requiredShiftTemplateIds: [] },
    })).toEqual({
      templateIds: [3],
      options: { requiredShiftTemplateIds: [] },
    });
  });

  it.each([
    [{ templateIds: [], options: { requireShift: true } }, 'templateIds must contain at least one id'],
    [{ templateIds: ['3'], options: { requireShift: true } }, 'templateIds must contain only positive integer ids'],
    [{ templateIds: [3, 3], options: { requireShift: true } }, 'templateIds cannot contain duplicate ids'],
    [{ templateIds: [3], options: {} }, 'At least one option is required'],
    [{ templateIds: [3], options: { requireShift: 'true' } }, 'options.requireShift must be a boolean'],
    [{ templateIds: [3], options: { requireSocialMediaPlan: 'true' } }, 'options.requireSocialMediaPlan must be a boolean'],
    [{ templateIds: [3], options: { priority: 'urgent' } }, 'options.priority must be high, medium, or low'],
    [{ templateIds: [3], options: { scheduledWorkdayPlacement: 'later' } }, 'options.scheduledWorkdayPlacement must be start, middle, or end'],
    [{ templateIds: [3], options: { requiredShiftTemplateIds: [0] } }, 'options.requiredShiftTemplateIds must contain only positive integer ids'],
    [{ templateIds: [3], options: { unsupported: true } }, 'Unknown option: unsupported'],
    [{ templateIds: [3], options: { requireShift: true }, unsupported: true }, 'Unknown request field: unsupported'],
  ])('rejects invalid input %#', (payload, message) => {
    expect(() => parseAssistantManagerTaskBulkOptionsPayload(payload)).toThrow(message);
  });

  it('limits one request to 500 task templates', () => {
    expect(() => parseAssistantManagerTaskBulkOptionsPayload({
      templateIds: Array.from({ length: 501 }, (_, index) => index + 1),
      options: { requireShift: true },
    })).toThrow('templateIds cannot contain more than 500 ids');
  });
});

describe('assistant-manager task bulk options merge', () => {
  it('preserves unrelated schedule settings and removes legacy shift flags', () => {
    expect(mergeAssistantManagerTaskBulkOptions(
      {
        daysOfWeek: [1, 3],
        time: '09:00',
        requireScheduledShift: true,
        allowOffDays: true,
        requiredShiftTemplateIds: [2],
      },
      {
        requireShift: false,
        requireSocialMediaPlan: true,
        priority: 'low',
        notifyAtStart: false,
        scheduledWorkdayPlacement: 'middle',
        requiredShiftTemplateIds: [5, 7],
      },
    )).toEqual({
      daysOfWeek: [1, 3],
      time: '09:00',
      requireShift: false,
      requireSocialMediaPlan: true,
      priority: 'low',
      notifyAtStart: false,
      scheduledWorkdayPlacement: 'middle',
      requiredShiftTemplateIds: [5, 7],
    });
  });

  it('clears only the required shift-template gate when given an empty array', () => {
    expect(mergeAssistantManagerTaskBulkOptions(
      { cadenceAnchor: '2026-08-24', requiredShiftTemplateIds: [5] },
      { requiredShiftTemplateIds: [] },
    )).toEqual({ cadenceAnchor: '2026-08-24' });
  });

  it('leaves legacy shift flags untouched when requireShift is omitted', () => {
    expect(mergeAssistantManagerTaskBulkOptions(
      { requireScheduledShift: false, allowOffDays: true },
      { completionWindowMode: 'day' },
    )).toEqual({
      requireScheduledShift: false,
      allowOffDays: true,
      completionWindowMode: 'day',
    });
  });

  it('canonicalizes scheduled-only mode without mutating the current config', () => {
    const currentConfig = {
      requireShift: false,
      requireScheduledShift: false,
      allowOffDays: true,
      requiredShiftTemplateIds: [5],
      scheduledWorkdayPlacement: 'end',
      evidenceRules: [{ key: 'photo', type: 'image' }],
    };

    expect(mergeAssistantManagerTaskBulkOptions(currentConfig, { requireShift: true })).toEqual({
      requireShift: true,
      requiredShiftTemplateIds: [5],
      scheduledWorkdayPlacement: 'end',
      evidenceRules: [{ key: 'photo', type: 'image' }],
    });
    expect(currentConfig).toEqual({
      requireShift: false,
      requireScheduledShift: false,
      allowOffDays: true,
      requiredShiftTemplateIds: [5],
      scheduledWorkdayPlacement: 'end',
      evidenceRules: [{ key: 'photo', type: 'image' }],
    });
  });
});
