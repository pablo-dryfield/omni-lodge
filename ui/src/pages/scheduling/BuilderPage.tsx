import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Center,
  Group,
  Loader,
  Modal,
  Select,
  Switch,
  Stack,
  Text,
  TextInput,
  Textarea,
  Title,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconChevronLeft,
  IconChevronRight,
  IconHistory,
  IconPlus,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import dayjs from "dayjs";
import type { Dayjs } from "dayjs";
import isoWeek from "dayjs/plugin/isoWeek";
import type { AxiosError } from "axios";
import axiosInstance from "../../utils/axiosInstance";
import { useAppSelector } from "../../store/hooks";
import { makeSelectIsModuleActionAllowed } from "../../selectors/accessControlSelectors";
import {
  formatScheduleWeekLabel,
  getUpcomingWeeks,
  useAssignShifts,
  useAutoAssignWeek,
  useCreateShiftInstance,
  useDeleteAssignment,
  useDeleteShiftInstance,
  useEnsureWeek,
  useLockWeek,
  usePublishWeek,
  useReopenWeek,
  useShiftInstances,
  useShiftTemplates,
  useWeekAvailability,
  useWeekSummary,
} from "../../api/scheduling";
import { useShiftRoles } from "../../api/shiftRoles";
import WeekSelector from "../../components/scheduling/WeekSelector";
import AddShiftInstanceModal from "../../components/scheduling/AddShiftInstanceModal";
import type { AvailabilityEntry, ShiftAssignment, ShiftInstance, ScheduleViolation } from "../../types/scheduling";
import type { ServerResponse } from "../../types/general/ServerResponse";
import type { ShiftRole } from "../../types/shiftRoles/ShiftRole";

dayjs.extend(isoWeek);

type StaffOption = {
  value: string;
  label: string;
};

type StaffOptionGroup = {
  group: string;
  items: StaffOption[];
};

type RoleOption = {
  value: string;
  label: string;
  shiftRoleId: number | null;
  roleName: string;
  isCustomEntry?: boolean;
};

const ASSIGNMENT_ROLE_PRIORITY: Record<string, number> = {
  manager: 0,
  leader: 1,
  guide: 2,
  "social media": 3,
};

const normalizeRoleName = (roleName: string | null | undefined) => roleName?.trim().toLowerCase() ?? "";

const getRolePriority = (roleName: string, fallbackIndex: number) =>
  (ASSIGNMENT_ROLE_PRIORITY[normalizeRoleName(roleName)] ?? 10) + fallbackIndex / 1000;

const makeRoleValue = (opts: { shiftRoleId: number | null; roleName: string; prefix?: string }) => {
  if (opts.shiftRoleId != null) {
    return `shift-role:${opts.shiftRoleId}`;
  }
  const base = opts.roleName.trim().toLowerCase().replace(/\s+/g, "-");
  return `${opts.prefix ?? "custom"}:${base || "role"}`;
};

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
      .sort((a, b) => getRoleOrderValue(a.assignment, a.index) - getRoleOrderValue(b.assignment, b.index))
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

