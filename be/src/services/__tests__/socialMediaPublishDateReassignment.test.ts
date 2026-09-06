jest.mock('../../models/AssistantManagerTaskLog.js', () => ({
  __esModule: true, default: { findByPk: jest.fn(), findAll: jest.fn() },
}));
jest.mock('../../models/AssistantManagerTaskTemplate.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/AuditLog.js', () => ({ __esModule: true, default: { create: jest.fn() } }));
jest.mock('../../models/StaffPayoutCollectionLog.js', () => ({ __esModule: true, default: { findAll: jest.fn() } }));
jest.mock('../../models/StaffPayoutLedger.js', () => ({ __esModule: true, default: { findOne: jest.fn(), update: jest.fn() } }));
jest.mock('../../finance/models/VolunteerFundEntry.js', () => ({ __esModule: true, default: { findAll: jest.fn() } }));
jest.mock('../../__mocks__/sequelizeModelStub.ts', () => ({ __esModule: true, default: { findByPk: jest.fn() } }));
jest.mock('../configService.js', () => ({ getConfigValue: jest.fn(() => 'Europe/Warsaw') }));

import { Op } from 'sequelize';
import AssistantManagerTaskLog from '../../models/AssistantManagerTaskLog';
import AuditLog from '../../models/AuditLog';
import StaffPayoutCollectionLog from '../../models/StaffPayoutCollectionLog';
import StaffPayoutLedger from '../../models/StaffPayoutLedger';
import VolunteerFundEntry from '../../finance/models/VolunteerFundEntry';
import User from '../../__mocks__/sequelizeModelStub';
import type SocialMediaContent from '../../models/SocialMediaContent';
import {
  reassignPublishedSocialMediaTaskDate,
  syncPublishedSocialMediaTaskEvidence,
} from '../socialMediaPublishTaskService';

const transaction = { LOCK: { UPDATE: 'UPDATE' } };
const links = { instagram: 'https://instagram.com/reel/old', tiktok: 'https://tiktok.com/@user/video/1' };
const content = (overrides: Record<string, unknown> = {}) => ({
  id: 41, title: 'The reel', idea: 'Start in the square', onVideoCaptions: 'Krakow nights',
  platformCaption: 'Come along', hashtags: ['krakow'], targetPlatforms: ['instagram', 'tiktok'],
  scheduledAt: '2026-09-01', driveProjectUrl: 'https://drive.google.com/drive/folders/project',
  status: 'published', publishedAt: new Date('2026-09-04T22:30:12.123Z'), publishedBy: 9,
  publishedTaskLogId: 88, createdBy: 10, platformLinks: links, ...overrides,
}) as unknown as SocialMediaContent;

const publication = {
  version: 2, contentId: 41, publishedBy: 9, publishedAt: '2026-09-04T22:30:12.123Z',
  title: 'The reel', idea: 'Start in the square', onVideoCaptions: 'Krakow nights',
  platformCaption: 'Come along', hashtags: ['krakow'],
  driveProjectUrl: 'https://drive.google.com/drive/folders/project',
  platformLinks: links, platformLinkEditHistory: [{ editedBy: 3 }],
};

const task = (overrides: Record<string, unknown> = {}) => {
  const log: Record<string, any> = {
    id: 89, userId: 7, taskDate: '2026-09-02', templateId: 12, status: 'pending', completedAt: null,
    notes: 'Destination staff note.',
    meta: { completeOnSocialMediaPublish: true, points: 5, evidenceItems: [{ id: 'user-proof' }] },
    template: { scheduleConfig: { completeOnSocialMediaPublish: true } },
    ...overrides,
  };
  log.update = jest.fn(async (values: Record<string, unknown>) => Object.assign(log, values));
  return log;
};

const oldTask = (overrides: Record<string, unknown> = {}) => task({
  id: 88, taskDate: '2026-09-05', status: 'completed', completedAt: content().publishedAt,
  notes: [
    'Keep the handover note.',
    '[Social Media publication evidence #41 - START]\nOld idea and links\n[Social Media publication evidence #41 - END]',
    'Keep the checklist.',
    '[Social Media publication link correction #41 - START]\nUpdated links\n[Social Media publication link correction #41 - END]',
    '[Social Media publication evidence #60 - START]\nAnother idea\n[Social Media publication evidence #60 - END]',
  ].join('\n\n'),
  meta: {
    completeOnSocialMediaPublish: true, points: 8, evidenceItems: [{ id: 'original-proof' }],
    socialMediaContentId: 41, socialMediaContentSnapshot: { id: 41, title: 'The reel' },
    completedBySocialMediaPublish: true, socialMediaPublicationSnapshot: publication,
    socialMediaPublishReschedule: { previousTaskDate: '2026-09-01' },
    managerOverride: { originalGenerationSourceKey: '12:7:2026-09-01' },
  },
  ...overrides,
});

