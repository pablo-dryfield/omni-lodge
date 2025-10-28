import { useEffect, useMemo, useState } from "react";
import { Alert, Anchor, Card, Group, Select, SimpleGrid, Stack, Text, Title } from "@mantine/core";
import dayjs from "dayjs";
import isoWeek from "dayjs/plugin/isoWeek";
import type { AxiosError } from "axios";
import axiosInstance from "../../utils/axiosInstance";
import { getUpcomingWeeks, useEnsureWeek, useScheduleExports, useScheduleReports } from "../../api/scheduling";
import WeekSelector from "../../components/scheduling/WeekSelector";
import type { ServerResponse } from "../../types/general/ServerResponse";
import type { ShiftAssignment } from "../../types/scheduling";

dayjs.extend(isoWeek);

const HistoryPage = () => {
  const weeks = useMemo(() => getUpcomingWeeks(8), []);
  const [exportWeek, setExportWeek] = useState(weeks[0]?.value ?? "");
  const [fromWeek, setFromWeek] = useState(weeks[0]?.value ?? "");
  const [toWeek, setToWeek] = useState(weeks[0]?.value ?? "");
  const [userOptions, setUserOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [selectedUser, setSelectedUser] = useState<string | null>(null);

  const ensureExportWeekQuery = useEnsureWeek(exportWeek, { allowGenerate: false });
  const exportWeekId = ensureExportWeekQuery.data?.week.id ?? null;
  const exportsQuery = useScheduleExports(exportWeekId);
  const reportsQuery = useScheduleReports({ from: fromWeek, to: toWeek, userId: selectedUser ? Number(selectedUser) : undefined });


  useEffect(() => {
    const fetchUsers = async () => {
      const response = await axiosInstance.get<ServerResponse<{ id: number; firstName: string; lastName: string }>>("/users/active");
      const items = response.data?.[0]?.data ?? [];
      setUserOptions(items.map((item) => ({ value: item.id.toString(), label: `${item.firstName} ${item.lastName}` })));
    };
    void fetchUsers();
  }, []);

  const assignmentGroups = useMemo(() => {
    const items = reportsQuery.data ?? [];
    const grouped = new Map<string, ShiftAssignment[]>();
    items.forEach((assignment) => {
      const date = (assignment as unknown as { shiftInstance?: { date?: string } }).shiftInstance?.date ?? "unknown";
      const dayLabel = dayjs(date).isValid() ? dayjs(date).format("dddd, MMM D") : date;
      const current = grouped.get(dayLabel) ?? [];
      current.push(assignment);
      grouped.set(dayLabel, current);
    });
    return Array.from(grouped.entries());
  }, [reportsQuery.data]);

  return (
    <Stack mt="lg" gap="lg">
      {ensureExportWeekQuery.isError ? (
        <Alert color="red" title="Unable to load scheduling week">
          <Text size="sm">
            {((ensureExportWeekQuery.error as AxiosError)?.response?.status === 401
              ? "You do not have permission to generate the schedule week. Please contact a manager."
              : (ensureExportWeekQuery.error as Error).message) ?? "Failed to load scheduling week."}
          </Text>
        </Alert>
      ) : null}

      <Title order={3}>History & exports</Title>

      <Group justify="space-between" align="flex-end">
        <Stack gap="xs">
          <Text fw={600}>Exports</Text>
          <WeekSelector value={exportWeek} onChange={setExportWeek} />
        </Stack>
        <Stack gap="xs">
          <Text fw={600}>Assignments report</Text>
          <Group align="flex-end">
            <WeekSelector value={fromWeek} onChange={setFromWeek} label="From week" />
            <WeekSelector value={toWeek} onChange={setToWeek} label="To week" />
            <Select
              data={userOptions}
              value={selectedUser}
              onChange={setSelectedUser}
              placeholder="All staff"
              label="User"
              clearable
            />
          </Group>
        </Stack>
      </Group>

      <Stack>
        <Title order={5}>Exports</Title>
        {exportsQuery.data?.length ? (
          <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }}>
            {exportsQuery.data.map((item) => (
              <Card key={item.id} withBorder>
                <Stack gap={4}>
                  <Text fw={500}>{dayjs(item.createdAt).format("MMM D, YYYY HH:mm")}</Text>
                  <Anchor href={item.url} target="_blank" rel="noopener noreferrer">
                    Open in Drive
                  </Anchor>
                </Stack>
              </Card>
            ))}
          </SimpleGrid>
        ) : (
          <Text size="sm" c="dimmed">
            No exports yet.
          </Text>
        )}
      </Stack>

      <Stack>
        <Title order={5}>Assignments</Title>
        {assignmentGroups.length === 0 ? (
          <Text size="sm" c="dimmed">
            No assignments found in this range.
          </Text>
        ) : (
          assignmentGroups.map(([dayLabel, assignments]) => (
            <Card key={dayLabel} withBorder>
              <Stack gap={4}>
                <Text fw={600}>{dayLabel}</Text>
                {assignments.map((assignment) => (
                  <Text size="sm" key={assignment.id}>
                    Assignment #{assignment.id} — role {assignment.roleInShift}
                  </Text>
                ))}
              </Stack>
            </Card>
          ))
        )}
      </Stack>
    </Stack>
  );
};

export default HistoryPage;











