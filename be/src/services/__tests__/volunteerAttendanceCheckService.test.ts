jest.mock('../../config/database.js', () => ({ __esModule: true, default: { transaction: jest.fn() } }));
jest.mock('../../models/AssistantManagerTaskLog.js', () => ({ __esModule: true, default: { findByPk: jest.fn() } }));
jest.mock('../../models/AssistantManagerTaskTemplate.js', () => ({ __esModule: true, default: { findByPk: jest.fn() } }));
jest.mock('../../models/AuditLog.js', () => ({ __esModule: true, default: { findAll: jest.fn(), create: jest.fn() } }));
jest.mock('../../models/ScheduleWeek.js', () => ({ __esModule: true, default: { findByPk: jest.fn() } }));
jest.mock('../../models/ShiftAssignment.js', () => ({ __esModule: true, default: { findByPk: jest.fn(), findAll: jest.fn() } }));
jest.mock('../../models/ShiftInstance.js', () => ({ __esModule: true, default: { findByPk: jest.fn() } }));
jest.mock('../../models/ShiftType.js', () => ({ __esModule: true, default: { findAll: jest.fn() } }));
jest.mock('../../models/VolunteerShiftAttendance.js', () => ({ __esModule: true, default: { findOne: jest.fn(), findAll: jest.fn(), create: jest.fn() } }));

import sequelize from '../../config/database.js';
import AssistantManagerTaskLog from '../../models/AssistantManagerTaskLog.js';
import AssistantManagerTaskTemplate from '../../models/AssistantManagerTaskTemplate.js';
import AuditLog from '../../models/AuditLog.js';
import ScheduleWeek from '../../models/ScheduleWeek.js';
import ShiftAssignment from '../../models/ShiftAssignment.js';
import ShiftInstance from '../../models/ShiftInstance.js';
import ShiftType from '../../models/ShiftType.js';
import VolunteerShiftAttendance from '../../models/VolunteerShiftAttendance.js';
import { assertAttendanceEvidencePreserved, ensureTaskAttendanceCheckSatisfied, getVolunteerAttendanceCheck,
  saveVolunteerAttendanceCheck, validateAttendanceCheckConfig, validateAttendanceCheckShiftTypes } from '../volunteerAttendanceCheckService.js';

const config = { evidenceRules: [{ key: 'meeting', type: 'image', required: true }], volunteerAttendance: {
  checkKind: 'meeting_point', shiftTypeIds: [1], evidenceRuleKey: 'meeting', expectedTime: '20:45',
} };
const evidence = { id: 'photo-1', type: 'image', ruleKey: 'meeting', storagePath: 'drive:file', driveFileId: 'file',
  valid: true, uploadedAt: '2026-09-06T18:45:00Z', uploadedBy: 9 };
const log = { id: 10, templateId: 11, taskDate: '2026-09-06', userId: 9, status: 'pending', meta: { evidenceItems: [evidence] } };
const assignment = { id: 20, userId: 7, shiftInstanceId: 30, roleInShift: 'Guide', assignee: { firstName: 'A', lastName: 'Guide' },
  shiftInstance: { id: 30, date: log.taskDate, shiftTypeId: 1 } };
const attendance = { status: 'attended', revision: 1, evidenceTaskLogId: 10, evidenceRuleKey: 'meeting', evidenceFileId: 'photo-1',
  evidenceShiftInstanceId: 30, evidenceShiftTypeId: 1, evidenceTaskLog: { id: 10, taskDate: log.taskDate },
  checkKind: 'meeting_point', expectedTime: '20:45', recordedAt: new Date('2026-09-06T18:50:00Z') };
const actor = { actorId: 9, roleSlug: 'assistant-manager' };
const input = { status: 'on_time', evidenceFileId: 'photo-1', expectedRevision: 0 };
const transaction = { LOCK: { UPDATE: 'UPDATE' } };
const save = (body: unknown = input) => saveVolunteerAttendanceCheck({ ...actor, taskLogId: 10, assignmentId: 20, body });

