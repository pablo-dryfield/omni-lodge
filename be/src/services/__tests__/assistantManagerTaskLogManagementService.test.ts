import {
  applyManagerTaskOverride,
  buildAssistantManagerTaskGenerationSourceKey,
  getManagerTaskOverrideSourceKey,
  isSelfServiceAssistantManagerTaskLogMetaPayload,
  parseManagedAssistantManagerTaskLogPatch,
} from '../assistantManagerTaskLogManagementService';

describe('managed assistant-manager task-log patch validation', () => {
  it('accepts and normalizes every supported field', () => {
    expect(parseManagedAssistantManagerTaskLogPatch({
      userId: 17,
      taskDate: '2026-08-27',
      time: '09:30',
      durationHours: 1.5,
      priority: 'high',
      points: 3,
      tags: [' operations ', 'weekly', 'operations'],
      notes: '  Updated by a manager  ',
      requireShift: false,
    })).toEqual({
      userId: 17,
      taskDate: '2026-08-27',
      time: '09:30',
      durationHours: 1.5,
      priority: 'high',
      points: 3,
      tags: ['operations', 'weekly'],
      notes: 'Updated by a manager',
      requireShift: false,
    });
  });

  it('allows nullable time and notes', () => {
    expect(parseManagedAssistantManagerTaskLogPatch({ time: null, notes: null })).toEqual({
      time: null,
      notes: null,
    });
  });

  it.each([
    [{}, 'At least one editable field is required'],
    [{ status: 'completed' }, 'Unknown editable field: status'],
    [{ manual: true }, 'Unknown editable field: manual'],
    [{ evidenceItems: [] }, 'Unknown editable field: evidenceItems'],
    [{ userId: '17' }, 'userId must be a positive integer'],
    [{ taskDate: '2026-02-30' }, 'taskDate must be a valid YYYY-MM-DD date'],
    [{ time: '9:30' }, 'time must use HH:mm format or be null'],
    [{ durationHours: 0 }, 'durationHours must be a number of at least 0.25'],
    [{ priority: 'urgent' }, 'priority must be high, medium, or low'],
    [{ points: -1 }, 'points must be a non-negative number'],
    [{ tags: ['valid', '  '] }, 'tags must be an array of non-empty strings'],
    [{ notes: 4 }, 'notes must be a string or null'],
    [{ requireShift: 'false' }, 'requireShift must be a boolean'],
  ])('rejects invalid or unauthorized input %#', (payload, message) => {
    expect(() => parseManagedAssistantManagerTaskLogPatch(payload)).toThrow(message);
  });
});

describe('assistant-manager self-service task-log metadata boundary', () => {
  it('allows comments and evidence fields at the supported levels', () => {
    expect(isSelfServiceAssistantManagerTaskLogMetaPayload({ comment: 'Done' })).toBe(true);
    expect(isSelfServiceAssistantManagerTaskLogMetaPayload({ evidenceItems: [] })).toBe(true);
    expect(isSelfServiceAssistantManagerTaskLogMetaPayload({ socialMediaContentId: 14 })).toBe(true);
    expect(isSelfServiceAssistantManagerTaskLogMetaPayload({ socialMediaContentId: null })).toBe(true);
    expect(isSelfServiceAssistantManagerTaskLogMetaPayload({
      meta: { evidence: ['https://example.com/proof'], socialMediaContentId: null },
    })).toBe(true);
  });

  it.each([
    { taskDate: '2026-08-27' },
    { notes: 'Changed' },
    { requireShift: false },
    { manual: true },
    { meta: { priority: 'high' } },
  ])('rejects administrative metadata fields %#', (payload) => {
    expect(isSelfServiceAssistantManagerTaskLogMetaPayload(payload)).toBe(false);
  });
});

describe('managed assistant-manager task-log generation source', () => {
  it('builds a stable source key from the original generated identity', () => {
    expect(buildAssistantManagerTaskGenerationSourceKey(8, 17, '2026-08-27')).toBe(
      '8:17:2026-08-27',
    );
  });

  it('preserves the original source key across later manager edits', () => {
    const first = applyManagerTaskOverride(
      { priority: 'medium' },
      '8:17:2026-08-27',
      2,
      '2026-08-24T10:00:00.000Z',
    );
    const second = applyManagerTaskOverride(
      first,
      '8:21:2026-08-29',
      3,
      '2026-08-25T10:00:00.000Z',
    );

    expect(getManagerTaskOverrideSourceKey(second)).toBe('8:17:2026-08-27');
    expect(second.managerOverride).toEqual({
      originalGenerationSourceKey: '8:17:2026-08-27',
      updatedAt: '2026-08-25T10:00:00.000Z',
      updatedBy: 3,
    });
  });

  it('ignores malformed override markers', () => {
    expect(getManagerTaskOverrideSourceKey({
      managerOverride: { originalGenerationSourceKey: 'invalid' },
    })).toBeNull();
  });
});
