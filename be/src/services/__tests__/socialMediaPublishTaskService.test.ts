jest.mock('../../models/AssistantManagerTaskLog.js', () => ({
  __esModule: true,
  default: {
    findAll: jest.fn(),
    findByPk: jest.fn(),
  },
}));
jest.mock('../../models/AssistantManagerTaskTemplate.js', () => ({
  __esModule: true,
  default: {},
}));
jest.mock('../configService.js', () => ({
  getConfigValue: jest.fn(() => 'Europe/Warsaw'),
}));

import AssistantManagerTaskLog from '../../models/AssistantManagerTaskLog';
import type SocialMediaContent from '../../models/SocialMediaContent';
import {
  completeTaskForSocialMediaPublication,
  SocialMediaPublishTaskConflictError,
} from '../socialMediaPublishTaskService';

const mockFindAll = AssistantManagerTaskLog.findAll as jest.Mock;
const mockFindByPk = AssistantManagerTaskLog.findByPk as jest.Mock;

const transaction = {
  LOCK: { UPDATE: 'UPDATE', SHARE: 'SHARE' },
};

const buildContent = (overrides: Record<string, unknown> = {}) => ({
  id: 41,
  title: 'Krakow nightlife in 15 seconds',
  idea: 'Cut from the square to the first bar and finish on the dance floor.',
  onVideoCaptions: 'POV: your first night in Krakow',
  platformCaption: 'One night. Four bars. A lot of new friends.',
  hashtags: ['krakow', 'nightlife'],
  targetPlatforms: ['instagram', 'tiktok'],
  scheduledAt: '2026-09-02',
  thumbnailUrl: '/api/social-media/content/41/thumbnail',
  driveProjectUrl: 'https://drive.google.com/drive/folders/folder-1',
  publishedTaskLogId: null,
  ...overrides,
}) as unknown as SocialMediaContent;

const buildLog = (overrides: Record<string, unknown> = {}) => {
  const log: Record<string, unknown> = {
    id: 88,
    userId: 7,
    taskDate: '2026-09-02',
    status: 'pending',
    completedAt: null,
    notes: null,
    meta: { completeOnSocialMediaPublish: true },
    template: {
      id: 12,
      name: 'Publish the weekly reel',
      scheduleConfig: { completeOnSocialMediaPublish: true },
    },
    ...overrides,
  };
  log.update = jest.fn(async (values: Record<string, unknown>) => {
    Object.assign(log, values);
    return log;
  });
  return log;
};

const platformLinks = {
  instagram: 'https://www.instagram.com/reel/example',
  tiktok: 'https://www.tiktok.com/@example/video/123',
};

const callService = (
  content = buildContent(),
  publishedAt = new Date('2026-09-02T12:00:00.000Z'),
) => completeTaskForSocialMediaPublication({
  content,
  actorId: 7,
  publishedAt,
  platformLinks,
  transaction: transaction as never,
});

describe('Social Media publication Task Planner completion', () => {
  beforeEach(() => jest.clearAllMocks());

  it('prefers the one task explicitly linked to this idea and records the publication once', async () => {
    const linked = buildLog({
      id: 88,
      notes: 'Editor checked the final cut.',
      meta: {
        completeOnSocialMediaPublish: true,
        socialMediaContentId: 41,
      },
    });
    const unlinked = buildLog({ id: 89 });
    mockFindAll.mockResolvedValue([linked, unlinked]);

    await expect(callService()).resolves.toEqual({
      taskLogId: 88,
      userId: 7,
      taskDate: '2026-09-02',
      status: 'completed',
    });

    expect(mockFindAll).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 7, taskDate: '2026-09-02', status: 'pending' },
      order: [['id', 'ASC']],
      transaction,
      lock: 'UPDATE',
    }));
    expect(linked.update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'completed',
      completedAt: new Date('2026-09-02T12:00:00.000Z'),
      updatedBy: 7,
      notes: expect.stringContaining('Social Media publication: Krakow nightlife in 15 seconds'),
      meta: expect.objectContaining({
        socialMediaContentId: 41,
        completedBySocialMediaPublish: true,
        socialMediaContentSnapshot: expect.objectContaining({
          id: 41,
          status: 'published',
          platforms: ['instagram', 'tiktok'],
        }),
        socialMediaPublicationSnapshot: expect.objectContaining({
          contentId: 41,
          publishedBy: 7,
          platformLinks,
          driveProjectUrl: 'https://drive.google.com/drive/folders/folder-1',
        }),
      }),
    }), { transaction });
    expect((linked.update as jest.Mock).mock.calls[0][0].notes).toContain(
      'Instagram: https://www.instagram.com/reel/example',
    );
    expect((linked.update as jest.Mock).mock.calls[0][0].notes).toContain(
      'TikTok: https://www.tiktok.com/@example/video/123',
    );
    expect((linked.update as jest.Mock).mock.calls[0][0].notes).toContain(
      'Hashtags: #krakow #nightlife',
    );
    expect(unlinked.update).not.toHaveBeenCalled();
  });

  it('refuses to guess when multiple unlinked publish-enabled tasks match', async () => {
    mockFindAll.mockResolvedValue([
      buildLog({ id: 88 }),
      buildLog({ id: 89 }),
    ]);

    await expect(callService()).rejects.toThrow(
      new SocialMediaPublishTaskConflictError(
        'More than one publish-enabled Social Media task matches today. Link this idea to the correct task before publishing.',
      ),
    );
  });

  it('reports a clear conflict when no publish-enabled task exists for that user and date', async () => {
    mockFindAll.mockResolvedValue([
      buildLog({
        meta: { completeOnSocialMediaPublish: false },
        template: { scheduleConfig: { completeOnSocialMediaPublish: false } },
      }),
    ]);

    await expect(callService()).rejects.toThrow(
      'No pending publish-enabled Social Media task exists for you today',
    );
  });

  it('is idempotent when the content already points at its completed task result', async () => {
    const existing = buildLog({
      id: 88,
      status: 'completed',
      meta: {
        completeOnSocialMediaPublish: true,
        socialMediaContentId: 41,
      },
    });
    mockFindByPk.mockResolvedValue(existing);

    await expect(callService(buildContent({ publishedTaskLogId: 88 }))).resolves.toEqual({
      taskLogId: 88,
      userId: 7,
      taskDate: '2026-09-02',
      status: 'completed',
    });

    expect(mockFindByPk).toHaveBeenCalledWith(88, {
      transaction,
      lock: 'SHARE',
    });
    expect(mockFindAll).not.toHaveBeenCalled();
    expect(existing.update).not.toHaveBeenCalled();
  });

  it('rejects an existing task link owned by another user or idea', async () => {
    mockFindByPk.mockResolvedValue(buildLog({
      id: 88,
      userId: 99,
      status: 'completed',
      meta: { socialMediaContentId: 999 },
    }));

    await expect(callService(buildContent({ publishedTaskLogId: 88 }))).rejects.toThrow(
      'This publication is already linked to a different Task Planner result.',
    );
  });
});
