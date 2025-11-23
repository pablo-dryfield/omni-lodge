import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties, DragEvent, ReactNode } from "react";
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
  MultiSelect,
  Select,
  Switch,
  Stack,
  Text,
  TextInput,
  Textarea,
  Title,
  Tooltip,
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
  useClearShiftInstances,
  useCreateShiftInstance,
  useDeleteAssignment,
  useDeleteShiftInstance,
  useEnsureWeek,
  useGenerateShiftInstances,
  useLockWeek,
  usePublishWeek,
  useReopenWeek,
  useShiftInstances,
  useShiftTemplates,
  useWeekAvailability,
  useWeekSummary,
} from "../../api/scheduling";
import { useShiftRoles, useShiftRoleAssignments } from "../../api/shiftRoles";
import WeekSelector from "../../components/scheduling/WeekSelector";
import AddShiftInstanceModal from "../../components/scheduling/AddShiftInstanceModal";
import type {
  AvailabilityEntry,
  ShiftAssignment,
  ShiftInstance,
  ShiftRoleRequirement,
  ScheduleViolation,
} from "../../types/scheduling";
import type { ServerResponse } from "../../types/general/ServerResponse";
import type { ShiftRole } from "../../types/shiftRoles/ShiftRole";
import type { UserShiftRoleAssignment } from "../../types/shiftRoles/UserShiftRoleAssignment";

dayjs.extend(isoWeek);

type StaffOption = {
  value: string;
  label: string;
};

type StaffOptionGroup = {
  group: string;
  items: StaffOption[];
};

type StaffSelectData = Array<StaffOption | StaffOptionGroup>;

type AvailabilityWithMinutes = AvailabilityEntry & {
  startMinutesValue: number | null;
  endMinutesValue: number | null;
};

const DEFAULT_SHIFT_DURATION_MINUTES = 120;

const parseTimeToMinutes = (time: string | null | undefined): number | null => {
  if (!time) {
    return null;
  }
  const [hoursPart, minutesPart] = time.split(":");
  const hours = Number(hoursPart);
  const minutes = Number(minutesPart);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) {
    return null;
  }
  return hours * 60 + minutes;
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

const createRoleKey = (roleId: number | null, roleName: string) =>
  roleId != null ? `id:${roleId}` : `name:${normalizeRoleName(roleName)}`;

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
  minWidth: 0,
  backgroundColor: "#ffffff",
  verticalAlign: "top",
};

