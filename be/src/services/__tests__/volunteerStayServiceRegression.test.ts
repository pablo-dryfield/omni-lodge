jest.mock('../../config/database.js', () => ({ __esModule: true, default: { transaction: jest.fn() } }));
jest.mock('../../models/AssistantManagerTaskLog.js', () => ({ __esModule: true, default: { findAll: jest.fn() } }));
jest.mock('../../models/AssistantManagerTaskTemplate.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/AuditLog.js', () => ({ __esModule: true, default: { create: jest.fn() } }));
jest.mock('../../models/CleaningSubmission.js', () => ({ __esModule: true, default: { findAll: jest.fn() } }));
jest.mock('../../models/ReviewArchive.js', () => ({ __esModule: true, default: { findAll: jest.fn() } }));
jest.mock('../../models/ReviewAssignment.js', () => ({ __esModule: true, default: { findAll: jest.fn() } }));
jest.mock('../../models/ReviewCounter.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/ReviewCounterEntry.js', () => ({ __esModule: true, default: { findAll: jest.fn() } }));
jest.mock('../../models/ReviewManualCredit.js', () => ({ __esModule: true, default: { findAll: jest.fn() } }));
jest.mock('../../models/ReviewMonthLock.js', () => ({ __esModule: true, default: { findAll: jest.fn(), findOne: jest.fn() } }));
jest.mock('../../models/ScheduleWeek.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/ShiftAssignment.js', () => ({ __esModule: true, default: { findAll: jest.fn(), findByPk: jest.fn() } }));
jest.mock('../../models/ShiftInstance.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/ShiftTemplate.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/ShiftType.js', () => ({ __esModule: true, default: { findAll: jest.fn() } }));
jest.mock('../../models/StaffProfile.js', () => ({ __esModule: true, default: { findAll: jest.fn(), findOne: jest.fn() } }));
jest.mock('../../models/StaffProfileTypePeriod.js', () => ({ __esModule: true, default: { findAll: jest.fn(), findOne: jest.fn() } }));
jest.mock('../../models/VolunteerMilestoneFeedback.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/VolunteerShiftAttendance.js', () => ({
  __esModule: true, VOLUNTEER_ATTENDANCE_STATUSES: ['attended', 'late', 'absent', 'excused'], default: {},
}));
jest.mock('../../models/VolunteerStay.js', () => ({ __esModule: true, default: { findAll: jest.fn(), findOne: jest.fn(), create: jest.fn() } }));
jest.mock('../../models/VolunteerStayRevision.js', () => ({ __esModule: true, default: { create: jest.fn() } }));

import { Op } from 'sequelize';
import sequelize from '../../config/database.js';
import UserModelStub from '../../__mocks__/sequelizeModelStub.js';
import AssistantManagerTaskLog from '../../models/AssistantManagerTaskLog.js';
import AuditLog from '../../models/AuditLog.js';
import CleaningSubmission from '../../models/CleaningSubmission.js';
import ReviewArchive from '../../models/ReviewArchive.js';
import ReviewAssignment from '../../models/ReviewAssignment.js';
import ReviewCounterEntry from '../../models/ReviewCounterEntry.js';
import ReviewManualCredit from '../../models/ReviewManualCredit.js';
import ReviewMonthLock from '../../models/ReviewMonthLock.js';
import ShiftAssignment from '../../models/ShiftAssignment.js';
import ShiftType from '../../models/ShiftType.js';
import StaffProfile from '../../models/StaffProfile.js';
import StaffProfileTypePeriod from '../../models/StaffProfileTypePeriod.js';
import VolunteerStay from '../../models/VolunteerStay.js';
import VolunteerStayRevision from '../../models/VolunteerStayRevision.js';
import { DEFAULT_VOLUNTEER_MONTHLY_TARGETS } from '../../utils/volunteerStayTargets.js';
import { getVolunteerStayProgress, listVolunteerStayProgress, saveVolunteerStay, saveVolunteerStayFeedback } from '../volunteerStayService.js';

const userModel = Object.assign(UserModelStub, { findByPk: jest.fn(), findAll: jest.fn() });
const transaction = { LOCK: { UPDATE: 'UPDATE' } };
const user = { id: 7, firstName: 'Volunteer', lastName: 'Seven', email: 'seven@example.test', status: true,
  arrivalDate: '2026-08-15', departureDate: '2026-09-30', role: { slug: 'guide' } };
const types = [{ id: 1, key: 'pub_crawl', name: 'Pub Crawl' }, { id: 2, key: 'promotion', name: 'Promotion' },
  { id: 3, key: 'social_media', name: 'Social Media' }];
const makeStay = (overrides: Record<string, unknown> = {}) => {
  const stay = { id: 70, userId: 7, startDate: '2026-08-15', endDate: '2026-09-30', position: 'guide',
    monthlyTargets: { ...DEFAULT_VOLUNTEER_MONTHLY_TARGETS }, shiftTypeIds: { guiding: [1], promotion: [2], socialMedia: [3] },
    feedback: null, changeReason: null, revision: 1, createdBy: 9, updatedBy: 9,
    createdAt: new Date('2026-08-01T10:00:00Z'), updatedAt: new Date('2026-08-01T10:00:00Z'), ...overrides,
    update: jest.fn(),
  };
  stay.update.mockImplementation(async (values) => Object.assign(stay, values));
  return stay;
};
type StayFixture = ReturnType<typeof makeStay>;
let stay: StayFixture;
const report = (now = new Date('2026-09-06T12:00:00Z')) => getVolunteerStayProgress(7, { now });
const milestone = (progress: Awaited<ReturnType<typeof report>>, key: string) => progress.milestones.find((item) => item.key === key)!;
const shift = (id: number, typeId: number, date = '2026-08-20', status: string | null = 'attended') => ({
  id, userId: 7, shiftInstanceId: id + 1000, roleInShift: 'Guide',
  shiftInstance: { id: id + 1000, date, timeStart: '18:00:00', timeEnd: '22:00:00', shiftTypeId: typeId,
    shiftType: types.find((type) => type.id === typeId) },
  volunteerAttendance: status ? { status, recordedAt: new Date('2026-09-01T12:00:00Z'), notes: null } : null,
});
const archive = (id: number, date: string, overrides: Record<string, unknown> = {}) => ({
  id, platform: 'Google', reviewerName: `Review ${id}`, reviewCreatedAt: new Date(date), creditMonth: null, isDeleted: false, ...overrides,
});

