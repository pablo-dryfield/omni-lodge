import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Center,
  Divider,
  Group,
  Loader,
  NumberInput,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Textarea,
  Title,
} from "@mantine/core";
import { IconAlertTriangle, IconCheck, IconMap2, IconRoute, IconSend, IconUsersGroup } from "@tabler/icons-react";
import dayjs from "dayjs";
import isoWeek from "dayjs/plugin/isoWeek";
import type { AxiosError } from "axios";
import WeekSelector from "../../components/scheduling/WeekSelector";
import {
  formatScheduleWeekLabel,
  getUpcomingWeeks,
  useEnsureWeek,
  useShiftInstances,
} from "../../api/scheduling";
import {
  useAssignPromotionTeamRoute,
  useCreatePromotionRoutePlan,
  useCreatePromotionRouteVersion,
  usePromotionManagerSessions,
  usePromotionRoutePlans,
  usePromotionSessionPlayback,
  usePromotionTeamAssignments,
  usePublishPromotionRouteVersion,
  type CreatePromotionRouteVersionPayload,
  type PromotionCoordinate,
  type PromotionLifecycle,
  type PromotionRouteVersion,
  type PromotionTeamAssignment,
} from "../../api/promotionTracking";
import type { ShiftAssignment, ShiftInstance } from "../../types/scheduling";
import { makeSelectIsModuleActionAllowed } from "../../selectors/accessControlSelectors";
import { useAppSelector } from "../../store/hooks";
import PromotionRouteMapEditor, {
  type PromotionMapCheckpoint,
  type PromotionMapHostel,
  type PromotionMapPoint,
  type PromotionRouteMapTool,
} from "./PromotionRouteMapEditor";
import PromotionSessionPlaybackMap from "./PromotionSessionPlaybackMap";

dayjs.extend(isoWeek);

const MODULE_SLUG = "scheduling-promotion-routes";
const HOSTELS = ["Atlantis Hostel", "Bubble Hostel", "Draggo House"] as const;

type HostelForm = {
  finishLatitude: string;
  finishLongitude: string;
  radiusMeters: string;
  polyline: string;
};

type RouteForm = {
  planName: string;
  planDescription: string;
  routePlanId: string | null;
  routeName: string;
  startLabel: string;
  startLatitude: string;
  startLongitude: string;
  startRadiusMeters: string;
  streetPolyline: string;
  streetCheckpoints: string;
  maxHorizontalAccuracyMeters: string;
  startDwellSeconds: string;
  checkpointDwellSeconds: string;
  finishDwellSeconds: string;
  consecutiveFixesRequired: string;
  preShiftCheckInWindowMinutes: string;
  streetExpectedDurationMinutes: string;
  hostelExpectedDurationMinutes: string;
  reminderOffsetsMinutes: string;
  requiredParticipantProof: "self" | "all_assigned";
  hostels: Record<string, HostelForm>;
};

const defaultWeekValue = () => {
  const now = dayjs();
  return `${now.isoWeekYear()}-W${now.isoWeek().toString().padStart(2, "0")}`;
};

const makeInitialHostelForms = (): Record<string, HostelForm> =>
  Object.fromEntries(
    HOSTELS.map((hostel) => [
      hostel,
      {
        finishLatitude: "",
        finishLongitude: "",
        radiusMeters: "40",
        polyline: "",
      },
    ]),
  );

const initialForm = (): RouteForm => ({
  planName: "Promotion Street Route",
  planDescription: "Shared street promotion route with per-person hostel finishes.",
  routePlanId: null,
  routeName: "Main Promotion Route",
  startLabel: "Promotion starting point",
  startLatitude: "",
  startLongitude: "",
  startRadiusMeters: "40",
  streetPolyline: "",
  streetCheckpoints: "",
  maxHorizontalAccuracyMeters: "30",
  startDwellSeconds: "15",
  checkpointDwellSeconds: "15",
  finishDwellSeconds: "15",
  consecutiveFixesRequired: "2",
  preShiftCheckInWindowMinutes: "30",
  streetExpectedDurationMinutes: "60",
  hostelExpectedDurationMinutes: "30",
  reminderOffsetsMinutes: "30,10",
  requiredParticipantProof: "all_assigned",
  hostels: makeInitialHostelForms(),
});

const staffName = (assignment: ShiftAssignment) => {
  const assignee = assignment.assignee;
  const name = [assignee?.firstName, assignee?.lastName].filter(Boolean).join(" ").trim();
  return name || `User #${assignment.userId}`;
};

const isPromotionShift = (shift: ShiftInstance) => {
  const key = shift.shiftType?.key?.toLowerCase() ?? "";
  const name = shift.shiftType?.name?.toLowerCase() ?? "";
  return key.includes("promotion") || key.includes("promo") || name.includes("promotion") || name.includes("promo");
};

