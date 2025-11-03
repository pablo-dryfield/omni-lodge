import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Alert, Box, Button, Card, Center, Group, Loader, Stack, Text, Title } from "@mantine/core";
import { IconAlertTriangle, IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import dayjs from "dayjs";
import type { Dayjs } from "dayjs";
import isoWeek from "dayjs/plugin/isoWeek";
import WeekSelector from "../../components/scheduling/WeekSelector";
import {
  formatScheduleWeekLabel,
  getUpcomingWeeks,
  useEnsureWeek,
  useShiftInstances,
} from "../../api/scheduling";
import type { ShiftAssignment, ShiftInstance } from "../../types/scheduling";

dayjs.extend(isoWeek);

const ROLE_PRIORITY: Record<string, number> = {
  guide: 0,
  "social media": 1,
  leader: 2,
  manager: 3,
  takes: 3,
};

const ROLE_ORDER = ["Guides", "Social Media", "Leader", "Manager"] as const;

const palette = {
  heroGradient: "linear-gradient(135deg, #7C4DFF 0%, #9C6CFF 45%, #FF8EC3 100%)",
  lavender: "#F6F1FF",
  lavenderDeep: "#ECE2FF",
  lavenderAccent: "#C9BDFF",
  lavenderBold: "#A48BFF",
  plumDark: "#5224C7",
  slate: "#2E3446",
  border: "#D8CCFF",
  tableShadow: "0 18px 40px rgba(124, 77, 255, 0.18)",
  cardShadow: "0 12px 28px rgba(124, 77, 255, 0.22)",
};

const HEADER_FONT_STACK = "'Inter', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif";

const clampToHex = (value: number) => Math.max(0, Math.min(255, value));

const lightenColor = (hexColor: string, amount = 0.2) => {
  const normalized = hexColor.replace("#", "");
  if (normalized.length !== 6) {
    return hexColor;
  }
  const int = parseInt(normalized, 16);
  const r = (int >> 16) & 0xff;
  const g = (int >> 8) & 0xff;
  const b = int & 0xff;
  const adjust = (channel: number) =>
    clampToHex(Math.round(channel + (255 - channel) * Math.min(Math.max(amount, 0), 1)));

  const toHex = (channel: number) => adjust(channel).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};

const tableCellBase: CSSProperties = {
  border: `1px solid ${palette.border}`,
  padding: "14px 16px",
  textAlign: "center",
  minWidth: 110,
  backgroundColor: "#ffffff",
  verticalAlign: "top",
};

const roleCellStyles: CSSProperties = {
  ...tableCellBase,
  padding: 0,
  minWidth: 160,
  height: "100%",
  verticalAlign: "middle",
  borderLeftWidth: "3px",
  background: "linear-gradient(135deg, rgba(124, 77, 255, 0.12) 0%, rgba(255,255,255,0.7) 100%)",
};

const roleLabelStyles: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontWeight: 700,
  fontFamily: HEADER_FONT_STACK,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  color: palette.slate,
  minHeight: "100%",
  padding: "20px 12px",
};

const roleHeaderCellStyles: CSSProperties = {
  ...tableCellBase,
  padding: 0,
  backgroundColor: palette.lavenderDeep,
  borderWidth: "3px 3px 1px 3px",
  verticalAlign: "middle",
};

const roleHeaderLabelStyles: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontWeight: 700,
  fontFamily: HEADER_FONT_STACK,
  textTransform: "uppercase",
  letterSpacing: "0.12em",
  color: palette.plumDark,
  height: "100%",
  padding: "18px 12px",
};

const yearHeaderTextStyles: CSSProperties = {
  fontFamily: HEADER_FONT_STACK,
  fontWeight: 800,
  fontSize: "20px",
  letterSpacing: "0.08em",
  textTransform: "capitalize",
  lineHeight: 1.3,
};

const yearHeaderLabelStyles: CSSProperties = {
  ...yearHeaderTextStyles,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: "100%",
  height: "100%",
};

const monthHeaderTextStyles: CSSProperties = {
  fontFamily: HEADER_FONT_STACK,
  fontWeight: 700,
  fontSize: "18px",
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  lineHeight: 1.3,
};

const monthHeaderLabelStyles: CSSProperties = {
  ...monthHeaderTextStyles,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: "100%",
  height: "100%",
  padding: "10px 8px",
};