const roleCellStyles: CSSProperties = {
  ...tableCellBase,
  padding: 0,
  minWidth: 0,
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
      maxWidth: 260,
      minWidth: 0,
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

const PANEL_SCROLL_HEIGHT = "70vh";
const ROSTER_PANEL_WIDTH = 320;

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

const getShiftTypeLabel = (instance: ShiftInstance) => {
  const typeName = instance.shiftType?.name?.trim();
  if (typeName) {
    return typeName;
  }
  const templateName = instance.template?.name?.trim();
  if (templateName) {
    return templateName;
  }
  return "Shift";
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

const BuilderPage = () => {
  const [weekOptions, initialWeekValue] = useMemo(() => {
    const options = getUpcomingWeeks(6);
    const initial = options[1]?.value ?? options[0]?.value ?? "";
    return [options, initial] as const;
  }, []);

  const [selectedWeek, setSelectedWeek] = useState<string>(initialWeekValue);
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
  const [showAddInstance, setShowAddInstance] = useState(false);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [draggedUserId, setDraggedUserId] = useState<number | null>(null);
  const [dragHoverInstanceId, setDragHoverInstanceId] = useState<number | null>(null);
  const [pendingAssignmentUserId, setPendingAssignmentUserId] = useState<number | null>(null);
  const [selectedRosterUserId, setSelectedRosterUserId] = useState<number | null>(null);
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
  const [generateInstancesModalOpen, setGenerateInstancesModalOpen] = useState(false);
  const [generateTemplateSelection, setGenerateTemplateSelection] = useState<string[]>([]);
  const [clearInstancesModalOpen, setClearInstancesModalOpen] = useState(false);

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
  const shiftRoleAssignmentsQuery = useShiftRoleAssignments();
  const shiftRoleRecords = useMemo<ShiftRole[]>(() => {
    return (shiftRolesQuery.data?.[0]?.data ?? []) as ShiftRole[];
  }, [shiftRolesQuery.data]);
  const shiftRoleNameById = useMemo(() => {
    const map = new Map<number, string>();
    shiftRoleRecords.forEach((role) => {
      map.set(role.id, role.name);
    });
    return map;
  }, [shiftRoleRecords]);
  const normalizedShiftRoleIdByName = useMemo(() => {
    const lookup = new Map<string, number>();
    shiftRoleRecords.forEach((role) => {
      const normalized = normalizeRoleName(role.name);
      if (normalized && !lookup.has(normalized)) {
        lookup.set(normalized, role.id);
      }
    });
    return lookup;
  }, [shiftRoleRecords]);
  const weekAvailabilityQuery = useWeekAvailability(canAccessBuilder && weekId ? weekId : null);

  const assignMutation = useAssignShifts();
  const deleteAssignmentMutation = useDeleteAssignment();
  const createInstanceMutation = useCreateShiftInstance();
  const deleteInstanceMutation = useDeleteShiftInstance();
  const autoAssignMutation = useAutoAssignWeek();
  const lockWeekMutation = useLockWeek();
  const publishWeekMutation = usePublishWeek();
  const reopenWeekMutation = useReopenWeek();
  const generateInstancesMutation = useGenerateShiftInstances();
  const { mutateAsync: generateInstancesMutateAsync, reset: resetGenerateInstances } = generateInstancesMutation;
  const clearInstancesMutation = useClearShiftInstances();

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
  const staffAssignmentSummary = useMemo(() => {
    const map = new Map<number, { total: number; perShiftType: Map<string, number> }>();
    shiftInstances.forEach((instance) => {
      const label = getShiftTypeLabel(instance);
      (instance.assignments ?? []).forEach((assignment) => {
        if (!assignment.userId) {
          return;
        }
        const entry = map.get(assignment.userId);
        if (entry) {
          entry.total += 1;
          entry.perShiftType.set(label, (entry.perShiftType.get(label) ?? 0) + 1);
        } else {
          map.set(assignment.userId, {
            total: 1,
            perShiftType: new Map([[label, 1]]),
          });
        }
      });
    });
    return map;
  }, [shiftInstances]);
  const shiftRoleAssignments = useMemo<UserShiftRoleAssignment[]>(() => {
    return (shiftRoleAssignmentsQuery.data?.[0]?.data ?? []) as UserShiftRoleAssignment[];
  }, [shiftRoleAssignmentsQuery.data]);
  const userLivesInAccomById = useMemo(() => {
    const map = new Map<number, boolean>();
    shiftRoleAssignments.forEach((assignment) => {
      map.set(assignment.userId, Boolean(assignment.livesInAccom));
    });
    return map;
  }, [shiftRoleAssignments]);
  const userHasActiveProfileById = useMemo(() => {
    const map = new Map<number, boolean>();
    shiftRoleAssignments.forEach((assignment) => {
      map.set(assignment.userId, Boolean(assignment.staffProfileActive));
    });
    return map;
  }, [shiftRoleAssignments]);
  const userRoleIdsByUserId = useMemo(() => {
    const map = new Map<number, number[]>();
    shiftRoleAssignments.forEach((assignment) => {
      const normalizedIds = Array.from(
        new Set(
          (assignment.roleIds ?? [])
            .map((value) => Number(value))
            .filter((value): value is number => Number.isFinite(value)),
        ),
      );
      map.set(assignment.userId, normalizedIds);
    });
    return map;
  }, [shiftRoleAssignments]);
  const userRoleIdSetByUserId = useMemo(() => {
    const map = new Map<number, Set<number>>();
    userRoleIdsByUserId.forEach((ids, userId) => {
      map.set(userId, new Set(ids));
    });
    return map;
  }, [userRoleIdsByUserId]);
  const rosterEligibleUserIds = useMemo(() => {
    const set = new Set<number>();
    shiftRoleAssignments.forEach((assignment) => {
      const roleIds = userRoleIdsByUserId.get(assignment.userId) ?? [];
      if (roleIds.length > 0 && assignment.staffProfileActive) {
        set.add(assignment.userId);
      }
    });
    return set;
  }, [shiftRoleAssignments, userRoleIdsByUserId]);
  const getDefaultAvailability = useCallback(
    (userId: number | null | undefined) => {
      if (userId == null) {
        return false;
      }
      const hasActiveProfile = userHasActiveProfileById.get(userId) ?? false;
      if (!hasActiveProfile) {
        return false;
      }
      return userLivesInAccomById.get(userId) ?? false;
    },
    [userHasActiveProfileById, userLivesInAccomById],
  );

  const getRoleDefinitionsForInstance = useCallback((instance?: ShiftInstance | null) => {
    if (!instance) {
      return [];
    }
    if (Array.isArray(instance.requiredRoles) && instance.requiredRoles.length > 0) {
      return instance.requiredRoles;
    }
    return instance.template?.defaultRoles ?? [];
  }, []);

  const countAssignmentsForRole = useCallback(
    (instance: ShiftInstance, role: ShiftRoleRequirement) => {
      const roleLabel = role.role && role.role.trim().length > 0 ? role.role : "Staff";
      const assignments = instance.assignments ?? [];
      if (role.shiftRoleId != null) {
        const normalizedRoleLabel = normalizeRoleName(roleLabel);
        return assignments.filter((assignment) => {
          if (assignment.shiftRoleId === role.shiftRoleId) {
            return true;
          }
          if (!normalizedRoleLabel) {
            return false;
          }
          const assignmentLabel = normalizeRoleName(
            assignment.roleInShift && assignment.roleInShift.trim().length > 0 ? assignment.roleInShift : "",
          );
          if (!assignmentLabel) {
            return false;
          }
          return (
            assignmentLabel === normalizedRoleLabel ||
            assignmentLabel.includes(normalizedRoleLabel) ||
            normalizedRoleLabel.includes(assignmentLabel)
          );
        }).length;
      }
      const targetKey = createRoleKey(null, roleLabel);
      return assignments.filter((assignment) => {
        const assignmentLabel =
          assignment.roleInShift && assignment.roleInShift.trim().length > 0 ? assignment.roleInShift : "Staff";
        const assignmentKey = createRoleKey(assignment.shiftRoleId ?? null, assignmentLabel);
        return assignmentKey === targetKey;
      }).length;
    },
    [],
  );

  const userHasShiftRole = useCallback(
    (
      userId: number | null | undefined,
      target?: { shiftRoleId?: number | null; roleName?: string | null },
    ): boolean => {
      if (userId == null) {
        return false;
      }
      const roleSet = userRoleIdSetByUserId.get(userId);
      if (!roleSet || roleSet.size === 0) {
        return false;
      }
      if (target?.shiftRoleId != null) {
        return roleSet.has(target.shiftRoleId);
      }
      const normalizedTarget = normalizeRoleName(target?.roleName ?? "");
      if (!normalizedTarget) {
        return true;
      }
      for (const roleId of roleSet) {
        const roleName = shiftRoleNameById.get(roleId);
        if (!roleName) {
          continue;
        }
        const normalizedRoleName = normalizeRoleName(roleName);
        if (
          normalizedRoleName === normalizedTarget ||
          normalizedRoleName.includes(normalizedTarget) ||
          normalizedTarget.includes(normalizedRoleName)
        ) {
          return true;
        }
      }
      return false;
    },
    [shiftRoleNameById, userRoleIdSetByUserId],
  );

  const hasOpenRoleForUser = useCallback(
    (userId: number, instance?: ShiftInstance | null) => {
      if (!instance) {
        return false;
      }
      const roleDefinitions = getRoleDefinitionsForInstance(instance);
      if (roleDefinitions.length === 0) {
        return true;
      }
      return roleDefinitions.some((definition) => {
        if (
          !userHasShiftRole(userId, {
            shiftRoleId: definition.shiftRoleId ?? null,
            roleName: definition.role ?? "",
          })
        ) {
          return false;
        }
        const requiredSlots = Math.max(1, definition.required ?? 1);
        const filledSlots = countAssignmentsForRole(instance, definition);
        return filledSlots < requiredSlots;
      });
    },
    [countAssignmentsForRole, getRoleDefinitionsForInstance, userHasShiftRole],
  );

  const doesUserMatchRoleOption = useCallback(
    (userId: number, option: RoleOption) => {
      if (option.isCustomEntry) {
        return true;
      }
      return userHasShiftRole(userId, { shiftRoleId: option.shiftRoleId, roleName: option.roleName || option.label });
    },
    [userHasShiftRole],
  );

  const rosterStaff = useMemo(() => {
    if (!shiftRoleAssignmentsQuery.isSuccess || rosterEligibleUserIds.size === 0) {
      return staff;
    }
    return staff.filter((option) => rosterEligibleUserIds.has(Number(option.value)));
  }, [staff, rosterEligibleUserIds, shiftRoleAssignmentsQuery.isSuccess]);
  const staffCards = useMemo(
    () =>
      rosterStaff
        .map((option) => {
          const userId = Number(option.value);
          const normalizedUserId = Number.isFinite(userId) ? userId : null;
          const summary = normalizedUserId != null ? staffAssignmentSummary.get(normalizedUserId) : null;
          const shiftCounts = summary
            ? Array.from(summary.perShiftType.entries())
                .sort((a, b) => {
                  if (b[1] !== a[1]) {
                    return b[1] - a[1];
                  }
                  return a[0].localeCompare(b[0]);
                })
                .map(([label, count]) => ({ label, count }))
            : [];
          return {
            key: option.value,
            userId: normalizedUserId,
            name: option.label,
            totalAssignments: summary?.total ?? 0,
            shiftCounts,
            color: getUserColor(normalizedUserId),
          };
        })
        .sort((a, b) => {
          if (b.totalAssignments !== a.totalAssignments) {
            return b.totalAssignments - a.totalAssignments;
          }
          return a.name.localeCompare(b.name);
        }),
    [rosterStaff, staffAssignmentSummary],
  );
  const templateOptions = useMemo(
    () =>
      (templatesQuery.data ?? []).map((template) => ({
        value: template.id.toString(),
        label: template.name,
      })),
    [templatesQuery.data],
  );
  const selectedRosterUserName = useMemo(() => {
    if (selectedRosterUserId == null) {
      return null;
    }
    const match = staffCards.find((card) => card.userId === selectedRosterUserId);
    return match?.name ?? null;
  }, [selectedRosterUserId, staffCards]);

  useEffect(() => {
    if (selectedRosterUserId == null) {
      return;
    }
    if (!staffCards.some((card) => card.userId === selectedRosterUserId)) {
      setSelectedRosterUserId(null);
    }
  }, [selectedRosterUserId, staffCards]);

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

  const visibleRoles = useMemo(() => {
    const rolesWithAssignments = ROLE_ORDER.filter((roleLabel) =>
      daysOfWeek.some((day) => {
        const isoDate = day.format("YYYY-MM-DD");
        const assignments = assignmentsByDate.get(isoDate) ?? [];
        return filterAssignmentsForRole(roleLabel, assignments).length > 0;
      }),
    );
    if (rolesWithAssignments.length > 0) {
      return rolesWithAssignments;
    }
    return pubCrawlInstances.length > 0 ? Array.from(ROLE_ORDER) : rolesWithAssignments;
  }, [assignmentsByDate, daysOfWeek, pubCrawlInstances.length]);

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

  const handleRosterCardSelect = useCallback((userId: number | null) => {
    if (userId == null || Number.isNaN(userId)) {
      setSelectedRosterUserId(null);
      return;
    }
    setSelectedRosterUserId((current) => (current === userId ? null : userId));
  }, []);

  const clearRosterSelection = useCallback(() => {
    setSelectedRosterUserId(null);
  }, []);

  const handleOpenGenerateInstancesModal = useCallback(() => {
    setGenerateTemplateSelection((templatesQuery.data ?? []).map((template) => template.id.toString()));
    resetGenerateInstances();
    setGenerateInstancesModalOpen(true);
  }, [resetGenerateInstances, templatesQuery.data]);

  const handleCloseGenerateInstancesModal = useCallback(() => {
    setGenerateInstancesModalOpen(false);
  }, []);

  const handleSelectAllTemplates = useCallback(() => {
    setGenerateTemplateSelection(templateOptions.map((option) => option.value));
  }, [templateOptions]);

  const handleClearTemplateSelection = useCallback(() => {
    setGenerateTemplateSelection([]);
  }, []);

  const handleGenerateInstancesSubmit = useCallback(async () => {
    if (!weekId || generateTemplateSelection.length === 0) {
      return;
    }
    const templateIds = generateTemplateSelection
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value));
    if (templateIds.length === 0) {
      return;
    }
    await generateInstancesMutateAsync({ weekId, templateIds });
    setGenerateInstancesModalOpen(false);
  }, [generateInstancesMutateAsync, generateTemplateSelection, weekId]);

  const handleClearInstances = useCallback(async () => {
    if (!weekId) {
      return;
    }
    await clearInstancesMutation.mutateAsync({ weekId });
    setClearInstancesModalOpen(false);
  }, [clearInstancesMutation, weekId]);


  const formatAssignButtonLabel = useCallback(
    (baseLabel?: string | null) => {
      if (selectedRosterUserName) {
        return baseLabel && baseLabel.trim().length > 0
          ? `Assign ${selectedRosterUserName} (${baseLabel})`
          : `Assign ${selectedRosterUserName}`;
      }
      if (baseLabel && baseLabel.trim().length > 0) {
        return `Assign (${baseLabel})`;
      }
      return "Assign staff";
    },
    [selectedRosterUserName],
  );

  const handleUserCardDragStart = useCallback(
    (event: DragEvent<HTMLElement>, userId: number | null) => {
      if (!canModifyWeek || userId == null) {
        event.preventDefault();
        return;
      }
      setDraggedUserId(userId);
      setSelectedRosterUserId(userId);
      if (event.dataTransfer) {
        event.dataTransfer.setData("application/x-schedule-user", String(userId));
        event.dataTransfer.setData("text/plain", String(userId));
        event.dataTransfer.effectAllowed = "copyMove";
      }
    },
    [canModifyWeek],
  );

  const handleUserCardDragEnd = useCallback(() => {
    setDraggedUserId(null);
    setDragHoverInstanceId(null);
  }, []);

  useEffect(() => {
    autoAssignMutation.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekId]);

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

  const applicableAssignmentRoleOptions = useMemo(() => {
    if (!assignmentUserId) {
      return assignmentRoleOptions;
    }
    const userId = Number(assignmentUserId);
    if (!Number.isFinite(userId)) {
      return assignmentRoleOptions;
    }
    return assignmentRoleOptions.filter((option) => doesUserMatchRoleOption(userId, option) || option.isCustomEntry);
  }, [assignmentRoleOptions, assignmentUserId, doesUserMatchRoleOption]);

  useEffect(() => {
    if (!assignmentModal.opened) {
      return;
    }
    if (applicableAssignmentRoleOptions.length === 0) {
      setAssignmentRoleOption(null);
      return;
    }

    setAssignmentRoleOption((current) => {
      if (current && applicableAssignmentRoleOptions.some((option) => option.value === current.value)) {
        return current;
      }
      const firstOption = applicableAssignmentRoleOptions[0];
      if (firstOption.isCustomEntry) {
        setAssignmentCustomRoleName("");
      } else {
        setAssignmentCustomRoleName(firstOption.roleName);
      }
      return firstOption;
    });
  }, [assignmentModal.opened, applicableAssignmentRoleOptions]);

  const availabilityByUserId = useMemo(() => {
    const map = new Map<number, AvailabilityWithMinutes[]>();
    const entries = (weekAvailabilityQuery.data ?? []) as AvailabilityEntry[];
    entries.forEach((entry) => {
      const startMinutesValue = parseTimeToMinutes(entry.startTime ?? null);
      const endMinutesValue = parseTimeToMinutes(entry.endTime ?? null);
      const enriched: AvailabilityWithMinutes = {
        ...entry,
        startMinutesValue,
        endMinutesValue,
      };
      const existing = map.get(entry.userId);
      if (existing) {
        existing.push(enriched);
      } else {
        map.set(entry.userId, [enriched]);
      }
    });
    return map;
  }, [weekAvailabilityQuery.data]);

  const availabilityStatusByUserId = useMemo(() => {
    const map = new Map<number, Map<string, "available" | "unavailable">>();
    const entries = (weekAvailabilityQuery.data ?? []) as AvailabilityEntry[];
    entries.forEach((entry) => {
      const dayMap = map.get(entry.userId);
      if (dayMap) {
        const existing = dayMap.get(entry.day);
        if (entry.status === "available" || !existing) {
          dayMap.set(entry.day, entry.status);
        }
      } else {
        map.set(entry.userId, new Map([[entry.day, entry.status]]));
      }
    });
    return map;
  }, [weekAvailabilityQuery.data]);

  const buildShiftWindow = useCallback((shift?: ShiftInstance | null) => {
    if (!shift) {
      return null;
    }
    const startMinutes = parseTimeToMinutes(shift.timeStart) ?? 0;
    const endMinutesRaw = shift.timeEnd ? parseTimeToMinutes(shift.timeEnd) : null;
    const endMinutes =
      endMinutesRaw != null ? endMinutesRaw : startMinutes + DEFAULT_SHIFT_DURATION_MINUTES;

    return {
      date: shift.date,
      shiftTypeId: shift.shiftTypeId,
      startMinutes,
      endMinutes,
    };
  }, []);

  const activeShiftWindow = useMemo(() => {
    if (!assignmentModal.opened) {
      return null;
    }
    return buildShiftWindow(assignmentModal.shift);
  }, [assignmentModal.opened, assignmentModal.shift, buildShiftWindow]);


  const userMeetsRoleRequirements = useCallback(
    (userId: number, instance?: ShiftInstance | null) => {
      const roleSet = userRoleIdSetByUserId.get(userId);
      if (!roleSet || roleSet.size === 0) {
        return false;
      }
      if (!instance) {
        return true;
      }
      return hasOpenRoleForUser(userId, instance);
    },
    [hasOpenRoleForUser, userRoleIdSetByUserId],
  );

  const userCanTakeInstance = useCallback(
    (userId: number, instance: ShiftInstance | null | undefined) => userMeetsRoleRequirements(userId, instance),
    [userMeetsRoleRequirements],
  );

  const isUserAvailableForShift = useCallback(
    (userId: number, shiftOverride?: ShiftInstance | null): boolean => {
      const comparisonWindow = shiftOverride ? buildShiftWindow(shiftOverride) : activeShiftWindow;
      if (!comparisonWindow) {
        return true;
      }
      if (!userCanTakeInstance(userId, shiftOverride ?? assignmentModal.shift ?? ({} as ShiftInstance))) {
        return false;
      }
      const entries = availabilityByUserId.get(userId);
      const fallbackAvailable = getDefaultAvailability(userId);
      if (!entries || entries.length === 0) {
        return fallbackAvailable;
      }
      const dayEntries = entries.filter((entry) => entry.day === comparisonWindow.date);
      if (dayEntries.length === 0) {
        return fallbackAvailable;
      }

      return dayEntries.some((entry) => {
        if (entry.status !== "available") {
          return false;
        }
        if (entry.shiftTypeId && entry.shiftTypeId !== comparisonWindow.shiftTypeId) {
          return false;
        }
        if (
          entry.startMinutesValue != null &&
          comparisonWindow.startMinutes < entry.startMinutesValue
        ) {
          return false;
        }
        if (
          entry.endMinutesValue != null &&
          comparisonWindow.endMinutes > entry.endMinutesValue
        ) {
          return false;
        }
        return true;
      });
    },
    [
      activeShiftWindow,
      availabilityByUserId,
      buildShiftWindow,
      getDefaultAvailability,
      userCanTakeInstance,
      assignmentModal.shift,
    ],
  );

  const renderShiftTooltip = useCallback((instance: ShiftInstance) => {
    const title = instance.template?.name ?? instance.shiftType?.name ?? "Shift";
    const dateLabel = dayjs(instance.date).format("ddd, MMM D");
    const timeLabel = formatShiftTimeRange(instance.timeStart, instance.timeEnd) || "Any time";
    const assignedCount = instance.assignments?.length ?? 0;
    const capacity = instance.capacity ?? null;
    return (
      <Stack gap={2} maw={260}>
        <Text fw={600}>{title}</Text>
        <Text size="xs" c="dimmed">
          {dateLabel} {"\u2022"} {timeLabel}
        </Text>
        <Text size="xs">
          Assigned: {assignedCount}
          {capacity != null ? ` / Capacity: ${capacity}` : ""}
        </Text>
      </Stack>
    );
  }, []);

  const getInstanceHighlightStyles = useCallback(
    (instance: ShiftInstance) => {
      const userId = draggedUserId ?? selectedRosterUserId;
      if (!userId) {
        return {};
      }
      const eligible = isUserAvailableForShift(userId, instance);
      return eligible
        ? {
            boxShadow: "0 0 0 2px rgba(46, 196, 182, 0.4)",
            backgroundColor: "rgba(46, 196, 182, 0.08)",
          }
        : {
            opacity: 0.45,
          };
    },
    [draggedUserId, selectedRosterUserId, isUserAvailableForShift],
  );

  const staffOptionsByAvailability = useMemo(() => {
    if (!assignmentModal.opened || !activeShiftWindow) {
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
      if (isUserAvailableForShift(userId)) {
        availableOptions.push(option);
      } else {
        unavailableOptions.push(option);
      }
    });

    return {
      available: availableOptions,
      unavailable: unavailableOptions,
    };
  }, [activeShiftWindow, assignmentModal.opened, isUserAvailableForShift, staff]);

  const availableStaffOptions = staffOptionsByAvailability.available;
  const unavailableStaffOptions = staffOptionsByAvailability.unavailable;
  const availableOptionCount = availableStaffOptions.length;
  const unavailableOptionCount = unavailableStaffOptions.length;

  useEffect(() => {
    if (!assignmentModal.opened) {
      return;
    }
    if (
      !assignmentShowUnavailable &&
      availableOptionCount === 0 &&
      unavailableOptionCount > 0
    ) {
      setAssignmentShowUnavailable(true);
    }
  }, [
    assignmentModal.opened,
    assignmentShowUnavailable,
    availableOptionCount,
    unavailableOptionCount,
  ]);

  const staffSelectOptions = useMemo<StaffSelectData>(() => {
    if (!assignmentModal.opened) {
      return staff;
    }

    const availableItems: StaffOption[] = availableStaffOptions.map((option) => ({
      value: option.value,
      label: option.label,
    }));

    if (!assignmentShowUnavailable || unavailableOptionCount === 0) {
      return availableItems;
    }

    const unavailableItems: StaffOption[] = unavailableStaffOptions.map((option) => ({
      value: option.value,
      label: `${option.label} (Unavailable)`,
    }));

    return [
      { group: "Available", items: availableItems },
      { group: "Unavailable", items: unavailableItems },
    ];
  }, [
    assignmentModal.opened,
    assignmentShowUnavailable,
    staff,
    availableStaffOptions,
    unavailableStaffOptions,
    unavailableOptionCount,
  ]);

  useEffect(() => {
    if (!assignmentModal.opened) {
      return;
    }
    if (assignmentShowUnavailable) {
      return;
    }
    if (!assignmentUserId || !activeShiftWindow) {
      return;
    }
    const userId = Number(assignmentUserId);
    if (Number.isNaN(userId)) {
      return;
    }
    if (!isUserAvailableForShift(userId)) {
      setAssignmentUserId(null);
      setAssignmentOverrideReason("");
      setAssignmentRequiresOverride(false);
    }
  }, [
    assignmentModal.opened,
    assignmentShowUnavailable,
    assignmentUserId,
    activeShiftWindow,
    isUserAvailableForShift,
  ]);

  useEffect(() => {
    if (!assignmentModal.opened || pendingAssignmentUserId == null) {
      return;
    }
    if (!assignmentModal.shift) {
      setPendingAssignmentUserId(null);
      return;
    }
    const userId = pendingAssignmentUserId;
    setAssignmentShowUnavailable(true);
    setAssignmentUserId(userId.toString());
    const available = isUserAvailableForShift(userId, assignmentModal.shift);
    setAssignmentRequiresOverride(!available);
    if (available) {
      setAssignmentOverrideReason("");
    }
    setPendingAssignmentUserId(null);
  }, [
    assignmentModal.opened,
    assignmentModal.shift,
    pendingAssignmentUserId,
    isUserAvailableForShift,
  ]);

  useEffect(() => {
    if (!assignmentModal.opened || !assignmentModal.shift || !assignmentUserId) {
      return;
    }
    const userId = Number(assignmentUserId);
    if (!Number.isFinite(userId)) {
      return;
    }
    const available = isUserAvailableForShift(userId, assignmentModal.shift);
    setAssignmentRequiresOverride(!available);
  }, [
    assignmentModal.opened,
    assignmentModal.shift,
    assignmentUserId,
    availabilityByUserId,
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

  const handleOpenAssignment = useCallback((shift: ShiftInstance) => {
    setAssignmentModal({ opened: true, shift });
  }, []);

  const handleCloseAssignment = () => {
    setAssignmentModal({ opened: false, shift: null });
    setAssignmentUserId(null);
    setAssignmentRoleOption(null);
    setAssignmentCustomRoleName("");
    setAssignmentOverrideReason("");
    setAssignmentError(null);
    setAssignmentRequiresOverride(false);
    setAssignmentShowUnavailable(false);
    setPendingAssignmentUserId(null);
    setDraggedUserId(null);
    setDragHoverInstanceId(null);
    assignMutation.reset();
  };

  const openAssignmentForShift = useCallback(
    (shift: ShiftInstance, options?: { userId?: number | null }) => {
      const userId = options?.userId;
      if (typeof userId === "number" && Number.isFinite(userId)) {
        setPendingAssignmentUserId(userId);
      }
      handleOpenAssignment(shift);
    },
    [handleOpenAssignment],
  );

  const getUserIdFromDragEvent = useCallback(
    (event: DragEvent<HTMLElement>) => {
      if (draggedUserId != null) {
        return draggedUserId;
      }
      const payload =
        event.dataTransfer?.getData("application/x-schedule-user") ??
        event.dataTransfer?.getData("text/plain") ??
        "";
      const parsed = Number(payload);
      return Number.isFinite(parsed) ? parsed : null;
    },
    [draggedUserId],
  );

  const handleDropOnShift = useCallback(
    (event: DragEvent<HTMLElement>, instance: ShiftInstance) => {
      if (!canModifyWeek) {
        return;
      }
      const userId = getUserIdFromDragEvent(event);
      if (userId == null) {
        return;
      }
      event.preventDefault();
      setDragHoverInstanceId(null);
      openAssignmentForShift(instance, { userId });
      setDraggedUserId(null);
    },
    [canModifyWeek, getUserIdFromDragEvent, openAssignmentForShift],
  );

  const handleInstanceDragOver = useCallback(
    (event: DragEvent<HTMLElement>, instanceId: number) => {
      if (!canModifyWeek || draggedUserId == null) {
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      setDragHoverInstanceId(instanceId);
    },
    [canModifyWeek, draggedUserId],
  );

  const handleInstanceDragLeave = useCallback(
    (event: DragEvent<HTMLElement>, instanceId: number) => {
      if (dragHoverInstanceId !== instanceId) {
        return;
      }
      const nextTarget = event.relatedTarget as Node | null;
      if (nextTarget && event.currentTarget.contains(nextTarget)) {
        return;
      }
      setDragHoverInstanceId(null);
    },
    [dragHoverInstanceId],
  );

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
    const numericUserId = Number(assignmentUserId);
    if (
      Number.isFinite(numericUserId) &&
      !assignmentRoleOption.isCustomEntry &&
      !doesUserMatchRoleOption(numericUserId, assignmentRoleOption)
    ) {
      setAssignmentError("This team member does not have the required shift role.");
      return;
    }

    if (selectedOption.isCustomEntry) {
      const normalizedRoleName = normalizeRoleName(roleName);
      const normalizedUserId = Number.isFinite(numericUserId) ? numericUserId : null;
      const matchedRoleId =
        normalizedRoleName && normalizedShiftRoleIdByName.has(normalizedRoleName)
          ? normalizedShiftRoleIdByName.get(normalizedRoleName) ?? null
          : null;
      if (
        normalizedUserId != null &&
        matchedRoleId != null &&
        !userHasShiftRole(normalizedUserId, { shiftRoleId: matchedRoleId, roleName })
      ) {
        setAssignmentError("This team member does not have the required shift role.");
        return;
      }
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
              const dropActive = dragHoverInstanceId === instance.id;
              const highlightStyles = getInstanceHighlightStyles(instance);
              return (
                <Tooltip
                  key={`pub-instance-${instance.id}`}
                  label={renderShiftTooltip(instance)}
                  position="right"
                  withArrow
                  multiline
                  withinPortal
                >
                  <Box
                    onDragOver={(event) => handleInstanceDragOver(event, instance.id)}
                    onDragLeave={(event) => handleInstanceDragLeave(event, instance.id)}
                    onDrop={(event) => handleDropOnShift(event, instance)}
                    style={{
                      width: "100%",
                      border: dropActive ? `1px dashed ${palette.plumDark}` : undefined,
                      borderRadius: dropActive ? 12 : undefined,
                      padding: dropActive ? "6px" : undefined,
                      backgroundColor: dropActive
                        ? "rgba(124, 77, 255, 0.08)"
                        : highlightStyles.backgroundColor ?? "transparent",
                      boxShadow: highlightStyles.boxShadow,
                      opacity: highlightStyles.opacity,
                      transition: "background-color 120ms ease, border-color 120ms ease",
                    }}
                  >
                    <Group justify="space-between" align="center" style={{ width: "100%" }}>
                      <Button
                        size="xs"
                        variant="light"
                        leftSection={<IconPlus size={14} />}
                        onClick={() => openAssignmentForShift(instance, { userId: selectedRosterUserId })}
                      >
                        {formatAssignButtonLabel(label)}
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
                  </Box>
                </Tooltip>
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
          const dropActive = dragHoverInstanceId === instance.id;
          const highlightStyles = getInstanceHighlightStyles(instance);

          return (
            <Tooltip
              key={`instance-${instance.id}`}
              label={renderShiftTooltip(instance)}
              position="right"
              withArrow
              multiline
              withinPortal
            >
              <Stack
                gap={10}
                style={{
                  width: "100%",
                  border: dropActive ? `1px dashed ${palette.plumDark}` : undefined,
                  borderRadius: dropActive ? 16 : undefined,
                  padding: dropActive ? "10px" : undefined,
                  backgroundColor: dropActive
                    ? "rgba(124, 77, 255, 0.08)"
                    : highlightStyles.backgroundColor ?? "transparent",
                  boxShadow: highlightStyles.boxShadow,
                  opacity: highlightStyles.opacity,
                  transition: "background-color 120ms ease, border-color 120ms ease",
                }}
                onDragOver={(event) => handleInstanceDragOver(event, instance.id)}
                onDragLeave={(event) => handleInstanceDragLeave(event, instance.id)}
                onDrop={(event) => handleDropOnShift(event, instance)}
              >
                <Stack gap={10} align="center" style={{ width: "100%" }}>
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
                  onClick={() => openAssignmentForShift(instance, { userId: selectedRosterUserId })}
                >
                  {formatAssignButtonLabel(null)}
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
            </Tooltip>
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
      minWidth: 0,
      overflow: "hidden",
      borderRadius: 20,
      backgroundColor: "#fff",
      boxShadow: palette.tableShadow,
    }}
  >
      <Box
        component="table"
        style={{
          width: "100%",
          maxWidth: "100%",
          minWidth: 0,
          tableLayout: "fixed",
          borderCollapse: "separate",
          borderSpacing: 0,
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

  const rosterPanel = (
    <Card
      withBorder
      shadow="md"
      radius="lg"
      padding="lg"
      style={{
        flex: `1 1 ${ROSTER_PANEL_WIDTH}px`,
        minWidth: 260,
        maxWidth: 420,
        height: PANEL_SCROLL_HEIGHT,
        backgroundColor: "#fff",
        borderColor: palette.border,
        position: "relative",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Stack gap="xs">
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <Stack gap={4} style={{ maxWidth: "260px" }}>
            <Text fw={700} size="lg" style={{ fontFamily: HEADER_FONT_STACK }}>
              Active team roster
            </Text>
            <Text size="sm" c="dimmed">
              Drag a card or click to select it, then choose a shift in the schedule.
            </Text>
            {selectedRosterUserName ? (
              <Badge color="teal" variant="light">
                Selected: {selectedRosterUserName}
              </Badge>
            ) : (
              <Text size="xs" c="dimmed">
                Tip: Selection stays active so you can click multiple spots in a row.
              </Text>
            )}
          </Stack>
          <Stack gap={6} align="flex-end">
            <Badge color="violet" variant="light">
              {staffCards.length} active
            </Badge>
            {selectedRosterUserName ? (
              <Button size="xs" variant="subtle" color="gray" onClick={clearRosterSelection}>
                Clear selection
              </Button>
            ) : null}
          </Stack>
        </Group>
      </Stack>
      <Box style={{ flex: 1, overflowY: "auto", marginTop: 12 }}>
        {staffCards.length ? (
          <Stack gap="sm">
            {staffCards.map((staffer) => {
              const styles = createUserCardStyles(staffer.color.background);
              const isDragging = staffer.userId != null && draggedUserId === staffer.userId;
              const isSelected = staffer.userId != null && staffer.userId === selectedRosterUserId;
              const borderColor = isSelected ? palette.plumDark : styles.container.borderColor;
              const borderWidth = isSelected ? 2 : styles.container.borderWidth;
              return (
                <Card
                  key={`staff-card-${staffer.key}`}
                  radius="lg"
                  withBorder
                  padding="md"
                  draggable={canModifyWeek}
                  onDragStart={(event) => handleUserCardDragStart(event, staffer.userId)}
                  onDragEnd={handleUserCardDragEnd}
                  onClick={() => handleRosterCardSelect(staffer.userId)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      handleRosterCardSelect(staffer.userId);
                    }
                  }}
                  tabIndex={0}
                  role="button"
                  aria-pressed={isSelected}
                  style={{
                    ...styles.container,
                    color: staffer.color.text,
                    cursor: canModifyWeek ? "grab" : "pointer",
                    opacity: isDragging ? 0.7 : 1,
                    width: "100%",
                    borderColor,
                    borderWidth,
                    outline: isSelected ? `2px solid ${palette.plumDark}` : "none",
                    boxShadow: isSelected ? `0 6px 18px rgba(82, 36, 199, 0.3)` : styles.container.boxShadow,
                  }}
                >
                  <Box style={styles.overlay} />
                  <Stack gap={8} align="flex-start" style={{ position: "relative", zIndex: 1 }}>
                    <Group justify="space-between" style={{ width: "100%" }} wrap="nowrap">
                      <Text style={{ ...userCardNameStyles, color: staffer.color.text }}>{staffer.name}</Text>
                      {isSelected ? (
                        <Badge color="teal" size="xs" variant="filled">
                          Selected
                        </Badge>
                      ) : null}
                    </Group>
                    <Text size="xs" style={{ fontFamily: HEADER_FONT_STACK }}>
                      {staffer.totalAssignments
                        ? `Assigned to ${staffer.totalAssignments} shift${
                            staffer.totalAssignments === 1 ? "" : "s"
                          }`
                        : "No assignments yet this week"}
                    </Text>
                      {staffer.shiftCounts.length ? (
                        <Group gap={6} wrap="wrap">
                          {staffer.shiftCounts.map((entry) => (
                            <Badge
                              key={`${staffer.key}-${entry.label}`}
                              variant="light"
                              color="indigo"
                              style={{ textTransform: "none" }}
                            >
                              {entry.label}: {entry.count}
                            </Badge>
                          ))}
                        </Group>
                      ) : null}
                      {daysOfWeek.length ? (
                        <Group gap={4} wrap="nowrap">
                          {daysOfWeek.map((day) => {
                            const isoDate = day.format("YYYY-MM-DD");
                            const dayMap =
                              staffer.userId != null ? availabilityStatusByUserId.get(staffer.userId) : undefined;
                            const hasEntries = staffer.userId != null && availabilityByUserId.has(staffer.userId);
                            const defaultStatus = getDefaultAvailability(staffer.userId) ? "available" : "unavailable";
                            const status = dayMap?.get(isoDate) ?? (hasEntries ? "unavailable" : defaultStatus);
                            const isAvailable = status === "available";
                            return (
                              <Badge
                                key={`${staffer.key}-${isoDate}`}
                                size="xs"
                                variant={isAvailable ? "filled" : "outline"}
                                color={isAvailable ? "teal" : "gray"}
                                style={{ minWidth: 26, textAlign: "center" }}
                              >
                                {day.format("dd")}
                              </Badge>
                            );
                          })}
                        </Group>
                      ) : null}
                    </Stack>
                  </Card>
                );
              })}
            </Stack>
        ) : (
          <Text size="sm" c="dimmed">
            Active staff will appear here once loaded.
          </Text>
        )}
      </Box>
    </Card>
  );

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
              disabled={loading || !canNavigateBackward}
            >
              Previous Week
            </Button>
            <Stack gap={4} align="center" style={{ flex: 1, minWidth: 0 }}>
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
              disabled={loading || !canNavigateForward}
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
              color="teal"
              onClick={handleOpenGenerateInstancesModal}
              disabled={!canModifyWeek || templateOptions.length === 0}
            >
              Generate shift instances
            </Button>
            <Button
              variant="white"
              color="red"
              onClick={() => setClearInstancesModalOpen(true)}
              disabled={!canModifyWeek || !hasWeek || shiftInstances.length === 0}
            >
              Clear week
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
      {generateInstancesMutation.isSuccess ? (
        <Alert color="green" title="Shift instances generated">
          <Text size="sm">
            Created {generateInstancesMutation.data?.created ?? 0} new shift
            {generateInstancesMutation.data?.created === 1 ? "" : "s"} from{" "}
            {generateInstancesMutation.data?.templateCount ?? 0} template
            {generateInstancesMutation.data?.templateCount === 1 ? "" : "s"}.
            {generateInstancesMutation.data && generateInstancesMutation.data.skipped > 0
              ? ` Skipped ${generateInstancesMutation.data.skipped} existing slot${
                  generateInstancesMutation.data.skipped === 1 ? "" : "s"
                }.`
              : null}
          </Text>
        </Alert>
      ) : null}
      {clearInstancesMutation.isSuccess ? (
        <Alert color="red" title="Week cleared">
          <Text size="sm">
            Deleted {clearInstancesMutation.data?.deletedInstances ?? 0} shift
            {clearInstancesMutation.data?.deletedInstances === 1 ? "" : "s"} and{" "}
            {clearInstancesMutation.data?.deletedAssignments ?? 0} assignment
            {clearInstancesMutation.data?.deletedAssignments === 1 ? "" : "s"} for this week.
          </Text>
        </Alert>
      ) : null}
      {loading ? (
        <Center py="xl">
          <Loader />
        </Center>
      ) : (
        <Group align="flex-start" gap="lg" wrap="wrap" style={{ width: "100%" }}>
          <Box style={{ flex: "2 1 600px", minWidth: 0 }}>
            {!hasWeek ? (
              <Alert color="yellow" variant="light" radius="md" title="Week not available">
                <Text size="sm">
                  Schedule data for {formatWeekValue(selectedWeek)} is not available yet. Generate the week to begin
                  assigning staff.
                </Text>
              </Alert>
            ) : (
              <Card
                withBorder
                shadow="xl"
                radius="lg"
                padding="xl"
                style={{
                  backgroundColor: palette.lavender,
                  borderColor: palette.border,
                  height: PANEL_SCROLL_HEIGHT,
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <Stack gap="md" style={{ height: "100%" }}>
                  <Text size="sm" c="dimmed">
                    {selectedRosterUserName
                      ? `Selected: ${selectedRosterUserName}. Click any Assign button or drop their card onto a shift.`
                      : "Tip: Select someone from the roster or drag them directly to a shift cell."}
                  </Text>
                  <Box style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>
                    <Stack gap="xl" style={{ width: "100%", minWidth: 0, paddingRight: 12 }}>
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
                  </Box>
                </Stack>
              </Card>
            )}
          </Box>
          {rosterPanel}
        </Group>
      )}

      <Modal
        opened={generateInstancesModalOpen}
        onClose={handleCloseGenerateInstancesModal}
        title="Generate shift instances"
      >
        <Stack>
          <Text size="sm">
            Select which templates should create shift instances for the week of {weekRangeLabel}. Existing instances for
            the same template and day will be left untouched.
          </Text>
          <MultiSelect
            data={templateOptions}
            value={generateTemplateSelection}
            onChange={setGenerateTemplateSelection}
            label="Shift templates"
            placeholder="Pick templates"
            searchable
            nothingFoundMessage="No templates"
            disabled={templateOptions.length === 0}
          />
          <Group justify="space-between">
            <Group gap="xs">
              <Button
                variant="light"
                size="xs"
                onClick={handleSelectAllTemplates}
                disabled={templateOptions.length === 0}
              >
                Select all
              </Button>
              <Button variant="subtle" size="xs" onClick={handleClearTemplateSelection}>
                Clear
              </Button>
            </Group>
            <Text size="xs" c="dimmed">
              {generateTemplateSelection.length} selected
            </Text>
          </Group>
          {generateInstancesMutation.isError ? (
            <Alert color="red" title="Unable to generate">
              <Text size="sm">
                {(
                  generateInstancesMutation.error as AxiosError<{ error?: string; message?: string }> | undefined
                )?.response?.data?.error ??
                  (generateInstancesMutation.error as Error).message}
              </Text>
            </Alert>
          ) : null}
          <Button
            onClick={handleGenerateInstancesSubmit}
            disabled={!weekId || generateTemplateSelection.length === 0}
            loading={generateInstancesMutation.isPending}
          >
            Generate selected templates
          </Button>
        </Stack>
      </Modal>

      <Modal
        opened={clearInstancesModalOpen}
        onClose={() => {
          if (!clearInstancesMutation.isPending) {
            setClearInstancesModalOpen(false);
          }
        }}
        title="Clear week schedule"
      >
        <Stack>
          <Alert color="red" title="This cannot be undone">
            <Text size="sm">
              This will delete all shift instances for {weekRangeLabel}, along with every assignment linked to them. You
              will need to regenerate or add shifts again.
            </Text>
          </Alert>
          {clearInstancesMutation.isError ? (
            <Alert color="red" title="Unable to clear schedule">
              <Text size="sm">
                {(
                  clearInstancesMutation.error as AxiosError<{ error?: string; message?: string }> | undefined
                )?.response?.data?.error ??
                  (clearInstancesMutation.error as Error).message}
              </Text>
            </Alert>
          ) : null}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setClearInstancesModalOpen(false)} disabled={clearInstancesMutation.isPending}>
              Cancel
            </Button>
            <Button color="red" loading={clearInstancesMutation.isPending} onClick={handleClearInstances}>
              Delete all shifts
            </Button>
          </Group>
        </Stack>
      </Modal>

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
              setAssignmentRequiresOverride(!isUserAvailableForShift(userId));
            }}
            searchable
            nothingFoundMessage={assignmentShowUnavailable ? "No staff found" : "No staff available"}
          />
          {unavailableOptionCount > 0 ? (
            <Switch
              label="Show unavailable staff (override required)"
              checked={assignmentShowUnavailable}
              onChange={(event) => setAssignmentShowUnavailable(event.currentTarget.checked)}
              size="sm"
            />
          ) : null}
          <Select
            data={applicableAssignmentRoleOptions.map((option) => ({
              value: option.value,
              label: option.label,
            }))}
            label="Role"
            placeholder="Select role"
            value={assignmentRoleOption?.value ?? null}
            onChange={(value) => {
              const option = applicableAssignmentRoleOptions.find((candidate) => candidate.value === value) ?? null;
              setAssignmentRoleOption(option);
              if (option?.isCustomEntry) {
                setAssignmentCustomRoleName("");
              } else if (option?.roleName) {
                setAssignmentCustomRoleName(option.roleName);
              }
            }}
            searchable
            nothingFoundMessage="No roles"
            disabled={applicableAssignmentRoleOptions.length === 0}
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