const parseNumber = (value: string, label: string) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be a valid number.`);
  }
  return parsed;
};

const parsePositiveNumber = (value: string, label: string) => {
  const parsed = parseNumber(value, label);
  if (parsed <= 0) {
    throw new Error(`${label} must be greater than zero.`);
  }
  return parsed;
};

const coordinate = (latitude: string, longitude: string, latitudeLabel: string, longitudeLabel: string): PromotionCoordinate => ({
  latitude: parseNumber(latitude, latitudeLabel),
  longitude: parseNumber(longitude, longitudeLabel),
});

const parsePolyline = (value: string): PromotionCoordinate[] =>
  value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const parts = line.split(/[,\s]+/u).map((part) => part.trim()).filter(Boolean);
      if (parts.length < 2) {
        throw new Error(`Polyline line ${index + 1} must contain latitude and longitude.`);
      }
      return {
        latitude: parseNumber(parts[0], `Polyline line ${index + 1} latitude`),
        longitude: parseNumber(parts[1], `Polyline line ${index + 1} longitude`),
      };
    });

const parseCheckpointRows = (value: string, defaultDwellSeconds: number) =>
  value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const parts = line.split("|").map((part) => part.trim());
      if (parts.length < 4) {
        throw new Error(`Checkpoint line ${index + 1} must use: Label | latitude | longitude | radius | instruction.`);
      }
      return {
        label: parts[0] || `Checkpoint ${index + 1}`,
        latitude: parseNumber(parts[1], `Checkpoint ${index + 1} latitude`),
        longitude: parseNumber(parts[2], `Checkpoint ${index + 1} longitude`),
        radiusMeters: parsePositiveNumber(parts[3], `Checkpoint ${index + 1} radius`),
        instruction: parts[4] ?? "",
        requiredDwellSeconds: defaultDwellSeconds,
      };
    });

const coordinateText = (value: number) => value.toFixed(6);

const serializePolyline = (coordinates: PromotionCoordinate[]) =>
  coordinates
    .map((coordinate) => `${coordinateText(coordinate.latitude)},${coordinateText(coordinate.longitude)}`)
    .join("\n");

const serializeCheckpointRows = (checkpoints: PromotionMapCheckpoint[]) =>
  checkpoints
    .map((checkpoint) =>
      [
        checkpoint.label,
        coordinateText(checkpoint.latitude),
        coordinateText(checkpoint.longitude),
        checkpoint.radiusMeters,
        checkpoint.instruction ?? "",
      ].join(" | "),
    )
    .join("\n");

const parsePositiveNumberOrFallback = (value: string, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const safeParsePolyline = (value: string): PromotionCoordinate[] => {
  try {
    return parsePolyline(value);
  } catch {
    return [];
  }
};

const safeParseCheckpointRows = (value: string, defaultDwellSeconds: number): PromotionMapCheckpoint[] => {
  try {
    return parseCheckpointRows(value, defaultDwellSeconds);
  } catch {
    return [];
  }
};

const safePoint = (
  latitude: string,
  longitude: string,
  radiusMeters: string,
  label?: string,
): PromotionMapPoint | null => {
  const parsedLatitude = Number(latitude);
  const parsedLongitude = Number(longitude);
  if (!Number.isFinite(parsedLatitude) || !Number.isFinite(parsedLongitude)) return null;
  return {
    latitude: parsedLatitude,
    longitude: parsedLongitude,
    radiusMeters: parsePositiveNumberOrFallback(radiusMeters, 40),
    label,
  };
};

const errorMessage = (error: unknown) => {
  const axiosError = error as AxiosError<{ error?: string; message?: string }>;
  return axiosError.response?.data?.error ?? axiosError.response?.data?.message ?? (error as Error).message;
};

const routeVersionLabel = (version: PromotionRouteVersion) =>
  `${version.routeName} v${version.versionNumber}${version.status === "published" ? " · published" : " · draft"}`;

const lifecycleLabel = (lifecycle: string) =>
  lifecycle
    .toLowerCase()
    .replace(/_/gu, " ")
    .replace(/(^|\s)\S/gu, (match) => match.toUpperCase());

const lifecycleColor = (lifecycle: string) => {
  if (lifecycle === "COMPLETED") return "green";
  if (lifecycle === "ABORTED") return "red";
  if (lifecycle === "STREET_ACTIVE" || lifecycle === "HOSTEL_ACTIVE") return "blue";
  return "gray";
};

const qualityColor = (quality: string | null | undefined) => {
  if (quality === "VERIFIED") return "green";
  if (quality === "DEGRADED") return "yellow";
  if (quality === "REVIEW_REQUIRED") return "orange";
  return "gray";
};

const formatPlaybackTime = (value: string | null | undefined) => {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf())) return "—";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const routePreview = (version: PromotionRouteVersion) => (
  <Paper withBorder radius="md" p="md" bg="#F8FAFC">
    <Stack gap={8}>
      <Group justify="space-between" gap="xs">
        <Text fw={700}>{routeVersionLabel(version)}</Text>
        <Badge color={version.status === "published" ? "green" : "yellow"}>{version.status}</Badge>
      </Group>
      <Text size="sm" c="dimmed">
        Start: {version.start.label} · {version.start.radiusMeters}m radius
      </Text>
      <Text size="sm" c="dimmed">
        Street checkpoints: {version.streetCheckpoints.length} · hostel options: {version.hostelRoutes.length}
      </Text>
      <Group gap="xs">
        {version.hostelRoutes.map((hostel) => (
          <Badge key={hostel.hostelName} variant="light" color="indigo">
            {hostel.hostelName}
          </Badge>
        ))}
      </Group>
    </Stack>
  </Paper>
);

const PromotionRoutesPage = () => {
  const canView = useAppSelector(useMemo(() => makeSelectIsModuleActionAllowed(MODULE_SLUG, "view"), []));
  const canCreate = useAppSelector(useMemo(() => makeSelectIsModuleActionAllowed(MODULE_SLUG, "create"), []));
  const [weekValue, setWeekValue] = useState(defaultWeekValue());
  const [form, setForm] = useState<RouteForm>(initialForm);
  const [selectedPublishedRouteVersionId, setSelectedPublishedRouteVersionId] = useState<string | null>(null);
  const [hostelSelectionByAssignmentId, setHostelSelectionByAssignmentId] = useState<Record<string, string>>({});
  const [activeMapTool, setActiveMapTool] = useState<PromotionRouteMapTool>("pan");
  const [playbackLifecycleFilter, setPlaybackLifecycleFilter] = useState<PromotionLifecycle | "ALL">("COMPLETED");
  const [selectedPlaybackSessionId, setSelectedPlaybackSessionId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const weekLookup = useEnsureWeek(weekValue, { allowGenerate: false });
  const weekId = weekLookup.data?.week?.id ?? null;
  const shiftsQuery = useShiftInstances(weekId);
  const routePlansQuery = usePromotionRoutePlans();
  const teamAssignmentsQuery = usePromotionTeamAssignments(weekId);
  const managerSessionsQuery = usePromotionManagerSessions(playbackLifecycleFilter === "ALL" ? null : playbackLifecycleFilter);
  const playbackQuery = usePromotionSessionPlayback(selectedPlaybackSessionId);
  const createPlan = useCreatePromotionRoutePlan();
  const createVersion = useCreatePromotionRouteVersion();
  const publishVersion = usePublishPromotionRouteVersion();
  const assignRoute = useAssignPromotionTeamRoute();

  const routePlans = routePlansQuery.data?.routePlans ?? [];
  const allVersions = routePlans.flatMap((plan) => plan.routeVersions);
  const publishedVersions = allVersions.filter((version) => version.status === "published");
  const selectedPublishedVersion = publishedVersions.find((version) => version.routeVersionId === selectedPublishedRouteVersionId)
    ?? publishedVersions[0]
    ?? null;
  const managerSessions = useMemo(
    () => managerSessionsQuery.data?.sessions ?? [],
    [managerSessionsQuery.data?.sessions],
  );
  const selectedPlaybackSession = managerSessions.find((session) => session.sessionId === selectedPlaybackSessionId) ?? null;
  const playbackSessionOptions = managerSessions.map((session) => {
    const participants = session.participants.map((participant) => participant.displayName).join(", ") || `Assignment #${session.assignmentId}`;
    const startedAt = session.streetStartedAtUtc ?? session.hostelStartedAtUtc ?? session.completedAtUtc ?? session.abortedAtUtc;
    return {
      value: session.sessionId,
      label: `#${session.sessionId} · ${lifecycleLabel(session.lifecycle)} · ${formatPlaybackTime(startedAt)} · ${participants}`,
    };
  });

  useEffect(() => {
    if (managerSessions.length === 0) {
      if (selectedPlaybackSessionId !== null) setSelectedPlaybackSessionId(null);
      return;
    }
    if (!selectedPlaybackSessionId || !managerSessions.some((session) => session.sessionId === selectedPlaybackSessionId)) {
      setSelectedPlaybackSessionId(managerSessions[0].sessionId);
    }
  }, [managerSessions, selectedPlaybackSessionId]);

  const promotionShifts = useMemo(
    () => (shiftsQuery.data ?? []).filter(isPromotionShift),
    [shiftsQuery.data],
  );

  const teamAssignments = teamAssignmentsQuery.data?.teamAssignments;
  const teamAssignmentByShiftAssignmentId = useMemo(() => {
    const map = new Map<string, PromotionTeamAssignment>();
    (teamAssignments ?? []).forEach((assignment) => {
      if (assignment.shiftAssignmentId) {
        map.set(assignment.shiftAssignmentId, assignment);
      }
    });
    return map;
  }, [teamAssignments]);

  const routePlanOptions = routePlans.map((plan) => ({
    value: plan.routePlanId,
    label: `${plan.name} (${plan.routeVersions.length} version${plan.routeVersions.length === 1 ? "" : "s"})`,
  }));
  const publishedRouteOptions = publishedVersions.map((version) => ({
    value: version.routeVersionId,
    label: routeVersionLabel(version),
  }));
  const weekOptions = getUpcomingWeeks(12).map((week) => ({
    value: week.value,
    label: formatScheduleWeekLabel(week.year, week.week),
  }));
  const mapStartPoint = useMemo(
    () => safePoint(form.startLatitude, form.startLongitude, form.startRadiusMeters, form.startLabel.trim() || "Promotion starting point"),
    [form.startLabel, form.startLatitude, form.startLongitude, form.startRadiusMeters],
  );
  const mapStreetPolyline = useMemo(() => safeParsePolyline(form.streetPolyline), [form.streetPolyline]);
  const mapStreetCheckpoints = useMemo(
    () => safeParseCheckpointRows(
      form.streetCheckpoints,
      Math.floor(parsePositiveNumberOrFallback(form.checkpointDwellSeconds, 15)),
    ),
    [form.checkpointDwellSeconds, form.streetCheckpoints],
  );
  const mapHostels = useMemo<PromotionMapHostel[]>(
    () => HOSTELS.map((hostel) => ({
      hostelName: hostel,
      finish: safePoint(
        form.hostels[hostel].finishLatitude,
        form.hostels[hostel].finishLongitude,
        form.hostels[hostel].radiusMeters,
        `${hostel} finish`,
      ),
      polyline: safeParsePolyline(form.hostels[hostel].polyline),
    })),
    [form.hostels],
  );

  const updateHostel = (hostel: string, patch: Partial<HostelForm>) => {
    setForm((current) => ({
      ...current,
      hostels: {
        ...current.hostels,
        [hostel]: {
          ...current.hostels[hostel],
          ...patch,
        },
      },
    }));
  };

  const moveStartOnMap = (coordinateValue: PromotionCoordinate) => {
    setForm((current) => ({
      ...current,
      startLatitude: coordinateText(coordinateValue.latitude),
      startLongitude: coordinateText(coordinateValue.longitude),
    }));
  };

  const addStreetCheckpointOnMap = (coordinateValue: PromotionCoordinate) => {
    setForm((current) => {
      const defaultDwellSeconds = Math.floor(parsePositiveNumberOrFallback(current.checkpointDwellSeconds, 15));
      const checkpoints = safeParseCheckpointRows(current.streetCheckpoints, defaultDwellSeconds);
      const nextCheckpointNumber = checkpoints.length + 1;
      const nextCheckpoints = [
        ...checkpoints,
        {
          label: `Checkpoint ${nextCheckpointNumber}`,
          latitude: coordinateValue.latitude,
          longitude: coordinateValue.longitude,
          radiusMeters: 40,
          instruction: "",
          requiredDwellSeconds: defaultDwellSeconds,
        },
      ];
      return {
        ...current,
        streetCheckpoints: serializeCheckpointRows(nextCheckpoints),
      };
    });
  };

  const moveStreetCheckpointOnMap = (index: number, coordinateValue: PromotionCoordinate) => {
    setForm((current) => {
      const checkpoints = safeParseCheckpointRows(
        current.streetCheckpoints,
        Math.floor(parsePositiveNumberOrFallback(current.checkpointDwellSeconds, 15)),
      );
      const nextCheckpoints = checkpoints.map((checkpoint, checkpointIndex) =>
        checkpointIndex === index
          ? { ...checkpoint, latitude: coordinateValue.latitude, longitude: coordinateValue.longitude }
          : checkpoint,
      );
      return {
        ...current,
        streetCheckpoints: serializeCheckpointRows(nextCheckpoints),
      };
    });
  };

  const addStreetPolylineOnMap = (coordinateValue: PromotionCoordinate) => {
    setForm((current) => ({
      ...current,
      streetPolyline: serializePolyline([...safeParsePolyline(current.streetPolyline), coordinateValue]),
    }));
  };

  const moveStreetPolylineOnMap = (index: number, coordinateValue: PromotionCoordinate) => {
    setForm((current) => {
      const routeLine = safeParsePolyline(current.streetPolyline);
      const nextRouteLine = routeLine.map((coordinateItem, coordinateIndex) =>
        coordinateIndex === index ? coordinateValue : coordinateItem,
      );
      return {
        ...current,
        streetPolyline: serializePolyline(nextRouteLine),
      };
    });
  };

  const clearStreetPolylineOnMap = () => {
    setForm((current) => ({ ...current, streetPolyline: "" }));
  };

  const moveHostelFinishOnMap = (hostelName: string, coordinateValue: PromotionCoordinate) => {
    setForm((current) => {
      const currentHostel = current.hostels[hostelName] ?? {
        finishLatitude: "",
        finishLongitude: "",
        radiusMeters: "40",
        polyline: "",
      };
      return {
        ...current,
        hostels: {
          ...current.hostels,
          [hostelName]: {
            ...currentHostel,
            finishLatitude: coordinateText(coordinateValue.latitude),
            finishLongitude: coordinateText(coordinateValue.longitude),
          },
        },
      };
    });
  };

  const addHostelPolylineOnMap = (hostelName: string, coordinateValue: PromotionCoordinate) => {
    setForm((current) => {
      const currentHostel = current.hostels[hostelName] ?? {
        finishLatitude: "",
        finishLongitude: "",
        radiusMeters: "40",
        polyline: "",
      };
      return {
        ...current,
        hostels: {
          ...current.hostels,
          [hostelName]: {
            ...currentHostel,
            polyline: serializePolyline([...safeParsePolyline(currentHostel.polyline), coordinateValue]),
          },
        },
      };
    });
  };

  const moveHostelPolylineOnMap = (hostelName: string, index: number, coordinateValue: PromotionCoordinate) => {
    setForm((current) => {
      const currentHostel = current.hostels[hostelName] ?? {
        finishLatitude: "",
        finishLongitude: "",
        radiusMeters: "40",
        polyline: "",
      };
      const routeLine = safeParsePolyline(currentHostel.polyline);
      const nextRouteLine = routeLine.map((coordinateItem, coordinateIndex) =>
        coordinateIndex === index ? coordinateValue : coordinateItem,
      );
      return {
        ...current,
        hostels: {
          ...current.hostels,
          [hostelName]: {
            ...currentHostel,
            polyline: serializePolyline(nextRouteLine),
          },
        },
      };
    });
  };

  const clearHostelPolylineOnMap = (hostelName: string) => {
    setForm((current) => {
      const currentHostel = current.hostels[hostelName] ?? {
        finishLatitude: "",
        finishLongitude: "",
        radiusMeters: "40",
        polyline: "",
      };
      return {
        ...current,
        hostels: {
          ...current.hostels,
          [hostelName]: {
            ...currentHostel,
            polyline: "",
          },
        },
      };
    });
  };

  const buildRoutePayload = (): CreatePromotionRouteVersionPayload => {
    const start = {
      label: form.startLabel.trim() || "Promotion starting point",
      ...coordinate(form.startLatitude, form.startLongitude, "Start latitude", "Start longitude"),
      radiusMeters: parsePositiveNumber(form.startRadiusMeters, "Start radius"),
    };
    const checkpointDwellSeconds = Math.floor(parsePositiveNumber(form.checkpointDwellSeconds, "Checkpoint dwell seconds"));
    const streetCheckpoints = parseCheckpointRows(form.streetCheckpoints, checkpointDwellSeconds);
    if (!streetCheckpoints.length) {
      throw new Error("Add at least one street checkpoint before publishing a route.");
    }
    const parsedStreetPolyline = parsePolyline(form.streetPolyline);
    const streetPolyline = parsedStreetPolyline.length
      ? parsedStreetPolyline
      : [start, ...streetCheckpoints.map((checkpoint) => ({ latitude: checkpoint.latitude, longitude: checkpoint.longitude }))];

    const hostelRoutes = HOSTELS.map((hostel) => {
      const hostelForm = form.hostels[hostel];
      const finishCoordinate = coordinate(
        hostelForm.finishLatitude,
        hostelForm.finishLongitude,
        `${hostel} finish latitude`,
        `${hostel} finish longitude`,
      );
      return {
        hostelName: hostel,
        finishLabel: `${hostel} finish`,
        finish: {
          ...finishCoordinate,
          radiusMeters: parsePositiveNumber(hostelForm.radiusMeters, `${hostel} finish radius`),
        },
        polyline: parsePolyline(hostelForm.polyline),
      };
    });

    return {
      routeName: form.routeName.trim() || "Promotion route",
      start,
      finish: hostelRoutes[0].finish,
      streetPolyline,
      streetCheckpoints,
      hostelPolyline: [],
      hostelCheckpoints: [],
      policy: {
        maxHorizontalAccuracyMeters: parsePositiveNumber(form.maxHorizontalAccuracyMeters, "Max GPS accuracy"),
        startDwellSeconds: Math.floor(parsePositiveNumber(form.startDwellSeconds, "Start dwell seconds")),
        checkpointDwellSeconds,
        finishDwellSeconds: Math.floor(parsePositiveNumber(form.finishDwellSeconds, "Finish dwell seconds")),
        consecutiveFixesRequired: Math.floor(parsePositiveNumber(form.consecutiveFixesRequired, "Consecutive fixes")),
        reminderOffsetsMinutes: form.reminderOffsetsMinutes
          .split(",")
          .map((item) => Number(item.trim()))
          .filter((item) => Number.isFinite(item) && item >= 0),
        preShiftCheckInWindowMinutes: Math.floor(parsePositiveNumber(form.preShiftCheckInWindowMinutes, "Pre-shift window")),
        streetExpectedDurationMinutes: Math.floor(parsePositiveNumber(form.streetExpectedDurationMinutes, "Street expected duration")),
        hostelExpectedDurationMinutes: Math.floor(parsePositiveNumber(form.hostelExpectedDurationMinutes, "Hostel expected duration")),
        requiredParticipantProof: form.requiredParticipantProof,
        participantProofMaxAgeSeconds: 120,
        participantProofMaxDistanceMeters: 60,
        hostelRoutes,
      },
    };
  };

  const saveRouteVersion = async () => {
    setFormError(null);
    setNotice(null);
    try {
      const payload = buildRoutePayload();
      let routePlanId = form.routePlanId;
      if (!routePlanId) {
        const result = await createPlan.mutateAsync({
          name: form.planName.trim() || "Promotion Street Route",
          description: form.planDescription.trim() || null,
        });
        routePlanId = String(result.routePlan.id);
        setForm((current) => ({ ...current, routePlanId }));
      }
      await createVersion.mutateAsync({ routePlanId, payload });
      setNotice("Route version saved as a draft. Publish it before assigning it to shifts.");
    } catch (error) {
      setFormError(errorMessage(error));
    }
  };

  const assignStaffRoute = async (input: {
    shift: ShiftInstance;
    assignment: ShiftAssignment;
    hostelLabel: string | null;
  }) => {
    if (!selectedPublishedVersion) {
      setFormError("Select a published route version first.");
      return;
    }
    setFormError(null);
    setNotice(null);
    try {
      await assignRoute.mutateAsync({
        shiftInstanceId: input.shift.id,
        shiftAssignmentId: input.assignment.id,
        routeVersionId: Number(selectedPublishedVersion.routeVersionId),
        teamKey: `assignment-${input.assignment.id}`,
        hostelLabel: input.hostelLabel,
        notes: input.hostelLabel
          ? `Assigned from Promotion Routes UI to ${input.hostelLabel}.`
          : "Assigned from Promotion Routes UI with deterministic random hostel.",
      });
      setNotice(`${staffName(input.assignment)} assigned to ${input.hostelLabel ?? "a random hostel"}.`);
    } catch (error) {
      setFormError(errorMessage(error));
    }
  };

  if (!canView) {
    return (
      <Card withBorder shadow="sm" radius="md" mt="md">
        <Alert color="yellow" title="No access" icon={<IconAlertTriangle size={18} />}>
          You do not have permission to manage Promotion Helper routes.
        </Alert>
      </Card>
    );
  }

  const loading = routePlansQuery.isLoading || weekLookup.isLoading || shiftsQuery.isLoading || teamAssignmentsQuery.isLoading;

  return (
    <Stack gap="lg" mt="md">
      <Card withBorder shadow="sm" radius="lg" p="lg">
        <Group justify="space-between" align="flex-start">
          <Stack gap={4}>
            <Group gap="xs">
              <IconMap2 size={24} />
              <Title order={2}>Promotion Routes</Title>
            </Group>
            <Text c="dimmed">
              Configure one shared street-promotion route, then assign each scheduled promotion person to a hostel leg.
            </Text>
          </Stack>
          <Badge color="blue" variant="light" size="lg">
            Shared street route · per-person hostel
          </Badge>
        </Group>
      </Card>

      {notice && (
        <Alert color="green" icon={<IconCheck size={18} />} title="Saved">
          {notice}
        </Alert>
      )}
      {formError && (
        <Alert color="red" icon={<IconAlertTriangle size={18} />} title="Promotion route error">
          {formError}
        </Alert>
      )}

      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="lg">
        <Card withBorder shadow="sm" radius="lg" p="lg">
          <Stack gap="md">
            <Group gap="xs">
              <IconRoute size={22} />
              <Title order={3}>Route setup</Title>
            </Group>
            <Text size="sm" c="dimmed">
              Coordinates are saved on the server as an immutable route version. Editing later creates a new version.
            </Text>
            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              <TextInput
                label="New plan name"
                value={form.planName}
                onChange={(event) => setForm({ ...form, planName: event.currentTarget.value })}
                disabled={!canCreate}
              />
              <Select
                label="Or add version to existing plan"
                placeholder="Create new route plan"
                data={routePlanOptions}
                value={form.routePlanId}
                onChange={(value) => setForm({ ...form, routePlanId: value })}
                clearable
                searchable
                disabled={!canCreate}
              />
            </SimpleGrid>
            <Textarea
              label="Plan description"
              value={form.planDescription}
              onChange={(event) => setForm({ ...form, planDescription: event.currentTarget.value })}
              disabled={!canCreate}
            />
            <TextInput
              label="Route version name"
              value={form.routeName}
              onChange={(event) => setForm({ ...form, routeName: event.currentTarget.value })}
              disabled={!canCreate}
            />

            <PromotionRouteMapEditor
              start={mapStartPoint}
              streetPolyline={mapStreetPolyline}
              streetCheckpoints={mapStreetCheckpoints}
              hostels={mapHostels}
              activeTool={activeMapTool}
              onActiveToolChange={setActiveMapTool}
              onStartMove={moveStartOnMap}
              onStreetCheckpointAdd={addStreetCheckpointOnMap}
              onStreetCheckpointMove={moveStreetCheckpointOnMap}
              onStreetPolylineAdd={addStreetPolylineOnMap}
              onStreetPolylineMove={moveStreetPolylineOnMap}
              onStreetPolylineClear={clearStreetPolylineOnMap}
              onHostelFinishMove={moveHostelFinishOnMap}
              onHostelPolylineAdd={addHostelPolylineOnMap}
              onHostelPolylineMove={moveHostelPolylineOnMap}
              onHostelPolylineClear={clearHostelPolylineOnMap}
            />

            <Divider label="Start point" labelPosition="center" />
            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              <TextInput label="Start label" value={form.startLabel} onChange={(event) => setForm({ ...form, startLabel: event.currentTarget.value })} disabled={!canCreate} />
              <NumberInput label="Start radius metres" value={form.startRadiusMeters} onChange={(value) => setForm({ ...form, startRadiusMeters: String(value ?? "") })} disabled={!canCreate} />
              <TextInput label="Start latitude" value={form.startLatitude} onChange={(event) => setForm({ ...form, startLatitude: event.currentTarget.value })} disabled={!canCreate} />
              <TextInput label="Start longitude" value={form.startLongitude} onChange={(event) => setForm({ ...form, startLongitude: event.currentTarget.value })} disabled={!canCreate} />
            </SimpleGrid>

            <Textarea
              label="Street polyline"
              description="One coordinate per line: latitude,longitude. If left empty, the start and checkpoints form the sketch."
              minRows={4}
              value={form.streetPolyline}
              onChange={(event) => setForm({ ...form, streetPolyline: event.currentTarget.value })}
              disabled={!canCreate}
            />
            <Textarea
              label="Street checkpoints"
              description="One per line: Label | latitude | longitude | radius metres | instruction"
              minRows={5}
              value={form.streetCheckpoints}
              onChange={(event) => setForm({ ...form, streetCheckpoints: event.currentTarget.value })}
              disabled={!canCreate}
            />

            <Divider label="Policy" labelPosition="center" />
            <SimpleGrid cols={{ base: 1, sm: 3 }}>
              <NumberInput label="Max accuracy m" value={form.maxHorizontalAccuracyMeters} onChange={(value) => setForm({ ...form, maxHorizontalAccuracyMeters: String(value ?? "") })} disabled={!canCreate} />
              <NumberInput label="Start dwell sec" value={form.startDwellSeconds} onChange={(value) => setForm({ ...form, startDwellSeconds: String(value ?? "") })} disabled={!canCreate} />
              <NumberInput label="Checkpoint dwell sec" value={form.checkpointDwellSeconds} onChange={(value) => setForm({ ...form, checkpointDwellSeconds: String(value ?? "") })} disabled={!canCreate} />
              <NumberInput label="Finish dwell sec" value={form.finishDwellSeconds} onChange={(value) => setForm({ ...form, finishDwellSeconds: String(value ?? "") })} disabled={!canCreate} />
              <NumberInput label="Consecutive fixes" value={form.consecutiveFixesRequired} onChange={(value) => setForm({ ...form, consecutiveFixesRequired: String(value ?? "") })} disabled={!canCreate} />
              <NumberInput label="Pre-shift window min" value={form.preShiftCheckInWindowMinutes} onChange={(value) => setForm({ ...form, preShiftCheckInWindowMinutes: String(value ?? "") })} disabled={!canCreate} />
              <NumberInput label="Street target min" value={form.streetExpectedDurationMinutes} onChange={(value) => setForm({ ...form, streetExpectedDurationMinutes: String(value ?? "") })} disabled={!canCreate} />
              <NumberInput label="Hostel target min" value={form.hostelExpectedDurationMinutes} onChange={(value) => setForm({ ...form, hostelExpectedDurationMinutes: String(value ?? "") })} disabled={!canCreate} />
              <TextInput label="Reminder mins" value={form.reminderOffsetsMinutes} onChange={(event) => setForm({ ...form, reminderOffsetsMinutes: event.currentTarget.value })} disabled={!canCreate} />
            </SimpleGrid>
            <Select
              label="Participant proof"
              data={[
                { value: "all_assigned", label: "All assigned / group photo fallback" },
                { value: "self", label: "Starter only" },
              ]}
              value={form.requiredParticipantProof}
              onChange={(value) => setForm({ ...form, requiredParticipantProof: value === "self" ? "self" : "all_assigned" })}
              allowDeselect={false}
              disabled={!canCreate}
            />

            <Divider label="Hostel legs" labelPosition="center" />
            {HOSTELS.map((hostel) => (
              <Paper key={hostel} withBorder radius="md" p="md">
                <Stack gap="sm">
                  <Text fw={700}>{hostel}</Text>
                  <SimpleGrid cols={{ base: 1, sm: 3 }}>
                    <TextInput label="Finish latitude" value={form.hostels[hostel].finishLatitude} onChange={(event) => updateHostel(hostel, { finishLatitude: event.currentTarget.value })} disabled={!canCreate} />
                    <TextInput label="Finish longitude" value={form.hostels[hostel].finishLongitude} onChange={(event) => updateHostel(hostel, { finishLongitude: event.currentTarget.value })} disabled={!canCreate} />
                    <NumberInput label="Finish radius m" value={form.hostels[hostel].radiusMeters} onChange={(value) => updateHostel(hostel, { radiusMeters: String(value ?? "") })} disabled={!canCreate} />
                  </SimpleGrid>
                  <Textarea
                    label="Hostel route polyline"
                    description="Optional. One coordinate per line: latitude,longitude."
                    minRows={3}
                    value={form.hostels[hostel].polyline}
                    onChange={(event) => updateHostel(hostel, { polyline: event.currentTarget.value })}
                    disabled={!canCreate}
                  />
                </Stack>
              </Paper>
            ))}

            <Button
              leftSection={<IconSend size={18} />}
              onClick={() => void saveRouteVersion()}
              loading={createPlan.isPending || createVersion.isPending}
              disabled={!canCreate}
            >
              Save route version draft
            </Button>
          </Stack>
        </Card>

        <Card withBorder shadow="sm" radius="lg" p="lg">
          <Stack gap="md">
            <Title order={3}>Published routes</Title>
            {routePlansQuery.isLoading ? (
              <Center mih={180}><Loader variant="dots" /></Center>
            ) : routePlans.length === 0 ? (
              <Alert color="blue">No promotion route plans yet. Create one on the left.</Alert>
            ) : (
              routePlans.map((plan) => (
                <Stack key={plan.routePlanId} gap="sm">
                  <Group justify="space-between">
                    <Stack gap={0}>
                      <Text fw={800}>{plan.name}</Text>
                      <Text size="xs" c="dimmed">{plan.description}</Text>
                    </Stack>
                    <Badge variant="light">{plan.status}</Badge>
                  </Group>
                  {plan.routeVersions.length ? (
                    plan.routeVersions.map((version) => (
                      <Stack key={version.routeVersionId} gap="xs">
                        {routePreview(version)}
                        {version.status !== "published" && (
                          <Button
                            variant="light"
                            onClick={() => void publishVersion.mutateAsync(version.routeVersionId).catch((error) => setFormError(errorMessage(error)))}
                            loading={publishVersion.isPending}
                            disabled={!canCreate}
                          >
                            Publish v{version.versionNumber}
                          </Button>
                        )}
                      </Stack>
                    ))
                  ) : (
                    <Text size="sm" c="dimmed">No versions yet.</Text>
                  )}
                  <Divider />
                </Stack>
              ))
            )}
          </Stack>
        </Card>
      </SimpleGrid>

      <Card withBorder shadow="sm" radius="lg" p="lg">
        <Stack gap="md">
          <Group justify="space-between" align="flex-start">
            <Stack gap={4}>
              <Group gap="xs">
                <IconUsersGroup size={22} />
                <Title order={3}>Assign hostels to promotion staff</Title>
              </Group>
              <Text size="sm" c="dimmed">
                Use the same published street route for everyone. Choose a hostel per person, or leave it random.
              </Text>
            </Stack>
            <WeekSelector
              value={weekValue}
              onChange={setWeekValue}
              weeks={weekOptions}
              selectProps={{ w: 260, label: "Schedule week" }}
            />
          </Group>

          <Select
            label="Published route version to assign"
            data={publishedRouteOptions}
            value={selectedPublishedVersion?.routeVersionId ?? null}
            onChange={setSelectedPublishedRouteVersionId}
            placeholder="Publish a route first"
            searchable
            allowDeselect={false}
          />

          {loading ? (
            <Center mih={180}><Loader variant="dots" /></Center>
          ) : !weekLookup.data?.week ? (
            <Alert color="yellow" icon={<IconAlertTriangle size={18} />}>
              This schedule week does not exist yet.
            </Alert>
          ) : promotionShifts.length === 0 ? (
            <Alert color="blue">No Promotion shifts were found in this published week.</Alert>
          ) : (
            <Table.ScrollContainer minWidth={920}>
              <Table verticalSpacing="sm">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Date / time</Table.Th>
                    <Table.Th>Staff</Table.Th>
                    <Table.Th>Current route</Table.Th>
                    <Table.Th>Current hostel</Table.Th>
                    <Table.Th>Assign</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {promotionShifts.flatMap((shift) =>
                    (shift.assignments ?? []).map((assignment) => {
                      const current = teamAssignmentByShiftAssignmentId.get(String(assignment.id));
                      const hostelOptions = [
                        { value: "__random__", label: "Random hostel" },
                        ...HOSTELS.map((hostel) => ({ value: hostel, label: hostel })),
                      ];
                      const rowSelection = hostelSelectionByAssignmentId[String(assignment.id)]
                        ?? (current?.hostelLabel && HOSTELS.includes(current.hostelLabel as typeof HOSTELS[number])
                          ? current.hostelLabel
                          : "__random__");
                      return (
                        <Table.Tr key={`${shift.id}-${assignment.id}`}>
                          <Table.Td>
                            <Stack gap={0}>
                              <Text fw={700}>{shift.date}</Text>
                              <Text size="sm" c="dimmed">{shift.timeStart?.slice(0, 5)}{shift.timeEnd ? `–${shift.timeEnd.slice(0, 5)}` : ""}</Text>
                            </Stack>
                          </Table.Td>
                          <Table.Td>
                            <Stack gap={0}>
                              <Text fw={700}>{staffName(assignment)}</Text>
                              <Text size="xs" c="dimmed">{assignment.roleInShift || assignment.shiftRole?.name || "Promotion"}</Text>
                            </Stack>
                          </Table.Td>
                          <Table.Td>
                            {current ? (
                              <Text size="sm">{current.routeName ?? `Route #${current.routeVersionId}`} v{current.versionNumber ?? "?"}</Text>
                            ) : (
                              <Badge color="yellow" variant="light">Not assigned</Badge>
                            )}
                          </Table.Td>
                          <Table.Td>
                            {current?.hostelLabel ? <Badge color="indigo" variant="light">{current.hostelLabel}</Badge> : <Text size="sm" c="dimmed">Random / none</Text>}
                          </Table.Td>
                          <Table.Td>
                            <Group gap="xs" wrap="nowrap">
                              <Select
                                aria-label={`Hostel for ${staffName(assignment)}`}
                                data={hostelOptions}
                                value={rowSelection}
                                onChange={(value) => {
                                  setHostelSelectionByAssignmentId((currentSelections) => ({
                                    ...currentSelections,
                                    [String(assignment.id)]: value ?? "__random__",
                                  }));
                                }}
                                w={210}
                              />
                              <Button
                                size="xs"
                                onClick={() => void assignStaffRoute({
                                  shift,
                                  assignment,
                                  hostelLabel: rowSelection === "__random__" ? null : rowSelection,
                                })}
                                loading={assignRoute.isPending}
                                disabled={!selectedPublishedVersion || !canCreate}
                              >
                                Assign
                              </Button>
                            </Group>
                          </Table.Td>
                        </Table.Tr>
                      );
                    }),
                  )}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          )}
        </Stack>
      </Card>

      <Card withBorder shadow="sm" radius="lg" p="lg">
        <Stack gap="md">
          <Group justify="space-between" align="flex-start">
            <Stack gap={4}>
              <Group gap="xs">
                <IconMap2 size={22} />
                <Title order={3}>Route playback history</Title>
              </Group>
              <Text size="sm" c="dimmed">
                Recreate the actual sampled route from uploaded Promotion Helper GPS evidence. Gaps and review-quality samples stay visible.
              </Text>
            </Stack>
            {selectedPlaybackSession && (
              <Group gap="xs">
                <Badge color={lifecycleColor(selectedPlaybackSession.lifecycle)} variant="light">
                  {lifecycleLabel(selectedPlaybackSession.lifecycle)}
                </Badge>
                <Badge color={qualityColor(selectedPlaybackSession.verificationQuality ?? selectedPlaybackSession.quality)} variant="light">
                  {(selectedPlaybackSession.verificationQuality ?? selectedPlaybackSession.quality ?? "UNKNOWN").replace(/_/gu, " ")}
                </Badge>
              </Group>
            )}
          </Group>

          <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
            <Select
              label="Session status"
              data={[
                { value: "COMPLETED", label: "Completed sessions" },
                { value: "ABORTED", label: "Aborted sessions" },
                { value: "STREET_ACTIVE", label: "Street active" },
                { value: "HOSTEL_ACTIVE", label: "Hostel active" },
                { value: "ALL", label: "All recent sessions" },
              ]}
              value={playbackLifecycleFilter}
              onChange={(value) => {
                setPlaybackLifecycleFilter((value as PromotionLifecycle | "ALL" | null) ?? "COMPLETED");
                setSelectedPlaybackSessionId(null);
              }}
              allowDeselect={false}
            />
            <Select
              label="Promotion session"
              placeholder={managerSessionsQuery.isLoading ? "Loading sessions..." : "No sessions found"}
              data={playbackSessionOptions}
              value={selectedPlaybackSessionId}
              onChange={setSelectedPlaybackSessionId}
              searchable
              clearable={false}
              disabled={managerSessionsQuery.isLoading || playbackSessionOptions.length === 0}
            />
          </SimpleGrid>

          {managerSessionsQuery.isLoading ? (
            <Center mih={180}><Loader variant="dots" /></Center>
          ) : managerSessions.length === 0 ? (
            <Alert color="blue">No promotion sessions found for this filter yet.</Alert>
          ) : selectedPlaybackSession ? (
            <Paper withBorder radius="md" p="md" bg="#F8FAFC">
              <SimpleGrid cols={{ base: 1, sm: 4 }} spacing="md">
                <Stack gap={2}>
                  <Text size="xs" c="dimmed" fw={700}>Staff</Text>
                  <Text fw={700}>{selectedPlaybackSession.participants.map((participant) => participant.displayName).join(", ") || "Unknown"}</Text>
                </Stack>
                <Stack gap={2}>
                  <Text size="xs" c="dimmed" fw={700}>Street start</Text>
                  <Text>{formatPlaybackTime(selectedPlaybackSession.streetStartedAtUtc)}</Text>
                </Stack>
                <Stack gap={2}>
                  <Text size="xs" c="dimmed" fw={700}>Hostel start</Text>
                  <Text>{formatPlaybackTime(selectedPlaybackSession.hostelStartedAtUtc)}</Text>
                </Stack>
                <Stack gap={2}>
                  <Text size="xs" c="dimmed" fw={700}>Completed / aborted</Text>
                  <Text>{formatPlaybackTime(selectedPlaybackSession.completedAtUtc ?? selectedPlaybackSession.abortedAtUtc)}</Text>
                </Stack>
              </SimpleGrid>
            </Paper>
          ) : null}

          {playbackQuery.isLoading ? (
            <Center mih={220}><Loader variant="dots" /></Center>
          ) : playbackQuery.isError ? (
            <Alert color="red" icon={<IconAlertTriangle size={18} />} title="Unable to load route playback">
              {errorMessage(playbackQuery.error)}
            </Alert>
          ) : playbackQuery.data ? (
            <PromotionSessionPlaybackMap playback={playbackQuery.data} />
          ) : (
            <Alert color="blue">Select a session to view the route playback.</Alert>
          )}
        </Stack>
      </Card>
    </Stack>
  );
};

export default PromotionRoutesPage;