const userCardNameStyles: CSSProperties = {
  fontFamily: HEADER_FONT_STACK,
  fontWeight: 800,
  fontSize: "14px",
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  textAlign: "center",
};

const createUserCardStyles = (background: string) => {
  const gradientStart = lightenColor(background, 0.22);
  const borderColor = lightenColor(background, 0.36);
  return {
    container: {
      background: `linear-gradient(135deg, ${gradientStart} 0%, ${background} 100%)`,
      borderColor,
      borderWidth: 1,
      boxShadow: "0 18px 28px rgba(82, 36, 199, 0.18)",
      borderRadius: 18,
      padding: "14px 16px",
      width: "100%",
      position: "relative",
      overflow: "hidden",
      transition: "transform 120ms ease, box-shadow 120ms ease",
    } as CSSProperties,
    overlay: {
      position: "absolute",
      inset: 0,
      background: "linear-gradient(150deg, rgba(255,255,255,0.24) 0%, rgba(255,255,255,0) 70%)",
      pointerEvents: "none",
    } as CSSProperties,
  };
};

type UserSwatch = { background: string; text: string };

const USER_COLOR_PALETTE: UserSwatch[] = [
  { background: "#FF6B6B", text: "#FFFFFF" },
  { background: "#4ECDC4", text: "#0B1F28" },
  { background: "#FFD166", text: "#272320" },
  { background: "#1A8FE3", text: "#FFFFFF" },
  { background: "#9554FF", text: "#FFFFFF" },
  { background: "#2EC4B6", text: "#023436" },
  { background: "#FF9F1C", text: "#2B1A00" },
  { background: "#EF476F", text: "#FFFFFF" },
  { background: "#06D6A0", text: "#01352C" },
  { background: "#118AB2", text: "#F4FBFF" },
  { background: "#C77DFF", text: "#1C0433" },
  { background: "#9CFF2E", text: "#112200" },
  { background: "#FF5D8F", text: "#330010" },
  { background: "#2BCAFF", text: "#071725" },
  { background: "#FFC857", text: "#2A1B00" },
  { background: "#845EC2", text: "#F7F4FF" },
];

const DEFAULT_USER_COLOR: UserSwatch = { background: "#ECEFF4", text: palette.slate };

const formatShiftTimeRange = (start?: string | null, end?: string | null) => {
  const first = (start ?? "").trim().replace(/^(\d{1,2}:\d{2}).*$/, "$1");
  const second = (end ?? "").trim().replace(/^(\d{1,2}:\d{2}).*$/, "$1");
  if (!first && !second) {
    return "";
  }
  if (!first) {
    return second;
  }
  if (!second) {
    return first;
  }
  return `${first} \u2013 ${second}`;
};

const isPubCrawlShiftInstance = (instance: ShiftInstance) => {
  const typeKey = instance.shiftType?.key?.toLowerCase() ?? "";
  const typeName = instance.shiftType?.name?.toLowerCase() ?? "";
  const templateName = instance.template?.name?.toLowerCase() ?? "";
  return (
    typeKey.includes("pub_crawl") ||
    typeName.includes("pub crawl") ||
    templateName.includes("pub crawl")
  );
};

type ShiftTimeBucket = {
  label: string;
  instancesByDate: Map<string, ShiftInstance[]>;
};

type ShiftGroup = {
  key: string;
  shiftTypeName: string;
  heading: string;
  timeBuckets: ShiftTimeBucket[];
};

const createShiftGroupKey = (instance: ShiftInstance) => {
  const shiftKey = instance.shiftType?.key ?? `type-${instance.shiftTypeId ?? "unknown"}`;
  return `type:${shiftKey}`;
};

const normalizeTimeLabel = (value: string) => {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "Any Time";
};

const getShiftGroupHeading = (shiftTypeName: string) => shiftTypeName;

const getShiftGroupPriority = (shiftTypeName: string) => {
  const combined = shiftTypeName.toLowerCase();
  if (combined.includes("promotion")) {
    return 0;
  }
  if (combined.includes("clean")) {
    return 1;
  }
  return 2;
};

const compareTimeLabels = (a: string, b: string) =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

const normalizeRoleName = (value: string | null | undefined) => value?.trim().toLowerCase() ?? "";

