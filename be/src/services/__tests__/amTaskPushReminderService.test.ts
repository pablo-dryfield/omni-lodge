jest.mock('../../models/AssistantManagerTaskLog.js', () => ({ __esModule: true, default: { findAll: jest.fn(), findByPk: jest.fn(), sequelize: { transaction: jest.fn() } } }));
jest.mock('../../models/AssistantManagerTaskTemplate.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/AssistantManagerTaskPushSubscription.js', () => ({ __esModule: true, default: { findAll: jest.fn() } }));
jest.mock('../configService.js', () => ({ getConfigValue: jest.fn(() => 'Europe/Warsaw') }));
jest.mock('../amTaskPushService.js', () => ({ isAmTaskPushEnabled: jest.fn(() => true), sendAmTaskPushNotificationToUser: jest.fn() }));
import AssistantManagerTaskLog from '../../models/AssistantManagerTaskLog.js';
import AssistantManagerTaskPushSubscription from '../../models/AssistantManagerTaskPushSubscription.js';
import { sendAmTaskPushNotificationToUser } from '../amTaskPushService.js';
import { processAmTaskPushReminderTick } from '../amTaskPushReminderService.js';
const tx = { LOCK: { UPDATE: 'UPDATE' } };
let queried: any;
let latest: any;
describe('atomic reminder metadata tracking', () => {
  beforeEach(() => {
    jest.clearAllMocks(); jest.useFakeTimers().setSystemTime(new Date('2026-09-07T18:00:00Z'));
    queried = { id: 1, userId: 9, taskDate: '2026-09-07', status: 'pending', meta: { time: '20:00' },
      template: { name: 'Cleaning', scheduleConfig: {} }, update: jest.fn() };
    latest = { ...queried, meta: { ...queried.meta }, update: jest.fn() };
    latest.update.mockImplementation(async (values: any) => Object.assign(latest, values));
    (AssistantManagerTaskLog.findAll as jest.Mock).mockResolvedValue([queried]);
    (AssistantManagerTaskLog.findByPk as jest.Mock).mockImplementation(async () => latest);
    (AssistantManagerTaskLog.sequelize!.transaction as jest.Mock).mockImplementation(async (callback) => callback(tx));
    (AssistantManagerTaskPushSubscription.findAll as jest.Mock).mockResolvedValue([{ userId: 9 }]);
    (sendAmTaskPushNotificationToUser as jest.Mock).mockResolvedValue(true);
  });
  afterEach(() => jest.useRealTimers());
  it('merges the event into the latest row without erasing concurrent evidence or completion metadata', async () => {
    (sendAmTaskPushNotificationToUser as jest.Mock).mockImplementation(async () => {
      latest.meta = { ...latest.meta, evidenceItems: [{ id: 'cleaning-photo-100' }], cleaningPhotoWorkflow: { managed: true, completedAt: 'now' },
        pushNotificationEvents: { 'other-event': 'already sent' }, attendanceCheck: { revision: 4 } };
      latest.status = 'completed'; return true;
    });
    expect(await processAmTaskPushReminderTick()).toBe(1);
    expect(latest.meta).toMatchObject({ evidenceItems: [{ id: 'cleaning-photo-100' }], cleaningPhotoWorkflow: { managed: true, completedAt: 'now' },
      attendanceCheck: { revision: 4 }, pushNotificationEvents: { 'other-event': 'already sent' } });
    expect(Object.keys(latest.meta.pushNotificationEvents)).toHaveLength(2);
    expect(latest.status).toBe('completed'); expect(queried.update).not.toHaveBeenCalled();
    expect(AssistantManagerTaskLog.findByPk).toHaveBeenCalledWith(1, { transaction: tx, lock: 'UPDATE' });
  });
  it('does not record failed pushes and permits a later retry', async () => {
    (sendAmTaskPushNotificationToUser as jest.Mock).mockResolvedValueOnce(false);
    expect(await processAmTaskPushReminderTick()).toBe(0); expect(latest.update).not.toHaveBeenCalled();
    expect(await processAmTaskPushReminderTick()).toBe(1);
  });
  it('skips completed, reassigned, rescheduled and already-sent events discovered after the initial query', async () => {
    latest.status = 'completed'; expect(await processAmTaskPushReminderTick()).toBe(0);
    latest.status = 'pending'; latest.userId = 8; expect(await processAmTaskPushReminderTick()).toBe(0);
    latest.userId = 9; latest.meta.time = '21:00'; expect(await processAmTaskPushReminderTick()).toBe(0);
    expect(sendAmTaskPushNotificationToUser).not.toHaveBeenCalled();
    latest.meta.time = '20:00'; expect(await processAmTaskPushReminderTick()).toBe(1);
    expect(await processAmTaskPushReminderTick()).toBe(0);
  });
  it('coalesces overlapping ticks in this process while a push is in flight', async () => {
    let release!: (value: boolean) => void;
    (sendAmTaskPushNotificationToUser as jest.Mock).mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const first = processAmTaskPushReminderTick();
    while (!release) await Promise.resolve();
    expect(await processAmTaskPushReminderTick()).toBe(0);
    release(true); expect(await first).toBe(1);
    expect(sendAmTaskPushNotificationToUser).toHaveBeenCalledTimes(1);
  });
  it('does not overwrite an event marker committed by another worker during delivery', async () => {
    (sendAmTaskPushNotificationToUser as jest.Mock).mockImplementation(async () => {
      latest.meta.pushNotificationEvents = { [`start:${new Date('2026-09-07T18:00:00Z').valueOf()}`]: 'first worker' }; return true;
    });
    expect(await processAmTaskPushReminderTick()).toBe(1);
    expect(latest.update).not.toHaveBeenCalled();
    expect(Object.values(latest.meta.pushNotificationEvents)).toEqual(['first worker']);
  });
});
