import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';
import timezone from 'dayjs/plugin/timezone.js';
import utc from 'dayjs/plugin/utc.js';
import { Op } from 'sequelize';
import AssistantManagerTaskLog from '../models/AssistantManagerTaskLog.js';
import AssistantManagerTaskTemplate from '../models/AssistantManagerTaskTemplate.js';
import AssistantManagerTaskPushSubscription from '../models/AssistantManagerTaskPushSubscription.js';
import { getConfigValue } from './configService.js';
import {
  isAmTaskPushEnabled,
  sendAmTaskPushNotificationToUser,
} from './amTaskPushService.js';

dayjs.extend(customParseFormat);
dayjs.extend(utc);
dayjs.extend(timezone);

const TIME_INPUT_FORMATS = ['HH:mm', 'H:mm', 'HH:mm:ss', 'h:mm A', 'h A'];
const PUSH_SENT_META_KEY = 'pushNotificationEvents';
// Prevent overlapping ticks in this process from sending the same event twice. Across processes,
// the stable push tag still coalesces delivery; exactly-once delivery would require an outbox.
const inFlightReminderEvents = new Set<string>();

type ReminderEvent = {
  type: 'reminder' | 'start';
  at: dayjs.Dayjs;
  title: string;
  body: string;
};

const resolveScheduleTimezone = (): string =>
  (getConfigValue('SCHED_TZ') as string) ?? 'Europe/Warsaw';

const normalizeReminderMinutes = (value: unknown): number | null => {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    return null;
  }
  return numeric;
};

const getTaskStartDateTime = (
  log: AssistantManagerTaskLog,
  template: AssistantManagerTaskTemplate | null,
  scheduleTimezone: string,
): dayjs.Dayjs | null => {
  const scheduleConfig = (template?.scheduleConfig ?? {}) as Record<string, unknown>;
  const meta = (log.meta ?? {}) as Record<string, unknown>;

  const rawTime =
    typeof meta.time === 'string' && meta.time.trim()
      ? meta.time.trim()
      : typeof meta.shiftTimeStart === 'string' && meta.shiftTimeStart.trim()
        ? meta.shiftTimeStart.trim()
        : typeof scheduleConfig.time === 'string' && scheduleConfig.time.trim()
          ? scheduleConfig.time.trim()
          : typeof scheduleConfig.hour === 'string' && scheduleConfig.hour.trim()
            ? scheduleConfig.hour.trim()
            : null;

  if (!rawTime) {
    return null;
  }

  const parsedTime = dayjs(rawTime, TIME_INPUT_FORMATS, true);
  if (!parsedTime.isValid()) {
    return null;
  }

  const taskDate = typeof log.taskDate === 'string' ? log.taskDate : null;
  if (!taskDate) {
    return null;
  }

  const taskStart = dayjs.tz(
    `${taskDate} ${parsedTime.format('HH:mm')}`,
    'YYYY-MM-DD HH:mm',
    scheduleTimezone,
  );
  if (!taskStart.isValid()) {
    return null;
  }

  return taskStart;
};

const getSentEventMap = (
  meta: Record<string, unknown>,
): Record<string, string> => {
  const raw = meta[PUSH_SENT_META_KEY];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  return Object.entries(raw as Record<string, unknown>).reduce<Record<string, string>>(
    (accumulator, [key, value]) => {
      if (typeof value === 'string' && value.trim()) {
        accumulator[key] = value;
      }
      return accumulator;
    },
    {},
  );
};

const buildEventKey = (event: ReminderEvent): string =>
  `${event.type}:${event.at.valueOf()}`;

const buildReminderEvents = (
  log: AssistantManagerTaskLog,
  taskStart: dayjs.Dayjs,
  template: AssistantManagerTaskTemplate | null,
): ReminderEvent[] => {
  const scheduleConfig = (template?.scheduleConfig ?? {}) as Record<string, unknown>;
  const reminderMinutes = normalizeReminderMinutes(
    scheduleConfig.reminderMinutesBeforeStart,
  );
  const notifyAtStart = scheduleConfig.notifyAtStart !== false;
  const taskName = template?.name ?? `Task #${log.id}`;
  const events: ReminderEvent[] = [];

  if (reminderMinutes != null) {
    events.push({
      type: 'reminder',
      at: taskStart.subtract(reminderMinutes, 'minute'),
      title: `Task reminder: ${taskName}`,
      body: `Starts in ${reminderMinutes} minute(s) at ${taskStart.format('HH:mm')}.`,
    });
  }

  if (notifyAtStart) {
    events.push({
      type: 'start',
      at: taskStart,
      title: `Task starting now: ${taskName}`,
      body: `Scheduled for ${taskStart.format('ddd, MMM D HH:mm')}.`,
    });
  }

  return events;
};