describe('volunteer stay integration regressions', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-09-06T12:00:00Z'));
    stay = makeStay();
    (sequelize.transaction as jest.Mock).mockImplementation(async (...args) => args.at(-1)(transaction));
    userModel.findByPk.mockResolvedValue(user);
    userModel.findAll.mockResolvedValue([]);
    (StaffProfile.findOne as jest.Mock).mockResolvedValue({ userId: 7, staffType: 'volunteer', active: true });
    (StaffProfile.findAll as jest.Mock).mockResolvedValue([]);
    (StaffProfileTypePeriod.findOne as jest.Mock).mockResolvedValue(null);
    (StaffProfileTypePeriod.findAll as jest.Mock).mockResolvedValue([]);
    (VolunteerStay.findAll as jest.Mock).mockImplementation(async () => [stay]);
    (VolunteerStay.findOne as jest.Mock).mockResolvedValue(null);
    (ShiftType.findAll as jest.Mock).mockImplementation(async (options) => options?.where
      ? types.filter((type) => options.where.id[Op.in].includes(type.id)) : types);
    for (const model of [ReviewArchive, ReviewAssignment, ReviewCounterEntry, ReviewManualCredit, ReviewMonthLock, ShiftAssignment, AssistantManagerTaskLog, CleaningSubmission]) {
      (model.findAll as jest.Mock).mockResolvedValue([]);
    }
  });
  afterEach(() => jest.useRealTimers());

  it('uses actual Warsaw review dates, includes arrival and excludes departure and future local dates', async () => {
    const rows = [archive(1, '2026-08-14T21:59:59Z'), archive(2, '2026-08-14T22:00:00Z', { creditMonth: '2026-09-01' }),
      archive(3, '2026-09-06T21:59:59Z'), archive(4, '2026-09-06T22:00:00Z'), archive(5, '2026-09-29T22:00:00Z')];
    (ReviewArchive.findAll as jest.Mock).mockImplementation(async ({ where }) => rows.filter((row) =>
      row.reviewCreatedAt >= where.reviewCreatedAt[Op.gte] && row.reviewCreatedAt < where.reviewCreatedAt[Op.lt]));
    (ReviewAssignment.findAll as jest.Mock).mockResolvedValue(rows.map((row) => ({ id: row.id, reviewId: row.id, userId: 7 })));
    const progress = await report();
    expect(milestone(progress, 'reviews')).toMatchObject({ current: 2, target: 22.5 });
    expect(milestone(progress, 'reviews').evidence.map((entry) => entry.occurredAt)).toEqual(['2026-08-15', '2026-09-06']);
    expect((ReviewArchive.findAll as jest.Mock).mock.calls[0][0].where.reviewCreatedAt).toEqual({
      [Op.gte]: new Date('2026-08-14T22:00:00Z'), [Op.lt]: new Date('2026-09-06T22:00:00Z'),
    });
    await report(new Date('2026-10-01T12:00:00Z'));
    expect((ReviewArchive.findAll as jest.Mock).mock.calls[1][0].where.reviewCreatedAt[Op.lt]).toEqual(new Date('2026-09-29T22:00:00Z'));
  });

  it('honors credit-month snapshot membership and retains deleted locked reviews without duplicate shared credit', async () => {
    (ReviewArchive.findAll as jest.Mock).mockResolvedValue([
      archive(10, '2026-08-20T12:00:00Z', { creditMonth: '2026-07-01', isDeleted: true }),
      archive(11, '2026-08-20T12:00:00Z', { creditMonth: '2026-07-01' }),
      archive(12, '2026-08-20T12:00:00Z', { isDeleted: true }), archive(13, '2026-08-20T12:00:00Z'),
    ]);
    (ReviewMonthLock.findAll as jest.Mock).mockResolvedValue([{ periodStart: '2026-07-01', reviewIds: [10] }]);
    (ReviewAssignment.findAll as jest.Mock).mockResolvedValue([
      { reviewId: 10, userId: 7 }, { reviewId: 10, userId: 7 }, { reviewId: 10, userId: 8 },
      { reviewId: 11, userId: 7 }, { reviewId: 12, userId: 7 }, { reviewId: 13, userId: 7 },
    ]);
    const progress = await report();
    expect(milestone(progress, 'reviews').current).toBe(1.5);
    expect(milestone(progress, 'reviews').evidence.map((entry) => entry.id)).toEqual(['archive-10-7', 'archive-13-7']);
    expect((ReviewMonthLock.findAll as jest.Mock).mock.calls[0][0].where.periodStart[Op.in]).toEqual(expect.arrayContaining(['2026-07-01', '2026-08-01']));
  });

  it('keeps fractional manual credits and warns instead of double-counting undated legacy backfills', async () => {
    (ReviewManualCredit.findAll as jest.Mock).mockResolvedValue([
      { id: 1, userId: 7, date: '2026-08-20', credit: '0.1250', platform: 'Google', notes: 'Shared credit' },
      { id: 2, userId: 7, date: '2026-09-01', credit: '10', platform: 'Google', notes: 'Backfilled from legacy review counter #1' },
    ]);
    (ReviewCounterEntry.findAll as jest.Mock).mockResolvedValue([{ userId: 7 }]);
    const progress = await report();
    expect(milestone(progress, 'reviews').current).toBe(0.125);
    expect(progress.warnings).toEqual([expect.stringContaining('Monthly-only legacy review totals')]);
  });

  it('retains a fully covered closed calendar month legacy total without its duplicate backfill', async () => {
    stay = makeStay({ startDate: '2026-08-01', endDate: '2026-09-01' });
    (ReviewCounterEntry.findAll as jest.Mock).mockResolvedValue([{ id: 77, userId: 7, rawCount: '7', counter: { periodStart: '2026-08-01', platform: 'Google' } }]);
    (ReviewManualCredit.findAll as jest.Mock).mockResolvedValue([{ id: 2, userId: 7, date: '2026-08-01', credit: '7', platform: 'Google', notes: 'Backfilled from legacy review counter #1' }]);
    const progress = await report();
    expect(milestone(progress, 'reviews')).toMatchObject({ current: 7, evidence: [expect.objectContaining({ occurredAt: '2026-08-01' })] });
    expect(progress.warnings).toEqual([]);
  });

  it('does not attribute a partial or still-open calendar month legacy total to a stay', async () => {
    (ReviewCounterEntry.findAll as jest.Mock).mockResolvedValue([{ id: 77, userId: 7, rawCount: '7', counter: { periodStart: '2026-08-01', platform: 'Google' } }]);
    let progress = await report();
    expect(milestone(progress, 'reviews').current).toBe(0);
    expect(progress.warnings).not.toEqual([]);
    stay = makeStay({ startDate: '2026-09-01', endDate: '2026-10-01' });
    (ReviewCounterEntry.findAll as jest.Mock).mockResolvedValue([{ id: 78, userId: 7, rawCount: '9', counter: { periodStart: '2026-09-01', platform: 'Google' } }]);
    progress = await report();
    expect(milestone(progress, 'reviews').current).toBe(0);
    expect(progress.warnings).not.toEqual([]);
    const lastDay = await report(new Date('2026-09-30T12:00:00Z'));
    expect(milestone(lastDay, 'reviews').current).toBe(0);
    expect(lastDay.warnings).not.toEqual([]);
    expect(milestone(await report(new Date('2026-10-01T12:00:00Z')), 'reviews').current).toBe(9);
  });

  it('checks a legacy month against each person\'s stay, not the overview\'s combined date range', async () => {
    const partial = makeStay({ startDate: '2026-08-01', endDate: '2026-08-20' });
    const complete = makeStay({ id: 80, userId: 8, startDate: '2026-08-01', endDate: '2026-09-01' });
    (VolunteerStay.findAll as jest.Mock).mockResolvedValue([partial, complete]);
    (StaffProfile.findAll as jest.Mock).mockResolvedValue([{ userId: 7, active: true }, { userId: 8, active: true }]);
    userModel.findAll.mockResolvedValue([user, { ...user, id: 8 }]);
    (ReviewCounterEntry.findAll as jest.Mock).mockResolvedValue([
      { id: 77, userId: 7, rawCount: '7', counter: { periodStart: '2026-08-01', platform: 'Google' } },
      { id: 78, userId: 8, rawCount: '8', counter: { periodStart: '2026-08-01', platform: 'Google' } },
    ]);
    const overview = await listVolunteerStayProgress({ now: new Date('2026-09-06T12:00:00Z') });
    const partialReport = overview.volunteers.find((entry) => entry.user.id === 7)!;
    const completeReport = overview.volunteers.find((entry) => entry.user.id === 8)!;
    expect(partialReport.milestones.find((entry) => entry.key === 'reviews')?.current).toBe(0);
    expect(partialReport.warnings).not.toEqual([]);
    expect(completeReport.milestones.find((entry) => entry.key === 'reviews')?.current).toBe(8);
    expect(completeReport.warnings).toEqual([]);
  });

  it('does not lose a review star to machine-precision accumulation of one-third shares', async () => {
    stay = makeStay({ startDate: '2026-08-01', endDate: '2026-09-01', monthlyTargets: { ...DEFAULT_VOLUNTEER_MONTHLY_TARGETS, reviews: 5 } });
    const reviews = Array.from({ length: 15 }, (_, index) => archive(index + 1, '2026-08-20T12:00:00Z'));
    (ReviewArchive.findAll as jest.Mock).mockResolvedValue(reviews);
    (ReviewAssignment.findAll as jest.Mock).mockResolvedValue(reviews.flatMap((review) => [7, 8, 9].map((userId) => ({ reviewId: review.id, userId }))));
    expect(milestone(await report(), 'reviews')).toMatchObject({ current: 5, target: 5, earned: true, remainingText: 'Stay target reached' });
  });

  it('does not award an unearned positive review target through numeric tolerance', async () => {
    stay = makeStay({ monthlyTargets: { ...DEFAULT_VOLUNTEER_MONTHLY_TARGETS, reviews: 1e-16 } });
    expect(milestone(await report(), 'reviews')).toMatchObject({ current: 0, earned: false });
  });

  it('requires guiding and promotion independently and deduplicates physical shifts', async () => {
    stay = makeStay({ startDate: '2026-08-01', endDate: '2026-09-01', monthlyTargets: { ...DEFAULT_VOLUNTEER_MONTHLY_TARGETS, guidingShifts: 1, promotionShifts: 1 } });
    const first = shift(1, 1);
    (ShiftAssignment.findAll as jest.Mock).mockResolvedValue([first, { ...first, id: 9, roleInShift: 'Leader' }, shift(2, 1)]);
    const progress = await report();
    expect(progress.attendanceAssignments).toHaveLength(2);
    expect(milestone(progress, 'monthly_shifts')).toMatchObject({ current: 2, target: 2, earned: false,
      subtargets: [{ key: 'guidingShifts', current: 2, target: 1 }, { key: 'promotionShifts', current: 0, target: 1 }] });
  });

  it('does not count future confirmed shifts, out-of-stay shifts, or absent shifts toward commitments', async () => {
    (ShiftAssignment.findAll as jest.Mock).mockResolvedValue([
      shift(1, 1, '2026-09-07'), shift(2, 1, '2026-08-14'), shift(3, 1, '2026-09-30'),
      shift(4, 1, '2026-08-20', 'absent'), shift(5, 2, '2026-08-20', 'late'),
    ]);
    const progress = await report();
    expect(milestone(progress, 'monthly_shifts')).toMatchObject({ current: 1,
      subtargets: [{ key: 'guidingShifts', current: 0 }, { key: 'promotionShifts', current: 1 }] });
    expect(milestone(progress, 'attendance').earned).toBe(false);
  });

  it('uses only the saved Social Media mapping for that position', async () => {
    stay = makeStay({ position: 'social_media' });
    (ShiftAssignment.findAll as jest.Mock).mockResolvedValue([shift(1, 1), shift(2, 2), shift(3, 3)]);
    expect(milestone(await report(), 'monthly_shifts')).toMatchObject({ current: 1, target: 24,
      subtargets: [{ key: 'socialMediaShifts', current: 1, target: 24 }] });
  });

  it('never transfers attendance credit or notes to a new assignment owner', async () => {
    const row = shift(1, 1);
    (ShiftAssignment.findAll as jest.Mock).mockResolvedValue([{ ...row, volunteerAttendance: { ...row.volunteerAttendance, subjectUserId: 8, notes: 'Belongs to the old assignee' } }]);
    const progress = await report();
    expect(milestone(progress, 'monthly_shifts').current).toBe(0);
    expect(progress.attendanceAssignments[0]).toMatchObject({ status: null, notes: null, recordedAt: null });
  });

  it('requires approved photos for managed cleaning shifts and attributes them to the cleaner, not the manager', async () => {
    const row = shift(1, 7);
    row.shiftInstance.shiftType = { id: 7, key: 'cleaning', name: 'Cleaning' } as never;
    (ShiftAssignment.findAll as jest.Mock).mockResolvedValue([row]);
    const task = { id: 91, userId: 9, taskDate: row.shiftInstance.date, template: { name: 'Cleaning approval', scheduleConfig: {
      cleaningPhotoApprovalEnabled: true, shiftEvidenceSources: [{ shiftTypeIds: [7] }],
    } } };
    (AssistantManagerTaskLog.findAll as jest.Mock).mockImplementation(async (options) => options.where.userId ? [] : [task]);
    // No lazy submission exists yet: the configured task still prevents attendance fallback.
    expect(milestone(await report(), 'cleaning').current).toBe(0);
    const submission = { id: 10, taskLogId: 91, taskLog: { id: 91, taskDate: row.shiftInstance.date }, shiftAssignmentId: 1, userId: 7, status: 'awaiting_review',
      scheduleSnapshot: { shiftInstanceId: 1001, shiftTypeId: 7, date: row.shiftInstance.date } };
    (CleaningSubmission.findAll as jest.Mock).mockResolvedValue([submission]);
    expect(milestone(await report(), 'cleaning').current).toBe(0);
    (CleaningSubmission.findAll as jest.Mock).mockResolvedValue([{ ...submission, status: 'approved' }, { ...submission, id: 11, status: 'approved' }]);
    expect(milestone(await report(), 'cleaning')).toMatchObject({ current: 1, evidence: [{ label: 'Approved cleaning photos', status: 'approved' }] });
    (CleaningSubmission.findAll as jest.Mock).mockResolvedValue([{ ...submission, status: 'approved', userId: 8 }]);
    expect(milestone(await report(), 'cleaning').current).toBe(0);
    (CleaningSubmission.findAll as jest.Mock).mockResolvedValue([{ ...submission, status: 'approved', shiftAssignmentId: null }]);
    expect(milestone(await report(), 'cleaning').current).toBe(0);
    (CleaningSubmission.findAll as jest.Mock).mockResolvedValue([{ ...submission, status: 'approved', scheduleSnapshot: { ...submission.scheduleSnapshot, date: '2026-08-19' } }]);
    expect(milestone(await report(), 'cleaning').current).toBe(0);
    (CleaningSubmission.findAll as jest.Mock).mockResolvedValue([{ ...submission, status: 'approved', scheduleSnapshot: { ...submission.scheduleSnapshot, shiftTypeId: 1 } }]);
    expect(milestone(await report(), 'cleaning').current).toBe(0);
    (CleaningSubmission.findAll as jest.Mock).mockResolvedValue([{ ...submission, status: 'approved', taskLog: { id: 91, taskDate: '2026-08-19' } }]);
    expect(milestone(await report(), 'cleaning').current).toBe(0);
  });

  it('does not move photo-linked attendance credit into a new date, shift or shift type', async () => {
    const row = shift(1, 1);
    const evidence = { ...row.volunteerAttendance, subjectUserId: 7, evidenceTaskLogId: 91,
      evidenceTaskLog: { id: 91, taskDate: row.shiftInstance.date }, evidenceShiftInstanceId: row.shiftInstanceId, evidenceShiftTypeId: 1 };
    for (const changes of [{ evidenceTaskLog: { id: 91, taskDate: '2026-08-19' } }, { evidenceShiftInstanceId: 2001 }, { evidenceShiftTypeId: 2 }]) {
      (ShiftAssignment.findAll as jest.Mock).mockResolvedValue([{ ...row, volunteerAttendance: { ...evidence, ...changes } }]);
      const progress = await report();
      expect(milestone(progress, 'monthly_shifts').current).toBe(0);
      expect(progress.attendanceAssignments[0].status).toBeNull();
    }
    (ShiftAssignment.findAll as jest.Mock).mockResolvedValue([{ ...row, volunteerAttendance: evidence }]);
    expect(milestone(await report(), 'monthly_shifts').current).toBe(1);
  });

  it('treats late attendance as attended but requires a separate on-time target', async () => {
    (ShiftAssignment.findAll as jest.Mock).mockResolvedValue([shift(1, 1), shift(2, 2, '2026-08-20', 'late'), shift(3, 1, '2026-08-20', 'excused')]);
    expect(milestone(await report(), 'attendance')).toMatchObject({ current: 50, earned: false,
      subtargets: [{ key: 'attendance', current: 100, target: 90 }, { key: 'punctuality', current: 50, target: 90 }] });
  });

  it('earns the stay attendance star with an absence when both saved percentage targets are met', async () => {
    (ShiftAssignment.findAll as jest.Mock).mockResolvedValue([
      ...Array.from({ length: 9 }, (_, index) => shift(index + 1, 1)),
      shift(10, 1, '2026-08-20', 'absent'), shift(11, 1, '2026-08-20', 'excused'),
    ]);
    const attendance = milestone(await report(), 'attendance');
    expect(attendance).toMatchObject({ current: 90, earned: true, remainingText: 'Stay target reached',
      subtargets: [{ key: 'attendance', current: 90, target: 90 }, { key: 'punctuality', current: 100, target: 90 }] });
    expect(attendance.reason).toContain('1 unexcused absence counts against attendance; 1 excused shift excluded.');
  });

  it('uses the saved threshold for absences and reports the percentage deficit rather than requiring absence removal', async () => {
    (ShiftAssignment.findAll as jest.Mock).mockResolvedValue([
      shift(1, 1), shift(2, 1), shift(3, 1), shift(4, 1, '2026-08-20', 'absent'),
    ]);
    expect(milestone(await report(), 'attendance')).toMatchObject({ current: 75, earned: false,
      remainingText: 'Attendance target not yet reached (90%)' });
    stay = makeStay({ monthlyTargets: { ...DEFAULT_VOLUNTEER_MONTHLY_TARGETS, attendancePercent: 75 } });
    expect(milestone(await report(), 'attendance')).toMatchObject({ current: 75, earned: true });
  });

  it('blocks pending confirmations even when the attendance and on-time percentages already meet the target', async () => {
    (ShiftAssignment.findAll as jest.Mock).mockResolvedValue([
      ...Array.from({ length: 9 }, (_, index) => shift(index + 1, 1)), shift(10, 1, '2026-08-20', null),
    ]);
    expect(milestone(await report(), 'attendance')).toMatchObject({ current: 90, earned: false,
      remainingText: '1 shift confirmation pending', reason: expect.stringContaining('1 shift confirmation pending.') });
  });

  it('requires both percentage targets independently when late arrivals and absences are recorded', async () => {
    const rows = [
      ...Array.from({ length: 9 }, (_, index) => shift(index + 1, 1)),
      shift(10, 1, '2026-08-20', 'late'), shift(11, 1, '2026-08-20', 'absent'),
    ];
    (ShiftAssignment.findAll as jest.Mock).mockResolvedValue(rows);
    expect(milestone(await report(), 'attendance')).toMatchObject({ earned: true,
      subtargets: [{ key: 'attendance', current: 90.9 }, { key: 'punctuality', current: 90 }] });
    (ShiftAssignment.findAll as jest.Mock).mockResolvedValue([shift(1, 1, '2026-08-20', 'late'), ...rows.slice(1)]);
    expect(milestone(await report(), 'attendance')).toMatchObject({ earned: false,
      remainingText: 'On-time target not yet reached (90%)',
      subtargets: [{ key: 'attendance', current: 90.9 }, { key: 'punctuality', current: 80 }] });
  });

  it('does not award attendance for only excused shifts or round a below-target attendance rate upward', async () => {
    (ShiftAssignment.findAll as jest.Mock).mockResolvedValue([shift(1, 1, '2026-08-20', 'excused')]);
    expect(milestone(await report(), 'attendance')).toMatchObject({ earned: false,
      remainingText: 'Complete one non-excused shift', reason: 'No completed non-excused shifts yet; 1 excused shift excluded.' });
    (ShiftAssignment.findAll as jest.Mock).mockResolvedValue(Array.from({ length: 29 }, (_, index) =>
      shift(index + 1, 1, '2026-08-20', index < 26 ? 'attended' : 'absent')));
    expect(milestone(await report(), 'attendance')).toMatchObject({ current: 89.6, earned: false,
      remainingText: 'Attendance target not yet reached (90%)' });
  });

  it('does not unlock punctuality by rounding up a ratio just below the target', async () => {
    (ShiftAssignment.findAll as jest.Mock).mockResolvedValue(Array.from({ length: 29 }, (_, index) => shift(index + 1, 1, '2026-08-20', index < 26 ? 'attended' : 'late')));
    expect(milestone(await report(), 'attendance')).toMatchObject({ current: 89.6, earned: false });
    (ShiftAssignment.findAll as jest.Mock).mockResolvedValue(Array.from({ length: 10 }, (_, index) => shift(index + 1, 1, '2026-08-20', index < 9 ? 'attended' : 'late')));
    expect(milestone(await report(), 'attendance')).toMatchObject({ current: 90, earned: true });
  });

  it('returns no evidence or accrued targets for a future stay', async () => {
    stay = makeStay({ startDate: '2026-10-01', endDate: '2026-11-01' });
    const progress = await report();
    expect(progress.targetSummary?.elapsedMonths).toBe(0);
    expect(milestone(progress, 'reviews')).toMatchObject({ current: 0, expectedToDate: 0 });
    expect(ReviewArchive.findAll).not.toHaveBeenCalled();
    expect(AssistantManagerTaskLog.findAll).not.toHaveBeenCalled();
  });

  it('never selects a requested stay from another person', async () => {
    await expect(getVolunteerStayProgress(7, { stayId: 88 })).rejects.toMatchObject({ status: 404 });
    expect(ReviewArchive.findAll).not.toHaveBeenCalled();
  });

  it('selects the current stay, otherwise the nearest upcoming, otherwise the most recent past', async () => {
    const old = makeStay({ id: 60, startDate: '2026-06-01', endDate: '2026-07-01' });
    const recent = makeStay({ id: 61, startDate: '2026-07-01', endDate: '2026-08-01' });
    const current = makeStay({ id: 70, startDate: '2026-08-01', endDate: '2026-09-10' });
    const upcoming = makeStay({ id: 71, startDate: '2026-09-15', endDate: '2026-10-15' });
    const later = makeStay({ id: 72, startDate: '2026-11-01', endDate: '2026-12-01' });
    (VolunteerStay.findAll as jest.Mock).mockResolvedValue([later, upcoming, old, current, recent]);
    expect((await report()).stay?.id).toBe(70);
    (VolunteerStay.findAll as jest.Mock).mockResolvedValue([later, upcoming, old, recent]);
    expect((await report()).stay?.id).toBe(71);
    (VolunteerStay.findAll as jest.Mock).mockResolvedValue([old, recent]);
    expect((await report()).stay?.id).toBe(61);
  });

  it('allows saved historical stays without a current volunteer profile but rejects unrelated self access', async () => {
    (StaffProfile.findOne as jest.Mock).mockResolvedValue(null);
    await expect(report()).resolves.toMatchObject({ stay: { id: 70 } });
    (VolunteerStay.findAll as jest.Mock).mockResolvedValue([]);
    await expect(getVolunteerStayProgress(7, { selfAccess: true })).rejects.toMatchObject({ status: 403 });
    await expect(getVolunteerStayProgress(7)).rejects.toMatchObject({ status: 404 });
  });

  it('keeps an inactive volunteer historical report readable without marking the profile active', async () => {
    (StaffProfile.findOne as jest.Mock).mockResolvedValue({ userId: 7, staffType: 'volunteer', active: false });
    expect(await report()).toMatchObject({ active: false, stay: { id: 70 } });
  });

  it('keeps an inactive volunteer without a saved stay selectable for historical setup', async () => {
    (StaffProfile.findAll as jest.Mock).mockResolvedValue([{ userId: 7, active: false }]);
    (VolunteerStay.findAll as jest.Mock).mockResolvedValue([]);
    userModel.findAll.mockResolvedValue([user]);

    const overview = await listVolunteerStayProgress();

    expect(overview.volunteers).toHaveLength(1);
    expect(overview.volunteers[0]).toMatchObject({ active: false, setupRequired: true, stay: null });
    expect(StaffProfile.findAll).toHaveBeenCalledWith({
      where: { staffType: 'volunteer' },
      attributes: ['userId', 'active'],
    });
  });

  it('keeps a former volunteer with recorded staff-type history available for missing stay setup', async () => {
    (StaffProfile.findAll as jest.Mock).mockResolvedValue([]);
    (StaffProfile.findOne as jest.Mock).mockResolvedValue(null);
    (StaffProfileTypePeriod.findAll as jest.Mock).mockResolvedValue([{ id: 91, userId: 7, staffType: 'volunteer' }]);
    (StaffProfileTypePeriod.findOne as jest.Mock).mockResolvedValue({ id: 91 });
    (VolunteerStay.findAll as jest.Mock).mockResolvedValue([]);
    userModel.findAll.mockResolvedValue([user]);

    const overview = await listVolunteerStayProgress({ now: new Date('2026-09-06T12:00:00Z') });
    expect(overview.volunteers).toEqual([expect.objectContaining({ active: false, setupRequired: true, stay: null })]);
    await expect(getVolunteerStayProgress(7, { now: new Date('2026-09-06T12:00:00Z') }))
      .resolves.toMatchObject({ active: false, setupRequired: true, stay: null });
    expect(StaffProfileTypePeriod.findAll).toHaveBeenCalledWith({
      where: { staffType: 'volunteer', effectiveStart: { [Op.lte]: '2026-09-06' } },
      attributes: ['userId'],
    });
  });

  it('requires a revision match and reason before editing an agreement', async () => {
    (VolunteerStay.findOne as jest.Mock).mockResolvedValue(stay);
    await expect(saveVolunteerStay({ userId: 7, stayId: 70, actorId: 9, body: { expectedRevision: 2, changeReason: 'Extend stay' } })).rejects.toMatchObject({ status: 409 });
    await expect(saveVolunteerStay({ userId: 7, stayId: 70, actorId: 9, body: { expectedRevision: 1 } })).rejects.toMatchObject({ status: 400 });
    expect(stay.update).not.toHaveBeenCalled();
    expect(VolunteerStayRevision.create).not.toHaveBeenCalled();
  });

  it('does not silently substitute prior dates for explicitly null edit dates', async () => {
    (VolunteerStay.findOne as jest.Mock).mockResolvedValue(stay);
    await expect(saveVolunteerStay({ userId: 7, stayId: 70, actorId: 9,
      body: { expectedRevision: 1, startDate: null, changeReason: 'Correct dates' } })).rejects.toMatchObject({ status: 400 });
    expect(stay.update).not.toHaveBeenCalled();
  });

  it('creates an explicit agreement and initial revision without changing mutable profile dates', async () => {
    (VolunteerStay.create as jest.Mock).mockImplementation(async (values) => {
      stay = makeStay({ ...values, id: 71 });
      return stay;
    });
    const progress = await saveVolunteerStay({ userId: 7, actorId: 9, body: {
      startDate: '2026-10-01', endDate: '2026-11-01', position: 'guide', shiftTypeIds: stay.shiftTypeIds,
      monthlyTargets: { ...DEFAULT_VOLUNTEER_MONTHLY_TARGETS, reviews: 16 }, changeReason: 'Peak-season agreement',
    } });
    expect(progress.stay).toMatchObject({ id: 71, revision: 1, startDate: '2026-10-01', endDate: '2026-11-01',
      monthlyTargets: { reviews: 16 }, changeReason: 'Peak-season agreement', feedback: null });
    expect(user.arrivalDate).toBe('2026-08-15');
    expect(VolunteerStay.create).toHaveBeenCalledWith(expect.objectContaining({ userId: 7, createdBy: 9, updatedBy: 9 }), { transaction });
    expect(VolunteerStayRevision.create).toHaveBeenCalledWith(expect.objectContaining({ stayId: 71, revision: 1,
      snapshot: expect.objectContaining({ startDate: '2026-10-01', endDate: '2026-11-01' }) }), { transaction });
    expect(AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({ action: 'volunteer_stay.created' }), { transaction });
  });

  it('allows a former volunteer to record a first stay only when its dates overlap recorded volunteer history', async () => {
    (StaffProfile.findOne as jest.Mock).mockResolvedValue(null);
    (StaffProfileTypePeriod.findOne as jest.Mock).mockResolvedValue({ id: 91 });
    (VolunteerStay.create as jest.Mock).mockImplementation(async (values) => {
      stay = makeStay({ ...values, id: 72 });
      return stay;
    });

    await expect(saveVolunteerStay({ userId: 7, actorId: 9, body: {
      startDate: '2026-07-15', endDate: '2026-08-02', position: 'guide', shiftTypeIds: stay.shiftTypeIds,
    } })).resolves.toMatchObject({ stay: { id: 72 } });
    expect(StaffProfileTypePeriod.findOne).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        userId: 7,
        staffType: 'volunteer',
        effectiveStart: { [Op.lt]: '2026-08-02' },
        [Op.or]: [{ effectiveEnd: null }, { effectiveEnd: { [Op.gte]: '2026-07-15' } }],
      }),
      transaction,
      lock: 'UPDATE',
    }));
    expect(VolunteerStay.create).toHaveBeenCalledTimes(1);
  });

  it('rejects a first historical stay when no recorded volunteer period overlaps its dates', async () => {
    (StaffProfile.findOne as jest.Mock).mockResolvedValue(null);
    (StaffProfileTypePeriod.findOne as jest.Mock).mockResolvedValue(null);

    await expect(saveVolunteerStay({ userId: 7, actorId: 9, body: {
      startDate: '2026-06-01', endDate: '2026-07-01', position: 'guide', shiftTypeIds: stay.shiftTypeIds,
    } })).rejects.toMatchObject({ status: 400 });
    expect(VolunteerStay.create).not.toHaveBeenCalled();
    expect(VolunteerStayRevision.create).not.toHaveBeenCalled();
  });

  it('rejects overlapping stays after locking the same user and before any writes', async () => {
    (VolunteerStay.findOne as jest.Mock).mockResolvedValue(stay);
    await expect(saveVolunteerStay({ userId: 7, actorId: 9, body: {
      startDate: '2026-09-01', endDate: '2026-10-01', position: 'guide', shiftTypeIds: stay.shiftTypeIds,
    } })).rejects.toMatchObject({ status: 409 });
    expect(userModel.findByPk).toHaveBeenCalledWith(7, expect.objectContaining({ transaction, lock: 'UPDATE' }));
    expect(VolunteerStay.create).not.toHaveBeenCalled();
    expect(VolunteerStayRevision.create).not.toHaveBeenCalled();
  });

  it('rejects duplicated or nonexistent shift mappings instead of counting one type twice', async () => {
    const body = { startDate: '2026-08-15', endDate: '2026-09-30', position: 'guide' };
    await expect(saveVolunteerStay({ userId: 7, actorId: 9, body: { ...body, shiftTypeIds: { guiding: [1], promotion: [1] } } })).rejects.toMatchObject({ status: 400 });
    await expect(saveVolunteerStay({ userId: 7, actorId: 9, body: { ...body, shiftTypeIds: { guiding: [1], promotion: [99] } } })).rejects.toMatchObject({ status: 400 });
    expect(VolunteerStay.create).not.toHaveBeenCalled();
  });

  it.each([0, 16])('requires a written reason when creating a custom monthly target agreement (%s reviews)', async (reviews) => {
    await expect(saveVolunteerStay({ userId: 7, actorId: 9, body: {
      startDate: '2026-08-15', endDate: '2026-09-30', position: 'guide', shiftTypeIds: stay.shiftTypeIds,
      monthlyTargets: { ...DEFAULT_VOLUNTEER_MONTHLY_TARGETS, reviews },
    } })).rejects.toMatchObject({ status: 400 });
    expect(VolunteerStay.create).not.toHaveBeenCalled();
    expect(VolunteerStayRevision.create).not.toHaveBeenCalled();
  });

  it('preserves approval and revision when JSONB key order and mapping order alone change', async () => {
    const feedback = { approved: true, feedback: 'Excellent', approvedBy: 9,
      approvedAt: '2026-09-01T00:00:00Z', updatedBy: 9, updatedAt: '2026-09-01T00:00:00Z' };
    stay = makeStay({ feedback, monthlyTargets: { attendancePercent: 90, cleaningTasks: 5, socialMediaShifts: 16,
      promotionShifts: 12, guidingShifts: 12, reviews: 15 },
    shiftTypeIds: { promotion: [2], socialMedia: [], guiding: [3, 1] } });
    (VolunteerStay.findOne as jest.Mock).mockResolvedValueOnce(stay).mockResolvedValueOnce(null);
    const progress = await saveVolunteerStay({ userId: 7, stayId: 70, actorId: 10, body: {
      expectedRevision: 1, changeReason: 'Reviewed unchanged agreement', monthlyTargets: { ...DEFAULT_VOLUNTEER_MONTHLY_TARGETS },
      shiftTypeIds: { guiding: [1, 3], promotion: [2], socialMedia: [] },
    } });
    expect(progress.stay).toMatchObject({ revision: 1, feedback });
    expect(stay.update).not.toHaveBeenCalled();
    expect(VolunteerStayRevision.create).not.toHaveBeenCalled();
    expect(AuditLog.create).not.toHaveBeenCalled();
  });

  it('edits, revokes a prior approval, and writes its new immutable revision and audit in one transaction', async () => {
    stay = makeStay({ feedback: { approved: true, feedback: 'Excellent', approvedBy: 9, approvedAt: '2026-09-01T00:00:00Z', updatedBy: 9, updatedAt: '2026-09-01T00:00:00Z' } });
    (VolunteerStay.findOne as jest.Mock).mockResolvedValueOnce(stay).mockResolvedValueOnce(null);
    const progress = await saveVolunteerStay({ userId: 7, stayId: 70, actorId: 10,
      body: { expectedRevision: 1, endDate: '2026-10-15', changeReason: 'Agreed extension' } });
    expect(progress.stay).toMatchObject({ endDate: '2026-10-15', revision: 2, updatedBy: 10,
      feedback: { approved: false, approvedAt: null, approvedBy: null, feedback: 'Excellent' } });
    expect(stay.update).toHaveBeenCalledWith(expect.objectContaining({ revision: 2 }), { transaction });
    expect(VolunteerStayRevision.create).toHaveBeenCalledWith(expect.objectContaining({ stayId: 70, revision: 2, actorId: 10,
      reason: 'Agreed extension', snapshot: expect.objectContaining({ endDate: '2026-10-15', revision: 2 }) }), { transaction });
    expect(AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({ action: 'volunteer_stay.updated', actorId: 10 }), { transaction });
  });

  it('rejects feedback approval when any first-four milestone remains incomplete', async () => {
    (VolunteerStay.findOne as jest.Mock).mockResolvedValue(stay);
    await expect(saveVolunteerStayFeedback({ userId: 7, stayId: 70, actorId: 9,
      body: { expectedRevision: 1, approved: true, feedback: 'Reviewed' } })).rejects.toMatchObject({ status: 409,
      details: { incompleteMilestones: expect.arrayContaining(['reviews', 'attendance', 'monthly_shifts', 'cleaning']) } });
    expect(stay.update).not.toHaveBeenCalled();
    expect(VolunteerStayRevision.create).not.toHaveBeenCalled();
  });

  it('serializes feedback revisions and rejects future or stale feedback without writes', async () => {
    (VolunteerStay.findOne as jest.Mock).mockResolvedValue(stay);
    await expect(saveVolunteerStayFeedback({ userId: 7, stayId: 70, actorId: 9,
      body: { expectedRevision: 2, approved: false, feedback: 'Draft' } })).rejects.toMatchObject({ status: 409 });
    stay.startDate = '2026-10-01'; stay.endDate = '2026-11-01';
    await expect(saveVolunteerStayFeedback({ userId: 7, stayId: 70, actorId: 9,
      body: { expectedRevision: 1, approved: false, feedback: 'Draft' } })).rejects.toMatchObject({ status: 400 });
    expect(stay.update).not.toHaveBeenCalled();
  });

  it('records written approval only after all first-four milestones, with auditable actor and version', async () => {
    stay = makeStay({ startDate: '2026-08-01', endDate: '2026-09-01', monthlyTargets: {
      reviews: 1, guidingShifts: 0, promotionShifts: 0, socialMediaShifts: 0, cleaningTasks: 0, attendancePercent: 90,
    } });
    (VolunteerStay.findOne as jest.Mock).mockResolvedValue(stay);
    (ShiftAssignment.findAll as jest.Mock).mockResolvedValue([shift(1, 1)]);
    (ReviewArchive.findAll as jest.Mock).mockResolvedValue([archive(41, '2026-08-20T12:00:00Z')]);
    (ReviewAssignment.findAll as jest.Mock).mockResolvedValue([{ reviewId: 41, userId: 7 }, { reviewId: 41, userId: 8 }]);
    (ReviewManualCredit.findAll as jest.Mock).mockResolvedValue([{ id: 5, userId: 7, date: '2026-08-20', credit: '0.5', platform: 'Google', notes: null }]);
    const progress = await saveVolunteerStayFeedback({ userId: 7, stayId: 70, actorId: 9,
      body: { expectedRevision: 1, approved: true, feedback: 'Agreed duties met' } });
    expect(progress).toMatchObject({ starsEarned: 5, stay: { revision: 2, feedback: { approved: true, approvedBy: 9 } } });
    expect(sequelize.transaction).toHaveBeenCalledWith({ isolationLevel: 'REPEATABLE READ' }, expect.any(Function));
    for (const model of [ReviewArchive, ReviewAssignment, ReviewCounterEntry, ReviewManualCredit, ReviewMonthLock, ShiftAssignment, AssistantManagerTaskLog, VolunteerStay, ShiftType]) {
      expect((model.findAll as jest.Mock).mock.calls[0][0].transaction).toBe(transaction);
    }
    expect(VolunteerStayRevision.create).toHaveBeenCalledWith(expect.objectContaining({ revision: 2, actorId: 9,
      snapshot: expect.objectContaining({ approvalEvidence: expect.objectContaining({ asOfDate: '2026-09-06',
        milestones: expect.arrayContaining([expect.objectContaining({ key: 'reviews', current: 1, earned: true,
          evidence: expect.arrayContaining([expect.objectContaining({ id: 'archive-41-7' }), expect.objectContaining({ id: 'manual-5' })]) })]) }) }),
    }), { transaction });
    expect(AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({ action: 'volunteer_stay.feedback_updated' }), { transaction });
  });

  it('returns a refresh conflict for concurrent snapshot serialization failures', async () => {
    (sequelize.transaction as jest.Mock).mockRejectedValueOnce({ original: { code: '40001' } });
    await expect(saveVolunteerStayFeedback({ userId: 7, stayId: 70, actorId: 9,
      body: { expectedRevision: 1, approved: false, feedback: 'Draft' } })).rejects.toMatchObject({ status: 409 });
    expect(VolunteerStayRevision.create).not.toHaveBeenCalled();
  });
});
