jest.mock('../../models/AssistantManagerTaskLog.js', () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));
jest.mock('../../models/AssistantManagerTaskTemplate.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/ReviewArchive.js', () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));
jest.mock('../../models/ReviewAssignment.js', () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));
jest.mock('../../models/ReviewCounter.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/ReviewCounterEntry.js', () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));
jest.mock('../../models/ReviewManualCredit.js', () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));
jest.mock('../../models/ReviewMonthLock.js', () => ({
  __esModule: true,
  default: { findOne: jest.fn() },
}));
jest.mock('../../models/ScheduleWeek.js', () => ({ __esModule: true, default: { findByPk: jest.fn() } }));
jest.mock('../../models/ShiftAssignment.js', () => ({
  __esModule: true,
  default: { findAll: jest.fn(), findByPk: jest.fn() },
}));
jest.mock('../../models/ShiftInstance.js', () => ({ __esModule: true, default: { findByPk: jest.fn() } }));
jest.mock('../../models/ShiftTemplate.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/ShiftType.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/StaffProfile.js', () => ({
  __esModule: true,
  default: { findAll: jest.fn(), findOne: jest.fn() },
}));
jest.mock('../../models/User.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/VolunteerMilestoneFeedback.js', () => ({
  __esModule: true,
  default: { findAll: jest.fn(), findOrCreate: jest.fn() },
}));
jest.mock('../../models/VolunteerShiftAttendance.js', () => ({
  __esModule: true,
  VOLUNTEER_ATTENDANCE_STATUSES: ['attended', 'late', 'absent', 'excused'],
  default: { findOrCreate: jest.fn(), sequelize: { transaction: jest.fn() } },
}));

import AssistantManagerTaskLog from '../../models/AssistantManagerTaskLog.js';
import ReviewArchive from '../../models/ReviewArchive.js';
import ReviewAssignment from '../../models/ReviewAssignment.js';
import ReviewCounterEntry from '../../models/ReviewCounterEntry.js';
import ReviewManualCredit from '../../models/ReviewManualCredit.js';
import ReviewMonthLock from '../../models/ReviewMonthLock.js';
import ShiftAssignment from '../../models/ShiftAssignment.js';
import ShiftInstance from '../../models/ShiftInstance.js';
import ScheduleWeek from '../../models/ScheduleWeek.js';
import StaffProfile from '../../models/StaffProfile.js';
import VolunteerMilestoneFeedback from '../../models/VolunteerMilestoneFeedback.js';
import VolunteerShiftAttendance from '../../models/VolunteerShiftAttendance.js';
import {
  calculateVolunteerMilestones,
  currentVolunteerAttendance,
  deduplicateVolunteerAttendanceAssignments,
  isCleaningTaskTemplate,
  isPastShift,
  loadVolunteerReviewCredits,
  getVolunteerMilestoneProgress,
  parseVolunteerMilestonePeriod,
  recordVolunteerAttendance,
  saveVolunteerManagementFeedback,
  selectVolunteerCleaningEvidence,
} from '../volunteerMilestoneService.js';

