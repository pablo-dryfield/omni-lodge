import { useEffect, useMemo, useState } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Divider,
  Group,
  Loader,
  Modal,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import dayjs from "dayjs";
import isoWeek from "dayjs/plugin/isoWeek";
import type { AxiosError } from "axios";
import axiosInstance from "../../utils/axiosInstance";
import { useAppSelector } from "../../store/hooks";
import { makeSelectIsModuleActionAllowed } from "../../selectors/accessControlSelectors";
import {
  useAssignShifts,
  useCreateShiftInstance,
  useDeleteAssignment,
  useDeleteShiftInstance,
  useEnsureWeek,
  useAutoAssignWeek,
  useLockWeek,
  usePublishWeek,
  useShiftInstances,
  useShiftTemplates,
  useWeekSummary,
  getUpcomingWeeks,
} from "../../api/scheduling";
import WeekSelector from "../../components/scheduling/WeekSelector";
import AddShiftInstanceModal from "../../components/scheduling/AddShiftInstanceModal";
import AssignmentCell from "../../components/scheduling/AssignmentCell";
import type { ShiftAssignment, ShiftInstance, ShiftTemplate } from "../../types/scheduling";
import type { ServerResponse } from "../../types/general/ServerResponse";

dayjs.extend(isoWeek);

type StaffOption = {
  value: string;
  label: string;
};

