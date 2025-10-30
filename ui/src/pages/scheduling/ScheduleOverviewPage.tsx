import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  Center,
  Group,
  Loader,
  Stack,
  Text,
  ThemeIcon,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconCalendarEvent,
  IconChevronLeft,
  IconChevronRight,
} from "@tabler/icons-react";
import dayjs from "dayjs";
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
  manager: 0,
  leader: 1,
  guide: 2,
  "social media": 3,
};

const normalizeRoleName = (value: string | null | undefined) => value?.trim().toLowerCase() ?? "";

const getRoleOrderValue = (assignment: ShiftAssignment, index: number) =>
  (ROLE_PRIORITY[normalizeRoleName(assignment.roleInShift)] ?? 10) + index / 1000;

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

const getUserColor = (userId: number | null | undefined) => {
  if (!userId) {
    return "#E0E0E0";
  }
  const hue = (userId * 37) % 360;
  return `hsl(${hue}, 75%, 85%)`;
};

const formatWeekValue = (weekValue: string) => {
  const [year, weekPart] = weekValue.split("-W");
  return formatScheduleWeekLabel(Number(year), Number(weekPart));
};

const ensureIsoWeekString = (date: dayjs.Dayjs) => `${date.isoWeekYear()}-W${String(date.isoWeek()).padStart(2, "0")}`;

