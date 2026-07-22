import { useCallback, useEffect, useMemo, useState } from "react";
import { ActionIcon, Alert, Badge, Box, Button, Card, Group, Paper, SimpleGrid, Stack, Text, ThemeIcon } from "@mantine/core";
import { TimeInput } from "@mantine/dates";
import dayjs from "dayjs";
import isoWeek from "dayjs/plugin/isoWeek";
import weekday from "dayjs/plugin/weekday";
import type { AxiosError } from "axios";
import { useEnsureWeek, useAvailability, useSaveAvailability, getUpcomingWeeks } from "../../api/scheduling";
import { useMyStaffProfile } from "../../api/staffProfiles";
import WeekSelector from "../../components/scheduling/WeekSelector";
import type { AvailabilityPayload } from "../../types/scheduling";
import { useAppSelector } from "../../store/hooks";
import { IconCheck, IconChevronLeft, IconChevronRight, IconClock, IconDeviceFloppy, IconEdit, IconLock, IconX } from "@tabler/icons-react";

dayjs.extend(isoWeek);
dayjs.extend(weekday);

const LOCK_HOUR = Number(process.env.REACT_APP_SCHED_LOCK_HOUR ?? 18);
const HEADER_FONT_STACK = "'Arial Black', 'Inter', sans-serif";

type AvailabilityEntryState = {
  status: "available" | "unavailable";
  startTime?: string | null;
  endTime?: string | null;
};

