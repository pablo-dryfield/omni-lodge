import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import isoWeek from 'dayjs/plugin/isoWeek.js';
import ScheduleWeek from '../models/ScheduleWeek.js';
import ShiftInstance from '../models/ShiftInstance.js';
import ShiftType from '../models/ShiftType.js';
import ShiftAssignment from '../models/ShiftAssignment.js';
import User from '../models/User.js';
import { getConfigValue } from './configService.js';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isoWeek);

const resolveScheduleTimezone = (): string => (getConfigValue('SCHED_TZ') as string) ?? 'Europe/Warsaw';

type AssignmentView = {
  id: number;
  userId: number;
  name: string;
  roleInShift: string;
};

type ShiftView = {
  id: number;
  shiftType: string;
  date: string;
  timeLabel: string;
  meta: Record<string, unknown> | null;
  assignments: AssignmentView[];
};

type DayView = {
  date: string;
  label: string;
  shifts: ShiftView[];
};

export async function buildScheduleView(weekId: number): Promise<{ week: ScheduleWeek; days: DayView[] }> {
  const week = await ScheduleWeek.findByPk(weekId);
  if (!week) {
    throw new Error(`Schedule week ${weekId} not found`);
  }

  const shifts = await ShiftInstance.findAll({
    where: { scheduleWeekId: weekId },
    include: [
      { model: ShiftType, as: 'shiftType' },
      {
        model: ShiftAssignment,
        as: 'assignments',
        include: [{ model: User, as: 'assignee' }],
      },
    ],
    order: [
      ['date', 'ASC'],
      ['timeStart', 'ASC'],
    ],
  });

  const dayMap = new Map<string, DayView>();

  shifts.forEach((shift) => {
    const dateStr = shift.date;
    const date = dayjs.tz(dateStr, resolveScheduleTimezone());
    const dayLabel = date.format('dddd, MMM D');
    const assignments = (shift.assignments ?? []).map((assignment) => {
      const assignee = (assignment as unknown as { assignee?: User }).assignee;
      return {
        id: assignment.id,
        userId: assignment.userId,
        name: assignee ? `${assignee.firstName} ${assignee.lastName}` : 'Unassigned',
        roleInShift: assignment.roleInShift,
      };
    });

    const shiftTypeInstance = (shift as unknown as { shiftType?: ShiftType }).shiftType;
    const shiftTypeName = shiftTypeInstance?.name ?? 'Shift';
    const timeLabelParts = [shift.timeStart];
    if (shift.timeEnd) {
      timeLabelParts.push('–', shift.timeEnd);
    }

    const shiftView: ShiftView = {
      id: shift.id,
      shiftType: shiftTypeName,
      date: dayLabel,
      timeLabel: timeLabelParts.filter(Boolean).join(' '),
      meta: shift.meta ?? null,
      assignments,
    };

    const entry = dayMap.get(dateStr) ?? {
      date: dateStr,
      label: dayLabel,
      shifts: [],
    };

    entry.shifts.push(shiftView);
    dayMap.set(dateStr, entry);
  });

  const days = Array.from(dayMap.values()).sort((a, b) => dayjs(a.date).diff(dayjs(b.date)));
  return { week, days };
}

export async function renderScheduleHTML(weekId: number): Promise<{ html: string; days: DayView[]; week: ScheduleWeek }> {
  const { week, days } = await buildScheduleView(weekId);
  const title = `Week ${week.isoWeek} – ${week.year}`;
  const scheduleTimezone = resolveScheduleTimezone();
  const generatedAt = dayjs().tz(scheduleTimezone).format('YYYY-MM-DD HH:mm');

  const dayColumns = days.map((day) => {
    const shiftBlocks = day.shifts.map((shift) => {
      const metaLabel = shift.meta && shift.meta.area ? `<span class="shift-meta">${String(shift.meta.area)}</span>` : '';
      const assignments = shift.assignments.length > 0
        ? '<ul>' + shift.assignments.map((assignment) => `<li><strong>${assignment.roleInShift}:</strong> ${assignment.name}</li>`).join('') + '</ul>'
        : '<p class="empty">No assignments yet</p>';
      return `
        <div class="shift-card">
          <div class="shift-header">
            <span class="shift-type">${shift.shiftType}</span>
            <span class="shift-time">${shift.timeLabel}</span>
            ${metaLabel}
          </div>
          <div class="shift-body">
            ${assignments}
          </div>
        </div>
      `;
    }).join('');

    return `
      <div class="day-column">
        <div class="day-header">${day.label}</div>
        ${shiftBlocks || '<p class="empty">No shifts</p>'}
      </div>
    `;
  }).join('');

  const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <title>${title}</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          margin: 0;
          padding: 24px;
          background: #f7f8fa;
        }
        h1 {
          margin: 0 0 8px;
          font-size: 24px;
        }
        .subtitle {
          color: #555;
          margin-bottom: 24px;
        }
        .grid {
          display: grid;
          grid-template-columns: repeat(${days.length}, minmax(180px, 1fr));
          gap: 16px;
        }
        .day-column {
          background: #ffffff;
          border-radius: 8px;
          box-shadow: 0 2px 6px rgba(0, 0, 0, 0.05);
          padding: 12px;
        }
        .day-header {
          font-weight: 600;
          font-size: 16px;
          margin-bottom: 12px;
        }
        .shift-card {
          border: 1px solid #e1e5eb;
          border-radius: 6px;
          padding: 8px 10px;
          margin-bottom: 12px;
          background: #fcfdff;
        }
        .shift-header {
          display: flex;
          flex-direction: column;
          gap: 4px;
          margin-bottom: 8px;
        }
        .shift-type {
          font-weight: 600;
          color: #1c4ed8;
        }
        .shift-time {
          font-size: 13px;
          color: #4b5563;
        }
        .shift-meta {
          font-size: 12px;
          color: #9ca3af;
        }
        .shift-body ul {
          padding-left: 18px;
          margin: 0;
        }
        .shift-body li {
          margin-bottom: 4px;
        }
        .empty {
          color: #9ca3af;
          font-size: 13px;
          margin: 8px 0;
        }
      </style>
    </head>
    <body>
      <h1>${title}</h1>
      <div class="subtitle">Generated ${generatedAt} (${scheduleTimezone})</div>
      <div class="grid">
        ${dayColumns}
      </div>
    </body>
    </html>
  `;

  return { html, days, week };
}
