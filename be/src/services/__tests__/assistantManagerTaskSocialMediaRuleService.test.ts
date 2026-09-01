import {
  buildAssistantManagerTaskSocialMediaSnapshot,
  getStoredSocialMediaSnapshot,
  isSocialMediaContentTaskReady,
  parseSocialMediaContentId,
  requireTaskReadySocialMediaContent,
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
