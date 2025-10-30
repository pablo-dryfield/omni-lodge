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
  Textarea,
  Title,
} from "@mantine/core";
import { IconHistory, IconPlus, IconTrash } from "@tabler/icons-react";
import dayjs from "dayjs";
import isoWeek from "dayjs/plugin/isoWeek";
import type { AxiosError } from "axios";
import axiosInstance from "../../utils/axiosInstance";
import { useAppSelector } from "../../store/hooks";
import { makeSelectIsModuleActionAllowed } from "../../selectors/accessControlSelectors";
import {
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
  useWeekSummary,
} from "../../api/scheduling";
import { useShiftRoles } from "../../api/shiftRoles";
import WeekSelector from "../../components/scheduling/WeekSelector";
import AddShiftInstanceModal from "../../components/scheduling/AddShiftInstanceModal";
import AssignmentCell from "../../components/scheduling/AssignmentCell";
import type { ShiftAssignment, ShiftInstance, ScheduleViolation } from "../../types/scheduling";
import type { ServerResponse } from "../../types/general/ServerResponse";
import type { ShiftRole } from "../../types/shiftRoles/ShiftRole";

dayjs.extend(isoWeek);

type StaffOption = {
  value: string;
  label: string;
};

type RoleOption = {
  value: string;
  label: string;
  shiftRoleId: number | null;
  roleName: string;
  isCustomEntry?: boolean;
};

const ROLE_PRIORITY: Record<string, number> = {
  manager: 0,
  leader: 1,
  guide: 2,
  "social media": 3,
};

const normalizeRoleName = (roleName: string | null | undefined) => roleName?.trim().toLowerCase() ?? "";

const getRolePriority = (roleName: string, fallbackIndex: number) =>
  (ROLE_PRIORITY[normalizeRoleName(roleName)] ?? 10) + fallbackIndex / 1000;

const makeRoleValue = (opts: { shiftRoleId: number | null; roleName: string; prefix?: string }) => {
  if (opts.shiftRoleId != null) {
    return `shift-role:${opts.shiftRoleId}`;
  }
  const base = opts.roleName.trim().toLowerCase().replace(/\s+/g, "-");
  return `${opts.prefix ?? "custom"}:${base || "role"}`;
};

const BuilderPage = () => {
  const [weekOptions, initialWeekValue] = useMemo(() => {
    const options = getUpcomingWeeks(6);
    const initial = options[1]?.value ?? options[0]?.value ?? "";
    return [options, initial] as const;
  }, []);

  const [selectedWeek, setSelectedWeek] = useState<string>(initialWeekValue);
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

  const assignMutation = useAssignShifts();
  const deleteAssignmentMutation = useDeleteAssignment();
  const createInstanceMutation = useCreateShiftInstance();
  const deleteInstanceMutation = useDeleteShiftInstance();
  const autoAssignMutation = useAutoAssignWeek();
  const lockWeekMutation = useLockWeek();
  const publishWeekMutation = usePublishWeek();
  const reopenWeekMutation = useReopenWeek();

  const weekStart = useMemo(() => {
    if (!selectedWeek) {
      return null;
    }
    const [year, weekPart] = selectedWeek.split("-W");
    return dayjs().year(Number(year)).isoWeek(Number(weekPart)).startOf("isoWeek");
  }, [selectedWeek]);

  const weekStartLabel = weekStart ? `${weekStart.format("MMM D")} - ${weekStart.add(6, "day").format("MMM D")}` : "";

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

  const instances = instancesQuery.data ?? [];
  const weekViolations = summaryQuery.data?.violations ?? [];
  const weekState = summaryQuery.data?.week?.state ?? null;
  const isPublished = weekState === "published";
  const canModifyWeek = Boolean(weekId) && !isPublished;

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
          disabled={!canModifyWeek}
        >
          Add shift
        </Button>
        <Button
          variant="light"
          color="indigo"
          onClick={handleAutoAssign}
          loading={autoAssignMutation.isPending}
          disabled={!canModifyWeek}
        >
          Auto assign volunteers
        </Button>
        <Button
          variant="light"
          color="gray"
          onClick={handleLockWeek}
          loading={lockWeekMutation.isPending}
          disabled={!canModifyWeek}
        >
          Lock week
        </Button>
        <Button
          variant="filled"
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

      {weekViolations.length ? (
        <Alert color="yellow" title="Open scheduling issues">
          <Stack gap={4}>
            {weekViolations.map((violation) => (
              <Text key={`${violation.code}-${violation.message}`} size="sm">
                • {violation.message}
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
                    • {violation.message}
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
          <Text size="sm">The week has been moved back to the locked state. You can make adjustments and publish again.</Text>
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

      {instancesQuery.isLoading ? (
        <Loader />
      ) : (
        <SimpleGrid cols={{ base: 1, md: 2, lg: 3 }} spacing="lg">
          {instances.map((instance) => {
            const dateLabel = dayjs(instance.date).format("ddd, MMM D");
            const timeLabel = instance.timeEnd ? `${instance.timeStart} - ${instance.timeEnd}` : instance.timeStart;
            const templateRoles = instance.requiredRoles ?? instance.template?.defaultRoles ?? [];
            const assignmentsByUser = new Map<string, ShiftAssignment[]>();
            (instance.assignments ?? []).forEach((assignment) => {
              const key =
                assignment.userId != null ? `user-${assignment.userId}` : `assignment-${assignment.id}`;
              const existing = assignmentsByUser.get(key);
              if (existing) {
                existing.push(assignment);
              } else {
                assignmentsByUser.set(key, [assignment]);
              }
            });

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
                      <Badge key={`${role.shiftRoleId ?? "custom"}-${role.role}`} variant="light" color="gray">
                        {role.role}
                      </Badge>
                    ))}
                  </Group>
                  <Divider />
                  <Stack gap="sm">
                    {Array.from(assignmentsByUser.entries()).map(([groupKey, groupAssignments]) => (
                      <AssignmentCell
                        key={groupKey}
                        assignments={groupAssignments}
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

      <Modal opened={assignmentModal.opened} onClose={handleCloseAssignment} title="Assign staff">
        <Stack>
          {assignmentError ? (
            <Alert color="red" title="Unable to assign">
              <Text size="sm">{assignmentError}</Text>
            </Alert>
          ) : null}
          <Select
            data={staff}
            label="Team member"
            placeholder="Select staff"
            value={assignmentUserId}
            onChange={setAssignmentUserId}
            searchable
            nothingFoundMessage="No staff found"
          />
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
