import { useCallback, useMemo, useState } from "react";
import {
  ActionIcon,
  Alert,
  Avatar,
  Badge,
  Box,
  Button,
  Card,
  Group,
  Modal,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  ThemeIcon,
  Title,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import {
  IconAlertTriangle,
  IconArrowsExchange,
  IconCalendar,
  IconChevronLeft,
  IconChevronRight,
  IconClock,
  IconRefresh,
  IconUserMinus,
  IconUserCheck,
  IconX,
} from "@tabler/icons-react";
import dayjs from "dayjs";
import isoWeek from "dayjs/plugin/isoWeek";
import isBetween from "dayjs/plugin/isBetween";
import type { AxiosError } from "axios";
import { useAppSelector } from "../../store/hooks";
import {
  getUpcomingWeeks,
  useCancelShiftRequest,
  useCreateShiftRequest,
  useEnsureWeek,
  useMyShiftRequests,
  useShiftRequestPartnerResponse,
  useShiftInstances,
} from "../../api/scheduling";
import WeekSelector from "../../components/scheduling/WeekSelector";
import SwapRequestModal from "../../components/scheduling/SwapRequestModal";
import ShiftChangeRequestModal from "../../components/scheduling/ShiftChangeRequestModal";
import {
  getShiftRequestType,
  resolveShiftRequestAssignment,
  type ShiftRequestAssignmentLike,
} from "../../components/scheduling/shiftRequestPresentation";
import type { ShiftAssignment, ShiftInstance, ShiftRequest } from "../../types/scheduling";
import { buildUserProfilePhotoUrl } from "../../utils/profilePhoto";

dayjs.extend(isoWeek);
dayjs.extend(isBetween);

const HEADER_FONT_STACK = "'Arial Black', 'Inter', sans-serif";

const normalizeRole = (value?: string | null) => value?.trim().toLowerCase() ?? "";

const shiftRolesMatch = (
  source: ShiftAssignment | null | undefined,
  target: ShiftAssignment | null | undefined,
): boolean => {
  if (!source || !target) {
    return false;
  }
  const sourceRoleId = source.shiftRoleId ?? null;
  const targetRoleId = target.shiftRoleId ?? null;
  if (sourceRoleId !== null || targetRoleId !== null) {
    return sourceRoleId !== null && targetRoleId !== null && sourceRoleId === targetRoleId;
  }
  return normalizeRole(source.roleInShift) === normalizeRole(target.roleInShift);
};

const formatTime = (value?: string | null) => {
  if (!value) {
    return null;
  }
  const match = value.match(/^(\d{1,2}):(\d{2})/);
  return match ? `${match[1].padStart(2, "0")}:${match[2]}` : value;
};

const formatShiftTimeRange = (start?: string | null, end?: string | null) =>
  [formatTime(start), formatTime(end)].filter(Boolean).join(" - ");

const formatRoleLabel = (value?: string | null) =>
  value?.replace(/[_-]+/g, " ").trim().replace(/\b\w/g, (char) => char.toUpperCase()) || "Role";

const getUserName = (assignment?: ShiftRequestAssignmentLike | null) => {
  const user = assignment?.assignee;
  return [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim() || "Teammate";
};

const getInitials = (name: string) => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return `${parts[0]?.[0] ?? "U"}${parts[1]?.[0] ?? ""}`.toUpperCase();
};

const getProfilePhotoUrl = (assignment?: ShiftRequestAssignmentLike | null) =>
  buildUserProfilePhotoUrl({ user: assignment?.assignee ?? null });

const hasShiftStartPassed = (shift: ShiftInstance) => {
  if (!shift.date || !shift.timeStart) {
    return false;
  }
  return dayjs(`${shift.date} ${shift.timeStart}`).isBefore(dayjs());
};

const getStatusColor = (status: ShiftRequest["status"]) => {
  switch (status) {
    case "pending_partner":
      return "orange";
    case "pending_manager":
      return "blue";
    case "approved":
      return "green";
    case "denied":
    case "canceled":
      return "red";
    default:
      return "gray";
  }
};

const MyShiftsPage = () => {
  const isMobile = useMediaQuery("(max-width: 768px)");
  const weekOptions = useMemo(() => getUpcomingWeeks(6), []);
  const [selectedWeek, setSelectedWeek] = useState<string>(weekOptions[0]?.value ?? "");
  const loggedUserId = useAppSelector((state) => state.session.loggedUserId);
  const isAuthenticated = loggedUserId > 0;

  const ensureWeekQuery = useEnsureWeek(selectedWeek, { allowGenerate: false, enabled: isAuthenticated });
  const weekId = ensureWeekQuery.data?.week?.id ?? null;
  const instancesQuery = useShiftInstances(weekId);
  const createShiftRequest = useCreateShiftRequest();
  const myShiftRequests = useMyShiftRequests();
  const partnerResponse = useShiftRequestPartnerResponse();
  const cancelShiftRequest = useCancelShiftRequest();

  const selectedWeekIndex = weekOptions.findIndex((option) => option.value === selectedWeek);
  const canNavigateBackward = selectedWeekIndex > 0;
  const canNavigateForward = selectedWeekIndex >= 0 && selectedWeekIndex < weekOptions.length - 1;
  const navigationIsLoading = ensureWeekQuery.isFetching || instancesQuery.isFetching;

  const handleNavigateWeek = useCallback(
    (direction: -1 | 1) => {
      const nextWeek = weekOptions[selectedWeekIndex + direction];
      if (nextWeek) {
        setSelectedWeek(nextWeek.value);
      }
    },
    [selectedWeekIndex, weekOptions],
  );

  const selectedWeekRange = useMemo(() => {
    if (!selectedWeek) {
      return null;
    }
    const [year, weekPart] = selectedWeek.split("-W");
    const start = dayjs().year(Number(year)).isoWeek(Number(weekPart)).startOf("isoWeek");
    const end = start.add(6, "day").endOf("day");
    return { start, end };
  }, [selectedWeek]);

  const [swapModal, setSwapModal] = useState<{
    opened: boolean;
    assignment: ShiftAssignment | null;
    shift: ShiftInstance | null;
  }>({ opened: false, assignment: null, shift: null });

  const [respondingSwapId, setRespondingSwapId] = useState<number | null>(null);
  const [cancelingSwapId, setCancelingSwapId] = useState<number | null>(null);
  const [dropEntry, setDropEntry] = useState<{ shift: ShiftInstance; assignment: ShiftAssignment } | null>(null);
  const [responseModal, setResponseModal] = useState<{ request: ShiftRequest; accept: boolean } | null>(null);
  const [responseNote, setResponseNote] = useState("");
  const [responseError, setResponseError] = useState<string | null>(null);

  const getSwapStatusLabel = useCallback((status: ShiftRequest["status"]) => {
    switch (status) {
      case "pending_partner":
        return "Awaiting teammate";
      case "pending_manager":
        return "Awaiting manager";
      case "approved":
        return "Approved";
      case "denied":
        return "Denied";
      case "canceled":
        return "Canceled";
      default:
        return status;
    }
  }, []);

  const instancesForWeek = useMemo(() => {
    if (!weekId || !instancesQuery.data || !selectedWeekRange) {
      return [];
    }
    return instancesQuery.data.filter((instance) => {
      if (instance.scheduleWeekId !== weekId) {
        return false;
      }
      const date = dayjs(instance.date);
      return date.isBetween(selectedWeekRange.start, selectedWeekRange.end, undefined, "[]");
    });
  }, [instancesQuery.data, selectedWeekRange, weekId]);

  const myAssignments = useMemo(() => {
    if (!loggedUserId || !weekId || !selectedWeekRange) {
      return [];
    }
    const items: Array<{ shift: ShiftInstance; assignment: ShiftAssignment }> = [];
    instancesForWeek.forEach((instance) => {
      (instance.assignments ?? []).forEach((assignment) => {
        if (assignment.userId === loggedUserId) {
          items.push({ shift: instance, assignment });
        }
      });
    });
    return items.sort((a, b) => {
      const aStart = dayjs(`${a.shift.date} ${a.shift.timeStart}`).valueOf();
      const bStart = dayjs(`${b.shift.date} ${b.shift.timeStart}`).valueOf();
      return aStart - bStart;
    });
  }, [instancesForWeek, loggedUserId, weekId, selectedWeekRange]);

  const potentialAssignments = useMemo(() => {
    if (!instancesForWeek.length || !loggedUserId) {
      return [];
    }
    const assignments: Array<ShiftAssignment & { shiftInstance: ShiftInstance }> = [];
    instancesForWeek.forEach((instance) => {
      (instance.assignments ?? []).forEach((assignment) => {
        if (assignment.userId === loggedUserId || !assignment.assignee) {
          return;
        }
        assignments.push({
          ...assignment,
          shiftInstance: instance,
        });
      });
    });
    return assignments;
  }, [instancesForWeek, loggedUserId]);

  const modalAssignments = useMemo(() => {
    if (!swapModal.shift || !swapModal.assignment) {
      return [];
    }
    return potentialAssignments.filter(
      (assignment) =>
        assignment.shiftInstance?.shiftTypeId === swapModal.shift?.shiftTypeId &&
        assignment.shiftInstanceId !== swapModal.assignment?.shiftInstanceId &&
        shiftRolesMatch(swapModal.assignment, assignment),
    );
  }, [potentialAssignments, swapModal.assignment, swapModal.shift]);

  const activeRequests = useMemo(
    () =>
      (myShiftRequests.data ?? []).filter(
        (request) => request.status === "pending_partner" || request.status === "pending_manager",
      ),
    [myShiftRequests.data],
  );

  const activeRequestAssignmentIds = useMemo(
    () =>
      new Set(
        activeRequests
          .flatMap((request) => [request.fromAssignmentId, request.toAssignmentId])
          .filter((assignmentId): assignmentId is number => Number.isInteger(assignmentId)),
      ),
    [activeRequests],
  );

  const summary = useMemo(() => {
    const upcoming = myAssignments.filter((item) => !hasShiftStartPassed(item.shift)).length;
    return {
      total: myAssignments.length,
      upcoming,
      pending: activeRequests.length,
    };
  }, [activeRequests.length, myAssignments]);

  const handleOpenSwap = (entry: { shift: ShiftInstance; assignment: ShiftAssignment }) => {
    if (hasShiftStartPassed(entry.shift)) {
      return;
    }
    setSwapModal({ opened: true, assignment: entry.assignment, shift: entry.shift });
  };

  const handleSubmitSwap = async (payload: { fromAssignmentId: number; toAssignmentId: number; partnerId: number }) => {
    await createShiftRequest.mutateAsync({
      type: "swap",
      fromAssignmentId: payload.fromAssignmentId,
      toAssignmentId: payload.toAssignmentId,
    });
  };

  const handlePartnerDecision = useCallback(
    async (requestId: number, accept: boolean, note?: string) => {
      setRespondingSwapId(requestId);
      try {
        await partnerResponse.mutateAsync({ requestId, accept, ...(note ? { note } : {}) });
      } finally {
        setRespondingSwapId(null);
      }
    },
    [partnerResponse],
  );

  const handleCancelSwap = useCallback(
    async (requestId: number) => {
      setCancelingSwapId(requestId);
      try {
        await cancelShiftRequest.mutateAsync({ requestId });
      } finally {
        setCancelingSwapId(null);
      }
    },
    [cancelShiftRequest],
  );

  const handleSubmitDrop = async ({ assignmentId, note }: { assignmentId: number; note?: string }) => {
    await createShiftRequest.mutateAsync({ type: "drop", assignmentId, ...(note ? { note } : {}) });
  };

  const handleConfirmPartnerResponse = async () => {
    if (!responseModal) return;
    setResponseError(null);
    try {
      await handlePartnerDecision(responseModal.request.id, responseModal.accept, responseNote.trim() || undefined);
      setResponseModal(null);
      setResponseNote("");
    } catch (error) {
      setResponseError(error instanceof Error ? error.message : "Unable to update this request.");
    }
  };

  const renderWeekControls = () => (
    <Group gap="xs" wrap="nowrap" style={{ width: "100%", maxWidth: 680 }}>
      <ActionIcon
        variant="filled"
        color="gray"
        size={46}
        radius="md"
        aria-label="Previous week"
        onClick={() => handleNavigateWeek(-1)}
        disabled={!canNavigateBackward || navigationIsLoading}
        style={{
          flex: "0 0 46px",
          backgroundColor: "#EFF6FF",
          color: "#2563EB",
          border: "3px solid #93C5FD",
          boxShadow: "0 8px 18px rgba(37, 99, 235, 0.18), inset 0 0 0 1px rgba(255,255,255,0.76)",
        }}
      >
        <IconChevronLeft size={18} />
      </ActionIcon>
      <Box style={{ flex: "1 1 auto", minWidth: 0 }}>
        <WeekSelector
          value={selectedWeek || null}
          weeks={weekOptions.map((option) => ({ ...option, label: option.label.toUpperCase() }))}
          onChange={setSelectedWeek}
          selectProps={{
            style: { width: "100%" },
            styles: {
              input: {
                fontWeight: 800,
                textAlign: "center",
                minHeight: 46,
                borderRadius: 14,
                border: "3px solid #94A3B8",
                boxShadow: "0 8px 18px rgba(15, 23, 42, 0.14), inset 0 0 0 1px rgba(255,255,255,0.82)",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              },
              option: {
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              },
            },
          }}
        />
      </Box>
      <ActionIcon
        variant="filled"
        color="gray"
        size={46}
        radius="md"
        aria-label="Next week"
        onClick={() => handleNavigateWeek(1)}
        disabled={!canNavigateForward || navigationIsLoading}
        style={{
          flex: "0 0 46px",
          backgroundColor: "#EFF6FF",
          color: "#2563EB",
          border: "3px solid #93C5FD",
          boxShadow: "0 8px 18px rgba(37, 99, 235, 0.18), inset 0 0 0 1px rgba(255,255,255,0.76)",
        }}
      >
        <IconChevronRight size={18} />
      </ActionIcon>
    </Group>
  );

  const renderShiftCard = (item: { shift: ShiftInstance; assignment: ShiftAssignment }) => {
    const shiftName = item.shift.shiftType?.name ?? "Shift";
    const timeRange = formatShiftTimeRange(item.shift.timeStart, item.shift.timeEnd);
    const isPast = hasShiftStartPassed(item.shift);
    const hasEligiblePartners = potentialAssignments.some(
      (assignment) =>
        assignment.shiftInstance?.shiftTypeId === item.shift.shiftTypeId &&
        assignment.shiftInstanceId !== item.assignment.shiftInstanceId &&
        shiftRolesMatch(item.assignment, assignment),
    );
    const hasPendingRequest = activeRequestAssignmentIds.has(item.assignment.id);
    const disableSwap = isPast || !hasEligiblePartners || hasPendingRequest;
    const disableDrop = isPast || hasPendingRequest;
    const roleLabel = formatRoleLabel(item.assignment.roleInShift);

    return (
      <Card key={item.assignment.id} withBorder shadow="sm" radius={22} padding={0} style={{ overflow: "hidden" }}>
        <Box
          style={{
            padding: isMobile ? "14px" : "16px 18px",
            background:
              "linear-gradient(135deg, rgba(237, 229, 255, 0.96), rgba(255, 255, 255, 0.98) 48%, rgba(255, 244, 250, 0.9))",
            borderTop: "5px solid #7C3AED",
            borderBottom: "1px solid #E2E8F0",
          }}
        >
          <Stack gap="sm">
          <Group justify="space-between" gap="md" wrap="nowrap">
            <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
              <Paper radius={16} p="xs" shadow="xs" style={{ minWidth: 60, textAlign: "center", backgroundColor: "#FFFFFF" }}>
                <Text size="xs" c="dimmed" fw={900} tt="uppercase" style={{ fontFamily: HEADER_FONT_STACK }}>
                  {dayjs(item.shift.date).format("MMM")}
                </Text>
                <Text fw={900} size="xl" style={{ fontFamily: HEADER_FONT_STACK, lineHeight: 1 }}>
                  {dayjs(item.shift.date).format("D")}
                </Text>
              </Paper>
              <Stack gap={4} style={{ minWidth: 0 }}>
                <Text
                  fw={900}
                  style={{
                    fontFamily: HEADER_FONT_STACK,
                    color: "#3B0764",
                    letterSpacing: "0.05em",
                    textTransform: "uppercase",
                    fontSize: isMobile ? 18 : 22,
                    lineHeight: 1,
                  }}
                >
                  {shiftName}
                </Text>
                <Group gap={6}>
                  <Badge color="violet" variant="light" radius="xl">
                    {roleLabel}
                  </Badge>
                  {isPast ? (
                    <Badge color="gray" variant="light" radius="xl">
                      Finished
                    </Badge>
                  ) : null}
                </Group>
              </Stack>
            </Group>
          </Group>
          <Group grow={isMobile} justify="flex-end" wrap="wrap">
            <Button
              variant={disableSwap ? "light" : "filled"}
              color={disableSwap ? "gray" : "violet"}
              radius="xl"
              leftSection={<IconArrowsExchange size={16} />}
              disabled={disableSwap}
              onClick={() => handleOpenSwap(item)}
              style={{ flex: isMobile ? "0 0 auto" : undefined, fontWeight: 900 }}
            >
              {isMobile ? "Swap" : "Request swap"}
            </Button>
            <Button
              variant={disableDrop ? "light" : "filled"}
              color={disableDrop ? "gray" : "orange"}
              radius="xl"
              leftSection={<IconUserMinus size={16} />}
              disabled={disableDrop}
              onClick={() => setDropEntry(item)}
              style={{ fontWeight: 900 }}
            >
              {isMobile ? "Drop" : "Drop shift"}
            </Button>
          </Group>
          </Stack>
        </Box>

        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm" p="md">
          <Paper withBorder radius={16} p="sm" style={{ textAlign: "center", backgroundColor: "#F8FAFC" }}>
            <ThemeIcon color="blue" variant="light" radius="xl" mx="auto" mb={6}>
              <IconCalendar size={18} />
            </ThemeIcon>
            <Text size="xs" c="dimmed" fw={900} tt="uppercase" style={{ fontFamily: HEADER_FONT_STACK }}>
              Date
            </Text>
            <Text fw={900}>{dayjs(item.shift.date).format("dddd, MMM D")}</Text>
          </Paper>
          <Paper withBorder radius={16} p="sm" style={{ textAlign: "center", backgroundColor: "#F8FAFC" }}>
            <ThemeIcon color="blue" variant="light" radius="xl" mx="auto" mb={6}>
              <IconClock size={18} />
            </ThemeIcon>
            <Text size="xs" c="dimmed" fw={900} tt="uppercase" style={{ fontFamily: HEADER_FONT_STACK }}>
              Time
            </Text>
            <Text fw={900}>{timeRange || "Any time"}</Text>
          </Paper>
        </SimpleGrid>

        {!hasEligiblePartners || isPast || hasPendingRequest ? (
          <Box px="md" pb="md">
            <Alert color={isPast ? "gray" : "blue"} radius="lg" variant="light">
              <Text size="sm" fw={800} ta="center">
                {isPast
                  ? "Shift requests are closed for this shift."
                  : hasPendingRequest
                    ? "A request is already pending for this shift."
                    : "No teammates are available for a swap. You can still request to drop this shift."}
              </Text>
            </Alert>
          </Box>
        ) : null}
      </Card>
    );
  };

  const renderSwapSide = (
    label: string,
    assignment: ShiftRequestAssignmentLike | null | undefined,
    tone: "offer" | "request",
  ) => {
    const shift = assignment?.shiftInstance;
    const name = getUserName(assignment);
    const photoUrl = getProfilePhotoUrl(assignment);
    const accent = tone === "offer" ? "#2563EB" : "#e90183";
    const borderColor = tone === "offer" ? "#93C5FD" : "#F9A8D4";
    const background = tone === "offer" ? "#EFF6FF" : "#FDF2F8";

    return (
      <Paper withBorder radius={18} p="sm" style={{ borderColor, backgroundColor: background, textAlign: "center" }}>
        <Text
          size="xs"
          fw={900}
          style={{
            fontFamily: HEADER_FONT_STACK,
            color: accent,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          {label}
        </Text>
        <Avatar
          src={photoUrl ?? undefined}
          alt={name}
          size={44}
          radius="xl"
          mx="auto"
          my={8}
          styles={{
            root: {
              border: "2px solid #FFFFFF",
              outline: `2px solid ${accent}`,
              fontFamily: HEADER_FONT_STACK,
              fontWeight: 900,
              color: accent,
            },
          }}
        >
          {getInitials(name)}
        </Avatar>
        <Text fw={900} style={{ fontFamily: HEADER_FONT_STACK }}>
          {name}
        </Text>
        <Text fw={900} c={accent} tt="uppercase" mt={4} style={{ fontFamily: HEADER_FONT_STACK }}>
          {shift?.shiftType?.name ?? "Shift"}
        </Text>
        <Text size="sm" fw={800}>
          {shift ? `${dayjs(shift.date).format("ddd, MMM D")} · ${formatShiftTimeRange(shift.timeStart, shift.timeEnd)}` : "Unknown shift"}
        </Text>
      </Paper>
    );
  };

  const renderRequestCard = (request: ShiftRequest) => {
    const requestType = getShiftRequestType(request);
    const fromAssignment = resolveShiftRequestAssignment(request, "from");
    const toAssignment = resolveShiftRequestAssignment(request, "to");
    const isRequester = request.requesterId === loggedUserId;
    const isPartner = request.partnerId === loggedUserId;
    const showPartnerActions = request.status === "pending_partner" && isPartner;
    const canCancel =
      (request.status === "pending_partner" || request.status === "pending_manager") && (isRequester || isPartner);
    const statusColor = getStatusColor(request.status);
    const requesterName =
      [request.requester?.firstName, request.requester?.lastName].filter(Boolean).join(" ") || "Teammate";
    const requestTitle = requestType === "takeover" ? "Takeover request" : requestType === "drop" ? "Drop request" : "Swap request";

    return (
      <Card key={request.id} withBorder shadow="sm" radius={22} padding="md">
        <Stack gap="md">
          <Group justify="space-between" align="center">
            <Stack gap={2}>
              <Text fw={900} style={{ fontFamily: HEADER_FONT_STACK, letterSpacing: "0.04em", textTransform: "uppercase" }}>
                {requestTitle}
              </Text>
              <Text size="sm" c="dimmed" fw={700}>
                Requested by {isRequester ? "you" : requesterName}
              </Text>
            </Stack>
            <Badge color={statusColor} variant="light" radius="xl" size="lg">
              {getSwapStatusLabel(request.status)}
            </Badge>
          </Group>

          {requestType === "swap" ? (
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
              {renderSwapSide(isRequester ? "You offer" : "They offer", fromAssignment, "offer")}
              {renderSwapSide(isRequester ? "You request" : "You give", toAssignment, "request")}
            </SimpleGrid>
          ) : requestType === "takeover" ? (
            renderSwapSide(isPartner ? "Your shift" : "Shift to take over", fromAssignment, "request")
          ) : (
            renderSwapSide("Shift to drop", fromAssignment, "offer")
          )}

          {request.requestNote ? (
            <Alert color="blue" radius="lg" variant="light">
              <Text size="xs" fw={900} tt="uppercase">Request note</Text>
              <Text size="sm" fw={700}>{request.requestNote}</Text>
            </Alert>
          ) : null}

          {request.partnerResponseNote ? (
            <Alert color="teal" radius="lg" variant="light">
              <Text size="xs" fw={900} tt="uppercase">Teammate note</Text>
              <Text size="sm" fw={700}>{request.partnerResponseNote}</Text>
            </Alert>
          ) : null}

          {request.decisionReason ? (
            <Alert color="gray" radius="lg" variant="light">
              <Text size="xs" fw={900} tt="uppercase">
                {request.status === "canceled" ? "Cancellation note" : "Manager note"}
              </Text>
              <Text size="sm" fw={700}>{request.decisionReason}</Text>
            </Alert>
          ) : null}

          {(showPartnerActions || canCancel) && (
            <Group justify="space-between" align="center" grow={isMobile}>
              {showPartnerActions ? (
                <>
                  <Button
                    color="red"
                    variant="light"
                    loading={respondingSwapId === request.id && partnerResponse.isPending}
                    onClick={() => {
                      setResponseNote("");
                      setResponseError(null);
                      setResponseModal({ request, accept: false });
                    }}
                    leftSection={<IconX size={16} />}
                  >
                    Decline
                  </Button>
                  <Button
                    color="green"
                    loading={respondingSwapId === request.id && partnerResponse.isPending}
                    onClick={() => {
                      setResponseNote("");
                      setResponseError(null);
                      setResponseModal({ request, accept: true });
                    }}
                    leftSection={<IconUserCheck size={16} />}
                  >
                    Accept
                  </Button>
                </>
              ) : (
                <span />
              )}
              {canCancel ? (
                <Button
                  variant="light"
                  color="red"
                  loading={cancelingSwapId === request.id && cancelShiftRequest.isPending}
                  onClick={() => handleCancelSwap(request.id)}
                  leftSection={<IconX size={16} />}
                >
                  Cancel request
                </Button>
              ) : null}
            </Group>
          )}
        </Stack>
      </Card>
    );
  };

  return (
    <Stack mt={isMobile ? "sm" : "lg"} gap="lg">
      {isAuthenticated && ensureWeekQuery.isError ? (
        <Alert color="red" title="Unable to load scheduling week" icon={<IconAlertTriangle size={18} />}>
          <Text size="sm">
            {((ensureWeekQuery.error as AxiosError)?.response?.status === 401
              ? "You do not have permission to generate the schedule week. Please contact a manager."
              : (ensureWeekQuery.error as Error).message) ?? "Failed to load scheduling week."}
          </Text>
        </Alert>
      ) : null}

      <Stack gap="sm" align="center">
        {renderWeekControls()}
      </Stack>

      <SimpleGrid cols={{ base: 2, sm: 3 }} spacing="sm">
        <Paper withBorder radius={18} p="md" style={{ textAlign: "center", backgroundColor: "#FFFFFF" }}>
          <Text size="xs" c="dimmed" fw={900} tt="uppercase" style={{ fontFamily: HEADER_FONT_STACK }}>
            Assigned
          </Text>
          <Text fw={900} size="xl" style={{ fontFamily: HEADER_FONT_STACK }}>
            {summary.total}
          </Text>
        </Paper>
        <Paper withBorder radius={18} p="md" style={{ textAlign: "center", backgroundColor: "#FFFFFF" }}>
          <Text size="xs" c="dimmed" fw={900} tt="uppercase" style={{ fontFamily: HEADER_FONT_STACK }}>
            Upcoming
          </Text>
          <Text fw={900} size="xl" c="blue" style={{ fontFamily: HEADER_FONT_STACK }}>
            {summary.upcoming}
          </Text>
        </Paper>
        {summary.pending > 0 ? (
          <Paper withBorder radius={18} p="md" style={{ textAlign: "center", backgroundColor: "#FFFFFF" }}>
            <Text size="xs" c="dimmed" fw={900} tt="uppercase" style={{ fontFamily: HEADER_FONT_STACK }}>
              Pending requests
            </Text>
            <Text fw={900} size="xl" c="orange" style={{ fontFamily: HEADER_FONT_STACK }}>
              {summary.pending}
            </Text>
          </Paper>
        ) : null}
      </SimpleGrid>

      <Stack gap="md">
        {myAssignments.length === 0 ? (
          <Alert color="gray" title="No shifts assigned">
            You have no assignments for this week yet.
          </Alert>
        ) : (
          <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
            {myAssignments.map(renderShiftCard)}
          </SimpleGrid>
        )}
      </Stack>

      {(myShiftRequests.data?.length ?? 0) > 0 ? (
        <Stack mt="sm" gap="md">
          <Group justify="center" align="center" gap="xs">
            <Title order={3} style={{ fontFamily: HEADER_FONT_STACK }}>
              SHIFT REQUESTS
            </Title>
            <ThemeIcon color="violet" variant="light" radius="xl">
              <IconRefresh size={18} />
            </ThemeIcon>
          </Group>
          <SimpleGrid cols={{ base: 1, xl: 2 }} spacing="md">
            {(myShiftRequests.data ?? []).map(renderRequestCard)}
          </SimpleGrid>
        </Stack>
      ) : null}

      <SwapRequestModal
        opened={swapModal.opened}
        onClose={() => setSwapModal({ opened: false, assignment: null, shift: null })}
        onSubmit={handleSubmitSwap}
        fromAssignment={swapModal.assignment}
        fromShift={swapModal.shift}
        potentialAssignments={modalAssignments}
      />

      <ShiftChangeRequestModal
        opened={Boolean(dropEntry)}
        requestType="drop"
        assignments={
          dropEntry
            ? [{ ...dropEntry.assignment, shiftInstance: dropEntry.shift }]
            : []
        }
        onClose={() => setDropEntry(null)}
        onSubmit={handleSubmitDrop}
      />

      <Modal
        opened={Boolean(responseModal)}
        onClose={() => {
          if (!partnerResponse.isPending) {
            setResponseModal(null);
            setResponseNote("");
            setResponseError(null);
          }
        }}
        title={responseModal?.accept ? "Accept request" : "Decline request"}
        centered
        fullScreen={isMobile}
        size="md"
      >
        <Stack gap="md">
          <Text fw={700} ta="center">
            {responseModal?.request.requestType === "takeover"
              ? responseModal.accept
                ? "Accept this takeover and send it to a manager for final approval?"
                : "Decline this takeover request?"
              : responseModal?.accept
                ? "Accept this swap and send it to a manager for final approval?"
                : "Decline this swap request?"}
          </Text>
          <Textarea
            label="Response note (optional)"
            placeholder="Add context for the requester and manager"
            value={responseNote}
            onChange={(event) => setResponseNote(event.currentTarget.value)}
            maxLength={2000}
            autosize
            minRows={3}
            disabled={partnerResponse.isPending}
          />
          {responseError ? <Alert color="red" role="alert">{responseError}</Alert> : null}
          <Group grow>
            <Button variant="light" color="gray" onClick={() => setResponseModal(null)} disabled={partnerResponse.isPending}>
              Cancel
            </Button>
            <Button
              color={responseModal?.accept ? "green" : "red"}
              onClick={handleConfirmPartnerResponse}
              loading={partnerResponse.isPending}
            >
              {responseModal?.accept ? "Accept" : "Decline"}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
};

export default MyShiftsPage;