const formatRoleLabel = (value: string | null | undefined) => {
  const normalized = value?.trim();
  if (!normalized) {
    return "";
  }
  return normalized
    .split(/\s+/)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
};

const getRoleOrderValue = (assignment: ShiftAssignment, index: number) => {
  const normalized = normalizeRoleName(assignment.roleInShift);
  const base = ROLE_PRIORITY[normalized] ?? ROLE_PRIORITY[normalized.replace(/s$/, "")] ?? 10;
  return base + index / 1000;
};

const getUserDisplayName = (assignment: ShiftAssignment) => {
  if (assignment.assignee) {
    const first = assignment.assignee.firstName ?? "";
    const last = assignment.assignee.lastName ?? "";
    const full = `${first} ${last}`.trim();
    if (full.length > 0) {
      return full;
    }
  }
  if (assignment.userId != null) {
    return `User #${assignment.userId}`;
  }
  return "Unassigned";
};

const groupAssignmentsByUser = (assignments: ShiftAssignment[]) => {
  const map = new Map<number | string, ShiftAssignment[]>();
  assignments.forEach((assignment, index) => {
    const key = assignment.userId ?? `assignment-${assignment.id}`;
    const existing = map.get(key);
    if (existing) {
      existing.push(assignment);
    } else {
      map.set(key, [assignment]);
    }
  });
  return Array.from(map.values()).map((userAssignments) =>
    userAssignments
      .map((assignment, index) => ({ assignment, index }))
      .sort(
        (a, b) => getRoleOrderValue(a.assignment, a.index) - getRoleOrderValue(b.assignment, b.index),
      )
      .map(({ assignment }) => assignment),
  );
};

const filterAssignmentsForRole = (roleLabel: string, assignments: ShiftAssignment[]) => {
  switch (roleLabel) {
    case "Guides":
      return assignments.filter((assignment) => normalizeRoleName(assignment.roleInShift).includes("guide"));
    case "Social Media":
      return assignments.filter((assignment) => normalizeRoleName(assignment.roleInShift).includes("social"));
    case "Leader":
      return assignments.filter((assignment) => normalizeRoleName(assignment.roleInShift).includes("leader"));
    default:
      return assignments.filter((assignment) => {
        const normalized = normalizeRoleName(assignment.roleInShift);
        return normalized.includes("manager") || normalized.includes("takes");
      });
  }
};

const getUserColor = (userId: number | null | undefined): UserSwatch => {
  if (!userId) {
    return DEFAULT_USER_COLOR;
  }
  const index = Math.abs(userId) % USER_COLOR_PALETTE.length;
  return USER_COLOR_PALETTE[index] ?? DEFAULT_USER_COLOR;
};

const ISO_WEEK_VALUE_REGEX = /^(\d{4})-W(\d{1,2})$/;

const ensureIsoWeekString = (value: Dayjs | string) => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    const match = ISO_WEEK_VALUE_REGEX.exec(trimmed);
    if (match) {
      const [, rawYear, rawWeek] = match;
      const year = Number(rawYear);
      const week = Number(rawWeek);
      if (!Number.isNaN(year) && !Number.isNaN(week)) {
        return `${year}-W${week.toString().padStart(2, "0")}`;
      }
    }
    const parsed = dayjs(value);
    if (parsed.isValid()) {
      return ensureIsoWeekString(parsed);
    }
    return trimmed;
  }

  const year = value.isoWeekYear();
  const week = value.isoWeek();
  return `${year}-W${week.toString().padStart(2, "0")}`;
};

const parseIsoWeekStart = (value: string | null | undefined): Dayjs | null => {
  if (!value) {
    return null;
  }
  const parsed = dayjs(value, "GGGG-[W]WW", true);
  return parsed.isValid() ? parsed.startOf("isoWeek") : null;
};

type MonthSegment = { label: string; span: number; key: string };

const buildMonthSegments = (days: Dayjs[]): MonthSegment[] => {
  const segments: { label: string; span: number; month: number; year: number }[] = [];
  days.forEach((day) => {
    const month = day.month();
    const year = day.year();
    const monthLabel = day.format("MMMM").toUpperCase();
    const existing = segments[segments.length - 1];
    if (existing && existing.month === month && existing.year === year) {
      existing.span += 1;
    } else {
      segments.push({ label: monthLabel, span: 1, month, year });
    }
  });
  return segments.map(({ label, span, year, month }) => ({
    label,
    span,
    key: `${year}-${month}`,
  }));
};

