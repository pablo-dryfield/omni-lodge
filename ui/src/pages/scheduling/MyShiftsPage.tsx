import { useCallback, useMemo, useState } from "react";
import { Alert, Badge, Button, Card, Group, Stack, Text, Title } from "@mantine/core";
import dayjs from "dayjs";
import isoWeek from "dayjs/plugin/isoWeek";
import type { AxiosError } from "axios";
import { useAppSelector } from "../../store/hooks";
import { getUpcomingWeeks, useCreateSwap, useEnsureWeek, useMySwaps, useShiftInstances } from "../../api/scheduling";
import WeekSelector from "../../components/scheduling/WeekSelector";
import SwapRequestModal from "../../components/scheduling/SwapRequestModal";
import type { ShiftAssignment, ShiftInstance } from "../../types/scheduling";

dayjs.extend(isoWeek);

type SwapCandidate = {
  assignment: ShiftAssignment;
  partnerId: number;
  partnerName: string;
  date: string;
  shiftTypeId: number;
  shiftTypeName: string | null;
  shiftStart: string;
  shiftEnd: string | null;
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
      return date.isBetween(selectedWeekRange.start, selectedWeekRange.end, null, "[]");
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

  const partnerLookup = useMemo(() => {
    if (!instancesForWeek.length || !loggedUserId || !weekId || !selectedWeekRange) {
      return new Map<number, { label: string; staffProfileType: string | null }>();
    }
    const map = new Map<number, { label: string; staffProfileType: string | null }>();
    instancesForWeek.forEach((instance) => {
      (instance.assignments ?? []).forEach((assignment) => {
        if (assignment.assignee && assignment.userId !== loggedUserId) {
          const profileType =
            assignment.assignee.staffProfile?.staffType ??
            (assignment.assignee.userShiftRoles?.[0]?.staffType ?? null);
          map.set(assignment.userId, {
            label: `${assignment.assignee.firstName} ${assignment.assignee.lastName}`,
            staffProfileType: profileType ?? null,
          });
        }
      });
    });
    return map;
  }, [instancesForWeek, loggedUserId, weekId, selectedWeekRange]);

  const partners = useMemo(() => {
    return Array.from(partnerLookup.entries()).map(([userId, info]) => ({
      value: userId.toString(),
      label: info.label,
    }));
  }, [partnerLookup]);

  const potentialAssignments = useMemo(() => {
    if (!instancesForWeek.length || !loggedUserId || !weekId || !selectedWeekRange) {
      return [];
    }
    const assignments: Array<
      ShiftAssignment & { shiftInstance: ShiftInstance; partnerProfileType: string | null }
    > = [];
    instancesForWeek.forEach((instance) => {
      const partnerScope = instance.assignments?.reduce((scope, assignment) => {
        if (assignment.assignee) {
          scope[assignment.userId] =
            assignment.assignee.staffProfile?.staffType ??
            (assignment.assignee.userShiftRoles?.[0]?.staffType ?? null);
        }
        return scope;
      }, {} as Record<number, string | null>);

      (instance.assignments ?? []).forEach((assignment) => {
        if (assignment.userId !== loggedUserId) {
          const profileType = partnerScope?.[assignment.userId] ?? null;
          assignments.push({
            ...assignment,
            shiftInstance: instance,
            partnerProfileType: profileType,
          });
        }
      });
    });
    return assignments;
  }, [instancesForWeek, loggedUserId, weekId, selectedWeekRange]);

  const handleOpenSwap = (entry: { shift: ShiftInstance; assignment: ShiftAssignment }) => {
    setSwapModal({ opened: true, assignment: entry.assignment, shift: entry.shift });
  };

  const handleSubmitSwap = async (payload: { fromAssignmentId: number; toAssignmentId: number; partnerId: number }) => {
    await createSwap.mutateAsync(payload);
  };

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
            {myAssignments.map((item) => (
              <Card key={item.assignment.id} withBorder shadow="sm" radius="md">
                <Group justify="space-between" align="flex-start">
                  <Stack gap={4}>
                  <Text fw={600}>{item.shift.shiftType?.name ?? "Shift"}</Text>
                  <Text size="sm" c="dimmed">
                    {dayjs(item.shift.date).format("dddd, MMM D")} · {item.shift.timeStart}
                    {item.shift.timeEnd ? ` – ${item.shift.timeEnd}` : ""}
                  </Text>
                  <Badge variant="light" color="blue">
                    {item.assignment.roleInShift}
                  </Badge>
                </Stack>
                <Button variant="light" onClick={() => handleOpenSwap(item)}>
                  Request swap
                </Button>
              </Group>
            </Card>
          ))}
        </Stack>
      )}

      <Select
        label="Swap partner"
        placeholder="Choose teammate"
        data={partners}
        value={swapModal.partnerId ?? null}
        onChange={(value) =>
          setSwapModal((current) => ({
            ...current,
            partnerId: value,
          }))
        }
        disabled={!swapModal.opened}
      />

      <Select
        label="Swap assignment"
        placeholder="Select assignment to swap into"
        data={potentialAssignments.map((assignment) => ({
          value: assignment.id.toString(),
          label: `${dayjs(assignment.shiftInstance?.date).format("MMM D")} • ${
            assignment.shiftInstance?.shiftType?.name ?? "Shift"
          } • ${assignment.assignee ? `${assignment.assignee.firstName} ${assignment.assignee.lastName}` : "Open"}`,
        }))}
        value={swapModal.targetAssignmentId ?? null}
        onChange={(value) =>
          setSwapModal((current) => ({
            ...current,
            targetAssignmentId: value,
          }))
        }
        disabled={!swapModal.opened}
      />

      {mySwaps.data && mySwaps.data.length > 0 && (
        <Stack mt="lg" gap="sm">
          <Title order={5}>Swap requests</Title>
          {mySwaps.data.map((swap) => (
            <Card key={swap.id} withBorder radius="md">
              <Group justify="space-between">
                <Text size="sm">
                  Request #{swap.id} — <Badge>{swap.status}</Badge>
                </Text>
                {swap.decisionReason && (
                  <Text size="xs" c="dimmed">
                    {swap.decisionReason}
                  </Text>
                )}
              </Group>
            </Card>
          ))}
        </Stack>
      )}

      <SwapRequestModal
        opened={swapModal.opened}
        onClose={() => setSwapModal({ opened: false, assignment: null, shift: null })}
        onSubmit={handleSubmitSwap}
        fromAssignment={swapModal.assignment}
        potentialAssignments={potentialAssignments}
        partners={partners}
      />
    </Stack>
  );
};

export default MyShiftsPage;