const AvailabilityPage = () => {
  const weekOptions = useMemo(() => getUpcomingWeeks(6, false), []);
  const [selectedWeek, setSelectedWeek] = useState<string>(weekOptions[0]?.value ?? "");
  const [entries, setEntries] = useState<Record<string, AvailabilityEntryState>>({});
  const [timeframeVisible, setTimeframeVisible] = useState<Record<string, boolean>>({});
  const [initialEntries, setInitialEntries] = useState<Record<string, AvailabilityEntryState>>({});
  const [initialTimeframes, setInitialTimeframes] = useState<Record<string, boolean>>({});
  const [isLocked, setIsLocked] = useState(false);
  const [isEditing, setIsEditing] = useState(true);
  const [saveError, setSaveError] = useState<string | null>(null);

  const authenticated = useAppSelector((state) => state.session.authenticated);

  const ensureWeekQuery = useEnsureWeek(selectedWeek, { allowGenerate: false, enabled: authenticated });
  const weekId = ensureWeekQuery.data?.week?.id ?? null;
  const availabilityQuery = useAvailability(weekId);
  const saveAvailability = useSaveAvailability();
  const myStaffProfileQuery = useMyStaffProfile();

  const weekStart = useMemo(() => {
    if (!selectedWeek) {
      return null;
    }
    const [year, weekPart] = selectedWeek.split("-W");
    return dayjs()
      .year(Number(year))
      .isoWeek(Number(weekPart))
      .startOf("isoWeek");
  }, [selectedWeek]);

  const selectedWeekIndex = weekOptions.findIndex((option) => option.value === selectedWeek);
  const canNavigateBackward = selectedWeekIndex > 0;
  const canNavigateForward = selectedWeekIndex >= 0 && selectedWeekIndex < weekOptions.length - 1;
  const navigationIsLoading = ensureWeekQuery.isFetching || availabilityQuery.isFetching;

  const handleNavigateWeek = useCallback(
    (direction: -1 | 1) => {
      const nextIndex = selectedWeekIndex + direction;
      const nextWeek = weekOptions[nextIndex];
      if (nextWeek) {
        setSelectedWeek(nextWeek.value);
      }
    },
    [selectedWeekIndex, weekOptions],
  );

  const defaultAvailabilityStatus = useMemo(
    () => (myStaffProfileQuery.data?.livesInAccom ? "available" : "unavailable"),
    [myStaffProfileQuery.data?.livesInAccom],
  );

  const getDefaultEntryState = useCallback(
    (): AvailabilityEntryState => ({
      status: defaultAvailabilityStatus,
      startTime: null,
      endTime: null,
    }),
    [defaultAvailabilityStatus],
  );

  const cloneEntries = (source: Record<string, AvailabilityEntryState>) =>
    Object.fromEntries(Object.entries(source).map(([key, value]) => [key, { ...value }]));

const cloneTimeframes = (source: Record<string, boolean>) => ({ ...source });

const openNativeTimePicker = (input: HTMLInputElement) => {
  const pickerInput = input as HTMLInputElement & { showPicker?: () => void };
  if (typeof pickerInput.showPicker !== "function") {
    return;
  }
  try {
    pickerInput.showPicker();
  } catch (error) {
    void error;
  }
};


  const buildDefaultEntries = useCallback(() => {
    if (!weekStart) {
      return { entryMap: {}, visibilityMap: {} };
    }
    const entryMap: Record<string, AvailabilityEntryState> = {};
    const visibilityMap: Record<string, boolean> = {};
    Array.from({ length: 7 }).forEach((_, index) => {
      const day = weekStart.add(index, "day").format("YYYY-MM-DD");
      entryMap[day] = getDefaultEntryState();
      visibilityMap[day] = false;
    });
    return { entryMap, visibilityMap };
  }, [getDefaultEntryState, weekStart]);

  const applyDefaultEntries = useCallback(() => {
    const { entryMap, visibilityMap } = buildDefaultEntries();
    if (Object.keys(entryMap).length === 0) {
      return;
    }
    setEntries(entryMap);
    setTimeframeVisible(visibilityMap);
    setInitialEntries(cloneEntries(entryMap));
    setInitialTimeframes(cloneTimeframes(visibilityMap));
  }, [buildDefaultEntries]);

  useEffect(() => {
    const hasActiveDraft = isEditing && Object.keys(entries).length > 0;
    if (hasActiveDraft) {
      return;
    }

    const hasEntries = (availabilityQuery.data?.length ?? 0) > 0;
    if (hasEntries) {
      const entryMap: Record<string, AvailabilityEntryState> = {};
      const visibilityMap: Record<string, boolean> = {};
      availabilityQuery.data?.forEach((entry) => {
        entryMap[entry.day] = {
          status: entry.status,
          startTime: entry.startTime ?? null,
          endTime: entry.endTime ?? null,
        };
        visibilityMap[entry.day] = Boolean(entry.startTime || entry.endTime);
      });
      setEntries(entryMap);
      setTimeframeVisible(visibilityMap);
      setInitialEntries(cloneEntries(entryMap));
      setInitialTimeframes(cloneTimeframes(visibilityMap));
      setIsLocked(true);
      setIsEditing(false);
      setSaveError(null);
      return;
    }
    if (
      !availabilityQuery.isFetching &&
      myStaffProfileQuery.isSuccess &&
      weekStart
    ) {
      applyDefaultEntries();
      setIsLocked(false);
      setIsEditing(true);
      setSaveError(null);
    }
  }, [
    applyDefaultEntries,
    availabilityQuery.data,
    availabilityQuery.isFetching,
    entries,
    isEditing,
    myStaffProfileQuery.isSuccess,
    weekStart,
  ]);

  useEffect(() => {
    setEntries({});
    setTimeframeVisible({});
    setInitialEntries({});
    setInitialTimeframes({});
    setIsLocked(false);
    setIsEditing(true);
    setSaveError(null);
  }, [selectedWeek]);

  const deadline = weekStart
    ? weekStart.subtract(1, "day").hour(LOCK_HOUR).minute(0).second(0)
    : null;

  const countdownLabel = deadline
    ? (() => {
        const diff = deadline.diff(dayjs(), "second");
        if (diff <= 0) {
          return "Availability submissions are locked.";
        }
        const totalMinutes = deadline.diff(dayjs(), "minute");
        if (totalMinutes <= 0) {
          return "Availability submissions are locked.";
        }
        const days = Math.floor(totalMinutes / (60 * 24));
        const hours = Math.floor((totalMinutes - days * 60 * 24) / 60);
        const minutes = totalMinutes % 60;
        return `Time remaining: ${days}d ${hours}h ${minutes}m`;
      })()
    : "";

  const weekDays = useMemo(
    () => (weekStart ? Array.from({ length: 7 }).map((_, index) => weekStart.add(index, "day")) : []),
    [weekStart],
  );

  const handleToggle = (day: string, status: "available" | "unavailable") => {
    if (!isEditing) {
      return;
    }
    setEntries((current) => {
      const existing = current[day] ?? getDefaultEntryState();
      const nextEntry: AvailabilityEntryState =
        status === "unavailable"
          ? { status, startTime: null, endTime: null }
          : { status, startTime: existing.startTime ?? null, endTime: existing.endTime ?? null };
      return {
        ...current,
        [day]: nextEntry,
      };
    });

    if (status === "unavailable") {
      setTimeframeVisible((current) => ({
        ...current,
        [day]: false,
      }));
    }
  };

  const handleTimeChange = (day: string, key: "startTime" | "endTime", value: string | null) => {
    if (!isEditing) {
      return;
    }
    setEntries((current) => {
      const fallback = getDefaultEntryState();
      return {
        ...current,
        [day]: {
          status: current[day]?.status ?? fallback.status,
          startTime: key === "startTime" ? value : current[day]?.startTime ?? fallback.startTime,
          endTime: key === "endTime" ? value : current[day]?.endTime ?? fallback.endTime,
        },
      };
    });
  };

  const handleToggleTimeframe = (day: string, visible: boolean) => {
    if (!isEditing) {
      return;
    }
    setTimeframeVisible((current) => ({
      ...current,
      [day]: visible,
    }));

    setEntries((current) => {
      const entry = current[day] ?? getDefaultEntryState();
      return {
        ...current,
        [day]: visible
          ? entry
          : {
              ...entry,
              startTime: null,
              endTime: null,
            },
      };
    });
  };

  const handleSave = async () => {
    if (!weekId || !weekStart) {
      return;
    }

    setSaveError(null);
    const payload: AvailabilityPayload = {
      scheduleWeekId: weekId,
      entries: Array.from({ length: 7 }).map((_, index) => {
        const day = weekStart.add(index, "day").format("YYYY-MM-DD");
          const current = entries[day] ?? { status: defaultAvailabilityStatus };
        const visible = timeframeVisible[day] ?? Boolean(current.startTime || current.endTime);
        return {
          day,
          status: current.status,
          startTime: visible ? current.startTime ?? null : null,
          endTime: visible ? current.endTime ?? null : null,
        };
      }),
    };

    try {
      await saveAvailability.mutateAsync(payload);
      setInitialEntries(cloneEntries(entries));
      setInitialTimeframes(cloneTimeframes(timeframeVisible));
      setIsLocked(true);
      setIsEditing(false);
      setSaveError(null);
    } catch (error) {
      const axiosError = error as AxiosError<{ error?: string; message?: string }>;
      const backendMessage = axiosError.response?.data?.error ?? axiosError.response?.data?.message;
      setSaveError(backendMessage ?? axiosError.message ?? "Failed to save availability.");
    }
  };
  const handleStartEditing = () => {
    setIsEditing(true);
    setSaveError(null);
  };

  const handleCancelEditing = () => {
    setEntries(cloneEntries(initialEntries));
    setTimeframeVisible(cloneTimeframes(initialTimeframes));
    setIsEditing(false);
    setSaveError(null);
  };

  return (
    <Stack mt="lg" gap="lg" style={{ width: "100%" }}>
      {authenticated && ensureWeekQuery.isError ? (
        <Alert color="red" title="Unable to load scheduling week">
          <Text size="sm">
            {((ensureWeekQuery.error as AxiosError)?.response?.status === 401
              ? "You do not have permission to generate the schedule week. Please contact a manager."
              : (ensureWeekQuery.error as Error).message) ?? "Failed to load scheduling week."}
          </Text>
        </Alert>
      ) : null}

      <Stack gap="sm" align="center">
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
        {deadline ? (
          <Alert
            color={deadline.isBefore(dayjs()) ? "red" : "blue"}
            radius="lg"
            variant="light"
            icon={deadline.isBefore(dayjs()) ? <IconLock size={18} /> : <IconClock size={18} />}
            style={{ width: "100%", maxWidth: 680 }}
          >
            <Text fw={800} ta="center">
              {countdownLabel}
            </Text>
          </Alert>
        ) : null}
      </Stack>

      <SimpleGrid spacing="md" verticalSpacing="md" cols={{ base: 1, sm: 2, lg: 4 }}>
        {weekDays.map((date) => {
          const dayKey = date.format("YYYY-MM-DD");
          const entry = entries[dayKey] ?? { status: "available" as const };
          const isAvailable = entry.status === "available";
          const isTimeframeVisible = timeframeVisible[dayKey] ?? Boolean(entry.startTime || entry.endTime);
          const statusColor = isAvailable ? "green" : "red";
          const accent = isAvailable ? "#22C55E" : "#EF4444";
          const isToday = date.isSame(dayjs(), "day");

          return (
            <Card
              key={dayKey}
              withBorder
              shadow="sm"
              radius={20}
              padding={0}
              style={{
                overflow: "hidden",
                borderColor: isAvailable ? "rgba(34, 197, 94, 0.34)" : "rgba(239, 68, 68, 0.34)",
                backgroundColor: "#FFFFFF",
              }}
            >
              <Box
                style={{
                  padding: "14px 16px",
                  background: isAvailable
                    ? "linear-gradient(135deg, rgba(220, 252, 231, 0.88), rgba(255, 255, 255, 0.98))"
                    : "linear-gradient(135deg, rgba(254, 226, 226, 0.9), rgba(255, 255, 255, 0.98))",
                  borderTop: `5px solid ${accent}`,
                  borderBottom: "1px solid #E2E8F0",
                }}
              >
                <Group justify="space-between" align="center" wrap="nowrap">
                  <Group gap="sm" wrap="nowrap">
                    <Paper
                      radius={14}
                      p="xs"
                      shadow="xs"
                      style={{
                        minWidth: 58,
                        textAlign: "center",
                        backgroundColor: "#FFFFFF",
                      }}
                    >
                      <Text size="xs" c="dimmed" fw={900} tt="uppercase" style={{ fontFamily: HEADER_FONT_STACK }}>
                        {date.format("MMM")}
                      </Text>
                      <Text fw={900} size="xl" style={{ fontFamily: HEADER_FONT_STACK, lineHeight: 1 }}>
                        {date.format("D")}
                      </Text>
                    </Paper>
                    <Stack gap={2}>
                      <Group gap={6}>
                        <Text fw={900} style={{ fontFamily: HEADER_FONT_STACK, letterSpacing: "0.03em" }}>
                          {date.format("dddd").toUpperCase()}
                        </Text>
                        {isToday ? (
                          <Badge size="xs" radius="xl" variant="light" color="blue">
                            Today
                          </Badge>
                        ) : null}
                      </Group>
                      <Text size="sm" c="dimmed" fw={700}>
                        {date.format("MMM D, YYYY")}
                      </Text>
                    </Stack>
                  </Group>
                  <Badge
                    color={statusColor}
                    variant="outline"
                    radius="xl"
                    styles={{
                      root: {
                        border: `2px solid ${isAvailable ? "#22C55E" : "#EF4444"}`,
                        backgroundColor: isAvailable ? "#F0FDF4" : "#FEF2F2",
                        color: isAvailable ? "#15803D" : "#B91C1C",
                        fontWeight: 900,
                      },
                    }}
                  >
                    {isAvailable ? "Let's Party!" : "No"}
                  </Badge>
                </Group>
              </Box>

              <Stack gap="md" p="md" align="stretch">
                <Group grow gap="xs">
                  <Button
                    radius="xl"
                    color="red"
                    variant={!isAvailable ? "filled" : "light"}
                    leftSection={<IconX size={16} />}
                    onClick={() => handleToggle(dayKey, "unavailable")}
                    disabled={!isEditing}
                    style={{
                      border: "2px solid #EF4444",
                      fontWeight: 900,
                    }}
                  >
                    Unavailable
                  </Button>
                  <Button
                    radius="xl"
                    color="green"
                    variant={isAvailable ? "filled" : "light"}
                    leftSection={<IconCheck size={18} />}
                    onClick={() => handleToggle(dayKey, "available")}
                    disabled={!isEditing}
                    style={{
                      border: "2px solid #22C55E",
                      boxShadow: isAvailable ? "0 8px 18px rgba(34, 197, 94, 0.24)" : undefined,
                      fontWeight: 900,
                      color: isAvailable ? undefined : "#15803D",
                      backgroundColor: isAvailable ? undefined : "#F0FDF4",
                    }}
                  >
                    Available
                  </Button>
                </Group>

                {isAvailable ? (
                  <Paper withBorder radius={16} p="sm" style={{ backgroundColor: "#F8FAFC" }}>
                    <Stack gap="sm">
                      <Group justify="space-between" align="center" wrap="nowrap">
                        <Group gap="xs" wrap="nowrap">
                          <ThemeIcon color="blue" variant="light" radius="xl" size={34}>
                            <IconClock size={18} />
                          </ThemeIcon>
                          <Stack gap={0}>
                            <Text fw={900}>Time window</Text>
                            <Text size="xs" c="dimmed" fw={700}>
                              {isTimeframeVisible ? "Specific hours" : "Optional"}
                            </Text>
                          </Stack>
                        </Group>
                        <Button
                          size="xs"
                          radius="xl"
                          variant={isTimeframeVisible ? "light" : "filled"}
                          color={isTimeframeVisible ? "red" : "blue"}
                          onClick={() => handleToggleTimeframe(dayKey, !isTimeframeVisible)}
                          disabled={!isEditing}
                        >
                          {isTimeframeVisible ? "Remove" : "Add optional"}
                        </Button>
                      </Group>

                      {isTimeframeVisible ? (
                        <SimpleGrid cols={{ base: 1, xs: 2 }} spacing="xs">
                          <TimeInput
                            label="From"
                            value={entry.startTime ?? ""}
                            onChange={(event) => handleTimeChange(dayKey, "startTime", event.currentTarget.value || null)}
                            onClick={(event) => openNativeTimePicker(event.currentTarget)}
                            onFocus={(event) => openNativeTimePicker(event.currentTarget)}
                            disabled={!isEditing}
                            leftSection={<IconClock size={16} />}
                            styles={{
                              label: { width: "100%", textAlign: "center", fontWeight: 800 },
                              input: { textAlign: "center", fontWeight: 800 },
                            }}
                            rightSection={
                              entry.startTime && isEditing ? (
                                <ActionIcon
                                  size="sm"
                                  variant="subtle"
                                  color="gray"
                                  onClick={() => handleTimeChange(dayKey, "startTime", null)}
                                  aria-label="Clear start time"
                                >
                                  <IconX size={12} />
                                </ActionIcon>
                              ) : undefined
                            }
                            rightSectionPointerEvents={entry.startTime && isEditing ? "auto" : "none"}
                          />
                          <TimeInput
                            label="To"
                            value={entry.endTime ?? ""}
                            onChange={(event) => handleTimeChange(dayKey, "endTime", event.currentTarget.value || null)}
                            onClick={(event) => openNativeTimePicker(event.currentTarget)}
                            onFocus={(event) => openNativeTimePicker(event.currentTarget)}
                            disabled={!isEditing}
                            leftSection={<IconClock size={16} />}
                            styles={{
                              label: { width: "100%", textAlign: "center", fontWeight: 800 },
                              input: { textAlign: "center", fontWeight: 800 },
                            }}
                            rightSection={
                              entry.endTime && isEditing ? (
                                <ActionIcon
                                  size="sm"
                                  variant="subtle"
                                  color="gray"
                                  onClick={() => handleTimeChange(dayKey, "endTime", null)}
                                  aria-label="Clear end time"
                                >
                                  <IconX size={12} />
                                </ActionIcon>
                              ) : undefined
                            }
                            rightSectionPointerEvents={entry.endTime && isEditing ? "auto" : "none"}
                          />
                        </SimpleGrid>
                      ) : null}
                    </Stack>
                  </Paper>
                ) : (
                  <Paper withBorder radius={16} p="sm" style={{ backgroundColor: "#FEF2F2", borderColor: "#FECACA" }}>
                    <Text c="red" fw={900} ta="center">
                      Not available this day
                    </Text>
                  </Paper>
                )}
              </Stack>
            </Card>
          );
        })}
      </SimpleGrid>

      {saveError ? (
        <Alert color="red" title="Failed to save">
          <Text size="sm">{saveError}</Text>
        </Alert>
      ) : null}

      {isEditing ? (
        <Group justify="center" gap="sm">
          {isLocked ? (
            <Button variant="light" color="red" onClick={handleCancelEditing} leftSection={<IconX size={16} />}>
              Cancel
            </Button>
          ) : null}
          <Button
            onClick={handleSave}
            loading={saveAvailability.isPending || ensureWeekQuery.isFetching}
            disabled={!weekId}
            size="md"
            leftSection={<IconDeviceFloppy size={16} />}
          >
            Save availability
          </Button>
        </Group>
      ) : (
        <Group justify="center">
          <Button size="md" variant="light" onClick={handleStartEditing} leftSection={<IconEdit size={16} />}>
            Edit availability
          </Button>
        </Group>
      )}
    </Stack>
  );
};

export default AvailabilityPage;







