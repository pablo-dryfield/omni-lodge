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

  it('does not reopen a cleaning-managed source even for an unchanged publication date', async () => {
    const source = oldTask();
    source.meta.cleaningPhotoWorkflow = { managed: true };
    (AssistantManagerTaskLog.findByPk as jest.Mock).mockResolvedValue(source);
    await expect(reassign(content(), '2026-09-05')).rejects.toThrow('managed by cleaning photo approvals');
    expect(source.update).not.toHaveBeenCalled();
    expect(StaffPayoutLedger.findOne).not.toHaveBeenCalled();
  });

  it('does not use a cleaning-managed destination or change either task', async () => {
    const source = oldTask();
    const target = task();
    target.meta.cleaningPhotoWorkflow = { managed: true };
    (AssistantManagerTaskLog.findByPk as jest.Mock).mockResolvedValue(source);
    (AssistantManagerTaskLog.findAll as jest.Mock).mockResolvedValue([target]);
    await expect(reassign()).rejects.toThrow('Assign a publish-enabled Social Media task');
    expect(source.update).not.toHaveBeenCalled();
    expect(target.update).not.toHaveBeenCalled();
    expect(StaffPayoutLedger.update).not.toHaveBeenCalled();
  });

  it('ignores a cleaning destination when a separate valid publication task exists', async () => {
    const source = oldTask();
    const cleaning = task({ id: 90 });
    cleaning.meta.cleaningPhotoWorkflow = { managed: true };
    const target = task();
    (AssistantManagerTaskLog.findByPk as jest.Mock).mockResolvedValue(source);
    (AssistantManagerTaskLog.findAll as jest.Mock).mockResolvedValue([cleaning, target]);
    await expect(reassign()).resolves.toMatchObject({ taskCompletion: { taskLogId: 89 } });
    expect(cleaning.update).not.toHaveBeenCalled();
    expect(target.update).toHaveBeenCalledTimes(1);
  });

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
    [[{ status: 'waived' }], 'waived'],
    [[{ status: 'completed', meta: { socialMediaContentId: 66, completeOnSocialMediaPublish: true } }], 'another idea'],
    [[{ status: 'completed', meta: { socialMediaPublicationSnapshot: { contentId: 66 }, completeOnSocialMediaPublish: true } }], 'another publication'],
    [[{ status: 'completed', meta: { socialMediaContentId: 41, socialMediaContentSnapshot: { id: 66 }, completeOnSocialMediaPublish: true } }], 'another publication'],
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

  it('rejects ambiguity between a pending and already completed unlinked task', async () => {
    const source = oldTask();
    const target = task();
    const completed = task({ id: 90, status: 'completed' });
    (AssistantManagerTaskLog.findByPk as jest.Mock).mockResolvedValue(source);
    (AssistantManagerTaskLog.findAll as jest.Mock).mockResolvedValue([completed, target]);
    await expect(reassign()).rejects.toThrow('More than one');
    expect(source.update).not.toHaveBeenCalled();
    expect(target.update).not.toHaveBeenCalled();
    expect(completed.update).not.toHaveBeenCalled();
    expect(AuditLog.create).not.toHaveBeenCalled();
  });

  it.each([false, true])('accepts an already completed target preserving its work (explicit link: %s)', async (explicitLink) => {
    const completedAt = new Date('2026-09-02T19:45:00.000Z');
    const target = task({ status: 'completed', completedAt });
    if (explicitLink) target.meta.socialMediaContentId = 41;
    const other = task({ id: 90 });
    (AssistantManagerTaskLog.findAll as jest.Mock).mockResolvedValue(explicitLink ? [other, target] : [target]);

    await expect(reassign()).resolves.toEqual(expect.objectContaining({
      taskCompletion: { taskLogId: 89, userId: 7, taskDate: '2026-09-02', status: 'completed' },
    }));
    expect(target.completedAt).toEqual(completedAt);
    expect(target.taskDate).toBe('2026-09-02');
    expect(target.notes).toContain('Destination staff note.');
    expect(target.notes).toContain('Idea: Start in the square');
    expect(target.notes).toContain(links.instagram);
    expect(target.meta.evidenceItems).toEqual([{ id: 'user-proof' }]);
    expect(target.meta.socialMediaPublicationSnapshot.publishedAt).toBe('2026-09-01T22:30:12.123Z');
    expect(target.meta.socialMediaPublicationDateCompletionBaseline).toEqual(expect.objectContaining({
      contentId: 41, taskLogId: 89, status: 'completed', completedAt: completedAt.toISOString(),
      hadAutoCompletionFlag: false,
    }));
    expect(AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      metaJson: expect.objectContaining({
        targetPreviousStatus: 'completed', targetPreviousCompletedAt: completedAt.toISOString(),
        sourceResultStatus: 'pending',
      }),
    }), { transaction });
    expect(other.update).not.toHaveBeenCalled();
  });

  it.each([undefined, false])('restores independent completion across repeated moves without transferring its baseline (prior flag: %s)', async (priorAutoFlag) => {
    const original = oldTask();
    const completedAt = new Date('2026-09-02T19:45:00.000Z');
    const independent = task({ status: 'completed', completedAt });
    if (priorAutoFlag !== undefined) independent.meta.completedBySocialMediaPublish = priorAutoFlag;
    const pending = task({ id: 90, taskDate: '2026-09-03', notes: 'Third task note.' });
    const item = content();
    const move = async (from: Record<string, any>, to: Record<string, any>) => {
      (AssistantManagerTaskLog.findByPk as jest.Mock).mockResolvedValue(from);
      (AssistantManagerTaskLog.findAll as jest.Mock).mockResolvedValue([to]);
      const result = await reassign(item, to.taskDate);
      Object.assign(item, { publishedTaskLogId: to.id, publishedAt: result.publishedAt });
    };

    await move(original, independent);
    expect(original.status).toBe('pending');
    expect(independent.completedAt).toEqual(completedAt);

    await move(independent, pending);
    expect(independent.status).toBe('completed');
    expect(independent.completedAt).toEqual(completedAt);
    expect(independent.notes).toBe('Destination staff note.');
    expect(independent.meta.evidenceItems).toEqual([{ id: 'user-proof' }]);
    expect(independent.meta).not.toHaveProperty('socialMediaContentId');
    expect(independent.meta).not.toHaveProperty('socialMediaPublicationSnapshot');
    expect(independent.meta).not.toHaveProperty('socialMediaPublicationDateCompletionBaseline');
    if (priorAutoFlag === undefined) expect(independent.meta).not.toHaveProperty('completedBySocialMediaPublish');
    else expect(independent.meta.completedBySocialMediaPublish).toBe(false);
    expect(pending.status).toBe('completed');
    expect(pending.completedAt).toEqual(item.publishedAt);
    expect(pending.meta.socialMediaPublicationDateCompletionBaseline).toBeFalsy();
    expect(pending.meta.socialMediaPublicationSnapshot).not.toHaveProperty('socialMediaPublicationDateCompletionBaseline');
    expect((AuditLog.create as jest.Mock).mock.calls.at(-1)?.[0].metaJson.sourceResultStatus).toBe('completed');

    await move(pending, independent);
    expect(pending.status).toBe('pending');
    expect(pending.completedAt).toBeNull();
    expect(pending.notes).toBe('Third task note.');
    expect(independent.completedAt).toEqual(completedAt);
    expect(independent.meta.socialMediaPublicationDateCompletionBaseline.taskLogId).toBe(independent.id);

    await move(independent, original);
    expect(independent.status).toBe('completed');
    expect(independent.completedAt).toEqual(completedAt);
    expect(independent.notes).toBe('Destination staff note.');
    expect(original.status).toBe('completed');
    expect(original.meta.socialMediaPublicationDateCompletionBaseline).toBeFalsy();
    expect(original.meta.socialMediaPublicationSnapshot.publishDateEditHistory).toHaveLength(4);
    expect(original.notes.match(/evidence #41 - START/gu)).toHaveLength(1);
  });

  it('does not preserve a duplicate automatic completion as independent work when moving again', async () => {
    const duplicate = oldTask({ id: 89, taskDate: '2026-09-02' });
    const item = content();
    (AssistantManagerTaskLog.findAll as jest.Mock).mockResolvedValue([duplicate]);
    const firstMove = await reassign(item);
    Object.assign(item, { publishedTaskLogId: duplicate.id, publishedAt: firstMove.publishedAt });
    expect(duplicate.meta.socialMediaPublicationDateCompletionBaseline).toBeFalsy();

    const pending = task({ id: 90, taskDate: '2026-09-03' });
    (AssistantManagerTaskLog.findByPk as jest.Mock).mockResolvedValue(duplicate);
    (AssistantManagerTaskLog.findAll as jest.Mock).mockResolvedValue([pending]);
    await reassign(item, pending.taskDate);
    expect(duplicate.status).toBe('pending');
    expect(duplicate.completedAt).toBeNull();
    expect(duplicate.meta).not.toHaveProperty('completedBySocialMediaPublish');
    expect(duplicate.notes).not.toContain('#41');
    expect(pending.meta.socialMediaPublicationDateCompletionBaseline).toBeFalsy();
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