const BuilderPage = () => {
  const [weekOptions, initialWeekValue] = useMemo(() => {
    const options = getUpcomingWeeks(6);
    const initial = options[1]?.value ?? options[0]?.value ?? "";
    return [options, initial] as const;
  }, []);

  const [selectedWeek, setSelectedWeek] = useState<string>(initialWeekValue);
  const handleNavigateWeek = useCallback(
    (direction: -1 | 1) => {
      const [year, weekPart] = selectedWeek.split("-W");
      const adjusted = dayjs().year(Number(year)).isoWeek(Number(weekPart)).add(direction, "week");
      setSelectedWeek(ensureIsoWeekString(adjusted));
    },
    [selectedWeek],
  );
  useEffect(() => {
    if (!selectedWeek) {
      const fallback = weekOptions[0]?.value ?? dayjs().format("GGGG-[W]WW");
      setSelectedWeek(fallback);
    }
  }, [selectedWeek, weekOptions]);
  const [showAddInstance, setShowAddInstance] = useState(false);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [assignmentModal, setAssignmentModal] = useState<{ opened: boolean; shift: ShiftInstance | null }>({
    opened: false,
    shift: null,
  });
  const [assignmentUserId, setAssignmentUserId] = useState<string | null>(null);
  const [assignmentRoleOption, setAssignmentRoleOption] = useState<RoleOption | null>(null);
  const [assignmentCustomRoleName, setAssignmentCustomRoleName] = useState("");
  const [assignmentOverrideReason, setAssignmentOverrideReason] = useState("");
  const [assignmentError, setAssignmentError] = useState<string | null>(null);
  const [assignmentRequiresOverride, setAssignmentRequiresOverride] = useState(false);
  const [assignmentShowUnavailable, setAssignmentShowUnavailable] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishViolations, setPublishViolations] = useState<ScheduleViolation[] | null>(null);
  const [reopenError, setReopenError] = useState<string | null>(null);

  const selectCanAccessBuilder = useMemo(
    () => makeSelectIsModuleActionAllowed("scheduling-builder", "view"),
    [],
  );
  const canAccessBuilder = useAppSelector(selectCanAccessBuilder);
  const { loaded: accessLoaded, loading: accessLoading } = useAppSelector((state) => state.accessControl);

  const ensureWeekQuery = useEnsureWeek(selectedWeek, { allowGenerate: canAccessBuilder, enabled: canAccessBuilder });
  const weekId = canAccessBuilder ? ensureWeekQuery.data?.week?.id ?? null : null;

  const summaryQuery = useWeekSummary(canAccessBuilder && weekId ? weekId : null);
  const templatesQuery = useShiftTemplates({ enabled: canAccessBuilder });
  const instancesQuery = useShiftInstances(canAccessBuilder ? weekId : null);
  const shiftRolesQuery = useShiftRoles();
  const weekAvailabilityQuery = useWeekAvailability(canAccessBuilder ? weekId ?? null : null);

  const assignMutation = useAssignShifts();
  const deleteAssignmentMutation = useDeleteAssignment();
  const createInstanceMutation = useCreateShiftInstance();
  const deleteInstanceMutation = useDeleteShiftInstance();
  const autoAssignMutation = useAutoAssignWeek();
  const lockWeekMutation = useLockWeek();
  const publishWeekMutation = usePublishWeek();
  const reopenWeekMutation = useReopenWeek();

  const weekStart = useMemo(() => {
    const [year, weekPart] = selectedWeek.split("-W");
    if (!year || !weekPart) {
      return dayjs().startOf("isoWeek");
    }
    return dayjs().year(Number(year)).isoWeek(Number(weekPart)).startOf("isoWeek");
  }, [selectedWeek]);

  const weekRangeLabel = `${weekStart.format("MMM D")} - ${weekStart.add(6, "day").format("MMM D")}`;

  const daysOfWeek = useMemo(
    () => Array.from({ length: 7 }, (_, index) => weekStart.add(index, "day")),
    [weekStart],
  );
  const monthSegments = useMemo<MonthSegment[]>(() => buildMonthSegments(daysOfWeek), [daysOfWeek]);

  const shiftInstances = useMemo(() => instancesQuery.data ?? [], [instancesQuery.data]);

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

  const pubCrawlInstancesByDate = useMemo(() => {
    const map = new Map<string, ShiftInstance[]>();
    pubCrawlInstances.forEach((instance) => {
      const existing = map.get(instance.date);
      if (existing) {
        existing.push(instance);
      } else {
        map.set(instance.date, [instance]);
      }
    });
    return map;
  }, [pubCrawlInstances]);

  const loading = ensureWeekQuery.isLoading || instancesQuery.isLoading;
  const error = ensureWeekQuery.isError ? ensureWeekQuery.error : instancesQuery.error;
  const hasWeek = Boolean(weekId);
  const weekViolations = summaryQuery.data?.violations ?? [];
  const weekState = summaryQuery.data?.week?.state ?? null;
  const isPublished = weekState === "published";
  const canModifyWeek = Boolean(weekId) && !isPublished;

  const shiftRoleRecords = useMemo<ShiftRole[]>(() => {
    return (shiftRolesQuery.data?.[0]?.data ?? []) as ShiftRole[];
  }, [shiftRolesQuery.data]);

  useEffect(() => {
    const { reset } = autoAssignMutation;
    reset();
  }, [autoAssignMutation, weekId]);

  useEffect(() => {
    if (!canAccessBuilder) {
      setStaff([]);
      return;
    }

    const fetchStaff = async () => {
      const response = await axiosInstance.get<
        ServerResponse<{ id: number; firstName: string; lastName: string }>
      >("/users/active");
      const items = response.data?.[0]?.data ?? [];
      setStaff(
        items.map((item) => ({
          value: item.id.toString(),
          label: `${item.firstName} ${item.lastName}`,
        })),
      );
    };

    void fetchStaff();
  }, [canAccessBuilder]);

  useEffect(() => {
    if (!assignmentModal.opened) {
      return;
    }
    setAssignmentUserId(null);
    setAssignmentError(null);
    setAssignmentOverrideReason("");
    setAssignmentRequiresOverride(false);
    setAssignmentCustomRoleName("");
    setAssignmentShowUnavailable(false);
  }, [assignmentModal.opened]);

  const assignmentRoleOptions = useMemo<RoleOption[]>(() => {
    const shift = assignmentModal.shift;
    if (!shift) {
      return [];
    }

    const options: RoleOption[] = [];
    const seen = new Set<string>();

    const addOption = (option: RoleOption) => {
      if (seen.has(option.value)) {
        return;
      }
      seen.add(option.value);
      options.push(option);
    };

    const requiredRoles = shift.requiredRoles ?? shift.template?.defaultRoles ?? [];
    requiredRoles.forEach((role, index) => {
      const roleName = (role.role ?? "").trim() || "Staff";
      addOption({
        value: makeRoleValue({ shiftRoleId: role.shiftRoleId ?? null, roleName, prefix: `required-${index}` }),
        label: roleName,
        shiftRoleId: role.shiftRoleId ?? null,
        roleName,
      });
    });

    shiftRoleRecords
      .slice()
      .sort((a, b) => getRolePriority(a.name, a.id) - getRolePriority(b.name, b.id))
      .forEach((role) => {
        addOption({
          value: makeRoleValue({ shiftRoleId: role.id, roleName: role.name }),
          label: role.name,
          shiftRoleId: role.id,
          roleName: role.name,
        });
      });

    addOption({
      value: "__custom__",
      label: "Custom role",
      shiftRoleId: null,
      roleName: "",
      isCustomEntry: true,
    });

    return options;
  }, [assignmentModal.shift, shiftRoleRecords]);

  useEffect(() => {
    if (!assignmentModal.opened) {
      return;
    }
    if (assignmentRoleOptions.length === 0) {
      setAssignmentRoleOption(null);
      return;
    }

    setAssignmentRoleOption((current) => {
      if (current && assignmentRoleOptions.some((option) => option.value === current.value)) {
        return current;
      }
      const firstOption = assignmentRoleOptions[0];
      if (firstOption.isCustomEntry) {
        setAssignmentCustomRoleName("");
      } else {
        setAssignmentCustomRoleName(firstOption.roleName);
      }
      return firstOption;
    });
  }, [assignmentModal.opened, assignmentRoleOptions]);

  const availabilityByUserId = useMemo(() => {
    const map = new Map<number, AvailabilityEntry[]>();
    const entries = weekAvailabilityQuery.data ?? [];
    entries.forEach((entry) => {
      const current = map.get(entry.userId);
      if (current) {
        current.push(entry);
      } else {
        map.set(entry.userId, [entry]);
      }
    });
    return map;
  }, [weekAvailabilityQuery.data]);

  const isUserAvailableForShift = useCallback(
    (userId: number, shift: ShiftInstance | null): boolean => {
      if (!shift) {
        return true;
      }
      const entries = availabilityByUserId.get(userId);
      if (!entries || entries.length === 0) {
        return true;
      }
      const dayEntries = entries.filter((entry) => entry.day === shift.date);
      if (dayEntries.length === 0) {
        return true;
      }
      const shiftStart = dayjs(`${shift.date} ${shift.timeStart}`);
      const shiftEnd = shift.timeEnd
        ? dayjs(`${shift.date} ${shift.timeEnd}`)
        : shiftStart.add(2, "hour");

      return dayEntries.some((entry) => {
        if (entry.status !== "available") {
          return false;
        }
        if (entry.shiftTypeId && entry.shiftTypeId !== shift.shiftTypeId) {
          return false;
        }
        if (entry.startTime) {
          const availabilityStart = dayjs(`${entry.day} ${entry.startTime}`);
          if (shiftStart.isBefore(availabilityStart)) {
            return false;
          }
        }
        if (entry.endTime) {
          const availabilityEnd = dayjs(`${entry.day} ${entry.endTime}`);
          if (shiftEnd.isAfter(availabilityEnd)) {
            return false;
          }
        }
        return true;
      });
    },
    [availabilityByUserId],
  );

  const staffOptionsForAssignment = useMemo(() => {
    const shift = assignmentModal.shift;
    if (!shift) {
      return {
        available: staff,
        unavailable: [] as StaffOption[],
      };
    }

    const availableOptions: StaffOption[] = [];
    const unavailableOptions: StaffOption[] = [];

    staff.forEach((option) => {
      const userId = Number(option.value);
      if (Number.isNaN(userId)) {
        availableOptions.push(option);
        return;
      }
      if (isUserAvailableForShift(userId, shift)) {
        availableOptions.push(option);
      } else {
        unavailableOptions.push(option);
      }
    });

    return {
      available: availableOptions,
      unavailable: unavailableOptions,
    };
  }, [assignmentModal.shift, isUserAvailableForShift, staff]);

  useEffect(() => {
    if (!assignmentModal.opened) {
      return;
    }
    if (
      !assignmentShowUnavailable &&
      staffOptionsForAssignment.available.length === 0 &&
      staffOptionsForAssignment.unavailable.length > 0
    ) {
      setAssignmentShowUnavailable(true);
    }
  }, [assignmentModal.opened, assignmentShowUnavailable, staffOptionsForAssignment]);

  const staffSelectOptions = useMemo<StaffOptionGroup[]>(() => {
    const availableItems: StaffOption[] = staffOptionsForAssignment.available.map((option) => ({
      value: option.value,
      label: option.label,
    }));

    const groups: StaffOptionGroup[] = [{ group: "Available", items: availableItems }];

    if (assignmentShowUnavailable && staffOptionsForAssignment.unavailable.length > 0) {
      const unavailableItems: StaffOption[] = staffOptionsForAssignment.unavailable.map((option) => ({
        value: option.value,
        label: `${option.label} (Unavailable)`,
      }));
      groups.push({ group: "Unavailable", items: unavailableItems });
    }

    return groups;
  }, [assignmentShowUnavailable, staffOptionsForAssignment]);

  useEffect(() => {
    if (!assignmentModal.opened) {
      return;
    }
    if (!assignmentUserId) {
      setAssignmentRequiresOverride(false);
      return;
    }
    const userId = Number(assignmentUserId);
    if (Number.isNaN(userId)) {
      setAssignmentRequiresOverride(false);
      return;
    }
    const shift = assignmentModal.shift ?? null;
    setAssignmentRequiresOverride(!isUserAvailableForShift(userId, shift));
  }, [
    assignmentModal.opened,
    assignmentModal.shift,
    assignmentUserId,
    isUserAvailableForShift,
  ]);

  useEffect(() => {
    if (!assignmentModal.opened) {
      return;
    }
    if (assignmentShowUnavailable) {
      return;
    }
    if (!assignmentUserId || !assignmentModal.shift) {
      return;
    }
    const userId = Number(assignmentUserId);
    if (Number.isNaN(userId)) {
      return;
    }
    if (!isUserAvailableForShift(userId, assignmentModal.shift)) {
      setAssignmentUserId(null);
      setAssignmentOverrideReason("");
      setAssignmentRequiresOverride(false);
    }
  }, [
    assignmentModal.opened,
    assignmentModal.shift,
    assignmentShowUnavailable,
    assignmentUserId,
    isUserAvailableForShift,
  ]);

  const autoAssignData = autoAssignMutation.data;

  const autoAssignErrorMessage = useMemo(() => {
    const error = autoAssignMutation.error as AxiosError<{ error?: string; message?: string }> | null;
    if (!error) {
      return null;
    }
    return error.response?.data?.error ?? error.response?.data?.message ?? error.message;
  }, [autoAssignMutation.error]);

  const volunteerAssignmentsPreview = useMemo(() => {
    if (!autoAssignData?.volunteerAssignments?.length) {
      return null;
    }
    const entries = autoAssignData.volunteerAssignments.map((summary) => {
      const fallback = `User ${summary.userId}`;
      const name = summary.fullName && summary.fullName.trim().length > 0 ? summary.fullName : fallback;
      return `${name}: ${summary.assigned}`;
    });
    const preview = entries.slice(0, 6).join(", ");
    return entries.length > 6 ? `${preview}, ...` : preview;
  }, [autoAssignData]);

  const unfilledPreview = useMemo(() => {
    if (!autoAssignData?.unfilled?.length) {
      return null;
    }
    const entries = autoAssignData.unfilled
      .slice(0, 5)
      .map((slot) => `${dayjs(slot.date).format("MMM D")} ${slot.timeStart} (${slot.role})`);
    return autoAssignData.unfilled.length > 5 ? `${entries.join(", ")}, ...` : entries.join(", ");
  }, [autoAssignData]);

  const handleOpenAssignment = (shift: ShiftInstance) => {
    setAssignmentModal({ opened: true, shift });
  };

  const handleCloseAssignment = () => {
    setAssignmentModal({ opened: false, shift: null });
    setAssignmentUserId(null);
    setAssignmentRoleOption(null);
    setAssignmentCustomRoleName("");
    setAssignmentOverrideReason("");
    setAssignmentError(null);
    setAssignmentRequiresOverride(false);
    assignMutation.reset();
  };

  const handleCreateAssignment = async () => {
    if (!assignmentModal.shift || !assignmentUserId || !assignmentRoleOption || !weekId) {
      return;
    }

    const selectedOption = assignmentRoleOption;
    const roleName = selectedOption.isCustomEntry
      ? assignmentCustomRoleName.trim()
      : selectedOption.roleName.trim() || selectedOption.label.trim();

    if (!roleName) {
      setAssignmentError("Select or enter a role for this assignment.");
      return;
    }

    try {
      setAssignmentError(null);
      await assignMutation.mutateAsync({
        assignments: [
          {
            shiftInstanceId: assignmentModal.shift.id,
            userId: Number(assignmentUserId),
            roleInShift: roleName,
            shiftRoleId: selectedOption.shiftRoleId ?? null,
            overrideReason: assignmentOverrideReason.trim() ? assignmentOverrideReason.trim() : undefined,
          },
        ],
        weekId,
      });
      handleCloseAssignment();
    } catch (error) {
      const axiosError = error as AxiosError<{ error?: string; message?: string }>;
      const message = axiosError.response?.data?.error ?? axiosError.response?.data?.message ?? axiosError.message;
      setAssignmentError(message);
      if (message.toLowerCase().includes("override")) {
        setAssignmentRequiresOverride(true);
      }
    }
  };

  const handleRemoveAssignment = async (assignment: ShiftAssignment) => {
    if (!weekId) return;
    await deleteAssignmentMutation.mutateAsync({ assignmentId: assignment.id, weekId });
  };

  const handleDeleteInstance = async (instance: ShiftInstance) => {
    if (!weekId) return;
    await deleteInstanceMutation.mutateAsync({ id: instance.id, weekId });
  };

  const handleCreateInstance = async (
    payload: Parameters<typeof createInstanceMutation.mutateAsync>[0],
  ) => {
    await createInstanceMutation.mutateAsync(payload);
  };

  const handleLockWeek = async () => {
    if (!weekId) return;
    await lockWeekMutation.mutateAsync(weekId);
  };

  const handlePublishWeek = async () => {
    if (!weekId) return;
    setPublishError(null);
    setPublishViolations(null);
    try {
      await publishWeekMutation.mutateAsync(weekId);
    } catch (error) {
      const axiosError = error as AxiosError<{ error?: string; message?: string; violations?: ScheduleViolation[] }>;
      const message = axiosError.response?.data?.error ?? axiosError.response?.data?.message ?? axiosError.message;
      setPublishError(message);
      const violations = axiosError.response?.data?.violations;
      if (Array.isArray(violations) && violations.length > 0) {
        setPublishViolations(violations);
      }
    }
  };

  const handleAutoAssign = async () => {
    if (!weekId) {
      return;
    }
    try {
      setPublishError(null);
      setPublishViolations(null);
      await autoAssignMutation.mutateAsync({ weekId });
    } catch {
      // handled by mutation state
    }
  };

  const handleReopenWeek = async () => {
    if (!weekId) return;
    setReopenError(null);
    try {
      await reopenWeekMutation.mutateAsync(weekId);
      publishWeekMutation.reset();
    } catch (error) {
      const axiosError = error as AxiosError<{ error?: string; message?: string }>;
      setReopenError(axiosError.response?.data?.error ?? axiosError.response?.data?.message ?? axiosError.message);
    }
  };

  const renderAssignmentCard = (
    groupAssignments: ShiftAssignment[],
    options?: { showRoles?: boolean; allowManage?: boolean },
  ) => {
    if (groupAssignments.length === 0) {
      return null;
    }

    const allowManage = options?.allowManage ?? false;
    const primary = groupAssignments[0];
    if (!primary) {
      return null;
    }

    const { background, text } = getUserColor(primary.userId ?? null);
    const name = getUserDisplayName(primary);
    const styles = createUserCardStyles(background);
    const secondaryColor =
      text.toLowerCase() === "#ffffff" ? "rgba(255, 255, 255, 0.78)" : lightenColor(text, 0.35);
    const removeDisabled = !allowManage || deleteAssignmentMutation.isPending || !canModifyWeek;

    return (
      <Card
        key={groupAssignments.map((assignment) => assignment.id).join("-")}
        radius="lg"
        withBorder
        padding="md"
        style={{ ...styles.container, color: text }}
      >
        <Box style={styles.overlay} />
        <Stack gap={8} align="center" style={{ width: "100%", position: "relative", zIndex: 1 }}>
          <Text style={{ ...userCardNameStyles, color: text }}>{name}</Text>
          <Group gap={6} justify="center" style={{ flexWrap: "wrap", width: "100%" }}>
            {groupAssignments.map((assignment) => {
              const label =
                formatRoleLabel(assignment.roleInShift) ||
                formatRoleLabel(assignment.shiftRole?.name) ||
                `Role #${assignment.shiftRoleId ?? assignment.id}`;
              return (
                <Badge
                  key={assignment.id}
                  color="violet"
                  variant="light"
                  rightSection={
                    allowManage ? (
                      <ActionIcon
                        size="xs"
                        variant="transparent"
                        color="red"
                        onClick={() => handleRemoveAssignment(assignment)}
                        disabled={removeDisabled}
                        aria-label={`Remove ${label}`}
                      >
                        <IconX size={12} />
                      </ActionIcon>
                    ) : undefined
                  }
                >
                  {label}
                </Badge>
              );
            })}
          </Group>
          {groupAssignments.length > 1 ? (
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
      return [] as ReactNode[];
    }
    const grouped = groupAssignmentsByUser(matches);
    return grouped
      .map((groupAssignments) =>
        renderAssignmentCard(groupAssignments, { allowManage: canModifyWeek }),
      )
      .filter((node): node is JSX.Element => Boolean(node));
  };

  const renderPubCrawlCell = (roleLabel: string, isoDate: string) => {
    const assignments = assignmentsByDate.get(isoDate) ?? [];
    const nodes = renderAssignmentsForRole(roleLabel, assignments);
    const instancesForDate = pubCrawlInstancesByDate.get(isoDate) ?? [];

    return (
      <Stack gap={8} align="center" style={{ width: "100%" }}>
        {nodes.length > 0 ? (
          nodes
        ) : (
          <Text size="sm" c="dimmed">
            {"\u2014"}
          </Text>
        )}
        {canModifyWeek
          ? instancesForDate.map((instance) => {
              const label = formatShiftTimeRange(instance.timeStart, instance.timeEnd);
              return (
                <Group
                  key={`pub-instance-${instance.id}`}
                  justify="space-between"
                  align="center"
                  style={{ width: "100%" }}
                >
                  <Button
                    size="xs"
                    variant="light"
                    leftSection={<IconPlus size={14} />}
                    onClick={() => handleOpenAssignment(instance)}
                  >
                    {label ? `Assign (${label})` : "Assign staff"}
                  </Button>
                  {canModifyWeek ? (
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      onClick={() => handleDeleteInstance(instance)}
                      disabled={deleteInstanceMutation.isPending}
                    >
                      <IconTrash size={16} />
                    </ActionIcon>
                  ) : null}
                </Group>
              );
            })
          : null}
      </Stack>
    );
  };

  const renderInstancesForCell = (instances: ShiftInstance[]) => {
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
      <Stack gap={14} align="stretch" style={{ width: "100%" }}>
        {sorted.map((instance) => {
          const assignments = instance.assignments ?? [];
          const grouped = groupAssignmentsByUser(assignments);
          const templateRoles = instance.requiredRoles ?? instance.template?.defaultRoles ?? [];

          return (
            <Stack key={`instance-${instance.id}`} gap={10} style={{ width: "100%" }}>
              <Stack gap={10} align="stretch">
                {grouped.length > 0 ? (
                  grouped
                    .map((groupAssignments) =>
                      renderAssignmentCard(groupAssignments, { allowManage: canModifyWeek }),
                    )
                    .filter((node): node is JSX.Element => Boolean(node))
                ) : (
                  <Text size="sm" c="dimmed" ta="center">
                    No assignments yet
                  </Text>
                )}
              </Stack>
              {canModifyWeek ? (
                <Button
                  size="xs"
                  variant="light"
                  leftSection={<IconPlus size={14} />}
                  onClick={() => handleOpenAssignment(instance)}
                >
                  Assign staff
                </Button>
              ) : null}
              <Group justify="space-between" align="center">
                {canModifyWeek ? (
                  <ActionIcon
                    variant="subtle"
                    color="red"
                    onClick={() => handleDeleteInstance(instance)}
                    disabled={deleteInstanceMutation.isPending}
                  >
                    <IconTrash size={16} />
                  </ActionIcon>
                ) : null}
              </Group>
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
              {renderPubCrawlCell(roleLabel, isoDate)}
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
        };

        return (
          <tr key={`${group.key}-${bucket.label}`}>
            <td style={timeframeCellStyle}>
              <div style={roleLabelStyles}>{bucket.label}</div>
            </td>
            {daysOfWeek.map((day, index) => {
              const isoDate = day.format("YYYY-MM-DD");
              const instances = bucket.instancesByDate.get(isoDate) ?? [];
              const nextDay = daysOfWeek[index + 1];
              const borderRightWidth = !nextDay || !day.isSame(nextDay, "month") ? "3px" : "1px";
              return (
                <td
                  key={`${group.key}-${bucket.label}-${isoDate}`}
                  style={{
                    ...assignmentCellStyle,
                    borderWidth: `${topBorder} ${borderRightWidth} ${bottomBorder} 0`,
                  }}
                >
                  {renderInstancesForCell(instances)}
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

  const pubCrawlTable =
    visibleRoles.length > 0 ? renderScheduleTable("pub-crawl", pubCrawlHeading, "Role", pubCrawlRows) : null;
  if (!accessLoaded) {
    return (
      <Stack mt="lg" gap="lg" align="center">
        {accessLoading ? (
          <Loader />
        ) : (
          <Alert color="yellow" title="Permissions not available">
            <Text size="sm">Scheduling permissions could not be loaded yet.</Text>
          </Alert>
        )}
      </Stack>
    );
  }

  if (!canAccessBuilder) {
    return (
      <Stack mt="lg" gap="lg">
        <Alert color="red" title="Insufficient permissions">
          <Text size="sm">You do not have permission to manage schedules.</Text>
        </Alert>
      </Stack>
    );
  }

  return (
    <Stack mt="lg" gap="lg">
      {ensureWeekQuery.isError ? (
        <Alert color="red" title="Unable to load scheduling week">
          <Text size="sm">
            {((ensureWeekQuery.error as AxiosError)?.response?.status === 401
              ? "You do not have permission to generate the schedule week. Please contact a manager."
              : (ensureWeekQuery.error as Error).message) ?? "Failed to load scheduling week."}
          </Text>
        </Alert>
      ) : error ? (
        <Alert color="red" title="Unable to load schedule data">
          <Text size="sm">{(error as Error).message}</Text>
        </Alert>
      ) : null}

      <Card radius="lg" shadow="xl" padding="lg" style={{ background: palette.heroGradient, color: "#fff" }}>
        <Stack gap="md">
          <Group justify="space-between" align="center" wrap="wrap">
            <Button
              variant="white"
              color="dark"
              leftSection={<IconChevronLeft size={16} />}
              onClick={() => handleNavigateWeek(-1)}
              disabled={loading}
            >
              Previous Week
            </Button>
            <Stack gap={4} align="center" style={{ flex: 1, minWidth: 240 }}>
              <Title order={3} fw={800} style={{ fontFamily: HEADER_FONT_STACK }}>
                Schedule Builder
              </Title>
              <Text size="sm" style={{ fontFamily: HEADER_FONT_STACK }}>
                {weekRangeLabel}
              </Text>
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
              disabled={loading}
            >
              Next Week
            </Button>
          </Group>
          <Group justify="center" gap="sm" wrap="wrap">
            <Button
              variant="white"
              color="dark"
              leftSection={<IconPlus size={16} />}
              onClick={() => setShowAddInstance(true)}
              disabled={!canModifyWeek}
            >
              Add shift
            </Button>
            <Button
              variant="white"
              color="indigo"
              onClick={handleAutoAssign}
              loading={autoAssignMutation.isPending}
              disabled={!canModifyWeek}
            >
              Auto assign volunteers
            </Button>
            <Button
              variant="white"
              color="gray"
              onClick={handleLockWeek}
              loading={lockWeekMutation.isPending}
              disabled={!canModifyWeek}
            >
              Lock week
            </Button>
            <Button
              variant="white"
              color="green"
              onClick={handlePublishWeek}
              loading={publishWeekMutation.isPending}
              disabled={!canModifyWeek}
            >
              Publish
            </Button>
            {isPublished ? (
              <Button
                variant="outline"
                color="violet"
                leftSection={<IconHistory size={16} />}
                onClick={handleReopenWeek}
                loading={reopenWeekMutation.isPending}
                disabled={!weekId}
              >
                Reopen week
              </Button>
            ) : null}
          </Group>
        </Stack>
      </Card>

      {weekViolations.length ? (
        <Alert color="yellow" title="Open scheduling issues">
          <Stack gap={4}>
            {weekViolations.map((violation) => (
              <Text key={`${violation.code}-${violation.message}`} size="sm">
              {"\u2022"} {violation.message}
              </Text>
            ))}
          </Stack>
        </Alert>
      ) : null}

      {publishError ? (
        <Alert color="red" title="Unable to publish week">
          <Stack gap={4}>
            <Text size="sm">{publishError}</Text>
            {publishViolations?.length ? (
              <Stack gap={2}>
                {publishViolations.map((violation) => (
                  <Text key={`${violation.code}-${violation.message}`} size="sm">
                  {"\u2022"} {violation.message}
                  </Text>
                ))}
              </Stack>
            ) : null}
          </Stack>
        </Alert>
      ) : null}

      {publishWeekMutation.isSuccess ? (
        <Alert color="green" title="Week published">
          <Text size="sm">The schedule has been published successfully.</Text>
        </Alert>
      ) : null}

      {reopenWeekMutation.isSuccess ? (
        <Alert color="blue" title="Week reopened">
          <Text size="sm">
            The week has been moved back to the collecting state. Team availability can be updated before you lock and publish again.
          </Text>
        </Alert>
      ) : null}

      {reopenError ? (
        <Alert color="red" title="Unable to reopen week">
          <Text size="sm">{reopenError}</Text>
        </Alert>
      ) : null}

      {autoAssignMutation.isSuccess && autoAssignData ? (
        <Alert color="green" title="Auto assignment complete">
          <Stack gap={4}>
            <Text size="sm">
              Assigned {autoAssignData.created} slot{autoAssignData.created === 1 ? "" : "s"} and removed{" "}
              {autoAssignData.removed} previous volunteer assignment{autoAssignData.removed === 1 ? "" : "s"}.
            </Text>
            <Text size="sm">
              {autoAssignData.unfilled.length
                ? `Remaining vacancies: ${autoAssignData.unfilled.length}.`
                : "All volunteer-required slots are filled."}
            </Text>
            {unfilledPreview ? (
              <Text size="xs" c="dimmed">
                Open slots: {unfilledPreview}
              </Text>
            ) : null}
            {volunteerAssignmentsPreview ? (
              <Text size="xs" c="dimmed">
                Volunteer load: {volunteerAssignmentsPreview}
              </Text>
            ) : null}
          </Stack>
        </Alert>
      ) : null}

      {autoAssignMutation.isError && autoAssignErrorMessage ? (
        <Alert color="red" title="Auto assignment failed">
          <Text size="sm">{autoAssignErrorMessage}</Text>
        </Alert>
      ) : null}

      {loading ? (
        <Center py="xl">
          <Loader />
        </Center>
      ) : !hasWeek ? (
        <Alert color="yellow" variant="light" radius="md" title="Week not available">
          <Text size="sm">
            Schedule data for {formatWeekValue(selectedWeek)} is not available yet. Generate the week to begin assigning
            staff.
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
            {!pubCrawlTable && otherShiftTables.length === 0 ? (
              <Text size="sm" c="dimmed" ta="center">
                No shifts scheduled for this week yet. Use the actions above to add shifts or auto assign staff.
              </Text>
            ) : null}
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

      <AddShiftInstanceModal
        opened={showAddInstance}
        onClose={() => setShowAddInstance(false)}
        onSubmit={handleCreateInstance}
        scheduleWeekId={weekId ?? 0}
        defaultDate={weekStart.toDate()}
        templates={templatesQuery.data ?? []}
      />

      <Modal opened={assignmentModal.opened} onClose={handleCloseAssignment} title="Assign staff">
        <Stack>
          {assignmentError ? (
            <Alert color="red" title="Unable to assign">
              <Text size="sm">{assignmentError}</Text>
            </Alert>
          ) : null}
          <Select
            data={staffSelectOptions}
            label="Team member"
            placeholder="Select staff"
            value={assignmentUserId}
            onChange={(value) => {
              setAssignmentUserId(value);
              if (!value) {
                setAssignmentRequiresOverride(false);
                return;
              }
              const userId = Number(value);
              if (Number.isNaN(userId)) {
                setAssignmentRequiresOverride(false);
                return;
              }
              const shift = assignmentModal.shift ?? null;
              setAssignmentRequiresOverride(!isUserAvailableForShift(userId, shift));
            }}
            searchable
            nothingFoundMessage={assignmentShowUnavailable ? "No staff found" : "No staff available"}
          />
          {staffOptionsForAssignment.unavailable.length > 0 ? (
            <Switch
              label="Show unavailable staff (override required)"
              checked={assignmentShowUnavailable}
              onChange={(event) => setAssignmentShowUnavailable(event.currentTarget.checked)}
              size="sm"
            />
          ) : null}
          <Select
            data={assignmentRoleOptions.map((option) => ({
              value: option.value,
              label: option.label,
            }))}
            label="Role"
            placeholder="Select role"
            value={assignmentRoleOption?.value ?? null}
            onChange={(value) => {
              const option = assignmentRoleOptions.find((candidate) => candidate.value === value) ?? null;
              setAssignmentRoleOption(option);
              if (option?.isCustomEntry) {
                setAssignmentCustomRoleName("");
              } else if (option?.roleName) {
                setAssignmentCustomRoleName(option.roleName);
              }
            }}
            searchable
            nothingFoundMessage="No roles"
            disabled={assignmentRoleOptions.length === 0}
          />
          {assignmentRoleOption?.isCustomEntry ? (
            <TextInput
              label="Custom role name"
              placeholder="Enter role name"
              value={assignmentCustomRoleName}
              onChange={(event) => setAssignmentCustomRoleName(event.currentTarget.value)}
              required
            />
          ) : null}
          {assignmentRequiresOverride ? (
            <Textarea
              label="Override reason"
              placeholder="Explain why this assignment should ignore availability"
              value={assignmentOverrideReason}
              minRows={2}
              onChange={(event) => setAssignmentOverrideReason(event.currentTarget.value)}
              required
            />
          ) : (
            <Textarea
              label="Override reason (optional)"
              placeholder="Explain why this assignment should ignore availability"
              value={assignmentOverrideReason}
              minRows={2}
              onChange={(event) => setAssignmentOverrideReason(event.currentTarget.value)}
            />
          )}
          <Button
            onClick={handleCreateAssignment}
            disabled={!assignmentUserId || !assignmentRoleOption || assignMutation.isPending}
            loading={assignMutation.isPending}
          >
            Save assignment
          </Button>
        </Stack>
      </Modal>
    </Stack>
  );
};

export default BuilderPage;
