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
  syncPublishedSocialMediaTaskEvidence,
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

  it('updates published links in the managed notes block and keeps an audit history in meta', async () => {
    const log = buildLog({
      notes: 'Editor checked the final cut.',
      meta: {
        completeOnSocialMediaPublish: true,
        socialMediaContentId: 41,
      },
    });
    mockFindAll.mockResolvedValue([log]);
    await callService();

    const newLinks = {
      instagram: 'https://www.instagram.com/reel/corrected',
      tiktok: 'https://www.tiktok.com/@example/video/456',
    };
    const content = buildContent({
      status: 'published',
      publishedAt: new Date('2026-09-02T12:00:00.000Z'),
      publishedBy: 7,
      publishedTaskLogId: 88,
      platformLinks: newLinks,
    });
    mockFindByPk.mockResolvedValue(log);

    await expect(syncPublishedSocialMediaTaskEvidence({
      content,
      actorId: 9,
      transaction: transaction as never,
      linkEdit: {
        editedAt: new Date('2026-09-03T09:30:00.000Z'),
        previousPlatformLinks: platformLinks,
      },
    })).resolves.toEqual({
      taskLogId: 88,
      userId: 7,
      taskDate: '2026-09-02',
      status: 'completed',
    });

    expect(mockFindByPk).toHaveBeenCalledWith(88, {
      transaction,
      lock: 'UPDATE',
    });
    const update = (log.update as jest.Mock).mock.calls.at(-1)?.[0];
    expect(update.updatedBy).toBe(9);
    expect(update.notes).toContain('Instagram: https://www.instagram.com/reel/corrected');
    expect(update.notes).toContain('TikTok: https://www.tiktok.com/@example/video/456');
    expect(update.notes).not.toContain('Instagram: https://www.instagram.com/reel/example');
    expect(update.notes.match(/Social Media publication evidence #41 - START/gu)).toHaveLength(1);
    expect(update.meta.socialMediaPublicationSnapshot).toEqual(expect.objectContaining({
      publishedAt: '2026-09-02T12:00:00.000Z',
      publishedBy: 7,
      originalPlatformLinks: platformLinks,
      platformLinks: newLinks,
      linksEditedAt: '2026-09-03T09:30:00.000Z',
      linksEditedBy: 9,
      platformLinkEditHistory: [{
        editedAt: '2026-09-03T09:30:00.000Z',
        editedBy: 9,
        previousPlatformLinks: platformLinks,
        platformLinks: newLinks,
      }],
    }));
  });

  it('preserves legacy notes and appends a replaceable correction block', async () => {
    const oldLinks = {
      instagram: 'https://www.instagram.com/reel/old',
      tiktok: 'https://www.tiktok.com/@example/video/old',
    };
    const newLinks = {
      instagram: 'https://www.instagram.com/reel/new',
      tiktok: 'https://www.tiktok.com/@example/video/new',
    };
    const log = buildLog({
      status: 'completed',
      notes: `Legacy publication notes\nInstagram: ${oldLinks.instagram}`,
      meta: {
        socialMediaContentId: 41,
        socialMediaPublicationSnapshot: {
          publishedBy: 7,
          publishedAt: '2026-09-02T12:00:00.000Z',
          platformLinks: oldLinks,
        },
      },
    });
    mockFindByPk.mockResolvedValue(log);
    const content = buildContent({
      status: 'published',
      publishedAt: new Date('2026-09-02T12:00:00.000Z'),
      publishedBy: 7,
      publishedTaskLogId: 88,
      platformLinks: newLinks,
    });

    await syncPublishedSocialMediaTaskEvidence({
      content,
      actorId: 9,
      transaction: transaction as never,
      linkEdit: {
        editedAt: new Date('2026-09-03T09:30:00.000Z'),
        previousPlatformLinks: oldLinks,
      },
    });

    const update = (log.update as jest.Mock).mock.calls[0][0];
    expect(update.notes).toContain('Legacy publication notes');
    expect(update.notes).toContain(`Instagram: ${oldLinks.instagram}`);
    expect(update.notes).toContain('[Social Media publication link correction #41 - START]');
    expect(update.notes).toContain(`Updated Instagram: ${newLinks.instagram}`);

    const latestLinks = {
      instagram: 'https://www.instagram.com/reel/latest',
      tiktok: 'https://www.tiktok.com/@example/video/latest',
    };
    Object.assign(content, { platformLinks: latestLinks });
    await syncPublishedSocialMediaTaskEvidence({
      content,
      actorId: 10,
      transaction: transaction as never,
      linkEdit: {
        editedAt: new Date('2026-09-04T10:00:00.000Z'),
        previousPlatformLinks: newLinks,
      },
    });
    const secondUpdate = (log.update as jest.Mock).mock.calls[1][0];
    expect(secondUpdate.notes.match(/publication link correction #41 - START/gu)).toHaveLength(1);
    expect(secondUpdate.notes).not.toContain(`Updated Instagram: ${newLinks.instagram}`);
    expect(secondUpdate.notes).toContain(`Updated Instagram: ${latestLinks.instagram}`);
    expect(
      secondUpdate.meta.socialMediaPublicationSnapshot.platformLinkEditHistory,
    ).toHaveLength(2);
  });

  it('refreshes a published planned date without rewriting task notes', async () => {
    const log = buildLog({
      status: 'completed',
      notes: 'Keep these task notes exactly.',
      meta: {
        socialMediaContentId: 41,
        socialMediaPublicationSnapshot: {
          publishedBy: 7,
          publishedAt: '2026-09-02T12:00:00.000Z',
          platformLinks,
          platformLinkEditHistory: [{ editedBy: 8 }],
        },
      },
    });
    mockFindByPk.mockResolvedValue(log);

    await syncPublishedSocialMediaTaskEvidence({
      content: buildContent({
        status: 'published',
        scheduledAt: '2026-09-09',
        publishedAt: new Date('2026-09-02T12:00:00.000Z'),
        publishedBy: 7,
        publishedTaskLogId: 88,
        platformLinks,
      }),
      actorId: 9,
      transaction: transaction as never,
    });

    const update = (log.update as jest.Mock).mock.calls[0][0];
    expect(update.notes).toBe('Keep these task notes exactly.');
    expect(update.meta.socialMediaContentSnapshot.scheduledAt).toBe(
      '2026-09-09T00:00:00.000Z',
    );
    expect(update.meta.socialMediaPublicationSnapshot).toEqual(expect.objectContaining({
      scheduledAt: '2026-09-09',
      platformLinkEditHistory: [{ editedBy: 8 }],
    }));
  });

  it('allows legacy published content without a linked Task Planner log', async () => {
    await expect(syncPublishedSocialMediaTaskEvidence({
      content: buildContent({
        status: 'published',
        publishedAt: new Date('2026-09-02T12:00:00.000Z'),
        publishedBy: 7,
        publishedTaskLogId: null,
        platformLinks,
      }),
      actorId: 9,
      transaction: transaction as never,
    })).resolves.toBeNull();
    expect(mockFindByPk).not.toHaveBeenCalled();
  });
});