const formatWeekValue = (value: string | null | undefined) => {
  if (!value) {
    return "N/A";
  }
  const match = ISO_WEEK_VALUE_REGEX.exec(value);
  if (match) {
    const [, rawYear, rawWeek] = match;
    return formatScheduleWeekLabel(Number(rawYear), Number(rawWeek));
  }
  const parsed = dayjs(value);
  if (parsed.isValid()) {
    return formatScheduleWeekLabel(parsed.isoWeekYear(), parsed.isoWeek());
  }
  return value;
};

const ScheduleOverviewPage = () => {
  const [weekOptions, initialWeekValue] = useMemo(() => {
    const options = getUpcomingWeeks(6);
    const initial = options[0]?.value ?? dayjs().format("GGGG-[W]WW");
    return [options, initial] as const;
  }, []);

  const [selectedWeek, setSelectedWeek] = useState(initialWeekValue);

  const ensureWeekQuery = useEnsureWeek(selectedWeek, { allowGenerate: false, enabled: true });
  const weekId = ensureWeekQuery.data?.week?.id ?? null;
  const shiftInstancesQuery = useShiftInstances(weekId);
  const shiftInstances = useMemo(() => shiftInstancesQuery.data ?? [], [shiftInstancesQuery.data]);
  const previousWeekValue = useMemo(() => {
    const start = parseIsoWeekStart(selectedWeek);
    if (!start) {
      return null;
    }
    const previous = start.subtract(1, "week");
    return ensureIsoWeekString(previous);
  }, [selectedWeek]);
  const previousWeekQuery = useEnsureWeek(previousWeekValue, {
    allowGenerate: false,
    enabled: Boolean(previousWeekValue),
  });
  const canNavigateBackward = Boolean(previousWeekQuery.data?.week);
  const canNavigateForward = useMemo(() => {
    const start = parseIsoWeekStart(selectedWeek);
    if (!start) {
      return false;
    }
    const currentStart = dayjs().startOf("isoWeek");
    const diff = start.diff(currentStart, "week");
    return diff < 1;
  }, [selectedWeek]);

  const handleNavigateWeek = useCallback(
    (direction: -1 | 1) => {
      const [year, weekPart] = selectedWeek.split("-W");
      const adjusted = dayjs().year(Number(year)).isoWeek(Number(weekPart)).add(direction, "week");
      if (direction === -1 && !canNavigateBackward) {
        return;
      }
      if (direction === 1 && !canNavigateForward) {
        return;
      }
      setSelectedWeek(ensureIsoWeekString(adjusted));
    },
    [selectedWeek, canNavigateBackward, canNavigateForward],
  );

  useEffect(() => {
    if (!selectedWeek) {
      const fallback = weekOptions[0]?.value ?? dayjs().format("GGGG-[W]WW");
      setSelectedWeek(fallback);
    }
  }, [selectedWeek, weekOptions]);

  const weekStart = useMemo(() => {
    const [year, weekPart] = selectedWeek.split("-W");
    if (!year || !weekPart) {
      return dayjs().startOf("isoWeek");
    }
    return dayjs().year(Number(year)).isoWeek(Number(weekPart)).startOf("isoWeek");
  }, [selectedWeek]);

  const daysOfWeek = useMemo(
    () => Array.from({ length: 7 }, (_, index) => weekStart.add(index, "day")),
    [weekStart],
  );
  const monthSegments = useMemo<MonthSegment[]>(() => buildMonthSegments(daysOfWeek), [daysOfWeek]);

  const pubCrawlInstances = useMemo(
    () => shiftInstances.filter((instance) => isPubCrawlShiftInstance(instance)),
    [shiftInstances],
  );

  const otherShiftGroups = useMemo(() => {
    const groups = new Map<
      string,
      {
        key: string;
        shiftTypeName: string;
        timeBuckets: Map<string, Map<string, ShiftInstance[]>>;
      }
    >();

    shiftInstances.forEach((instance) => {
      if (isPubCrawlShiftInstance(instance)) {
        return;
      }

      const key = createShiftGroupKey(instance);
      let group = groups.get(key);
      if (!group) {
        group = {
          key,
          shiftTypeName: instance.shiftType?.name ?? "Shift",
          timeBuckets: new Map<string, Map<string, ShiftInstance[]>>(),
        };
        groups.set(key, group);
      }

      const label = normalizeTimeLabel(formatShiftTimeRange(instance.timeStart, instance.timeEnd));
      let bucket = group.timeBuckets.get(label);
      if (!bucket) {
        bucket = new Map<string, ShiftInstance[]>();
        group.timeBuckets.set(label, bucket);
      }

      const dayInstances = bucket.get(instance.date);
      if (dayInstances) {
        dayInstances.push(instance);
      } else {
        bucket.set(instance.date, [instance]);
      }
    });

    return Array.from(groups.values())
      .map((group) => ({
        key: group.key,
        shiftTypeName: group.shiftTypeName,
        heading: getShiftGroupHeading(group.shiftTypeName),
        timeBuckets: Array.from(group.timeBuckets.entries())
          .sort(([a], [b]) => compareTimeLabels(a, b))
          .map(([label, instancesByDate]) => ({
            label,
            instancesByDate,
          })),
      }))
      .sort((a, b) => {
        const priorityDiff = getShiftGroupPriority(a.shiftTypeName) - getShiftGroupPriority(b.shiftTypeName);
        if (priorityDiff !== 0) {
          return priorityDiff;
        }
        const typeCompare = a.shiftTypeName.localeCompare(b.shiftTypeName);
        if (typeCompare !== 0) {
          return typeCompare;
        }
        return a.key.localeCompare(b.key);
      });
  }, [shiftInstances]);

  const assignmentsByDate = useMemo(() => {
    const map = new Map<string, ShiftAssignment[]>();
    pubCrawlInstances.forEach((instance) => {
      if (!instance.assignments?.length) {
        return;
      }
      const existing = map.get(instance.date);
      if (existing) {
        existing.push(...instance.assignments);
      } else {
        map.set(instance.date, [...instance.assignments]);
      }
    });
    return map;
  }, [pubCrawlInstances]);

  const visibleRoles = useMemo(
    () =>
      ROLE_ORDER.filter((roleLabel) =>
        daysOfWeek.some((day) => {
          const isoDate = day.format("YYYY-MM-DD");
          const assignments = assignmentsByDate.get(isoDate) ?? [];
          return filterAssignmentsForRole(roleLabel, assignments).length > 0;
        }),
      ),
    [assignmentsByDate, daysOfWeek],
  );

  const pubCrawlHeading = useMemo(() => {
    if (pubCrawlInstances.length === 0) {
      return "PUB CRAWL";
    }
    const timeLabels = new Set<string>();
    pubCrawlInstances.forEach((instance) => {
      const label = formatShiftTimeRange(instance.timeStart, instance.timeEnd);
      if (label) {
        timeLabels.add(label);
      }
    });
    const suffix = timeLabels.size === 1 ? Array.from(timeLabels)[0] : null;
    return suffix ? `PUB CRAWL - ${suffix}` : "PUB CRAWL";
  }, [pubCrawlInstances]);

  const loading = ensureWeekQuery.isLoading || shiftInstancesQuery.isLoading;
  const error = ensureWeekQuery.isError ? ensureWeekQuery.error : shiftInstancesQuery.error;
  const hasWeek = Boolean(weekId);

  const renderAssignmentGroupCard = (
    groupAssignments: ShiftAssignment[],
    options?: { showRoles?: boolean },
  ) => {
    const primary = groupAssignments[0];
    const { background, text } = getUserColor(primary?.userId ?? null);
    const name = getUserDisplayName(primary);
    const styles = createUserCardStyles(background);
    const secondaryColor =
      text.toLowerCase() === "#ffffff" ? "rgba(255, 255, 255, 0.78)" : lightenColor(text, 0.35);
    const showRoles = options?.showRoles ?? false;
    const roleLabels = showRoles
      ? Array.from(
          groupAssignments
            .map((assignment) => {
              const formatted = formatRoleLabel(assignment.roleInShift);
              const normalized = normalizeRoleName(assignment.roleInShift);
              return formatted
                ? ({ formatted, normalized } as const)
                : null;
            })
            .filter(
              (
                item,
              ): item is {
                formatted: string;
                normalized: string;
              } => item !== null,
            )
            .reduce<Map<string, string>>((map, item) => {
              if (!map.has(item.normalized)) {
                map.set(item.normalized, item.formatted);
              }
              return map;
            }, new Map())
            .values(),
        )
      : [];
    const showCount = groupAssignments.length > 1;

    return (
      <Card
        key={groupAssignments.map((assignment) => assignment.id).join("-")}
        radius="lg"
        withBorder
        padding={0}
        style={{ ...styles.container, color: text }}
      >
        <Box style={styles.overlay} />
        <Stack gap={6} align="center" style={{ width: "100%", position: "relative", zIndex: 1 }}>
          <Text style={{ ...userCardNameStyles, color: text }}>{name}</Text>
          {showRoles && roleLabels.length > 0 ? (
            <Text size="xs" style={{ fontFamily: HEADER_FONT_STACK, color: secondaryColor }}>
              {roleLabels.join(" \u2022 ")}
            </Text>
          ) : null}
          {showCount ? (
            <Text size="xs" style={{ fontFamily: HEADER_FONT_STACK, color: secondaryColor }}>
              {groupAssignments.length} assignments
            </Text>
          ) : null}
        </Stack>
      </Card>
    );
  };

  const renderAssignmentsForRole = (roleLabel: string, assignments: ShiftAssignment[]) => {
    const matches = filterAssignmentsForRole(roleLabel, assignments);

    if (matches.length === 0) {
      return (
        <Text size="sm" c="dimmed">
          {"\u2014"}
        </Text>
      );
    }

    const grouped = groupAssignmentsByUser(matches);

    return grouped.map((groupAssignments) => renderAssignmentGroupCard(groupAssignments));
  };

  const renderInstancesForCell = (
    instances: ShiftInstance[],
    options?: { showTime?: boolean; showRoles?: boolean },
  ) => {
    const showTime = options?.showTime ?? true;
    const showRoles = options?.showRoles ?? true;
    if (instances.length === 0) {
      return (
        <Text size="sm" c="dimmed">
          {"\u2014"}
        </Text>
      );
    }

    const sorted = [...instances].sort((a, b) => {
      const aStart = a.timeStart ?? "";
      const bStart = b.timeStart ?? "";
      if (aStart && bStart) {
        const compare = aStart.localeCompare(bStart);
        if (compare !== 0) {
          return compare;
        }
      }
      return a.id - b.id;
    });

    return (
      <Stack gap={12} align="center" style={{ width: "100%" }}>
        {sorted.map((instance) => {
          const assignments = instance.assignments ?? [];
          const grouped = groupAssignmentsByUser(assignments);
          const timeLabel = formatShiftTimeRange(instance.timeStart, instance.timeEnd);

          return (
            <Stack key={`instance-${instance.id}`} gap={8} align="center" style={{ width: "100%" }}>
              {showTime && timeLabel ? (
                <Text
                  size="xs"
                  c="dimmed"
                  style={{ fontFamily: HEADER_FONT_STACK, fontWeight: 600, letterSpacing: "0.05em" }}
                >
                  {timeLabel}
                </Text>
              ) : null}
              {grouped.length > 0
                ? grouped.map((groupAssignments) =>
                    renderAssignmentGroupCard(groupAssignments, { showRoles }),
                  )
                : (
                    <Text size="sm" c="dimmed">
                      {"\u2014"}
                    </Text>
                  )}
            </Stack>
          );
        })}
      </Stack>
    );
  };

  const renderScheduleTable = (
    key: string,
    heading: string,
    firstColumnLabel: string,
    rows: ReactNode[],
  ) => (
    <Box
      key={key}
      style={{
        flex: 1,
        overflowX: "auto",
        borderRadius: 20,
        backgroundColor: "#fff",
        boxShadow: palette.tableShadow,
      }}
    >
      <Box
        component="table"
        style={{
          width: "100%",
          borderCollapse: "separate",
          borderSpacing: 0,
          minWidth: 760,
          borderRadius: 18,
          overflow: "hidden",
        }}
      >
        <thead>
          <tr>
            <th
              colSpan={daysOfWeek.length + 1}
              style={{
                borderTop: `3px solid ${palette.border}`,
                textAlign: "center",
                background: "linear-gradient(135deg, #7C4DFF 0%, #9C6CFF 55%, #F48FB1 100%)",
                padding: "18px",
                fontSize: "22px",
                fontWeight: 800,
                textTransform: "uppercase",
                fontFamily: HEADER_FONT_STACK,
                letterSpacing: "0.05em",
                color: "#fff",
              }}
            >
              {heading}
            </th>
          </tr>
          <tr>
            <th
              style={{
                ...tableCellBase,
                borderWidth: "3px 3px 1px 3px",
                backgroundColor: palette.lavenderBold,
                textAlign: "center",
                padding: "18px 12px",
                verticalAlign: "middle",
                color: palette.plumDark,
              }}
            >
              <div style={yearHeaderLabelStyles}>{weekStart.format("YYYY")}</div>
            </th>
            {monthSegments.map((segment) => (
              <th
                key={`${key}-month-${segment.key}`}
                colSpan={segment.span}
                style={{
                  ...tableCellBase,
                  borderWidth: "3px 3px 1px 0",
                  backgroundColor: palette.lavenderAccent,
                  textAlign: "center",
                  padding: "16px 12px",
                  color: palette.plumDark,
                }}
              >
                <div style={monthHeaderLabelStyles}>{segment.label}</div>
              </th>
            ))}
          </tr>
          <tr>
            <th style={roleHeaderCellStyles}>
              <div style={roleHeaderLabelStyles}>{firstColumnLabel}</div>
            </th>
            {daysOfWeek.map((day, index) => {
              const nextDay = daysOfWeek[index + 1];
              const borderRightWidth = !nextDay || !day.isSame(nextDay, "month") ? "3px" : "1px";
              return (
                <th
                  key={`${key}-date-${day.toString()}`}
                  style={{
                    ...tableCellBase,
                    backgroundColor: palette.lavenderDeep,
                    borderWidth: `3px ${borderRightWidth} 1px 0`,
                  }}
                >
                  <Stack gap={0} align="center">
                    <Text
                      fw={700}
                      size="md"
                      style={{ fontFamily: HEADER_FONT_STACK, fontSize: "18px" }}
                    >
                      {day.format("DD")}
                    </Text>
                    <Text size="xs" c="dimmed" style={{ fontFamily: HEADER_FONT_STACK }}>
                      {day.format("ddd")}
                    </Text>
                  </Stack>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>{rows}</tbody>
      </Box>
    </Box>
  );

  const pubCrawlRows = visibleRoles.map((roleLabel, roleIndex) => {
    const topBorder = roleIndex === 0 ? "3px" : "2px";
    const bottomBorder = roleIndex === visibleRoles.length - 1 ? "3px" : "1px";
    const roleCellStyle: CSSProperties = {
      ...roleCellStyles,
      borderWidth: `${topBorder} 3px ${bottomBorder} 3px`,
    };
    const assignmentCellStyle: CSSProperties = {
      ...tableCellBase,
      borderWidth: `${topBorder} 1px ${bottomBorder} 0`,
    };

    return (
      <tr key={`role-${roleLabel}`}>
        <td style={roleCellStyle}>
          <div style={roleLabelStyles}>{roleLabel}</div>
        </td>
        {daysOfWeek.map((day, index) => {
          const isoDate = day.format("YYYY-MM-DD");
          const assignments = assignmentsByDate.get(isoDate) ?? [];
          const nextDay = daysOfWeek[index + 1];
          const borderRightWidth = !nextDay || !day.isSame(nextDay, "month") ? "3px" : "1px";
          return (
            <td
              key={`${isoDate}-${roleLabel}`}
              style={{
                ...assignmentCellStyle,
                borderWidth: `${topBorder} ${borderRightWidth} ${bottomBorder} 0`,
              }}
            >
              <Stack gap={8} align="center" style={{ width: "100%" }}>
                {renderAssignmentsForRole(roleLabel, assignments)}
              </Stack>
            </td>
          );
        })}
      </tr>
    );
  });

  const otherShiftTables = otherShiftGroups
    .map((group) => {
      if (group.timeBuckets.length === 0) {
        return null;
      }

      const rows = group.timeBuckets.map((bucket, bucketIndex) => {
        const topBorder = bucketIndex === 0 ? "3px" : "2px";
        const bottomBorder = bucketIndex === group.timeBuckets.length - 1 ? "3px" : "1px";
        const timeframeCellStyle: CSSProperties = {
          ...roleCellStyles,
          borderWidth: `${topBorder} 3px ${bottomBorder} 3px`,
        };
        const assignmentCellStyle: CSSProperties = {
          ...tableCellBase,
          borderWidth: `${topBorder} 1px ${bottomBorder} 0`,
          verticalAlign: "top",
        };

        return (
          <tr key={`${group.key}-${bucket.label}`}>
            <td style={timeframeCellStyle}>
              <div style={roleLabelStyles}>{bucket.label}</div>
            </td>
            {daysOfWeek.map((day, index) => {
              const isoDate = day.format("YYYY-MM-DD");
              const nextDay = daysOfWeek[index + 1];
              const borderRightWidth = !nextDay || !day.isSame(nextDay, "month") ? "3px" : "1px";
              const instances = bucket.instancesByDate.get(isoDate) ?? [];
              return (
                <td
                  key={`${group.key}-${bucket.label}-${isoDate}`}
                  style={{
                    ...assignmentCellStyle,
                    borderWidth: `${topBorder} ${borderRightWidth} ${bottomBorder} 0`,
                  }}
                >
                  {renderInstancesForCell(instances, { showTime: false, showRoles: false })}
                </td>
              );
            })}
          </tr>
        );
      });

      if (rows.length === 0) {
        return null;
      }

      return renderScheduleTable(`group-${group.key}`, group.heading, "Timeframe", rows);
    })
    .filter((table): table is JSX.Element => Boolean(table));

  const pubCrawlTable = renderScheduleTable("pub-crawl", pubCrawlHeading, "Role", pubCrawlRows);

  return (
    <Stack mt="lg" gap="lg">
      <Card
        radius="lg"
        shadow="xl"
        padding="lg"
        style={{
          background: palette.heroGradient,
          color: "#fff",
        }}
      >
        <Group justify="space-between" align="center">
          <Button
            variant="white"
            color="dark"
            leftSection={<IconChevronLeft size={16} />}
            onClick={() => handleNavigateWeek(-1)}
            disabled={!canNavigateBackward || shiftInstancesQuery.isLoading}
          >
            Previous Week
          </Button>
          <Stack gap={4} align="center" style={{ flex: 1 }}>
            <Title order={3} fw={800} style={{ fontFamily: HEADER_FONT_STACK }}>
              Weekly Shift Schedule
            </Title>
            <WeekSelector
              value={selectedWeek}
              weeks={weekOptions}
              onChange={setSelectedWeek}
              selectProps={{
                style: { maxWidth: 260, width: "100%" },
                styles: { input: { fontWeight: 600, textAlign: "center" } },
              }}
            />
          </Stack>
          <Button
            variant="white"
            color="dark"
            rightSection={<IconChevronRight size={16} />}
            onClick={() => handleNavigateWeek(1)}
            disabled={!canNavigateForward || shiftInstancesQuery.isLoading}
          >
            Next Week
          </Button>
        </Group>
      </Card>

      {error ? (
        <Alert color="red" variant="light" radius="md" title="Unable to load schedule">
          <Text size="sm">{(error as Error).message}</Text>
        </Alert>
      ) : null}

      {loading ? (
        <Center py="xl">
          <Loader />
        </Center>
      ) : !hasWeek ? (
        <Alert color="yellow" variant="light" radius="md" title="Week not available">
          <Text size="sm">
            Schedule data for {formatWeekValue(selectedWeek)} is not available yet. Generate the week from the builder to
            view assignments.
          </Text>
        </Alert>
      ) : (
        <Card
          withBorder
          shadow="xl"
          radius="lg"
          padding="xl"
          style={{ backgroundColor: palette.lavender, borderColor: palette.border }}
        >
          <Stack gap="xl">
            {pubCrawlTable}
            {otherShiftTables}
            {pubCrawlInstances.length === 0 ? (
              <Alert
                mb={0}
                color="yellow"
                variant="light"
                radius="md"
                icon={<IconAlertTriangle size={16} />}
                title="No pub crawl shifts found"
              >
                <Text size="sm">
                  There are no assignments for the pub crawl shift during {formatWeekValue(selectedWeek)}.
                </Text>
              </Alert>
            ) : null}
          </Stack>
        </Card>
      )}
    </Stack>
  );
};

export default ScheduleOverviewPage;