const reassign = (item = content(), publishedDate = '2026-09-02') => reassignPublishedSocialMediaTaskDate({
  content: item, actorId: 99, publishedDate, transaction: transaction as never,
});

describe('published Social Media date task reassignment', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-09-06T12:00:00.000Z'));
    (User as any).findByPk.mockResolvedValue({ id: 7 });
    (StaffPayoutLedger.findOne as jest.Mock).mockResolvedValue(null);
    (StaffPayoutCollectionLog.findAll as jest.Mock).mockResolvedValue([]);
    (VolunteerFundEntry.findAll as jest.Mock).mockResolvedValue([]);
    (AssistantManagerTaskLog.findByPk as jest.Mock).mockResolvedValue(oldTask());
    (AssistantManagerTaskLog.findAll as jest.Mock).mockResolvedValue([task()]);
    (AuditLog.create as jest.Mock).mockResolvedValue({ id: 1 });
  });
  afterEach(() => jest.useRealTimers());

  it('reopens only the old task and completes the original assignee task with transferred publication evidence', async () => {
    const source = oldTask();
    const target = task();
    (AssistantManagerTaskLog.findByPk as jest.Mock).mockResolvedValue(source);
    (AssistantManagerTaskLog.findAll as jest.Mock).mockResolvedValue([target]);

    await expect(reassign()).resolves.toEqual({
      previousTaskLogId: 88,
      taskCompletion: { taskLogId: 89, userId: 7, taskDate: '2026-09-02', status: 'completed' },
      publishedAt: new Date('2026-09-01T22:30:12.123Z'),
    });
    expect(source.status).toBe('pending');
    expect(source.completedAt).toBeNull();
    expect(source.taskDate).toBe('2026-09-05');
    expect(source.notes).toContain('Keep the handover note.');
    expect(source.notes).toContain('Keep the checklist.');
    expect(source.notes).toContain('Another idea');
    expect(source.notes).not.toContain('#41');
    expect(source.notes).not.toContain('Old idea and links');
    expect(source.meta).toEqual({
      completeOnSocialMediaPublish: true, points: 8, evidenceItems: [{ id: 'original-proof' }],
      managerOverride: { originalGenerationSourceKey: '12:7:2026-09-01' },
    });
    expect(target.notes).toContain('Destination staff note.');
    expect(target.notes).toContain('Idea: Start in the square');
    expect(target.notes).toContain(links.instagram);
    expect(target.meta.evidenceItems).toEqual([{ id: 'user-proof' }]);
    expect(target.meta.socialMediaPublicationSnapshot).toEqual(expect.objectContaining({
      publishedBy: 9, publishedAt: '2026-09-01T22:30:12.123Z',
      originalPublishedAt: publication.publishedAt, platformLinkEditHistory: [{ editedBy: 3 }],
      publishDateEditHistory: [expect.objectContaining({ editedBy: 99, userId: 7, previousTaskLogId: 88, taskLogId: 89 })],
    }));
    expect(AssistantManagerTaskLog.findAll).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 7, taskDate: '2026-09-02', id: { [Op.ne]: 88 } }, lock: 'UPDATE', transaction,
    }));
    expect(AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      actorId: 99, entityId: '41', metaJson: expect.objectContaining({ previousPublication: publication }),
    }), { transaction });
    expect(source.update).toHaveBeenCalledWith(expect.any(Object), { transaction });
    expect(target.update).toHaveBeenCalledWith(expect.any(Object), { transaction });
    expect(StaffPayoutLedger.update).toHaveBeenCalledWith({ settlementSnapshot: null }, {
      where: { staffUserId: 7, paidAmountMinor: 0, rangeEnd: { [Op.gte]: '2026-09-02' } }, transaction,
    });
  });

  it.each(['pending', 'missed'])('can use a matching %s task on an earlier unpaid month', async (status) => {
    const target = task({ taskDate: '2026-08-20', status });
    (AssistantManagerTaskLog.findAll as jest.Mock).mockResolvedValue([target]);
    await expect(reassign(content(), '2026-08-20')).resolves.toEqual(expect.objectContaining({
      taskCompletion: expect.objectContaining({ taskLogId: 89, taskDate: '2026-08-20' }),
    }));
  });

  it('retains Warsaw wall-clock publication time across a daylight-saving boundary', async () => {
    (AssistantManagerTaskLog.findAll as jest.Mock).mockResolvedValue([task({ taskDate: '2026-01-20' })]);
    await expect(reassign(content(), '2026-01-20')).resolves.toEqual(expect.objectContaining({
      publishedAt: new Date('2026-01-19T23:30:12.123Z'),
    }));
  });

  it.each([
    [[], 'Assign a publish-enabled'],
    [[{ meta: { socialMediaContentId: 66, completeOnSocialMediaPublish: true } }], 'another idea'],
    [[{ status: 'completed' }], 'already completed'],
    [[{ status: 'waived' }], 'already completed'],
    [[{ meta: { socialMediaContentSnapshot: { id: 66 }, completeOnSocialMediaPublish: true } }], 'another publication'],
    [[{ meta: { socialMediaContentId: '66', completeOnSocialMediaPublish: true } }], 'another publication'],
    [[{}, { id: 90 }], 'More than one'],
    [[{ userId: 99 }], 'Assign a publish-enabled'],
    [[{ meta: { completeOnSocialMediaPublish: false } }], 'Assign a publish-enabled'],
  ])('rejects unavailable or ambiguous targets atomically (%s)', async (rows, message) => {
    const source = oldTask();
    const targets = (rows as Record<string, unknown>[]).map((row) => task(row));
    (AssistantManagerTaskLog.findByPk as jest.Mock).mockResolvedValue(source);
    (AssistantManagerTaskLog.findAll as jest.Mock).mockResolvedValue(targets);
    await expect(reassign()).rejects.toThrow(message as string);
    expect(source.update).not.toHaveBeenCalled();
    targets.forEach((target) => expect(target.update).not.toHaveBeenCalled());
    expect(AuditLog.create).not.toHaveBeenCalled();
    expect(StaffPayoutLedger.update).not.toHaveBeenCalled();
  });

  it('ignores an already completed unlinked task when one pending task is available', async () => {
    const target = task();
    const completed = task({ id: 90, status: 'completed' });
    (AssistantManagerTaskLog.findAll as jest.Mock).mockResolvedValue([completed, target]);
    await reassign();
    expect(target.status).toBe('completed');
    expect(completed.update).not.toHaveBeenCalled();
  });

  it('honors a unique explicit idea link ahead of another unlinked task', async () => {
    const target = task({ meta: { socialMediaContentId: 41, completeOnSocialMediaPublish: true } });
    const other = task({ id: 90 });
    (AssistantManagerTaskLog.findAll as jest.Mock).mockResolvedValue([other, target]);
    await reassign();
    expect(target.status).toBe('completed');
    expect(other.update).not.toHaveBeenCalled();
  });

  it.each(['2026-02-30', '2026-9-02', '2026-09-07'])('rejects invalid or future date %s before modifying tasks', async (date) => {
    await expect(reassign(content(), date)).rejects.toThrow();
    expect(AssistantManagerTaskLog.findByPk).not.toHaveBeenCalled();
  });

  it('requires a verified linked completion for legacy publications', async () => {
    await expect(reassign(content({ publishedTaskLogId: null }))).rejects.toThrow('verified published item');
    expect(AssistantManagerTaskLog.findAll).not.toHaveBeenCalled();
    const invalidSource = oldTask({ meta: { socialMediaContentId: 66 } });
    (AssistantManagerTaskLog.findByPk as jest.Mock).mockResolvedValue(invalidSource);
    await expect(reassign()).rejects.toThrow('could not be verified');
    expect(invalidSource.update).not.toHaveBeenCalled();
  });

  it('makes a same-day retry a no-op and preserves the exact original time', async () => {
    const source = oldTask();
    (AssistantManagerTaskLog.findByPk as jest.Mock).mockResolvedValue(source);
    await expect(reassign(content(), '2026-09-05')).resolves.toEqual(expect.objectContaining({
      publishedAt: content().publishedAt, taskCompletion: expect.objectContaining({ taskLogId: 88 }),
    }));
    expect(source.update).not.toHaveBeenCalled();
    expect(AssistantManagerTaskLog.findAll).not.toHaveBeenCalled();
    expect(AuditLog.create).not.toHaveBeenCalled();
  });

  it('removes exact legacy generated notes while preserving surrounding user notes', async () => {
    const generated = [
      'Social Media publication: The reel', 'Idea: Start in the square', 'On-video captions: Krakow nights',
      'Platform caption: Come along', 'Hashtags: #krakow',
      'Drive folder: https://drive.google.com/drive/folders/project',
      `Instagram: ${links.instagram}`, `TikTok: ${links.tiktok}`,
    ].join('\n');
    const source = oldTask({ notes: `Staff note before.\n\n${generated}\n\nStaff note after.` });
    (AssistantManagerTaskLog.findByPk as jest.Mock).mockResolvedValue(source);
    await reassign();
    expect(source.notes).toBe('Staff note before.\n\nStaff note after.');
  });

  it('rejects broken managed notes and oversized destination notes without losing evidence', async () => {
    const source = oldTask({ notes: '[Social Media publication evidence #41 - START]\nUnfinished block' });
    (AssistantManagerTaskLog.findByPk as jest.Mock).mockResolvedValue(source);
    await expect(reassign()).rejects.toThrow('incomplete publication notes');
    expect(source.update).not.toHaveBeenCalled();
    (AssistantManagerTaskLog.findByPk as jest.Mock).mockResolvedValue(oldTask());
    const target = task({ notes: 'x'.repeat(100_000) });
    (AssistantManagerTaskLog.findAll as jest.Mock).mockResolvedValue([target]);
    await expect(reassign()).rejects.toThrow('enough note space');
    expect(target.update).not.toHaveBeenCalled();
  });

  it.each(['ledger', 'collection', 'fund'])('protects actual settled %s payroll', async (type) => {
    if (type === 'ledger') (StaffPayoutLedger.findOne as jest.Mock).mockResolvedValue({ id: 1 });
    if (type === 'collection') (StaffPayoutCollectionLog.findAll as jest.Mock).mockResolvedValue([{ id: 1, note: 'Salary' }]);
    if (type === 'fund') (VolunteerFundEntry.findAll as jest.Mock)
      .mockResolvedValueOnce([{ id: 1, amountMinor: 100 }]).mockResolvedValueOnce([]);
    const source = oldTask();
    (AssistantManagerTaskLog.findByPk as jest.Mock).mockResolvedValue(source);
    await expect(reassign()).rejects.toThrow('already settled payout');
    expect(source.update).not.toHaveBeenCalled();
    expect(AuditLog.create).not.toHaveBeenCalled();
  });

  it('permits fully reversed fund allocations and reimbursement-only collections', async () => {
    (StaffPayoutCollectionLog.findAll as jest.Mock).mockResolvedValue([{ id: 1, note: 'Taxi reimbursement' }]);
    (VolunteerFundEntry.findAll as jest.Mock)
      .mockResolvedValueOnce([{ id: 1, amountMinor: 100 }])
      .mockResolvedValueOnce([{ reversalOfEntryId: 1, amountMinor: -100 }]);
    await expect(reassign()).resolves.toEqual(expect.objectContaining({ previousTaskLogId: 88 }));
  });

  it('protects a later paid ledger whose carry depends on an affected task month', async () => {
    (StaffPayoutLedger.findOne as jest.Mock).mockResolvedValue({
      id: 4, rangeStart: '2026-09-01', rangeEnd: '2026-09-30', paidAmountMinor: 30000,
    });
    (AssistantManagerTaskLog.findAll as jest.Mock).mockResolvedValue([task({ taskDate: '2026-08-20' })]);
    await expect(reassign(content(), '2026-08-20')).rejects.toThrow('carried balance');
    expect(StaffPayoutLedger.findOne).toHaveBeenCalledWith(expect.objectContaining({
      where: { staffUserId: 7, paidAmountMinor: { [Op.ne]: 0 }, rangeEnd: { [Op.gte]: '2026-08-20' } },
    }));
    expect(StaffPayoutLedger.update).not.toHaveBeenCalled();
  });

  it('can move back to the reopened task and keeps subsequent link edits on the corrected date', async () => {
    const source = oldTask();
    const target = task();
    const item = content();
    (AssistantManagerTaskLog.findByPk as jest.Mock).mockResolvedValue(source);
    (AssistantManagerTaskLog.findAll as jest.Mock).mockResolvedValue([target]);
    const moved = await reassign(item);
    Object.assign(item, { publishedTaskLogId: target.id, publishedAt: moved.publishedAt });
    (AssistantManagerTaskLog.findByPk as jest.Mock).mockResolvedValue(target);
    (AssistantManagerTaskLog.findAll as jest.Mock).mockResolvedValue([source]);
    const movedBack = await reassign(item, '2026-09-05');
    Object.assign(item, { publishedTaskLogId: source.id, publishedAt: movedBack.publishedAt });
    expect(target.status).toBe('pending');
    expect(source.status).toBe('completed');
    expect(source.meta.socialMediaPublicationSnapshot.publishDateEditHistory).toHaveLength(2);
    expect(source.notes.match(/evidence #41 - START/gu)).toHaveLength(1);
    (AssistantManagerTaskLog.findByPk as jest.Mock).mockResolvedValue(source);
    const nextLinks = { ...links, instagram: 'https://instagram.com/reel/corrected' };
    Object.assign(item, { platformLinks: nextLinks });
    await syncPublishedSocialMediaTaskEvidence({
      content: item, actorId: 101, transaction: transaction as never,
      linkEdit: { editedAt: new Date(), previousPlatformLinks: links },
    });
    expect(source.meta.socialMediaPublicationSnapshot.publishedAt).toBe(movedBack.publishedAt.toISOString());
    expect(source.meta.socialMediaPublicationSnapshot.publishedBy).toBe(9);
    expect(source.notes).toContain(nextLinks.instagram);
    expect(source.meta.socialMediaPublicationSnapshot.publishDateEditHistory).toHaveLength(2);
  });
});
