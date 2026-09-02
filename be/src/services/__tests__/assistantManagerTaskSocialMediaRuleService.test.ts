import {
  buildAssistantManagerTaskSocialMediaSnapshot,
  assertManualSocialMediaPublishTaskCompletionAllowed,
  getStoredSocialMediaSnapshot,
  isSocialMediaContentTaskReady,
  normalizeCompleteOnSocialMediaPublish,
  normalizeAndValidateSocialMediaPublishAutomationConfig,
  parseSocialMediaContentId,
  requireTaskReadySocialMediaContent,
  resolveCompleteOnSocialMediaPublish,
  resolveRequireSocialMediaPlan,
  type AssistantManagerTaskSocialMediaContentRecord,
} from '../assistantManagerTaskSocialMediaRuleService';

const plannedContent: AssistantManagerTaskSocialMediaContentRecord = {
  id: 17,
  title: '  Three hidden corners in Krakow  ',
  status: 'planned',
  targetPlatforms: ['instagram', 'tiktok', 'instagram', ''],
  scheduledAt: new Date('2026-09-04T12:30:00.000Z'),
  thumbnailUrl: ' https://cdn.example.com/thumbnail.jpg ',
};

describe('assistant-manager Social Media plan task rule', () => {
  it('prefers the generated task snapshot over later template changes', () => {
    expect(resolveRequireSocialMediaPlan(
      { requireSocialMediaPlan: false },
      { requireSocialMediaPlan: true },
    )).toBe(false);
    expect(resolveRequireSocialMediaPlan(
      {},
      { requireSocialMediaPlan: true },
    )).toBe(true);
  });

  it('normalizes and resolves publish auto-completion without coercing truthy values', () => {
    expect(normalizeCompleteOnSocialMediaPublish(true)).toBe(true);
    expect(normalizeCompleteOnSocialMediaPublish(false)).toBe(false);
    expect(normalizeCompleteOnSocialMediaPublish('true')).toBe(false);

    expect(resolveCompleteOnSocialMediaPublish(
      { completeOnSocialMediaPublish: false },
      { completeOnSocialMediaPublish: true },
    )).toBe(false);
    expect(resolveCompleteOnSocialMediaPublish(
      {},
      { completeOnSocialMediaPublish: true },
    )).toBe(true);
    expect(resolveCompleteOnSocialMediaPublish(undefined, undefined)).toBe(false);
  });

  it('makes the Social Media plan gate mandatory for publish-driven completion', () => {
    expect(normalizeAndValidateSocialMediaPublishAutomationConfig({
      completeOnSocialMediaPublish: true,
      requireSocialMediaPlan: false,
      completionWindowMode: 'day',
    })).toEqual({
      completeOnSocialMediaPublish: true,
      requireSocialMediaPlan: true,
      completionWindowMode: 'day',
    });
  });

  it.each([
    [
      { completeOnSocialMediaPublish: true, completionWindowMode: 'strict' },
      'requires the End of day completion window',
    ],
    [
      {
        completeOnSocialMediaPublish: true,
        evidenceRules: [{ key: 'photo', required: true, minItems: 1 }],
      },
      'cannot be used with required evidence rules',
    ],
    [
      {
        completeOnSocialMediaPublish: true,
        evidenceRules: [{ key: 'link', required: false, minItems: 1 }],
      },
      'cannot be used with required evidence rules',
    ],
    [
      {
        completeOnSocialMediaPublish: true,
        shiftEvidenceSources: [{ key: 'promotion_staff' }],
      },
      'cannot be used with shift-based evidence',
    ],
  ])('rejects an unsafe publish automation configuration %#', (config, message) => {
    expect(() => normalizeAndValidateSocialMediaPublishAutomationConfig(config)).toThrow(message);
  });

  it('allows optional evidence that is not required for completion', () => {
    expect(normalizeAndValidateSocialMediaPublishAutomationConfig({
      completeOnSocialMediaPublish: true,
      evidenceRules: [{ key: 'reference', required: false, minItems: 0 }],
    })).toMatchObject({
      completeOnSocialMediaPublish: true,
      requireSocialMediaPlan: true,
    });
  });

  it('blocks only manual completion for publish-completed task logs', () => {
    expect(() => assertManualSocialMediaPublishTaskCompletionAllowed(
      { completeOnSocialMediaPublish: true },
      {},
    )).toThrow('completes automatically when its linked Social Media content is published');

    expect(() => assertManualSocialMediaPublishTaskCompletionAllowed(
      { completeOnSocialMediaPublish: false },
      { completeOnSocialMediaPublish: true },
    )).not.toThrow();
  });

  it('accepts only positive integer content ids or null', () => {
    expect(parseSocialMediaContentId(12)).toBe(12);
    expect(parseSocialMediaContentId(null)).toBeNull();
    expect(() => parseSocialMediaContentId('12')).toThrow(
      'socialMediaContentId must be a positive integer or null',
    );
    expect(() => parseSocialMediaContentId(0)).toThrow(
      'socialMediaContentId must be a positive integer or null',
    );
  });

  it.each(['planned', 'in_production', 'ready', 'published'])(
    'treats %s content as ready for task completion',
    (status) => {
      expect(isSocialMediaContentTaskReady(status)).toBe(true);
    },
  );

  it.each(['idea', 'archived', 'unknown', null])(
    'does not treat %s content as ready for task completion',
    (status) => {
      expect(isSocialMediaContentTaskReady(status)).toBe(false);
    },
  );

  it('builds a compact, normalized task snapshot', () => {
    const snapshot = buildAssistantManagerTaskSocialMediaSnapshot(plannedContent);
    expect(snapshot).toEqual({
      id: 17,
      title: 'Three hidden corners in Krakow',
      status: 'planned',
      platforms: ['instagram', 'tiktok'],
      scheduledAt: '2026-09-04T12:30:00.000Z',
      thumbnailUrl: 'https://cdn.example.com/thumbnail.jpg',
    });
    expect(getStoredSocialMediaSnapshot({ socialMediaContentSnapshot: snapshot })).toEqual(snapshot);
  });

  it('blocks completion when a required plan is missing', async () => {
    await expect(requireTaskReadySocialMediaContent({
      required: true,
      linkedContentId: null,
      loadContent: jest.fn(),
    })).rejects.toThrow('Link a Social Media plan before completing this task');
  });

  it('blocks an idea until it has been planned', async () => {
    await expect(requireTaskReadySocialMediaContent({
      required: true,
      linkedContentId: 17,
      loadContent: async () => ({ ...plannedContent, status: 'idea' }),
    })).rejects.toThrow('Develop the linked Social Media idea into a planned post');
  });

  it('returns a fresh snapshot for a task-ready linked plan', async () => {
    await expect(requireTaskReadySocialMediaContent({
      required: true,
      linkedContentId: 17,
      loadContent: async () => plannedContent,
    })).resolves.toEqual(buildAssistantManagerTaskSocialMediaSnapshot(plannedContent));
  });

  it('does not query content for a task without the rule', async () => {
    const loadContent = jest.fn();
    await expect(requireTaskReadySocialMediaContent({
      required: false,
      linkedContentId: null,
      loadContent,
    })).resolves.toBeNull();
    expect(loadContent).not.toHaveBeenCalled();
  });
});