const buildMonthSegments = (days: dayjs.Dayjs[]) => {
  const segments: Array<{ label: string; span: number }> = [];
  let current: { label: string; span: number } | null = null;
  days.forEach((day) => {
    const label = day.format("MMMM");
    if (!current || current.label !== label) {
      current = { label, span: 1 };
      segments.push(current);
    } else {
      current.span += 1;
    }
  });
  return segments;
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
        (a, b) =>
          getRoleOrderValue(a.assignment, a.index) - getRoleOrderValue(b.assignment, b.index),
      )
      .map(({ assignment }) => assignment),
  );
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

  const weekStart = useMemo(() => {
    const [year, weekPart] = selectedWeek.split("-W");
    if (!year || !weekPart) {
      return dayjs().startOf("isoWeek");
    }
    return dayjs().year(Number(year)).isoWeek(Number(weekPart)).startOf("isoWeek");
  }, [selectedWeek]);

  const daysOfWeek = useMemo(() => Array.from({ length: 7 }, (_, index) => weekStart.add(index, "day")), [weekStart]);
  const monthSegments = useMemo(() => buildMonthSegments(daysOfWeek), [daysOfWeek]);

  const pubCrawlInstances = useMemo(() => {
    if (!shiftInstancesQuery.data) {
      return [];
    }
    return (shiftInstancesQuery.data ?? []).filter(
      (instance) =>
        instance.shiftType?.key === "PUB_CRAWL" ||
        instance.shiftType?.name?.toLowerCase().includes("pub crawl") ||
        instance.template?.name?.toLowerCase().includes("pub crawl"),
    );
  }, [shiftInstancesQuery.data]);

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

  const loading = ensureWeekQuery.isLoading || shiftInstancesQuery.isLoading;
  const hasWeek = Boolean(weekId);
  const error = ensureWeekQuery.isError ? ensureWeekQuery.error : shiftInstancesQuery.error;

  return (
    <Stack mt="lg" gap="lg">
      <Group justify="space-between" align="flex-end">
        <Group gap="xs">
          <Button
            variant="subtle"
            color="dark"
            leftSection={<IconChevronLeft size={16} />}
            onClick={() => handleNavigateWeek(-1)}
          >
            Previous
          </Button>
          <Button
            variant="subtle"
            color="dark"
            rightSection={<IconChevronRight size={16} />}
            onClick={() => handleNavigateWeek(1)}
          >
            Next
          </Button>
        </Group>
        <Stack gap={2} align="center" style={{ flex: 1 }}>
          <Text fw={600} size="sm" c="dimmed">
            Week of
          </Text>
          <WeekSelector
            value={selectedWeek}
            onChange={setSelectedWeek}
            selectProps={{ style: { maxWidth: 240, width: "100%" } }}
          />
        </Stack>
        <ThemeIcon radius="xl" size="lg" variant="light" color="grape">
          <IconCalendarEvent size={18} />
        </ThemeIcon>
      </Group>

      {error ? (
        <Alert color="red" title="Unable to load schedule">
          <Text size="sm">{(error as Error).message}</Text>
        </Alert>
      ) : null}

      {loading ? (
        <Center py="xl">
          <Loader />
        </Center>
      ) : !hasWeek ? (
        <Alert color="yellow" title="Week not available">
          <Text size="sm">
            Schedule data for {formatWeekValue(selectedWeek)} is not available yet. Generate the week from the builder to
            view assignments.
          </Text>
        </Alert>
      ) : (
        <Card withBorder shadow="sm" radius="md" padding="lg" style={{ backgroundColor: "#f6f0ff" }}>
          <Stack gap="lg">
            <Group align="flex-start" gap="lg">
              <Card
                shadow="sm"
                radius="md"
                withBorder
                padding="lg"
                style={{ maxWidth: 260, backgroundColor: "#fbeae6" }}
              >
                <Stack gap="xs">
                  <Text fw={700} size="lg">
                    Krawl Through Krakow
                  </Text>
                  <Text size="sm">
                    Leader confirms the power hour venue with the Manager on shift. While doing the hostel run, check if
                    they have enough ticket books, flyers and posters with the right price. Promote the pub crawl with
                    the hostel guests in common areas. Hostel staff can also be invited to join the pub crawl for free.
                    <Text fw={700} component="span">
                      {" "}
                      Confirm hostel with the person on Takes / Manager.
                    </Text>
                  </Text>
                </Stack>
              </Card>

              <Box style={{ flex: 1, overflowX: "auto" }}>
                <Box component="table" style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
                  <thead>
                    <tr>
                      <th
                        colSpan={8}
                        style={{
                          textAlign: "center",
                          backgroundColor: "#d8bfd8",
                          padding: "12px",
                          fontSize: "20px",
                          fontWeight: 700,
                          border: "2px solid #8b658b",
                        }}
                      >
                        Pub Crawl – 8:45 P.M.
                      </th>
                    </tr>
                    <tr>
                      <th
                        style={{
                          width: 140,
                          backgroundColor: "#f8e5f8",
                          border: "2px solid #8b658b",
                          padding: "6px",
                          textAlign: "center",
                        }}
                      >
                        {weekStart.format("MMMM YYYY")}
                      </th>
                      {monthSegments.map((segment) => (
                        <th
                          key={segment.label}
                          colSpan={segment.span}
                          style={{
                            backgroundColor: "#f8e5f8",
                            border: "2px solid #8b658b",
                            padding: "6px",
                            textAlign: "center",
                            textTransform: "uppercase",
                            fontWeight: 600,
                          }}
                        >
                          {segment.label}
                        </th>
                      ))}
                    </tr>
                    <tr>
                      <th
                        style={{
                          backgroundColor: "#f8e5f8",
                          border: "2px solid #8b658b",
                          padding: "8px",
                          textAlign: "left",
                        }}
                      >
                        Role
                      </th>
                      {daysOfWeek.map((day) => (
                        <th
                          key={day.toString()}
                          style={{
                            backgroundColor: "#f8e5f8",
                            border: "2px solid #8b658b",
                            padding: "8px",
                            textAlign: "center",
                          }}
                        >
                          <Stack gap={0} align="center">
                            <Text fw={700} size="sm">
                              {day.format("DD")}
                            </Text>
                            <Text size="xs" c="dimmed">
                              {day.format("ddd")}
                            </Text>
                          </Stack>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {["Guides", "Social Media", "Leader", "Manager / Takes"].map((roleLabel) => (
                      <tr key={roleLabel}>
                        <td
                          style={{
                            border: "2px solid #8b658b",
                            padding: "10px",
                            fontWeight: 600,
                            backgroundColor: "#fdf2ff",
                          }}
                        >
                          {roleLabel}
                        </td>
                        {daysOfWeek.map((day) => {
                          const isoDate = day.format("YYYY-MM-DD");
                          const assignments = assignmentsByDate.get(isoDate) ?? [];

                          const matchingAssignments = assignments.filter((assignment) => {
                            const normalized = normalizeRoleName(assignment.roleInShift);
                            if (roleLabel === "Guides") {
                              return normalized.includes("guide");
                            }
                            if (roleLabel === "Social Media") {
                              return normalized.includes("social");
                            }
                            if (roleLabel === "Leader") {
                              return normalized.includes("leader");
                            }
                            if (roleLabel === "Manager / Takes") {
                              return normalized.includes("manager") || normalized.includes("takes");
                            }
                            return false;
                          });

                          const grouped = groupAssignmentsByUser(matchingAssignments);

                          return (
                            <td
                              key={isoDate + roleLabel}
                              style={{
                                border: "2px solid #8b658b",
                                padding: "10px",
                                minHeight: 80,
                                verticalAlign: "top",
                                backgroundColor: "#fff",
                              }}
                            >
                              <Stack gap={6}>
                                {grouped.length === 0 ? (
                                  <Text size="sm" c="dimmed">
                                    —
                                  </Text>
                                ) : (
                                  grouped.map((groupAssignments) => {
                                    const primary = groupAssignments[0];
                                    const color = getUserColor(primary?.userId ?? null);
                                    const name = getUserDisplayName(primary);
                                    return (
                                      <Card
                                        key={groupAssignments.map((assignment) => assignment.id).join("-")}
                                        radius="md"
                                        padding="xs"
                                        style={{
                                          backgroundColor: color,
                                          border: "1px solid rgba(0,0,0,0.1)",
                                        }}
                                      >
                                        <Stack gap={2}>
                                          <Text fw={600} size="sm">
                                            {name}
                                          </Text>
                                        </Stack>
                                      </Card>
                                    );
                                  })
                                )}
                              </Stack>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </Box>
              </Box>
            </Group>
            {pubCrawlInstances.length === 0 ? (
              <Alert
                mb={0}
                color="yellow"
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
