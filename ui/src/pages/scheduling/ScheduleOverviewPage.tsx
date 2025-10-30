import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  Center,
  Divider,
  Group,
  Loader,
  Paper,
  Stack,
  Text,
  ThemeIcon,
  Title,
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
import type { ShiftAssignment } from "../../types/scheduling";

dayjs.extend(isoWeek);

const ROLE_PRIORITY: Record<string, number> = {
  guide: 0,
  "social media": 1,
  leader: 2,
  manager: 3,
  takes: 3,
};

const palette = {
  heroGradient: "linear-gradient(135deg, #7C4DFF 0%, #9C6CFF 45%, #FF8EC3 100%)",
  panelGradient: "linear-gradient(140deg, #FFE3EF 0%, #FFF8FB 80%)",
  lavender: "#F6F1FF",
  lavenderDeep: "#ECE2FF",
  plum: "#7C4DFF",
  plumDark: "#5224C7",
  slate: "#2E3446",
  border: "#D8CCFF",
  tableShadow: "0 18px 40px rgba(124, 77, 255, 0.18)",
  cardShadow: "0 12px 28px rgba(124, 77, 255, 0.22)",
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
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  color: palette.slate,
  background: "linear-gradient(135deg, rgba(124, 77, 255, 0.12) 0%, rgba(255,255,255,0.7) 100%)",
  minWidth: 160,
};

const normalizeRoleName = (value: string | null | undefined) => value?.trim().toLowerCase() ?? "";

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

const getUserColor = (userId: number | null | undefined) => {
  if (!userId) {
    return "#ECEFF4";
  }
  const hue = (userId * 37) % 360;
  return `hsl(${hue}, 72%, 78%)`;
};

const formatWeekValue = (weekValue: string) => {
  const [year, weekPart] = weekValue.split("-W");
  return formatScheduleWeekLabel(Number(year), Number(weekPart));
};

