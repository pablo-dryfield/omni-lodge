import { useCallback, useMemo, useState } from "react";
import { Alert, Badge, Button, Card, Group, Stack, Text, Title } from "@mantine/core";
import dayjs from "dayjs";
import isoWeek from "dayjs/plugin/isoWeek";
import isBetween from "dayjs/plugin/isBetween";
import type { AxiosError } from "axios";
import { useAppSelector } from "../../store/hooks";
import {
  getUpcomingWeeks,
  useCreateSwap,
  useEnsureWeek,
  useMySwaps,
  usePartnerSwapResponse,
  useCancelSwap,
  useShiftInstances,
} from "../../api/scheduling";
import WeekSelector from "../../components/scheduling/WeekSelector";
import SwapRequestModal from "../../components/scheduling/SwapRequestModal";
import type { ShiftAssignment, ShiftInstance } from "../../types/scheduling";

dayjs.extend(isoWeek);
dayjs.extend(isBetween);

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

const MyShiftsPage = () => {
  const weekOptions = useMemo(() => getUpcomingWeeks(6), []);
  const [selectedWeek, setSelectedWeek] = useState<string>(weekOptions[0]?.value ?? "");
  const loggedUserId = useAppSelector((state) => state.session.loggedUserId);
  const isAuthenticated = loggedUserId > 0;

  const ensureWeekQuery = useEnsureWeek(selectedWeek, { allowGenerate: false, enabled: isAuthenticated });
  const weekId = ensureWeekQuery.data?.week?.id ?? null;
  const instancesQuery = useShiftInstances(weekId);
  const createSwap = useCreateSwap();
  const mySwaps = useMySwaps();
  const partnerResponse = usePartnerSwapResponse();
  const cancelSwap = useCancelSwap();

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

  const getSwapStatusLabel = useCallback((status: "pending_partner" | "pending_manager" | "approved" | "denied" | "canceled") => {
    switch (status) {
      case "pending_partner":
        return "AWAITING TEAMMATE";
      case "pending_manager":
        return "AWAITING MANAGER";
      case "approved":
        return "approved";
      case "denied":
        return "denied";
      case "canceled":
        return "canceled";
      default:
        return status;
    }
  }, []);

  const weekStartLabel = useMemo(() => {
    if (!selectedWeekRange) {
      return "";
    }
    return `${selectedWeekRange.start.format("MMM D")} - ${selectedWeekRange.end.format("MMM D")}`;
  }, [selectedWeekRange]);

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
    return items.sort((a, b) => dayjs(a.shift.date).valueOf() - dayjs(b.shift.date).valueOf());
  }, [instancesForWeek, loggedUserId, weekId, selectedWeekRange]);

  const userStaffProfileType = useMemo(() => {
    for (const item of myAssignments) {
      const profileType =
        item.assignment.assignee?.staffProfile?.staffType ??
        item.assignment.assignee?.userShiftRoles?.[0]?.staffType ??
        null;
      if (profileType) {
        return profileType;
      }
    }
    return null;
  }, [myAssignments]);

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
        const profileType =
          assignment.assignee.staffProfile?.staffType ??
          assignment.assignee.userShiftRoles?.[0]?.staffType ??
          null;
        const matchesProfile =
          userStaffProfileType == null ? profileType == null : profileType === userStaffProfileType;
        if (!matchesProfile) {
          return;
        }
        assignments.push({
          ...assignment,
          shiftInstance: instance,
        });
      });
    });
    return assignments;
  }, [instancesForWeek, loggedUserId, userStaffProfileType]);

  const swapLimitReachedTypes = useMemo(() => {
    if (!mySwaps.data || !weekId) {
      return new Set<number>();
    }
    const blocked = new Set<number>();
    mySwaps.data.forEach((swap) => {
      if (swap.requesterId !== loggedUserId) {
        return;
      }
      const shiftTypeId = swap.fromAssignment?.shiftInstance?.shiftTypeId ?? null;
      const swapWeekId = swap.fromAssignment?.shiftInstance?.scheduleWeekId ?? null;
      if (!shiftTypeId || swapWeekId !== weekId) {
        return;
      }
      if (swap.status === "canceled" || swap.status === "denied") {
        return;
      }
      blocked.add(shiftTypeId);
    });
    return blocked;
  }, [mySwaps.data, loggedUserId, weekId]);

  const modalAssignments = useMemo(() => {
    if (!swapModal.shift || !swapModal.assignment) {
      return [];
    }
    return potentialAssignments.filter(
      (assignment) =>
        assignment.shiftInstance?.shiftTypeId === swapModal.shift?.shiftTypeId &&
        shiftRolesMatch(swapModal.assignment, assignment),
    );
  }, [potentialAssignments, swapModal.assignment, swapModal.shift]);

  const handleOpenSwap = (entry: { shift: ShiftInstance; assignment: ShiftAssignment }) => {
    if (swapLimitReachedTypes.has(entry.shift.shiftTypeId)) {
      return;
    }
    setSwapModal({ opened: true, assignment: entry.assignment, shift: entry.shift });
  };

  const handleSubmitSwap = async (payload: { fromAssignmentId: number; toAssignmentId: number; partnerId: number }) => {
    await createSwap.mutateAsync(payload);
  };

  const handlePartnerDecision = useCallback(
    async (swapId: number, accept: boolean) => {
      setRespondingSwapId(swapId);
      try {
        await partnerResponse.mutateAsync({ swapId, accept });
      } finally {
        setRespondingSwapId(null);
      }
    },
    [partnerResponse],
  );

  const handleCancelSwap = useCallback(
    async (swapId: number) => {
      setCancelingSwapId(swapId);
      try {
        await cancelSwap.mutateAsync(swapId);
      } finally {
        setCancelingSwapId(null);
      }
    },
    [cancelSwap],
  );

  return (
    <Stack mt="lg" gap="lg">
      {isAuthenticated && ensureWeekQuery.isError ? (
        <Alert color="red" title="Unable to load scheduling week">
          <Text size="sm">
            {((ensureWeekQuery.error as AxiosError)?.response?.status === 401
              ? "You do not have permission to generate the schedule week. Please contact a manager."
              : (ensureWeekQuery.error as Error).message) ?? "Failed to load scheduling week."}
          </Text>
        </Alert>
      ) : null}

      <Group justify="space-between" align="flex-end">
        <Stack gap={4}>
          <Title order={3}>My shifts</Title>
          <Text size="sm" c="dimmed">
            {weekStartLabel}
          </Text>
        </Stack>
        <WeekSelector value={selectedWeek} onChange={setSelectedWeek} />
      </Group>

      {myAssignments.length === 0 ? (
        <Alert color="gray" title="No shifts assigned">
          You have no assignments for this week yet.
        </Alert>
      ) : (
        <Stack gap="md">
          {myAssignments.map((item) => {
            const shiftTimeLabel = `${dayjs(item.shift.date).format("dddd, MMM D")} - ${item.shift.timeStart}${
              item.shift.timeEnd ? ` - ${item.shift.timeEnd}` : ""
            }`;
            const swapLimitReached = swapLimitReachedTypes.has(item.shift.shiftTypeId);
            const hasEligiblePartners = potentialAssignments.some(
              (assignment) =>
                assignment.shiftInstance?.shiftTypeId === item.shift.shiftTypeId &&
                shiftRolesMatch(item.assignment, assignment),
            );
            const disableSwap = swapLimitReached || !hasEligiblePartners;

            return (
              <Card key={item.assignment.id} withBorder shadow="sm" radius="md">
                <Group justify="space-between" align="flex-start">
                  <Stack gap={4}>
                    <Text fw={600}>{item.shift.shiftType?.name ?? "Shift"}</Text>
                    <Text size="sm" c="dimmed">
                      {shiftTimeLabel}
                    </Text>
                    <Badge variant="light" color="blue">
                      {item.assignment.roleInShift}
                    </Badge>
                    {swapLimitReached ? (
                      <Text size="xs" c="red">
                        Swap limit reached for this shift type this week.
                      </Text>
                    ) : null}
                    {!swapLimitReached && !hasEligiblePartners ? (
                      <Text size="xs" c="dimmed">
                        No teammates available with matching shift type and role.
                      </Text>
                    ) : null}
                  </Stack>
                  <Button variant="light" disabled={disableSwap} onClick={() => handleOpenSwap(item)}>
                    Request swap
                  </Button>
                </Group>
              </Card>
            );
          })}
        </Stack>
      )}

      {mySwaps.data && mySwaps.data.length > 0 && (
        <Stack mt="lg" gap="sm">
          <Title order={5}>Swap requests</Title>
          {mySwaps.data.map((swap) => {
            const isRequester = swap.requesterId === loggedUserId;
            const isPartner = swap.partnerId === loggedUserId;
            const showPartnerActions = swap.status === "pending_partner" && isPartner;
            const canCancel =
              (swap.status === "pending_partner" || swap.status === "pending_manager") && (isRequester || isPartner);
            const requesterShiftLabel = swap.fromAssignment?.shiftInstance
              ? `Your shift: ${dayjs(swap.fromAssignment.shiftInstance.date).format("MMM D")} - ${swap.fromAssignment.shiftInstance.shiftType?.name ?? "Shift"} - ${swap.fromAssignment.roleInShift}`
              : null;
            const partnerShiftLabel = swap.toAssignment?.shiftInstance
              ? `${swap.partner?.firstName ?? "Teammate"} ${swap.partner?.lastName ?? ""} shift: ${dayjs(swap.toAssignment.shiftInstance.date).format("MMM D")} - ${swap.toAssignment.shiftInstance.shiftType?.name ?? "Shift"} - ${swap.toAssignment.roleInShift}`
              : null;

            return (
              <Card key={swap.id} withBorder radius="md">
                <Stack gap="xs">
                  <Stack gap={2}>
                    <Text size="sm" fw={600}>
                      Request #{swap.id} - <Badge>{getSwapStatusLabel(swap.status)}</Badge>
                    </Text>
                    <Text size="xs" c="dimmed">
                      {`Requested by ${
                        isRequester
                          ? "you"
                          : `${swap.requester?.firstName ?? "Teammate"} ${swap.requester?.lastName ?? ""}`.trim()
                      }`}
                    </Text>
                    {requesterShiftLabel ? <Text size="xs">{requesterShiftLabel}</Text> : null}
                    {partnerShiftLabel ? <Text size="xs">{partnerShiftLabel}</Text> : null}
                    {swap.decisionReason ? (
                      <Text size="xs" c="dimmed">
                        {swap.decisionReason}
                      </Text>
                    ) : null}
                  </Stack>
                  {(showPartnerActions || canCancel) && (
                    <Group justify="space-between" align="center">
                      {showPartnerActions ? (
                        <Group gap="xs">
                          <Button
                            variant="light"
                            color="green"
                            loading={respondingSwapId === swap.id && partnerResponse.isPending}
                            onClick={() => handlePartnerDecision(swap.id, true)}
                          >
                            Accept
                          </Button>
                          <Button
                            variant="light"
                            color="red"
                            loading={respondingSwapId === swap.id && partnerResponse.isPending}
                            onClick={() => handlePartnerDecision(swap.id, false)}
                          >
                            Decline
                          </Button>
                        </Group>
                      ) : (
                        <span />
                      )}
                      {canCancel ? (
                        <Button
                          variant="light"
                          color="gray"
                          loading={cancelingSwapId === swap.id && cancelSwap.isPending}
                          onClick={() => handleCancelSwap(swap.id)}
                        >
                          Cancel request
                        </Button>
                      ) : null}
                    </Group>
                  )}
                </Stack>
              </Card>
            );
          })}
        </Stack>
      )}

      <SwapRequestModal
        opened={swapModal.opened}
        onClose={() => setSwapModal({ opened: false, assignment: null, shift: null })}
        onSubmit={handleSubmitSwap}
        fromAssignment={swapModal.assignment}
        fromShift={swapModal.shift}
        potentialAssignments={modalAssignments}
      />
    </Stack>
  );
};

export default MyShiftsPage;