const BuilderPage = () => {
  const [weekOptions, initialWeekValue] = useMemo<[ReturnType<typeof getUpcomingWeeks>, string]>(() => {
    const options = getUpcomingWeeks(6);
    const initial = options[1]?.value ?? options[0]?.value ?? "";
    return [options, initial];
  }, []);
  const [selectedWeek, setSelectedWeek] = useState<string>(initialWeekValue);
  const [showAddInstance, setShowAddInstance] = useState(false);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [assignmentModal, setAssignmentModal] = useState<{
    opened: boolean;
    shift: ShiftInstance | null;
  }>({ opened: false, shift: null });
  const [assignmentRole, setAssignmentRole] = useState<string>("");
  const [assignmentUserId, setAssignmentUserId] = useState<string | null>(null);

  const selectCanAccessBuilder = useMemo(
    () => makeSelectIsModuleActionAllowed("scheduling-builder", "view"),
    [],
  );
  const canAccessBuilder = useAppSelector(selectCanAccessBuilder);
  const { loaded: accessLoaded, loading: accessLoading } = useAppSelector((state) => state.accessControl);

  const ensureWeekQuery = useEnsureWeek(selectedWeek, { allowGenerate: canAccessBuilder, enabled: canAccessBuilder });
  const weekId = canAccessBuilder ? ensureWeekQuery.data?.week?.id ?? null : null;
  const summaryQuery = useWeekSummary(canAccessBuilder ? weekId : null);
  const templatesQuery = useShiftTemplates({ enabled: canAccessBuilder });
  const instancesQuery = useShiftInstances(canAccessBuilder ? weekId : null);
  const assignMutation = useAssignShifts();
  const deleteAssignmentMutation = useDeleteAssignment();
  const createInstanceMutation = useCreateShiftInstance();
  const deleteInstanceMutation = useDeleteShiftInstance();
  const autoAssignMutation = useAutoAssignWeek();
  const lockWeekMutation = useLockWeek();
  const publishWeekMutation = usePublishWeek();

  const weekStart = useMemo(() => {
    if (!selectedWeek) {
      return null;
    }
    const [year, weekPart] = selectedWeek.split("-W");
    return dayjs().year(Number(year)).isoWeek(Number(weekPart)).startOf("isoWeek");
  }, [selectedWeek]);

  const weekStartLabel = weekStart ? `${weekStart.format("MMM D")} - ${weekStart.add(6, "day").format("MMM D")}` : "";

  const { reset: resetAutoAssign } = autoAssignMutation;

  useEffect(() => {
    resetAutoAssign();
  }, [resetAutoAssign, weekId]);

  useEffect(() => {
    if (!canAccessBuilder) {
      setStaff([]);
      return;
    }

    const fetchStaff = async () => {
      const response = await axiosInstance.get<ServerResponse<{ id: number; firstName: string; lastName: string }>>(
        "/users/active",
      );
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

  const autoAssignData = autoAssignMutation.data;

  const autoAssignErrorMessage = useMemo(() => {
    const error = autoAssignMutation.error;
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

  const handleOpenAssignment = (shift: ShiftInstance) => {
    setAssignmentModal({ opened: true, shift });
    setAssignmentRole("");
    setAssignmentUserId(null);
  };

  const handleCreateAssignment = async () => {
    if (!assignmentModal.shift || !assignmentUserId || !weekId) {
      return;
    }
    await assignMutation.mutateAsync({
      assignments: [
        {
          shiftInstanceId: assignmentModal.shift.id,
          userId: Number(assignmentUserId),
          roleInShift: assignmentRole || "Staff",
        },
      ],
      weekId,
    });
    setAssignmentModal({ opened: false, shift: null });
  };

  const handleRemoveAssignment = async (assignment: ShiftAssignment) => {
    if (!weekId) return;
    await deleteAssignmentMutation.mutateAsync({ assignmentId: assignment.id, weekId });
  };

  const handleDeleteInstance = async (instance: ShiftInstance) => {
    if (!weekId) return;
    await deleteInstanceMutation.mutateAsync({ id: instance.id, weekId });
  };

  const handleCreateInstance = async (payload: Parameters<typeof createInstanceMutation.mutateAsync>[0]) => {
    await createInstanceMutation.mutateAsync(payload);
  };

  const handleLockWeek = async () => {
    if (!weekId) return;
    await lockWeekMutation.mutateAsync(weekId);
  };

  const handlePublishWeek = async () => {
    if (!weekId) return;
    await publishWeekMutation.mutateAsync(weekId);
  };

  const handleAutoAssign = async () => {
    if (!weekId) {
      return;
    }
    try {
      await autoAssignMutation.mutateAsync({ weekId });
    } catch {
      // errors are surfaced via mutation state
    }
  };

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
      ) : null}

      <Group justify="space-between" align="flex-end">
        <Stack gap={4}>
          <Title order={3}>Schedule builder</Title>
          <Text size="sm" c="dimmed">
            {weekStartLabel}
          </Text>
        </Stack>
        <WeekSelector value={selectedWeek} onChange={setSelectedWeek} weeks={weekOptions} />
      </Group>

      <Group>
        <Button
          leftSection={<IconPlus size={16} />}
          onClick={() => setShowAddInstance(true)}
          disabled={!weekId}
        >
          Add shift
        </Button>
        <Button
          variant="light"
          color="indigo"
          onClick={handleAutoAssign}
          loading={autoAssignMutation.isPending}
          disabled={!weekId}
        >
          Auto assign volunteers
        </Button>
        <Button
          variant="light"
          color="gray"
          onClick={handleLockWeek}
          loading={lockWeekMutation.isPending}
          disabled={!weekId}
        >
          Lock week
        </Button>
        <Button
          variant="filled"
          color="green"
          onClick={handlePublishWeek}
          loading={publishWeekMutation.isPending}
          disabled={!weekId}
        >
          Publish
        </Button>
      </Group>

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

      {instancesQuery.isLoading ? (
        <Loader />
      ) : (
        <SimpleGrid cols={{ base: 1, md: 2, lg: 3 }} spacing="lg">
          {(instancesQuery.data ?? []).map((instance) => {
            const dateLabel = dayjs(instance.date).format("ddd, MMM D");
            const timeLabel = instance.timeEnd ? `${instance.timeStart} - ${instance.timeEnd}` : instance.timeStart;
            const templateRoles = instance.requiredRoles ?? instance.template?.defaultRoles ?? [];
            return (
              <Card key={instance.id} withBorder shadow="sm" radius="md">
                <Stack gap="sm">
                  <Group justify="space-between">
                    <Stack gap={0}>
                      <Text fw={600}>{instance.shiftType?.name ?? "Shift"}</Text>
                      <Text size="sm" c="dimmed">
                        {dateLabel} | {timeLabel}
                      </Text>
                    </Stack>
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      onClick={() => handleDeleteInstance(instance)}
                      disabled={deleteInstanceMutation.isPending}
                    >
                      <IconTrash size={16} />
                    </ActionIcon>
                  </Group>
                  <Group gap="xs">
                    {templateRoles.map((role) => (
                      <Badge key={role.role} variant="light" color="gray">
                        {role.role}
                      </Badge>
                    ))}
                  </Group>
                  <Divider />
                  <Stack gap="sm">
                    {(instance.assignments ?? []).map((assignment) => (
                      <AssignmentCell
                        key={assignment.id}
                        assignment={assignment}
                        onRemove={handleRemoveAssignment}
                        canManage
                      />
                    ))}
                    <Button
                      variant="light"
                      leftSection={<IconPlus size={16} />}
                      onClick={() => handleOpenAssignment(instance)}
                    >
                      Assign staff
                    </Button>
                  </Stack>
                </Stack>
              </Card>
            );
          })}
        </SimpleGrid>
      )}

      <AddShiftInstanceModal
        opened={showAddInstance}
        onClose={() => setShowAddInstance(false)}
        onSubmit={handleCreateInstance}
        scheduleWeekId={weekId ?? 0}
        defaultDate={weekStart?.toDate() ?? new Date()}
        templates={templatesQuery.data ?? []}
      />

      <Modal
        opened={assignmentModal.opened}
        onClose={() => setAssignmentModal({ opened: false, shift: null })}
        title="Assign staff"
      >
        <Stack>
          <Select
            data={staff}
            label="Team member"
            placeholder="Select staff"
            value={assignmentUserId}
            onChange={setAssignmentUserId}
            searchable
            nothingFoundMessage="No staff found"
          />
          <TextInput
            label="Role in shift"
            placeholder="Leader, Guide, Staff..."
            value={assignmentRole}
            onChange={(event) => setAssignmentRole(event.currentTarget.value)}
          />
          <Button onClick={handleCreateAssignment} disabled={!assignmentUserId || !weekId} loading={assignMutation.isPending}>
            Save assignment
          </Button>
        </Stack>
      </Modal>
    </Stack>
  );
};

export default BuilderPage;






