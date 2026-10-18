jest.mock('../../config/database.js', () => ({
  __esModule: true,
  default: { transaction: jest.fn() },
}));
jest.mock('../../models/ScheduleWeek.js', () => ({ __esModule: true, default: { findByPk: jest.fn() } }));
jest.mock('../../models/ShiftTemplate.js', () => ({ __esModule: true, default: { findAll: jest.fn() } }));
jest.mock('../../models/ShiftType.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/ShiftTypeProduct.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/ShiftInstance.js', () => ({
  __esModule: true,
  default: { findOne: jest.fn(), create: jest.fn() },
}));
jest.mock('../../models/ShiftAssignment.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/Availability.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/StaffProfile.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/User.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/Export.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/SwapRequest.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/AuditLog.js', () => ({ __esModule: true, default: { create: jest.fn() } }));
jest.mock('../../models/ShiftRole.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/UserShiftRole.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/Product.js', () => ({ __esModule: true, default: {} }));
jest.mock('../renderSchedule.js', () => ({ renderScheduleHTML: jest.fn() }));
jest.mock('../googleDrive.js', () => ({ ensureFolderPath: jest.fn(), uploadBuffer: jest.fn() }));
jest.mock('../notificationService.js', () => ({ sendSchedulingNotification: jest.fn() }));
jest.mock('../configService.js', () => ({ getConfigValue: jest.fn(() => undefined) }));
jest.mock('../shiftRequestService.js', () => ({}));
jest.mock('puppeteer', () => ({ __esModule: true, default: { launch: jest.fn() } }));

import sequelize from '../../config/database.js';
import ScheduleWeek from '../../models/ScheduleWeek.js';
import ShiftTemplate from '../../models/ShiftTemplate.js';
import ShiftInstance from '../../models/ShiftInstance.js';
import { generateShiftInstancesFromTemplates, parseWeekParam } from '../scheduleService.js';

const transaction = { commit: jest.fn(), rollback: jest.fn() };
const template = {
  id: 7,
  shiftTypeId: 1,
  defaultStartTime: '20:45:00',
  defaultEndTime: '02:00:00',
  repeatOn: [1, 2, 3, 4, 5, 6, 7],
};

describe('schedule week generation calendar dates', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    (sequelize.transaction as jest.Mock).mockResolvedValue(transaction);
    (ShiftTemplate.findAll as jest.Mock).mockResolvedValue([template]);
    (ShiftInstance.findOne as jest.Mock).mockResolvedValue(null);
    (ShiftInstance.create as jest.Mock).mockResolvedValue({});
  });

  afterEach(() => jest.useRealTimers());

  it.each([
    ['2026-10-18T21:40:00Z', 2026, 43, '2026-10-19', '2026-10-25'],
    ['2026-10-18T22:40:00Z', 2026, 43, '2026-10-19', '2026-10-25'],
    ['2026-10-19T00:40:00Z', 2026, 43, '2026-10-19', '2026-10-25'],
    ['2026-10-25T23:40:00Z', 2026, 44, '2026-10-26', '2026-11-01'],
    ['2021-01-01T12:00:00Z', 2021, 1, '2021-01-04', '2021-01-10'],
    ['2027-01-01T12:00:00Z', 2026, 53, '2026-12-28', '2027-01-03'],
  ])('generates the selected %s week without depending on the current calendar date', async (now, year, isoWeek, monday, sunday) => {
    jest.setSystemTime(new Date(now));
    (ScheduleWeek.findByPk as jest.Mock).mockResolvedValue({ id: 53, year, isoWeek, state: 'collecting' });

    const result = await generateShiftInstancesFromTemplates({ weekId: 53, templateIds: [7], actorId: 1 });
    const rows = (ShiftInstance.create as jest.Mock).mock.calls.map(([values]) => values);

    expect(result).toEqual({ weekId: 53, created: 7, skipped: 0, templateCount: 1 });
    expect(rows.map((row) => row.date)).toEqual(Array.from({ length: 7 }, (_, offset) => {
      const date = new Date(`${monday}T12:00:00Z`);
      date.setUTCDate(date.getUTCDate() + offset);
      return date.toISOString().slice(0, 10);
    }));
    expect(rows[6].date).toBe(sunday);
    expect(rows.every((row) => row.scheduleWeekId === 53 && row.timeStart === '20:45:00')).toBe(true);
    expect(transaction.commit).toHaveBeenCalledTimes(1);
    expect(transaction.rollback).not.toHaveBeenCalled();
  });

  it('preserves template weekdays and skips existing dates when generation is repeated', async () => {
    jest.setSystemTime(new Date('2026-10-18T22:40:00Z'));
    (ScheduleWeek.findByPk as jest.Mock).mockResolvedValue({ id: 53, year: 2026, isoWeek: 43, state: 'collecting' });
    (ShiftTemplate.findAll as jest.Mock).mockResolvedValue([{ ...template, repeatOn: [1, 7] }]);
    const dates = new Set<string>();
    (ShiftInstance.findOne as jest.Mock).mockImplementation(async ({ where }) => dates.has(where.date) ? {} : null);
    (ShiftInstance.create as jest.Mock).mockImplementation(async (row) => {
      dates.add(row.date);
      return row;
    });

    await expect(generateShiftInstancesFromTemplates({ weekId: 53 })).resolves.toMatchObject({ created: 2, skipped: 0 });
    await expect(generateShiftInstancesFromTemplates({ weekId: 53 })).resolves.toMatchObject({ created: 0, skipped: 2 });
    expect([...dates]).toEqual(['2026-10-19', '2026-10-25']);
  });

  it.each([
    ['2026-10-18T21:40:00Z', 2026, 43],
    ['2026-10-18T22:40:00Z', 2026, 44],
    ['2026-12-27T23:40:00Z', 2027, 1],
  ])('resolves the upcoming week at %s using the Warsaw calendar', (now, year, isoWeek) => {
    jest.setSystemTime(new Date(now));
    expect(parseWeekParam(null)).toEqual({ year, isoWeek });
  });
});