describe('photo-linked attendance', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-09-06T19:00:00Z'));
    (sequelize.transaction as jest.Mock).mockImplementation(async (callback) => callback(transaction));
    (AssistantManagerTaskLog.findByPk as jest.Mock).mockResolvedValue(log);
    (AssistantManagerTaskTemplate.findByPk as jest.Mock).mockResolvedValue({ scheduleConfig: config });
    (ShiftAssignment.findByPk as jest.Mock).mockResolvedValue(assignment);
    (ShiftAssignment.findAll as jest.Mock).mockResolvedValue([assignment]);
    (ShiftInstance.findByPk as jest.Mock).mockResolvedValue({ id: 30, date: log.taskDate, shiftTypeId: 1, scheduleWeekId: 1 });
    (ScheduleWeek.findByPk as jest.Mock).mockResolvedValue({ state: 'published' });
    (VolunteerShiftAttendance.findOne as jest.Mock).mockResolvedValue(null);
    (VolunteerShiftAttendance.findAll as jest.Mock).mockResolvedValue([]);
    (AuditLog.findAll as jest.Mock).mockResolvedValue([]);
  });
  afterEach(() => jest.useRealTimers());

  it('is opt-in and defaults meeting time to 20:45', () => {
    expect(validateAttendanceCheckConfig({})).toBeNull();
    expect(validateAttendanceCheckConfig({ ...config, volunteerAttendance: { ...config.volunteerAttendance, expectedTime: undefined } })?.expectedTime).toBe('20:45');
  });
  it.each(['24:00', '20:60', '8:45', '20:45:00'])('rejects invalid check time %s', (expectedTime) => {
    expect(() => validateAttendanceCheckConfig({ ...config, volunteerAttendance: { ...config.volunteerAttendance, expectedTime } })).toThrow('HH:mm');
  });
  it('requires a real required image rule and known shift types', async () => {
    expect(() => validateAttendanceCheckConfig({ ...config, evidenceRules: [{ key: 'meeting', type: 'link', required: true }] })).toThrow('required image');
    expect(() => validateAttendanceCheckConfig({ ...config, evidenceRules: [{ key: 'meeting', type: 'image', required: false }] })).toThrow('required image');
    (ShiftType.findAll as jest.Mock).mockResolvedValue([]);
    await expect(validateAttendanceCheckShiftTypes(config)).rejects.toMatchObject({ status: 400 });
  });
  it('denies staff and assistants assigned to a different task', async () => {
    await expect(getVolunteerAttendanceCheck(10, { actorId: 7, roleSlug: 'guide' })).rejects.toMatchObject({ status: 403 });
    await expect(getVolunteerAttendanceCheck(10, { actorId: 8, roleSlug: 'assistant-manager' })).rejects.toMatchObject({ status: 403 });
    await expect(getVolunteerAttendanceCheck(10, { actorId: 8, roleSlug: 'administrator' })).resolves.toMatchObject({ taskLogId: 10 });
  });
  it('stores a human decision with evidence, revision and immutable audit snapshot', async () => {
    await save();
    expect(VolunteerShiftAttendance.create).toHaveBeenCalledWith(expect.objectContaining({ status: 'attended', revision: 1, evidenceTaskLogId: 10, evidenceFileId: 'photo-1', evidenceShiftInstanceId: 30, evidenceShiftTypeId: 1 }), { transaction });
    expect(AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({ action: 'volunteer_attendance.checked', metaJson: expect.objectContaining({ userId: 7, evidence }) }), { transaction });
  });
  it('does not infer lateness from upload time and retains explicit late minutes', async () => {
    await save({ ...input, status: 'late', lateMinutes: 5 });
    expect(VolunteerShiftAttendance.create).toHaveBeenCalledWith(expect.objectContaining({ status: 'late', lateMinutes: 5 }), { transaction });
  });
  it('requires notes for absent and excused decisions', async () => {
    await expect(save({ ...input, status: 'absent' })).rejects.toMatchObject({ status: 400 });
    await expect(save({ ...input, status: 'excused', notes: '   ' })).rejects.toMatchObject({ status: 400 });
  });
  it('rejects self-confirmation, wrong subject photos and unpublished rosters', async () => {
    (ShiftAssignment.findByPk as jest.Mock).mockResolvedValue({ ...assignment, userId: 9 });
    await expect(save()).rejects.toMatchObject({ status: 403 });
    (ShiftAssignment.findByPk as jest.Mock).mockResolvedValue(assignment);
    (AssistantManagerTaskLog.findByPk as jest.Mock).mockResolvedValue({ ...log, meta: { evidenceItems: [{ ...evidence, subjectUserId: 8 }] } });
    await expect(save()).rejects.toMatchObject({ status: 409 });
    (AssistantManagerTaskLog.findByPk as jest.Mock).mockResolvedValue(log);
    (ScheduleWeek.findByPk as jest.Mock).mockResolvedValue({ state: 'draft' });
    await expect(save()).rejects.toMatchObject({ status: 409 });
    expect(VolunteerShiftAttendance.create).not.toHaveBeenCalled();
  });
  it('rejects stale revisions and pre-check times', async () => {
    (VolunteerShiftAttendance.findOne as jest.Mock).mockResolvedValue(attendance);
    await expect(save()).rejects.toMatchObject({ status: 409 });
    jest.setSystemTime(new Date('2026-09-06T18:44:00Z'));
    await expect(save()).rejects.toMatchObject({ status: 409 });
  });
  it('requires all current assignments before completion and counts duplicate roles once', async () => {
    await expect(ensureTaskAttendanceCheckSatisfied(log as never, log.meta)).rejects.toMatchObject({ status: 409 });
    (ShiftAssignment.findAll as jest.Mock).mockResolvedValue([assignment, { ...assignment, id: 21, volunteerAttendance: attendance }]);
    await expect(ensureTaskAttendanceCheckSatisfied(log as never, log.meta)).resolves.toBeUndefined();
    expect((await getVolunteerAttendanceCheck(10, actor)).assignments).toHaveLength(1);
  });
  it('excludes the task assignee from both the visible roster and completion requirements', async () => {
    const taskAssignee = { ...assignment, id: 21, userId: log.userId,
      assignee: { firstName: 'Jamie', lastName: 'Manager' }, volunteerAttendance: undefined };
    (ShiftAssignment.findAll as jest.Mock).mockResolvedValue([
      taskAssignee,
      { ...assignment, volunteerAttendance: attendance },
    ]);

    const result = await getVolunteerAttendanceCheck(10, actor);
    expect(result.assignments).toHaveLength(1);
    expect(result.assignments[0]).toMatchObject({ userId: assignment.userId, name: 'A Guide' });
    await expect(ensureTaskAttendanceCheckSatisfied(log as never, log.meta)).resolves.toBeUndefined();
  });
  it('rejects a direct attendance save for the task assignee, including from an administrator', async () => {
    (ShiftAssignment.findByPk as jest.Mock).mockResolvedValue({ ...assignment, userId: log.userId });

    await expect(saveVolunteerAttendanceCheck({
      actorId: 8,
      roleSlug: 'administrator',
      taskLogId: log.id,
      assignmentId: assignment.id,
      body: input,
    })).rejects.toMatchObject({ status: 409 });
    expect(VolunteerShiftAttendance.create).not.toHaveBeenCalled();
  });
  it('protects old photos even after current attendance has been corrected to another photo', async () => {
    (AuditLog.findAll as jest.Mock).mockResolvedValue([{ metaJson: { evidence } }]);
    await expect(assertAttendanceEvidencePreserved(10, log.meta, null)).rejects.toMatchObject({ status: 409 });
    await expect(assertAttendanceEvidencePreserved(10, log.meta, { evidenceItems: [{ id: evidence.id, type: 'link' }] })).rejects.toMatchObject({ status: 409 });
    await expect(assertAttendanceEvidencePreserved(10, log.meta, log.meta)).resolves.toBeUndefined();
  });

  it('does not transfer a previous assignee’s confirmation but preserves the optimistic revision for a new check', async () => {
    (ShiftAssignment.findAll as jest.Mock).mockResolvedValue([{ ...assignment, volunteerAttendance: { ...attendance, subjectUserId: 8 } }]);
    expect((await getVolunteerAttendanceCheck(10, actor)).assignments[0]).toMatchObject({ status: null, revision: 1, evidenceFileId: null });
    await expect(ensureTaskAttendanceCheckSatisfied(log as never, log.meta)).rejects.toMatchObject({ status: 409 });
    await save();
    expect(VolunteerShiftAttendance.create).toHaveBeenCalledWith(expect.objectContaining({ subjectUserId: 7 }), { transaction });
  });

  it.each([{ evidenceShiftInstanceId: 31 }, { evidenceShiftTypeId: 2 }, { evidenceTaskLog: { id: 10, taskDate: '2026-09-05' } }])('hides confirmations with stale physical shift/type/date bindings: %j', async (changes) => {
    (ShiftAssignment.findAll as jest.Mock).mockResolvedValue([{ ...assignment, volunteerAttendance: { ...attendance, ...changes } }]);
    expect((await getVolunteerAttendanceCheck(10, actor)).assignments[0]).toMatchObject({ status: null, revision: 1, evidenceFileId: null });
  });
});