export const processAmTaskPushReminderTick = async (): Promise<number> => {
  if (!isAmTaskPushEnabled()) {
    return 0;
  }

  const activeSubscriptions = await AssistantManagerTaskPushSubscription.findAll({
    attributes: ['userId'],
    where: { isActive: true },
  });
  const subscribedUserIds = Array.from(
    new Set(activeSubscriptions.map((subscription) => subscription.userId)),
  );
  if (subscribedUserIds.length === 0) {
    return 0;
  }

  const scheduleTimezone = resolveScheduleTimezone();
  const now = dayjs().tz(scheduleTimezone);
  const windowStart = now.subtract(60, 'second');
  const windowEnd = now.add(59, 'second');
  const latestAllowedPastEvent = windowStart.subtract(5, 'minute');
  const taskDateStart = now.startOf('day').subtract(1, 'day').format('YYYY-MM-DD');
  const taskDateEnd = now.endOf('day').add(14, 'day').format('YYYY-MM-DD');

  const logs = await AssistantManagerTaskLog.findAll({
    where: {
      status: 'pending',
      userId: { [Op.in]: subscribedUserIds },
      taskDate: { [Op.between]: [taskDateStart, taskDateEnd] },
    },
    include: [
      {
        model: AssistantManagerTaskTemplate,
        as: 'template',
        attributes: ['id', 'name', 'scheduleConfig'],
      },
    ],
  });

  let sentCount = 0;

  for (const log of logs) {
    const template =
      ((log as unknown as { template?: AssistantManagerTaskTemplate | null }).template ??
        null) as AssistantManagerTaskTemplate | null;
    const taskStart = getTaskStartDateTime(log, template, scheduleTimezone);
    if (!taskStart) {
      continue;
    }

    const events = buildReminderEvents(log, taskStart, template);
    if (events.length === 0) {
      continue;
    }

    const sentEventMap = getSentEventMap((log.meta ?? {}) as Record<string, unknown>);

    for (const event of events) {
      if (event.at.isBefore(latestAllowedPastEvent) || event.at.isAfter(windowEnd)) {
        continue;
      }

      const eventKey = buildEventKey(event);
      const inFlightKey = `${log.id}:${eventKey}`;
      if (sentEventMap[eventKey] || inFlightReminderEvents.has(inFlightKey)) {
        continue;
      }
      inFlightReminderEvents.add(inFlightKey);
      try {
        const sequelize = AssistantManagerTaskLog.sequelize;
        if (!sequelize) throw new Error('Database connection is not available for task reminder tracking.');
        // A tick can hold a stale task while another user completes or reschedules it.
        const current = await AssistantManagerTaskLog.findByPk(log.id, { include: [{ model: AssistantManagerTaskTemplate,
          as: 'template', attributes: ['id', 'name', 'scheduleConfig'] }] });
        if (!current || current.status !== 'pending' || current.userId !== log.userId) continue;
        const currentTemplate = current.template ?? null;
        const currentStart = getTaskStartDateTime(current, currentTemplate, scheduleTimezone);
        if (!currentStart || !buildReminderEvents(current, currentStart, currentTemplate).some((candidate) => buildEventKey(candidate) === eventKey)
          || getSentEventMap(current.meta ?? {})[eventKey]) continue;

        const wasSent = await sendAmTaskPushNotificationToUser({
        userId: log.userId,
        payload: {
          title: event.title,
          body: event.body,
          url: `/assistant-manager-tasks?section=dashboard&task=${log.id}`,
          // Include event timestamp to avoid silent replacement when multiple reminders
          // exist for the same task log (for example after template schedule updates).
          tag: `am-task-${log.id}-${event.type}-${event.at.valueOf()}`,
          taskLogId: log.id,
          eventType: event.type,
        },
        });
        if (!wasSent) continue;
        // Do not keep a database lock during a network push. Re-read under a row lock afterwards,
        // merging only this successful event into the latest evidence/workflow metadata.
        await sequelize.transaction(async (transaction) => {
          const latest = await AssistantManagerTaskLog.findByPk(log.id, { transaction, lock: transaction.LOCK.UPDATE });
          if (!latest) return;
          const latestMeta = (latest.meta ?? {}) as Record<string, unknown>;
          const latestEvents = getSentEventMap(latestMeta);
          if (latestEvents[eventKey]) return;
          await latest.update({ meta: { ...latestMeta, [PUSH_SENT_META_KEY]: { ...latestEvents, [eventKey]: now.toISOString() } } }, { transaction });
        });
        sentEventMap[eventKey] = now.toISOString();
        sentCount += 1;
      } finally {
        inFlightReminderEvents.delete(inFlightKey);
      }
    }
  }

  return sentCount;
};