const ensureIsoWeekString = (date: dayjs.Dayjs) =>
  `${date.isoWeekYear()}-W${String(date.isoWeek()).padStart(2, "0")}`;

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
        (a, b) => getRoleOrderValue(a.assignment, a.index) - getRoleOrderValue(b.assignment, b.index),
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

  const daysOfWeek = useMemo(
    () => Array.from({ length: 7 }, (_, index) => weekStart.add(index, "day")),
    [weekStart],
  );
  const monthSegments = useMemo(() => buildMonthSegments(daysOfWeek), [daysOfWeek]);

  const pubCrawlInstances = useMemo(() => {
    const instances = shiftInstancesQuery.data ?? [];
    return instances.filter((instance) => {
      const typeKey = instance.shiftType?.key?.toLowerCase() ?? "";
      const typeName = instance.shiftType?.name?.toLowerCase() ?? "";
      const templateName = instance.template?.name?.toLowerCase() ?? "";
      return (
        typeKey.includes("pub_crawl") ||
        typeName.includes("pub crawl") ||
        templateName.includes("pub crawl")
      );
    });
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
  const error = ensureWeekQuery.isError ? ensureWeekQuery.error : shiftInstancesQuery.error;
  const hasWeek = Boolean(weekId);

  const renderAssignmentsForRole = (roleLabel: string, assignments: ShiftAssignment[]) => {
    let predicate: (assignment: ShiftAssignment) => boolean;
    switch (roleLabel) {
      case "Guides":
        predicate = (assignment) => normalizeRoleName(assignment.roleInShift).includes("guide");
        break;
      case "Social Media":
        predicate = (assignment) => normalizeRoleName(assignment.roleInShift).includes("social");
        break;
      case "Leader":
        predicate = (assignment) => normalizeRoleName(assignment.roleInShift).includes("leader");
        break;
      default:
        predicate = (assignment) => {
          const normalized = normalizeRoleName(assignment.roleInShift);
          return normalized.includes("manager") || normalized.includes("takes");
        };
    }

    const grouped = groupAssignmentsByUser(assignments.filter(predicate));

    if (!grouped.length) {
      return (
        <Text size="sm" c="dimmed">
          â€”
        </Text>
      );
    }

    return grouped.map((groupAssignments) => {
      const primary = groupAssignments[0];
      const color = getUserColor(primary?.userId ?? null);
      const name = getUserDisplayName(primary);
      return (
        <Card
          key={groupAssignments.map((assignment) => assignment.id).join("-")}
          radius="md"
          padding="sm"
          withBorder
          style={{
            backgroundColor: color,
            borderColor: "rgba(124, 77, 255, 0.25)",
            boxShadow: palette.cardShadow,
          }}
        >
          <Stack gap={2} align="center">
            <Text fw={700} size="sm" c={palette.slate}>
              {name}
            </Text>
          </Stack>
        </Card>
      );
    });
  };

  return (
    <Stack mt="lg" gap="lg">
      <Card
        radius="lg"
        shadow="xl"
        padding="lg"
        style={{
          background: palette.heroGradient,
          color: "#fff",
        }}
      >
        <Group justify="space-between" align="center">
          <Button
            variant="white"
            color="dark"
            leftSection={<IconChevronLeft size={16} />}
            onClick={() => handleNavigateWeek(-1)}
          >
            Previous Week
          </Button>
          <Stack gap={4} align="center" style={{ flex: 1 }}>
            <Title order={3} fw={800}>
              Krawl Through Krakow Schedule
            </Title>
            <Group gap="xs" align="center">
              <ThemeIcon radius="xl" size="lg" variant="light" color="grape">
                <IconCalendarEvent size={18} />
              </ThemeIcon>
              <Text fw={600} size="sm">
                {formatWeekValue(selectedWeek)}
              </Text>
            </Group>
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
          >
            Next Week
          </Button>
        </Group>
      </Card>

      {error ? (
        <Alert color="red" variant="light" radius="md" title="Unable to load schedule">
          <Text size="sm">{(error as Error).message}</Text>
        </Alert>
      ) : null}

      {loading ? (
        <Center py="xl">
          <Loader />
        </Center>
      ) : !hasWeek ? (
        <Alert color="yellow" variant="light" radius="md" title="Week not available">
          <Text size="sm">
            Schedule data for {formatWeekValue(selectedWeek)} is not available yet. Generate the week from the builder to
            view assignments.
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
            <Group align="flex-start" gap="xl">
              <Paper
                shadow="md"
                radius="lg"
                withBorder
                p="lg"
                style={{
                  maxWidth: 340,
                  background: palette.panelGradient,
                  boxShadow: palette.cardShadow,
                }}
              >
                <Stack gap="md">
                  <Title order={4} c={palette.plumDark}>
                    Briefing
                  </Title>
                  <Divider color={palette.border} />
                  <Text size="sm" lh={1.6} c={palette.slate} style={{ textAlign: "justify" }}>
                    Leader confirms the power hour venue with the Manager on shift. While doing the hostel run, ensure
                    ticket books, flyers, and posters display the correct price. Promote the pub crawl in hostel common
                    areas and invite hostel staff to join for free.
                  </Text>
                  <Text size="sm" fw={700} c={palette.plumDark}>
                    Confirm hostel details with the person on Takes / Manager before departure.
                  </Text>
                </Stack>
              </Paper>

              <Box
                style={{
                  flex: 1,
                  overflowX: "auto",
                  borderRadius: 20,
                  backgroundColor: "#fff",
                  boxShadow: palette.tableShadow,
                  padding: 18,
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
                        colSpan={8}
                        style={{
                          textAlign: "center",
                          background: "linear-gradient(135deg, #7C4DFF 0%, #9C6CFF 55%, #F48FB1 100%)",
                          padding: "18px",
                          fontSize: "22px",
                          fontWeight: 800,
                          letterSpacing: "0.05em",
                          color: "#fff",
                        }}
                      >
                        Pub Crawl – 8:45 P.M.
                      </th>
                    </tr>
                    <tr>
                      <th
                        style={{
                          ...tableCellBase,
                          borderWidth: "0 1px 1px 1px",
                          backgroundColor: palette.lavenderDeep,
                          fontWeight: 600,
                          textTransform: "uppercase",
                          letterSpacing: "0.08em",
                          color: palette.plumDark,
                        }}
                      >
                        {weekStart.format("MMMM YYYY")}
                      </th>
                      {monthSegments.map((segment) => (
                        <th
                          key={segment.label}
                          colSpan={segment.span}
                          style={{
                            ...tableCellBase,
                            borderWidth: "0 1px 1px 0",
                            backgroundColor: palette.lavenderDeep,
                            textTransform: "uppercase",
                            fontWeight: 600,
                            letterSpacing: "0.08em",
                            color: palette.plumDark,
                          }}
                        >
                          {segment.label}
                        </th>
                      ))}
                    </tr>
                    <tr>
                      <th
                        style={{
                          ...tableCellBase,
                          backgroundColor: palette.lavenderDeep,
                          borderWidth: "0 1px 1px 1px",
                          textAlign: "left",
                          fontWeight: 700,
                          letterSpacing: "0.12em",
                          color: palette.plumDark,
                        }}
                      >
                        Role
                      </th>
                      {daysOfWeek.map((day) => (
                        <th
                          key={day.toString()}
                          style={{
                            ...tableCellBase,
                            backgroundColor: palette.lavenderDeep,
                            borderWidth: "0 1px 1px 0",
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
                        <td style={roleCellStyles}>{roleLabel}</td>
                        {daysOfWeek.map((day) => {
                          const isoDate = day.format("YYYY-MM-DD");
                          const assignments = assignmentsByDate.get(isoDate) ?? [];
                          return (
                            <td
                              key={isoDate + roleLabel}
                              style={{ ...tableCellBase, borderWidth: "0 1px 1px 0" }}
                            >
                              <Stack gap={8} align="center">
                                {renderAssignmentsForRole(roleLabel, assignments)}
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
    </Stack>
  );
};

export default ScheduleOverviewPage;