describe('volunteer milestone calculations', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (ShiftInstance.findByPk as jest.Mock).mockResolvedValue({ id: 19, scheduleWeekId: 5, shiftTypeId: 1, date: '2026-08-01', timeStart: '18:00:00', timeEnd: '22:00:00' });
    (ScheduleWeek.findByPk as jest.Mock).mockResolvedValue({ id: 5, state: 'published' });
    (AssistantManagerTaskLog.findAll as jest.Mock).mockResolvedValue([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('keeps genuine legacy confirmations but binds photo checks to source task date and physical shift identity', () => {
    const row = { userId: 7, shiftInstance: { id: 21, shiftTypeId: 2, date: '2026-08-20' }, volunteerAttendance: { status: 'attended', subjectUserId: 7 } };
    expect(currentVolunteerAttendance(row as never)).toBe(row.volunteerAttendance);
    const bound = { ...row.volunteerAttendance, evidenceTaskLogId: 91, evidenceShiftInstanceId: 21, evidenceShiftTypeId: 2,
      evidenceTaskLog: { id: 91, taskDate: '2026-08-20' } };
    expect(currentVolunteerAttendance({ ...row, volunteerAttendance: bound } as never)).toBe(bound);
    for (const changes of [{ subjectUserId: 8 }, { evidenceShiftInstanceId: 22 }, { evidenceShiftTypeId: 3 },
      { evidenceTaskLog: { id: 91, taskDate: '2026-08-21' } }, { evidenceTaskLog: undefined }, { evidenceShiftInstanceId: null, evidenceShiftTypeId: null }]) {
      expect(currentVolunteerAttendance({ ...row, volunteerAttendance: { ...bound, ...changes } } as never)).toBeUndefined();
    }
  });

  it('uses calendar-month DATEONLY boundaries and caps asOfDate to a past period', () => {
    expect(parseVolunteerMilestonePeriod('2024-02', new Date('2026-09-06T12:00:00Z'))).toEqual({
      month: '2024-02',
      startDate: '2024-02-01',
      endDate: '2024-02-29',
      asOfDate: '2024-02-29',
      timezone: 'Europe/Warsaw',
    });
    expect(() => parseVolunteerMilestonePeriod('2026-13')).toThrow('month must use YYYY-MM format');
  });

  it('treats an overnight shift as past only after its Warsaw-local end', () => {
    const shift = { date: '2026-09-05', timeStart: '23:00:00', timeEnd: '02:00:00' };
    expect(isPastShift(shift as never, new Date('2026-09-05T23:30:00Z'))).toBe(false);
    expect(isPastShift(shift as never, new Date('2026-09-06T00:30:00Z'))).toBe(true);
  });

  it('does not turn an equal start/end time into an artificial 24-hour shift', () => {
    const shift = { date: '2026-09-05', timeStart: '18:00:00', timeEnd: '18:00:00' };
    expect(isPastShift(shift as never, new Date('2026-09-05T16:30:00Z'))).toBe(true);
  });

  it('counts a multi-role assignment only once per physical shift', () => {
    const shared = {
      shiftInstanceId: 101,
      date: '2026-09-05',
      startTime: '18:00:00',
      endTime: '22:00:00',
      shiftName: 'Pub Crawl',
      notes: null,
      recordedByName: null,
      isPast: true,
    };
    const collapsed = deduplicateVolunteerAttendanceAssignments([
      {
        ...shared,
        assignmentId: 11,
        role: 'Guide',
        status: null,
        recordedAt: null,
      },
      {
        ...shared,
        assignmentId: 12,
        role: 'Leader',
        status: 'attended',
        recordedAt: new Date('2026-09-05T21:00:00Z'),
      },
    ]);

    expect(collapsed).toHaveLength(1);
    expect(collapsed[0]).toMatchObject({
      assignmentId: 12,
      shiftInstanceId: 101,
      role: 'Guide, Leader',
      status: 'attended',
    });
  });

  it('unlocks management review only after the four measurable stars', () => {
    const milestones = calculateVolunteerMilestones({
      reviewCredits: 5,
      scheduledPastShifts: 16,
      pendingAttendance: 0,
      attendedShifts: 15,
      lateShifts: 1,
      absentShifts: 0,
      excusedShifts: 0,
      completedCleaningTasks: 5,
      managementApproved: false,
    });

    expect(milestones.slice(0, 4).every((milestone) => milestone.earned)).toBe(true);
    expect(milestones[1]).toMatchObject({ current: 100, earned: true });
    expect(milestones[1].reason).toContain('1 late arrival');
    expect(milestones[4]).toMatchObject({ earned: false, state: 'in_progress' });

    const approved = calculateVolunteerMilestones({
      reviewCredits: 5,
      scheduledPastShifts: 16,
      pendingAttendance: 0,
      attendedShifts: 15,
      lateShifts: 1,
      absentShifts: 0,
      excusedShifts: 0,
      completedCleaningTasks: 5,
      managementApproved: true,
    });
    expect(approved.every((milestone) => milestone.earned)).toBe(true);
  });

  it('keeps a stored approval visibly locked when a measurable milestone regresses', () => {
    const milestones = calculateVolunteerMilestones({
      reviewCredits: 4,
      scheduledPastShifts: 16,
      pendingAttendance: 0,
      attendedShifts: 16,
      lateShifts: 0,
      absentShifts: 0,
      excusedShifts: 0,
      completedCleaningTasks: 5,
      managementApproved: true,
    });
    expect(milestones[4]).toMatchObject({
      earned: false,
      state: 'locked',
      current: 0,
      progressPercent: 0,
    });
    expect(milestones[4].reason).toContain('approval is recorded');
  });

  it('blocks attendance for pending confirmations and any unexcused absence', () => {
    const withPending = calculateVolunteerMilestones({
      reviewCredits: 0,
      scheduledPastShifts: 10,
      pendingAttendance: 1,
      attendedShifts: 9,
      lateShifts: 0,
      absentShifts: 0,
      excusedShifts: 0,
      completedCleaningTasks: 0,
      managementApproved: false,
    });
    expect(withPending[1]).toMatchObject({ earned: false, current: 90 });
    expect(withPending[1].reason).toContain('awaiting management confirmation');

    const withAbsence = calculateVolunteerMilestones({
      reviewCredits: 0,
      scheduledPastShifts: 10,
      pendingAttendance: 0,
      attendedShifts: 9,
      lateShifts: 0,
      absentShifts: 1,
      excusedShifts: 0,
      completedCleaningTasks: 0,
      managementApproved: false,
    });
    expect(withAbsence[1]).toMatchObject({ earned: false, current: 90 });
    expect(withAbsence[1].reason).toContain('unexcused absence');
  });

  it('recognizes cleaning tags and human-readable cleaning names', () => {
    expect(isCleaningTaskTemplate({
      name: 'House standards',
      category: 'Operations',
      subgroup: 'Accommodation',
      scheduleConfig: { tags: ['house-care'] },
    } as never)).toBe(true);
    expect(isCleaningTaskTemplate({
      name: 'Kitchen cleaning check',
      category: 'Operations',
      subgroup: 'House',
      scheduleConfig: {},
    } as never)).toBe(true);
    expect(isCleaningTaskTemplate({
      name: 'Post an Instagram story',
      category: 'Marketing',
      subgroup: 'Social',
      scheduleConfig: { tags: ['social'] },
    } as never)).toBe(false);
  });

  it('uses confirmed cleaning shifts as a fallback and never sums overlapping sources', () => {
    const taskEvidence = [
      { id: 'task-1', label: 'Kitchen cleaning' },
      { id: 'task-2', label: 'Bathroom cleaning' },
    ];
    const shiftEvidence = [
      { id: 'shift-1', label: 'Cleaning - Kitchen' },
      { id: 'shift-2', label: 'Cleaning - Bathroom' },
    ];

    expect(selectVolunteerCleaningEvidence([], shiftEvidence)).toBe(shiftEvidence);
    const overlapping = selectVolunteerCleaningEvidence(taskEvidence, shiftEvidence);
    expect(overlapping).toBe(taskEvidence);
    expect(overlapping).toHaveLength(2);
  });

  it('combines raw legacy fractions, split archive reviews, and non-backfilled manual credit', async () => {
    jest.spyOn(ReviewCounterEntry, 'findAll').mockResolvedValue([
      { id: 1, userId: 7, rawCount: 0.5, counter: { platform: 'Google', periodStart: '2026-08-01' } },
      { id: 2, userId: 7, rawCount: 0.5, counter: { platform: 'Tripadvisor', periodStart: '2026-08-01' } },
    ] as never);
    jest.spyOn(ReviewMonthLock, 'findOne').mockResolvedValue(null);
    jest.spyOn(ReviewManualCredit, 'findAll').mockResolvedValue([
      { id: 4, userId: 7, platform: 'Google', date: '2026-08-14', credit: '0.5', notes: null },
    ] as never);
    jest.spyOn(ReviewArchive, 'findAll').mockResolvedValue([
      {
        id: 30,
        platform: 'Google',
        reviewerName: 'A guest',
        creditMonth: '2026-08-01',
        reviewCreatedAt: new Date('2026-08-05T12:00:00Z'),
      },
    ] as never);
    jest.spyOn(ReviewAssignment, 'findAll').mockResolvedValue([
      { id: 8, reviewId: 30, userId: 7 },
      { id: 9, reviewId: 30, userId: 8 },
    ] as never);

    const credits = await loadVolunteerReviewCredits(
      [7],
      parseVolunteerMilestonePeriod('2026-08', new Date('2026-08-20T12:00:00Z')),
    );
    expect(credits.get(7)?.reduce((sum, entry) => sum + entry.amount, 0)).toBe(2);
    expect(credits.get(7)?.map((entry) => entry.id)).toEqual([
      'legacy-1',
      'legacy-2',
      'archive-30-7',
      'manual-4',
    ]);
  });

  it('uses the exact locked review snapshot even when archive rows are deleted later', async () => {
    jest.spyOn(ReviewCounterEntry, 'findAll').mockResolvedValue([]);
    jest.spyOn(ReviewMonthLock, 'findOne').mockResolvedValue({ reviewIds: [71, 72] } as never);
    jest.spyOn(ReviewManualCredit, 'findAll').mockResolvedValue([]);
    const archiveSpy = jest.spyOn(ReviewArchive, 'findAll').mockResolvedValue([]);
    jest.spyOn(ReviewAssignment, 'findAll').mockResolvedValue([]);

    await loadVolunteerReviewCredits(
      [7],
      parseVolunteerMilestonePeriod('2026-07', new Date('2026-09-01T12:00:00Z')),
    );
    expect(archiveSpy).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: expect.any(Object) },
    }));
    const archiveWhere = archiveSpy.mock.calls[0][0]?.where as Record<PropertyKey, unknown>;
    expect(archiveWhere).not.toHaveProperty('isDeleted');
  });

  it('rejects attendance until the Warsaw-local shift end', async () => {
    jest.spyOn(ShiftAssignment, 'findByPk').mockResolvedValue({
      id: 81,
      userId: 7,
      shiftInstance: {
        id: 18,
        date: '2099-01-01',
        timeStart: '18:00:00',
        timeEnd: '22:00:00',
        scheduleWeek: { id: 4, state: 'published' },
      },
    } as never);
    jest.spyOn(StaffProfile, 'findOne').mockResolvedValue({
      userId: 7,
      staffType: 'volunteer',
      user: { id: 7, firstName: 'Vera', lastName: 'Volunteer', email: 'v@example.com' },
    } as never);
    const createSpy = jest.spyOn(VolunteerShiftAttendance, 'findOrCreate').mockResolvedValue([] as never);

    await expect(recordVolunteerAttendance({
      shiftAssignmentId: 81,
      status: 'attended',
      notes: null,
      actorId: 3,
    })).rejects.toMatchObject({ status: 409 });
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('rejects attendance for a tentative, non-published schedule', async () => {
    jest.spyOn(ShiftAssignment, 'findByPk').mockResolvedValue({
      id: 82,
      userId: 7,
      shiftInstance: {
        id: 19,
        date: '2026-08-01',
        timeStart: '18:00:00',
        timeEnd: '22:00:00',
        scheduleWeek: { id: 5, state: 'assigned' },
      },
    } as never);
    jest.spyOn(StaffProfile, 'findOne').mockResolvedValue({
      userId: 7,
      staffType: 'volunteer',
      user: { id: 7, firstName: 'Vera', lastName: 'Volunteer', email: 'v@example.com' },
    } as never);
    const createSpy = jest.spyOn(VolunteerShiftAttendance, 'findOrCreate').mockResolvedValue([] as never);

    await expect(recordVolunteerAttendance({
      shiftAssignmentId: 82,
      status: 'attended',
      notes: null,
      actorId: 3,
    })).rejects.toMatchObject({ status: 409 });
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('protects evidence-linked attendance from the legacy confirmation endpoint', async () => {
    const transaction = { LOCK: { UPDATE: 'UPDATE' } };
    (VolunteerShiftAttendance.sequelize!.transaction as jest.Mock).mockImplementation(async (callback) => callback(transaction));
    jest.spyOn(ShiftAssignment, 'findByPk').mockResolvedValue({ id: 82, userId: 7, shiftInstanceId: 19,
      shiftInstance: { id: 19, date: '2026-08-01', timeStart: '18:00:00', timeEnd: '22:00:00', scheduleWeek: { id: 5, state: 'published' } } } as never);
    jest.spyOn(StaffProfile, 'findOne').mockResolvedValue({ userId: 7, staffType: 'volunteer', user: { id: 7 } } as never);
    const update = jest.fn();
    jest.spyOn(VolunteerShiftAttendance, 'findOrCreate').mockResolvedValue([{ evidenceTaskLogId: 10, revision: 3, update }, false] as never);
    await expect(recordVolunteerAttendance({ shiftAssignmentId: 82, status: 'attended', notes: null, actorId: 3 })).rejects.toMatchObject({ status: 409 });
    expect(update).not.toHaveBeenCalled();
  });

  it('increments legacy attendance revisions under the assignment lock', async () => {
    const transaction = { LOCK: { UPDATE: 'UPDATE' } };
    (VolunteerShiftAttendance.sequelize!.transaction as jest.Mock).mockImplementation(async (callback) => callback(transaction));
    jest.spyOn(ShiftAssignment, 'findByPk').mockResolvedValue({ id: 82, userId: 7, shiftInstanceId: 19,
      shiftInstance: { id: 19, date: '2026-08-01', timeStart: '18:00:00', timeEnd: '22:00:00', scheduleWeek: { id: 5, state: 'published' } } } as never);
    jest.spyOn(StaffProfile, 'findOne').mockResolvedValue({ userId: 7, staffType: 'volunteer', user: { id: 7 } } as never);
    const update = jest.fn();
    jest.spyOn(VolunteerShiftAttendance, 'findOrCreate').mockResolvedValue([{ evidenceTaskLogId: null, revision: 3, update }, false] as never);
    await recordVolunteerAttendance({ shiftAssignmentId: 82, status: 'attended', notes: null, actorId: 3 });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ revision: 4 }), { transaction });
    expect(ShiftAssignment.findByPk).toHaveBeenCalledWith(82, { transaction, lock: 'UPDATE' });
  });

  it('blocks legacy creation or updates for shifts with a matching photo-managed task, regardless of task owner', async () => {
    const transaction = { LOCK: { UPDATE: 'UPDATE' } };
    (VolunteerShiftAttendance.sequelize!.transaction as jest.Mock).mockImplementation(async (callback) => callback(transaction));
    jest.spyOn(ShiftAssignment, 'findByPk').mockResolvedValue({ id: 82, userId: 7, shiftInstanceId: 19,
      shiftInstance: { id: 19, date: '2026-08-01', timeStart: '18:00:00', timeEnd: '22:00:00', scheduleWeek: { id: 5, state: 'published' } } } as never);
    jest.spyOn(StaffProfile, 'findOne').mockResolvedValue({ userId: 7, staffType: 'volunteer', user: { id: 7 } } as never);
    (AssistantManagerTaskLog.findAll as jest.Mock).mockResolvedValue([{ id: 10, userId: 9, template: { scheduleConfig: { volunteerAttendance: { shiftTypeIds: [1] } } } }]);
    await expect(recordVolunteerAttendance({ shiftAssignmentId: 82, status: 'attended', notes: null, actorId: 7 })).rejects.toMatchObject({ status: 409, message: expect.stringContaining('photo-based attendance task') });
    expect(AssistantManagerTaskLog.findAll).toHaveBeenCalledWith(expect.objectContaining({ where: { taskDate: '2026-08-01' }, transaction }));
    expect(VolunteerShiftAttendance.findOrCreate).not.toHaveBeenCalled();
  });

  it('retains legacy recording when only unrelated photo-check shift types exist that day', async () => {
    const transaction = { LOCK: { UPDATE: 'UPDATE' } };
    (VolunteerShiftAttendance.sequelize!.transaction as jest.Mock).mockImplementation(async (callback) => callback(transaction));
    jest.spyOn(ShiftAssignment, 'findByPk').mockResolvedValue({ id: 82, userId: 7, shiftInstanceId: 19,
      shiftInstance: { id: 19, date: '2026-08-01', timeStart: '18:00:00', timeEnd: '22:00:00', scheduleWeek: { id: 5, state: 'published' } } } as never);
    jest.spyOn(StaffProfile, 'findOne').mockResolvedValue({ userId: 7, staffType: 'volunteer', user: { id: 7 } } as never);
    (AssistantManagerTaskLog.findAll as jest.Mock).mockResolvedValue([{ id: 10, template: { scheduleConfig: { volunteerAttendance: { shiftTypeIds: [2] } } } }]);
    jest.spyOn(VolunteerShiftAttendance, 'findOrCreate').mockResolvedValue([{ id: 17 }, true] as never);
    await expect(recordVolunteerAttendance({ shiftAssignmentId: 82, status: 'attended', notes: null, actorId: 3 })).resolves.toMatchObject({ volunteerUserId: 7 });
    expect(VolunteerShiftAttendance.findOrCreate).toHaveBeenCalled();
  });

  it('rejects final management approval while measurable milestones are incomplete', async () => {
    const profile = {
      userId: 7,
      staffType: 'volunteer',
      user: {
        id: 7,
        firstName: 'Vera',
        lastName: 'Volunteer',
        email: 'v@example.com',
        profilePhotoUrl: null,
      },
    };
    jest.spyOn(StaffProfile, 'findOne').mockResolvedValue(profile as never);
    jest.spyOn(ReviewCounterEntry, 'findAll').mockResolvedValue([]);
    jest.spyOn(ReviewMonthLock, 'findOne').mockResolvedValue(null);
    jest.spyOn(ReviewManualCredit, 'findAll').mockResolvedValue([]);
    jest.spyOn(ReviewArchive, 'findAll').mockResolvedValue([]);
    jest.spyOn(ReviewAssignment, 'findAll').mockResolvedValue([]);
    jest.spyOn(ShiftAssignment, 'findAll').mockResolvedValue([]);
    jest.spyOn(AssistantManagerTaskLog, 'findAll').mockResolvedValue([]);
    jest.spyOn(VolunteerMilestoneFeedback, 'findAll').mockResolvedValue([]);
    const createSpy = jest.spyOn(VolunteerMilestoneFeedback, 'findOrCreate').mockResolvedValue([] as never);

    await expect(saveVolunteerManagementFeedback({
      volunteerUserId: 7,
      month: '2026-09',
      feedback: 'Helpful and reliable.',
      approved: true,
      actorId: 3,
      now: new Date('2026-09-20T12:00:00Z'),
    })).rejects.toMatchObject({ status: 409 });
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('requires an active volunteer profile for self-service progress', async () => {
    const profileSpy = jest.spyOn(StaffProfile, 'findOne').mockResolvedValue(null);

    await expect(getVolunteerMilestoneProgress(7, '2026-09', {
      selfAccess: true,
      now: new Date('2026-09-20T12:00:00Z'),
    })).rejects.toMatchObject({
      status: 403,
      message: 'Volunteer milestones are available only to volunteers.',
    });
    expect(profileSpy).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ userId: 7, staffType: 'volunteer', active: true }),
    }));
  });
});
