jest.mock('../../models/AssistantManagerTaskLog.js', () => ({
  __esModule: true,
  default: {
    findAll: jest.fn(),
    findByPk: jest.fn(),
    findOne: jest.fn(),
  },
}));
jest.mock('../../models/AssistantManagerTaskTemplate.js', () => ({
  __esModule: true,
  default: {},
}));
jest.mock('../configService.js', () => ({
  getConfigValue: jest.fn(() => 'Europe/Warsaw'),
}));

import { Op, UniqueConstraintError } from 'sequelize';
import AssistantManagerTaskLog from '../../models/AssistantManagerTaskLog';
import type SocialMediaContent from '../../models/SocialMediaContent';
import {
  completeTaskForSocialMediaPublication,
  SocialMediaPublishTaskConflictError,
  syncPublishedSocialMediaTaskEvidence,
} from '../socialMediaPublishTaskService';

const mockFindAll = AssistantManagerTaskLog.findAll as jest.Mock;
const mockFindByPk = AssistantManagerTaskLog.findByPk as jest.Mock;
const mockFindOne = AssistantManagerTaskLog.findOne as jest.Mock;

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
  createdBy: 7,
  publishedTaskLogId: null,
  ...overrides,
}) as unknown as SocialMediaContent;

const buildLog = (overrides: Record<string, unknown> = {}) => {
  const log: Record<string, unknown> = {
    id: 88,
    templateId: 12,
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
  allowCrossUserCompletion = false,
) => completeTaskForSocialMediaPublication({
  content,
  actorId: 7,
  allowCrossUserCompletion,
  publishedAt,
  platformLinks,
  transaction: transaction as never,
});

describe('Social Media publication Task Planner completion', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindOne.mockResolvedValue(null);
  });

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

    expect(mockFindAll).toHaveBeenCalledTimes(1);
    expect(mockFindAll).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: expect.any(Object),
        meta: expect.any(Object),
      }),
      order: [['taskDate', 'ASC'], ['id', 'ASC']],
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
        'More than one publish-enabled Social Media task matches you today. Link this idea to the correct task before publishing.',
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
      'No pending publish-enabled Social Media task exists for the responsible user today',
    );
  });

  it('prefers the content creator task when an authorized manager publishes on their behalf', async () => {
    const creatorTask = buildLog({ id: 88, userId: 51 });
    const actorTask = buildLog({ id: 89, userId: 7 });
    mockFindAll
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([actorTask, creatorTask]);

    await expect(callService(buildContent({ createdBy: 51 }), undefined, true)).resolves.toEqual({
      taskLogId: 88,
      userId: 51,
      taskDate: '2026-09-02',
      status: 'completed',
    });

    expect(creatorTask.update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'completed',
      updatedBy: 7,
      meta: expect.objectContaining({
        socialMediaContentId: 41,
        socialMediaPublicationSnapshot: expect.objectContaining({
          publishedBy: 7,
        }),
      }),
    }), { transaction });
    expect(actorTask.update).not.toHaveBeenCalled();
    expect(mockFindAll.mock.calls[0][0].where.userId[Op.in]).toEqual([7, 51]);
  });

  it('limits explicit task links to the publisher and authorized content creator', async () => {
    const creatorTask = buildLog({ id: 88, userId: 51 });
    mockFindAll
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([creatorTask]);

    await callService(buildContent({ createdBy: 51 }), undefined, true);

    const explicitLinkWhere = mockFindAll.mock.calls[0][0].where;
    expect(explicitLinkWhere.userId[Op.in]).toEqual([7, 51]);
    expect(creatorTask.update).toHaveBeenCalled();
  });

  it('limits a non-manager task lookup to the publisher rather than another creator', async () => {
    mockFindAll.mockResolvedValue([]);

    await expect(callService(buildContent({ createdBy: 51 }))).rejects.toThrow(
      'Only an authorized manager can publish on behalf of the content creator',
    );
    expect(mockFindAll.mock.calls[0][0].where.userId[Op.in]).toEqual([7]);
    expect(mockFindAll.mock.calls[1][0].where.userId[Op.in]).toEqual([7]);
  });

  it('moves a missed explicitly linked task to the actual publication date without allowing regeneration', async () => {
    const linked = buildLog({
      id: 88,
      taskDate: '2026-09-01',
      status: 'missed',
      meta: {
        completeOnSocialMediaPublish: true,
        socialMediaContentId: 41,
      },
    });
    mockFindAll.mockResolvedValue([linked]);

    await expect(callService()).resolves.toEqual({
      taskLogId: 88,
      userId: 7,
      taskDate: '2026-09-02',
      status: 'completed',
    });

    expect(mockFindOne).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        templateId: 12,
        userId: 7,
        taskDate: '2026-09-02',
      }),
      transaction,
      lock: 'UPDATE',
    }));
    expect(mockFindAll.mock.calls[0][0].where.status[Op.in]).toEqual([
      'pending',
      'missed',
    ]);
    expect(linked.update).toHaveBeenCalledWith(expect.objectContaining({
      taskDate: '2026-09-02',
      status: 'completed',
      meta: expect.objectContaining({
        managerOverride: expect.objectContaining({
          originalGenerationSourceKey: '12:7:2026-09-01',
          updatedBy: 7,
        }),
        socialMediaPublishReschedule: expect.objectContaining({
          previousTaskDate: '2026-09-01',
          publicationDate: '2026-09-02',
          previousStatus: 'missed',
          appliedBy: 7,
        }),
      }),
    }), { transaction });
  });

  it('does not move a historical linked task out of a previous payroll month', async () => {
    const historical = buildLog({
      id: 88,
      taskDate: '2026-08-31',
      status: 'missed',
      meta: {
        completeOnSocialMediaPublish: true,
        socialMediaContentId: 41,
      },
    });
    mockFindAll.mockResolvedValue([historical]);

    await expect(callService()).rejects.toThrow(
      'previous closed payroll month and cannot be moved automatically',
    );
    expect(mockFindOne).not.toHaveBeenCalled();
    expect(historical.update).not.toHaveBeenCalled();
  });

  it('returns a retryable conflict if task generation wins the date-move race', async () => {
    const linked = buildLog({
      id: 88,
      taskDate: '2026-09-01',
      meta: {
        completeOnSocialMediaPublish: true,
        socialMediaContentId: 41,
      },
    });
    (linked.update as jest.Mock).mockRejectedValueOnce(
      new UniqueConstraintError({ message: 'duplicate task date' }),
    );
    mockFindAll.mockResolvedValue([linked]);

    await expect(callService()).rejects.toThrow(
      'A publication-date task was created at the same time. Try publishing again',
    );
  });

  it('uses an eligible same-day row instead of colliding while moving an older linked task', async () => {
    const linked = buildLog({
      id: 88,
      taskDate: '2026-09-01',
      meta: {
        completeOnSocialMediaPublish: true,
        socialMediaContentId: 41,
        socialMediaContentSnapshot: { id: 41 },
      },
    });
    const sameDay = buildLog({ id: 89, taskDate: '2026-09-02' });
    mockFindAll.mockResolvedValue([linked]);
    mockFindOne.mockResolvedValue(sameDay);

    await expect(callService()).resolves.toEqual({
      taskLogId: 89,
      userId: 7,
      taskDate: '2026-09-02',
      status: 'completed',
    });

    expect(linked.update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'waived',
      completedAt: null,
      notes: expect.stringContaining('published through the existing 2026-09-02 task #89'),
      meta: expect.objectContaining({
        completeOnSocialMediaPublish: true,
        socialMediaContentId: 41,
        socialMediaPublishSupersession: expect.objectContaining({
          contentId: 41,
          supersededByTaskLogId: 89,
          previousTaskDate: '2026-09-01',
          previousStatus: 'pending',
          publicationDate: '2026-09-02',
          appliedBy: 7,
        }),
      }),
      updatedBy: 7,
    }), { transaction });
    expect(sameDay.update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'completed',
      meta: expect.objectContaining({ socialMediaContentId: 41 }),
    }), { transaction });
  });

  it('returns a clear conflict when the publication-date row cannot receive the linked content', async () => {
    const linked = buildLog({
      id: 88,
      taskDate: '2026-09-01',
      meta: {
        completeOnSocialMediaPublish: true,
        socialMediaContentId: 41,
      },
    });
    const collision = buildLog({
      id: 89,
      taskDate: '2026-09-02',
      meta: {
        completeOnSocialMediaPublish: true,
        socialMediaContentId: 99,
      },
    });
    mockFindAll.mockResolvedValue([linked]);
    mockFindOne.mockResolvedValue(collision);

    await expect(callService()).rejects.toThrow(
      'another non-eligible task from the same template already exists for that user today',
    );
    expect(linked.update).not.toHaveBeenCalled();
    expect(collision.update).not.toHaveBeenCalled();
  });

  it('never consolidates linked tasks that belong to different users or templates', async () => {
    const creatorTask = buildLog({
      id: 88,
      userId: 51,
      taskDate: '2026-09-02',
      meta: {
        completeOnSocialMediaPublish: true,
        socialMediaContentId: 41,
      },
    });
    const actorTask = buildLog({
      id: 89,
      templateId: 13,
      userId: 7,
      taskDate: '2026-09-01',
      meta: {
        completeOnSocialMediaPublish: true,
        socialMediaContentId: 41,
      },
    });
    mockFindAll.mockResolvedValue([actorTask, creatorTask]);

    await expect(callService(buildContent({ createdBy: 51 }), undefined, true)).rejects.toThrow(
      'More than one Task Planner task is linked to this Social Media item',
    );
    expect(creatorTask.update).not.toHaveBeenCalled();
    expect(actorTask.update).not.toHaveBeenCalled();
  });

  it('does not waive a linked task from a previous payroll month during consolidation', async () => {
    const historical = buildLog({
      id: 88,
      taskDate: '2026-08-31',
      status: 'missed',
      meta: {
        completeOnSocialMediaPublish: true,
        socialMediaContentId: 41,
      },
    });
    const publicationDay = buildLog({
      id: 89,
      taskDate: '2026-09-02',
      meta: {
        completeOnSocialMediaPublish: true,
        socialMediaContentId: 41,
      },
    });
    mockFindAll.mockResolvedValue([historical, publicationDay]);

    await expect(callService()).rejects.toThrow(
      'previous closed payroll month and cannot be moved automatically',
    );
    expect(historical.update).not.toHaveBeenCalled();
    expect(publicationDay.update).not.toHaveBeenCalled();
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

  it('refreshes evidence when a manager published content for the task assignee', async () => {
    const assigneeLog = buildLog({
      status: 'completed',
      userId: 51,
      meta: {
        socialMediaContentId: 41,
        socialMediaPublicationSnapshot: {
          publishedBy: 7,
          publishedAt: '2026-09-02T12:00:00.000Z',
          platformLinks,
        },
      },
    });
    mockFindByPk.mockResolvedValue(assigneeLog);

    await expect(syncPublishedSocialMediaTaskEvidence({
      content: buildContent({
        status: 'published',
        createdBy: 51,
        publishedAt: new Date('2026-09-02T12:00:00.000Z'),
        publishedBy: 7,
        publishedTaskLogId: 88,
        platformLinks,
      }),
      actorId: 7,
      transaction: transaction as never,
    })).resolves.toEqual({
      taskLogId: 88,
      userId: 51,
      taskDate: '2026-09-02',
      status: 'completed',
    });

    expect(assigneeLog.update).toHaveBeenCalledWith(expect.objectContaining({
      updatedBy: 7,
    }), { transaction });
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
