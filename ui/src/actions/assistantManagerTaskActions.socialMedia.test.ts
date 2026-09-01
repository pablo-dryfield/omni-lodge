import { adaptAmTaskSocialMediaContentOption } from '../utils/assistantManagerTaskSocialMedia';

describe('Assistant Manager task Social Media selector adapter', () => {
  it('maps targetPlatforms to the task selector platform chips', () => {
    expect(adaptAmTaskSocialMediaContentOption({
      id: 14,
      title: '  Krakow myths in 20 seconds ',
      status: 'idea',
      targetPlatforms: ['instagram', 'tiktok', 'instagram'],
      scheduledAt: null,
      thumbnailUrl: null,
      isTaskReady: false,
    })).toEqual({
      id: 14,
      title: 'Krakow myths in 20 seconds',
      status: 'idea',
      platforms: ['instagram', 'tiktok'],
      scheduledAt: null,
      thumbnailUrl: null,
      isTaskReady: false,
    });
  });

  it('preserves the server readiness decision', () => {
    expect(adaptAmTaskSocialMediaContentOption({
      id: 15,
      title: 'Ready reel',
      status: 'planned',
      targetPlatforms: [],
      isTaskReady: true,
    })?.isTaskReady).toBe(true);
  });
});
