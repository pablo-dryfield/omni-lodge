import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import isoWeek from 'dayjs/plugin/isoWeek.js';
import ScheduleWeek from '../models/ScheduleWeek.js';
import ShiftInstance from '../models/ShiftInstance.js';
import ShiftTemplate from '../models/ShiftTemplate.js';
import ShiftType from '../models/ShiftType.js';
import ShiftAssignment from '../models/ShiftAssignment.js';
import User from '../models/User.js';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isoWeek);

const SCHED_TZ = process.env.SCHED_TZ || 'Europe/Warsaw';

type AssignmentView = {
  id: number;
  userId: number | null;
  name: string;
  roleInShift: string | null;
};

type ShiftView = {
  id: number;
  shiftType: string;
  shiftTypeKey: string | null;
  templateName: string | null;
  isoDate: string;
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

const ROLE_PRIORITY: Record<string, number> = {
  guide: 0,
  'social media': 1,
  leader: 2,
  manager: 3,
  takes: 3,
};

const ROLE_ORDER = ['Guides', 'Social Media', 'Leader', 'Manager'] as const;

type UserSwatch = { background: string; text: string };

const USER_COLOR_PALETTE: UserSwatch[] = [
  { background: '#FF6B6B', text: '#FFFFFF' },
  { background: '#4ECDC4', text: '#0B1F28' },
  { background: '#FFD166', text: '#272320' },
  { background: '#1A8FE3', text: '#FFFFFF' },
  { background: '#9554FF', text: '#FFFFFF' },
  { background: '#2EC4B6', text: '#023436' },
  { background: '#FF9F1C', text: '#2B1A00' },
  { background: '#EF476F', text: '#FFFFFF' },
  { background: '#06D6A0', text: '#01352C' },
  { background: '#118AB2', text: '#F4FBFF' },
  { background: '#C77DFF', text: '#1C0433' },
  { background: '#9CFF2E', text: '#112200' },
  { background: '#FF5D8F', text: '#330010' },
  { background: '#2BCAFF', text: '#071725' },
  { background: '#FFC857', text: '#2A1B00' },
  { background: '#845EC2', text: '#F7F4FF' },
];

const DEFAULT_USER_COLOR: UserSwatch = { background: '#ECEFF4', text: '#2E3446' };

type MonthSegment = { label: string; span: number };

function getWeekStart(year: number, isoWeekNumber: number) {
  return dayjs().tz(SCHED_TZ).year(year).isoWeek(isoWeekNumber).startOf('isoWeek');
}

function clampToChannel(value: number) {
  return Math.max(0, Math.min(255, value));
}

function lightenColor(hexColor: string, amount = 0.2) {
  const normalized = hexColor.replace('#', '');
  if (normalized.length !== 6) {
    return hexColor;
  }
  const numeric = parseInt(normalized, 16);
  const r = (numeric >> 16) & 0xff;
  const g = (numeric >> 8) & 0xff;
  const b = numeric & 0xff;
  const apply = (channel: number) => clampToChannel(Math.round(channel + (255 - channel) * amount));
  const toHex = (channel: number) => apply(channel).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function normalizeRoleName(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? '';
}

function formatRoleLabel(value: string | null | undefined) {
  const normalized = value?.trim();
  if (!normalized) {
    return '';
  }
  return normalized
    .split(/\s+/)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}

function getRoleOrderValue(assignment: AssignmentView, index: number) {
  const normalized = normalizeRoleName(assignment.roleInShift);
  const base = ROLE_PRIORITY[normalized] ?? ROLE_PRIORITY[normalized.replace(/s$/, '')] ?? 10;
  return base + index / 1000;
}

function filterAssignmentsForRole(roleLabel: (typeof ROLE_ORDER)[number], assignments: AssignmentView[]) {
  switch (roleLabel) {
    case 'Guides':
      return assignments.filter((assignment) => normalizeRoleName(assignment.roleInShift).includes('guide'));
    case 'Social Media':
      return assignments.filter((assignment) => normalizeRoleName(assignment.roleInShift).includes('social'));
    case 'Leader':
      return assignments.filter((assignment) => normalizeRoleName(assignment.roleInShift).includes('leader'));
    default:
      return assignments.filter((assignment) => {
        const normalized = normalizeRoleName(assignment.roleInShift);
        return normalized.includes('manager') || normalized.includes('takes');
      });
  }
}

function getUserDisplayName(assignment: AssignmentView) {
  if (assignment.name.trim().length > 0 && assignment.name.toLowerCase() !== 'unassigned') {
    return assignment.name.trim();
  }
  if (assignment.userId != null) {
    return `User #${assignment.userId}`;
  }
  return 'Unassigned';
}

function getUserColor(userId: number | null | undefined): UserSwatch {
  if (!userId) {
    return DEFAULT_USER_COLOR;
  }
  const index = Math.abs(userId) % USER_COLOR_PALETTE.length;
  return USER_COLOR_PALETTE[index] ?? DEFAULT_USER_COLOR;
}

function groupAssignmentsByUser(assignments: AssignmentView[]) {
  const map = new Map<number | string, AssignmentView[]>();
  assignments.forEach((assignment, index) => {
    const key = assignment.userId ?? `assignment-${assignment.id}`;
    const existing = map.get(key);
    if (existing) {
      existing.push(assignment);
    } else {
      map.set(key, [assignment]);
    }
  });
  return Array.from(map.values()).map((group) =>
    group
      .map((assignment, index) => ({ assignment, index }))
      .sort(
        (a, b) => getRoleOrderValue(a.assignment, a.index) - getRoleOrderValue(b.assignment, b.index),
      )
      .map(({ assignment }) => assignment),
  );
}

function buildMonthSegments(days: dayjs.Dayjs[]): MonthSegment[] {
  const segments: MonthSegment[] = [];
  days.forEach((day) => {
    const label = `${day.format('MMMM').toUpperCase()} ${day.year()}`;
    const previous = segments[segments.length - 1];
    if (previous && previous.label === label) {
      previous.span += 1;
    } else {
      segments.push({ label, span: 1 });
    }
  });
  return segments;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderAssignmentCard(group: AssignmentView[], options?: { includeRoles?: boolean }) {
  const primary = group[0];
  const { background, text } = getUserColor(primary?.userId ?? null);
  const gradientStart = lightenColor(background, 0.25);
  const borderColor = lightenColor(background, 0.4);
  const name = escapeHtml(getUserDisplayName(primary));
  const extraCount = group.length - 1;
  const includeRoles = options?.includeRoles ?? false;
  const roleLabels = includeRoles
    ? Array.from(
        group
          .map((assignment) => {
            const formatted = formatRoleLabel(assignment.roleInShift);
            const normalized = normalizeRoleName(assignment.roleInShift);
            return formatted ? ({ formatted, normalized } as const) : null;
          })
          .filter((item): item is { formatted: string; normalized: string } => item !== null)
          .reduce<Map<string, string>>((map, item) => {
            if (!map.has(item.normalized)) {
              map.set(item.normalized, item.formatted);
            }
            return map;
          }, new Map())
          .values(),
      )
    : [];
  const metaParts: string[] = [];
  if (includeRoles && roleLabels.length > 0) {
    const roleText = roleLabels.map((label) => escapeHtml(label)).join(' &middot; ');
    if (roleText.length > 0) {
      metaParts.push(roleText);
    }
  }
  if (extraCount > 0) {
    metaParts.push(escapeHtml(`+${extraCount} additional role${extraCount > 1 ? 's' : ''}`));
  }
  const meta =
    metaParts.length > 0 ? `<span class="assignment-meta">${metaParts.join(' &middot; ')}</span>` : '';
  return `<div class="assignment-card" style="--card-bg:${gradientStart};--card-bg-end:${background};--card-border:${borderColor};--card-text:${text};">
      <span class="assignment-name">${name}</span>
      ${meta}
    </div>`;
}

function renderShiftInstance(shift: ShiftView) {
  const grouped = groupAssignmentsByUser(shift.assignments);
  const timeLabel = escapeHtml(shift.timeLabel);
  const timeHtml = timeLabel ? `<div class="shift-instance-time">${timeLabel}</div>` : '';
  const assignmentsHtml =
    grouped.length > 0
      ? `<div class="assignment-stack">${grouped.map((group) => renderAssignmentCard(group, { includeRoles: true })).join('')}</div>`
      : '<div class="empty-cell">&mdash;</div>';
  return `<div class="shift-instance">
      ${timeHtml}
      ${assignmentsHtml}
    </div>`;
}

function normalizeTimeLabel(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : 'Any Time';
}

function getShiftGroupHeading(shiftType: string, templateName: string | null) {
  return templateName ? `${shiftType} - ${templateName}` : shiftType;
}

function getShiftGroupPriority(shiftType: string, templateName: string | null) {
  const combined = `${shiftType} ${templateName ?? ''}`.toLowerCase();
  if (combined.includes('promotion')) {
    return 0;
  }
  if (combined.includes('clean')) {
    return 1;
  }
  return 2;
}

function compareTimeLabels(a: string, b: string) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

function isPubCrawlShift(shift: ShiftView) {
  const key = shift.shiftTypeKey?.toLowerCase() ?? '';
  const name = shift.shiftType.toLowerCase();
  const template = (shift.templateName ?? '').toLowerCase();
  return key.includes('pub_crawl') || name.includes('pub crawl') || template.includes('pub crawl');
}

function getShiftGroupKey(shift: ShiftView) {
  const typeKey = (shift.shiftTypeKey ?? shift.shiftType).toLowerCase();
  const template = (shift.templateName ?? '').toLowerCase();
  const time = shift.timeLabel.toLowerCase();
  if (template) {
    return `template:${typeKey}:${template}`;
  }
  return `type:${typeKey}:time:${time || 'none'}`;
}

export async function buildScheduleView(weekId: number): Promise<{ week: ScheduleWeek; days: DayView[] }> {
  const week = await ScheduleWeek.findByPk(weekId);
  if (!week) {
    throw new Error(`Schedule week ${weekId} not found`);
  }

  const shifts = await ShiftInstance.findAll({
    where: { scheduleWeekId: weekId },
    include: [
      { model: ShiftType, as: 'shiftType' },
      { model: ShiftTemplate, as: 'template' },
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
    const date = dayjs.tz(dateStr, SCHED_TZ);
    const dayLabel = date.format('dddd, MMM D');
    const assignments = (shift.assignments ?? []).map((assignment) => {
      const assignee = (assignment as unknown as { assignee?: User }).assignee;
      return {
        id: assignment.id,
        userId: assignment.userId,
        name: assignee ? `${assignee.firstName ?? ''} ${assignee.lastName ?? ''}`.trim() : 'Unassigned',
        roleInShift: assignment.roleInShift,
      };
    });

    const shiftTypeInstance = (shift as unknown as { shiftType?: ShiftType }).shiftType;
    const shiftTypeName = shiftTypeInstance?.name ?? 'Shift';
    const shiftTypeKey = shiftTypeInstance?.key ?? null;
    const templateInstance = (shift as unknown as { template?: ShiftTemplate }).template;
    const templateName = templateInstance?.name ?? null;
    const timeLabelParts = [shift.timeStart];
    if (shift.timeEnd) {
      timeLabelParts.push('-', shift.timeEnd);
    }
    const timeLabel = timeLabelParts.filter(Boolean).join(' ');

    const shiftView: ShiftView = {
      id: shift.id,
      shiftType: shiftTypeName,
      shiftTypeKey,
      templateName,
      isoDate: dateStr,
      date: dayLabel,
      timeLabel,
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
  const weekStart = getWeekStart(week.year, week.isoWeek);
  const daysOfWeek = Array.from({ length: 7 }, (_, index) => {
    const day = weekStart.add(index, 'day');
    return {
      isoDate: day.format('YYYY-MM-DD'),
      number: day.format('DD'),
      short: day.format('ddd'),
      moment: day,
    };
  });

  const monthSegments = buildMonthSegments(daysOfWeek.map((item) => item.moment));

  const assignmentsByDate = new Map<string, AssignmentView[]>();
  const pubCrawlShifts: ShiftView[] = [];
  const otherShiftGroupMap = new Map<
    string,
    {
      key: string;
      shiftType: string;
      templateName: string | null;
      timeBuckets: Map<string, Map<string, ShiftView[]>>;
    }
  >();

  days.forEach((day) => {
    const isoDate = day.date;
    const pubCrawlForDay = day.shifts.filter((shift) => isPubCrawlShift(shift));
    if (pubCrawlForDay.length > 0) {
      const combined: AssignmentView[] = [];
      pubCrawlForDay.forEach((shift) => {
        pubCrawlShifts.push(shift);
        combined.push(...shift.assignments);
      });
      assignmentsByDate.set(isoDate, combined);
    }

    day.shifts.forEach((shift) => {
      if (isPubCrawlShift(shift)) {
        return;
      }
      const key = getShiftGroupKey(shift);
      let group = otherShiftGroupMap.get(key);
      if (!group) {
        group = {
          key,
          shiftType: shift.shiftType,
          templateName: shift.templateName,
          timeBuckets: new Map<string, Map<string, ShiftView[]>>(),
        };
        otherShiftGroupMap.set(key, group);
      }
      const timeLabel = normalizeTimeLabel(shift.timeLabel ?? '');
      let bucket = group.timeBuckets.get(timeLabel);
      if (!bucket) {
        bucket = new Map<string, ShiftView[]>();
        group.timeBuckets.set(timeLabel, bucket);
      }
      const entries = bucket.get(isoDate);
      if (entries) {
        entries.push(shift);
      } else {
        bucket.set(isoDate, [shift]);
      }
    });
  });

  const otherShiftGroups = Array.from(otherShiftGroupMap.values())
    .map((group) => ({
      key: group.key,
      shiftType: group.shiftType,
      templateName: group.templateName,
      heading: getShiftGroupHeading(group.shiftType, group.templateName),
      timeBuckets: Array.from(group.timeBuckets.entries())
        .sort(([a], [b]) => compareTimeLabels(a, b))
        .map(([label, shiftsByDate]) => ({
          label,
          shiftsByDate,
        })),
    }))
    .sort((a, b) => {
      const priorityDiff =
        getShiftGroupPriority(a.shiftType, a.templateName) - getShiftGroupPriority(b.shiftType, b.templateName);
      if (priorityDiff !== 0) {
        return priorityDiff;
      }
      const typeCompare = a.shiftType.localeCompare(b.shiftType);
      if (typeCompare !== 0) {
        return typeCompare;
      }
      const templateCompare = (a.templateName ?? '').localeCompare(b.templateName ?? '');
      if (templateCompare !== 0) {
        return templateCompare;
      }
      return a.key.localeCompare(b.key);
    });

  const visibleRoles = ROLE_ORDER.filter((roleLabel) =>
    daysOfWeek.some((day) => {
      const assignments = assignmentsByDate.get(day.isoDate) ?? [];
      return filterAssignmentsForRole(roleLabel, assignments).length > 0;
    }),
  );

  const rolesToRender = visibleRoles.length > 0 ? visibleRoles : ROLE_ORDER;

  const pubCrawlHeading = (() => {
    if (pubCrawlShifts.length === 0) {
      return 'Pub Crawl';
    }
    const uniqueLabels = Array.from(
      new Set(
        pubCrawlShifts
          .map((shift) => shift.timeLabel.trim())
          .filter((label) => label.length > 0),
      ),
    );
    if (uniqueLabels.length === 1) {
      return `Pub Crawl - ${uniqueLabels[0]}`;
    }
    return 'Pub Crawl';
  })();

  const weekLabel = `Week ${week.isoWeek.toString().padStart(2, '0')} / ${week.year}`;
  const weekRangeLabel = ${weekStart.format('MMM D')} - ;
  const generatedAt = dayjs().tz(SCHED_TZ).format('YYYY-MM-DD HH:mm');

  const bodyRows = rolesToRender
    .map((roleLabel) => {
      const dayCells = daysOfWeek
        .map((day) => {
          const assignments = assignmentsByDate.get(day.isoDate) ?? [];
          const matches = filterAssignmentsForRole(roleLabel, assignments);
          if (matches.length === 0) {
            return '<td class="assignment-cell"><div class="empty-cell">&mdash;</div></td>';
          }
          const grouped = groupAssignmentsByUser(matches);
          const cards = grouped.map((group) => renderAssignmentCard(group)).join('');
          return `<td class="assignment-cell"><div class="assignment-stack">${cards}</div></td>`;
        })
        .join('');
      return `<tr>
        <td class="role-cell">${escapeHtml(roleLabel)}</td>
        ${dayCells}
      </tr>`;
    })
    .join('');

  const monthHeaderRow = monthSegments
    .map((segment) => `<th class="month-header" colspan="${segment.span}">${escapeHtml(segment.label)}</th>`)
    .join('');

  const dateHeaderRow = daysOfWeek
    .map(
      (day) => `<th class="date-header">
        <span class="day-number">${escapeHtml(day.number)}</span>
        <span class="day-name">${escapeHtml(day.short)}</span>
      </th>`,
    )
    .join('');

  const renderTable = (heading: string, firstColumnLabel: string, tableRows: string) => `
            <div class="table-container">
              <table>
                <thead>
                  <tr>
                    <th class="hero-heading" colspan="${daysOfWeek.length + 1}">${escapeHtml(heading)}</th>
                  </tr>
                  <tr>
                    <th class="year-header">${escapeHtml(weekStart.format('YYYY'))}</th>
                    ${monthHeaderRow}
                  </tr>
                  <tr>
                    <th class="role-header-cell">${escapeHtml(firstColumnLabel)}</th>
                    ${dateHeaderRow}
                  </tr>
                </thead>
                <tbody>
                  ${tableRows}
                </tbody>
              </table>
            </div>`;

  const otherShiftTables = otherShiftGroups
    .map((group) => {
      const timeframeRows = group.timeBuckets
        .map((bucket, bucketIndex) => {
          const topBorder = bucketIndex === 0 ? '3px' : '2px';
          const bottomBorder = bucketIndex === group.timeBuckets.length - 1 ? '3px' : '1px';
          const dayCells = daysOfWeek
            .map((day, index) => {
              const nextDay = daysOfWeek[index + 1];
              const borderRightWidth = !nextDay || !day.moment.isSame(nextDay.moment, 'month') ? '3px' : '1px';
              const shiftsForDay = bucket.shiftsByDate.get(day.isoDate) ?? [];
              const content =
                shiftsForDay.length > 0
                  ? `<div class="shift-instance-stack">${shiftsForDay
                      .map((shift) => renderShiftInstance(shift))
                      .join('')}</div>`
                  : '<div class="empty-cell">&mdash;</div>';
              return `<td class="assignment-cell" style="border-width:${topBorder} ${borderRightWidth} ${bottomBorder} 0;">
                ${content}
              </td>`;
            })
            .join('');
          return `<tr>
            <td class="role-cell" style="border-width:${topBorder} 3px ${bottomBorder} 3px;">${escapeHtml(bucket.label)}</td>
            ${dayCells}
          </tr>`;
        })
        .join('');

      if (!timeframeRows) {
        return '';
      }

      return renderTable(group.heading, 'Timeframe', timeframeRows);
    })
    .join('');

  const pubCrawlTable = renderTable(pubCrawlHeading, 'Role', bodyRows);

  const pubCrawlAlert =
    pubCrawlShifts.length === 0
      ? `<div class="schedule-alert">No pub crawl shifts found for ${escapeHtml(weekLabel)}.</div>`
      : '';

  const html = `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <title>${escapeHtml(weekLabel)} - Shift Schedule</title>
        <style>
          :root {
            color-scheme: light;
          }
          * {
            box-sizing: border-box;
          }
          body {
            margin: 0;
            padding: 32px;
            font-family: 'Inter', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
            background: #f6f1ff;
            color: #2e3446;
          }
          .page {
            max-width: 1200px;
            margin: 0 auto;
            display: flex;
            flex-direction: column;
            gap: 24px;
          }
          .hero {
            background: linear-gradient(135deg, #7c4dff 0%, #9c6cff 45%, #ff8ec3 100%);
            color: #ffffff;
            border-radius: 28px;
            padding: 32px;
            box-shadow: 0 24px 48px rgba(124, 77, 255, 0.24);
            text-align: center;
          }
          .hero-title {
            font-size: 28px;
            font-weight: 800;
            letter-spacing: 0.05em;
            text-transform: uppercase;
            margin-bottom: 12px;
          }
          .hero-week {
            font-size: 16px;
            font-weight: 600;
            letter-spacing: 0.12em;
            text-transform: uppercase;
            opacity: 0.9;
          }
          .hero-range {
            margin-top: 6px;
            font-size: 14px;
            letter-spacing: 0.05em;
            opacity: 0.8;
          }
          .meta {
            font-size: 12px;
            color: #6b7280;
            text-align: right;
            letter-spacing: 0.08em;
            text-transform: uppercase;
          }
          .schedule-card {
            background: #f6f1ff;
            border: 1px solid #d8ccff;
            border-radius: 24px;
            padding: 24px;
            box-shadow: 0 18px 40px rgba(124, 77, 255, 0.18);
          }
          .table-container {
            overflow-x: auto;
            border-radius: 20px;
            margin-bottom: 24px;
          }
          table {
            width: 100%;
            border-collapse: separate;
            border-spacing: 0;
            min-width: 760px;
            border-radius: 18px;
            overflow: hidden;
          }
          th, td {
            border: 1px solid #d8ccff;
            padding: 14px 16px;
            text-align: center;
            background: #ffffff;
            vertical-align: top;
          }
          thead th {
            background: #ece2ff;
            font-weight: 600;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            color: #5224c7;
          }
          .hero-heading {
            background: linear-gradient(135deg, #7c4dff 0%, #9c6cff 55%, #f48fb1 100%);
            color: #ffffff;
            font-weight: 800;
            font-size: 20px;
            letter-spacing: 0.05em;
            text-transform: uppercase;
            padding: 18px;
          }
          .year-header {
            background: #a48bff;
            color: #ffffff;
            font-weight: 800;
            font-size: 16px;
            letter-spacing: 0.12em;
          }
          .month-header {
            background: #c9bdff;
            color: #5224c7;
            font-weight: 700;
            font-size: 14px;
            letter-spacing: 0.14em;
          }
          .date-header {
            background: #ece2ff;
            color: #2e3446;
            display: flex;
            flex-direction: column;
            gap: 4px;
            align-items: center;
            justify-content: center;
          }
          .day-number {
            font-size: 18px;
            font-weight: 700;
          }
          .day-name {
            font-size: 12px;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            color: #6b7280;
          }
          .role-header-cell {
            background: #ece2ff;
            font-weight: 700;
            letter-spacing: 0.12em;
            text-transform: uppercase;
            color: #5224c7;
          }
          .role-cell {
            background: linear-gradient(135deg, rgba(124, 77, 255, 0.12) 0%, rgba(255, 255, 255, 0.7) 100%);
            font-weight: 700;
            letter-spacing: 0.05em;
            text-transform: uppercase;
            color: #2e3446;
          }
          .assignment-cell {
            min-width: 110px;
            padding: 16px;
            background: #ffffff;
            vertical-align: top;
          }
          .assignment-stack {
            display: flex;
            flex-direction: column;
            gap: 8px;
            align-items: center;
          }
          .shift-instance-stack {
            display: flex;
            flex-direction: column;
            gap: 12px;
            align-items: center;
          }
          .shift-instance {
            display: flex;
            flex-direction: column;
            gap: 8px;
            align-items: center;
          }
          .shift-instance-time {
            font-size: 11px;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            color: #6b7280;
            font-weight: 600;
          }
          .assignment-card {
            display: flex;
            flex-direction: column;
            gap: 4px;
            align-items: center;
            justify-content: center;
            width: 100%;
            background: linear-gradient(135deg, var(--card-bg, rgba(255, 255, 255, 0.9)) 0%, var(--card-bg-end, rgba(255, 255, 255, 1)) 100%);
            color: var(--card-text, #2e3446);
            border: 1px solid var(--card-border, rgba(255, 255, 255, 0.4));
            border-radius: 16px;
            padding: 12px;
            box-shadow: 0 12px 28px rgba(82, 36, 199, 0.18);
            font-weight: 700;
            letter-spacing: 0.05em;
            text-transform: uppercase;
            font-size: 13px;
          }
          .assignment-name {
            display: block;
          }
          .assignment-meta {
            font-size: 10px;
            font-weight: 600;
            letter-spacing: 0.12em;
            opacity: 0.75;
          }
          .schedule-alert {
            background: #fff6e6;
            border: 1px solid #facc15;
            color: #92400e;
            border-radius: 16px;
            padding: 12px 16px;
            font-size: 13px;
            letter-spacing: 0.04em;
            text-transform: uppercase;
            margin-bottom: 16px;
          }
          .empty-cell {
            color: #9ca3af;
            font-size: 14px;
            letter-spacing: 0.08em;
          }
        </style>
      </head>
      <body>
        <div class="page">
          <div class="hero">
            <div class="hero-title">Weekly Shift Schedule</div>
            <div class="hero-week">${escapeHtml(weekLabel)}</div>
            <div class="hero-range">${escapeHtml(weekRangeLabel)}</div>
          </div>
          <div class="meta">Generated ${escapeHtml(generatedAt)} (${escapeHtml(SCHED_TZ)})</div>
          <div class="schedule-card">
            ${pubCrawlTable}
            ${otherShiftTables}
            ${pubCrawlAlert}
          </div>
        </div>
      </body>
    </html>
  `;

  return { html, days, week };
}
