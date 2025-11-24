import { useCallback, useEffect, useMemo, useState } from "react";
import { ActionIcon, Alert, Box, Button, Card, Group, SimpleGrid, Stack, Switch, Text, Title } from "@mantine/core";
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
import { IconX } from "@tabler/icons-react";

dayjs.extend(isoWeek);
dayjs.extend(weekday);

const LOCK_HOUR = Number(process.env.REACT_APP_SCHED_LOCK_HOUR ?? 18);

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
    <Stack mt="lg" gap="lg">
      {authenticated && ensureWeekQuery.isError ? (
        <Alert color="red" title="Unable to load scheduling week">
          <Text size="sm">
            {((ensureWeekQuery.error as AxiosError)?.response?.status === 401
              ? "You do not have permission to generate the schedule week. Please contact a manager."
              : (ensureWeekQuery.error as Error).message) ?? "Failed to load scheduling week."}
          </Text>
        </Alert>
      ) : null}

      <Stack gap="md" align="center">
        <Stack gap={4} align="center">
          <Title order={3}>Availability</Title>
          {deadline && (
            <Text size="sm" c={deadline.isBefore(dayjs()) ? "red" : "dimmed"}>
              {countdownLabel}
            </Text>
          )}
        </Stack>
        <WeekSelector value={selectedWeek} onChange={setSelectedWeek} weeks={weekOptions} />
      </Stack>

      <SimpleGrid spacing="md" verticalSpacing="md" cols={{ base: 1, sm: 2, lg: 3 }}>
        {Array.from({ length: 7 }).map((_, index) => {
          if (!weekStart) {
            return null;
          }
          const date = weekStart.add(index, "day");
          const dayKey = date.format("YYYY-MM-DD");
          const entry = entries[dayKey] ?? { status: "available" as const };
          const isAvailable = entry.status === "available";
          const isTimeframeVisible = timeframeVisible[dayKey] ?? Boolean(entry.startTime || entry.endTime);

          return (
            <Card key={dayKey} withBorder shadow="xs" radius="md">
              <Stack gap="sm" align="center">
                <Text fw={600}>{date.format("dddd, MMM D")}</Text>
                <Box
                  p={4}
                  style={{
                    border: isAvailable ? "1px solid transparent" : "1px solid var(--mantine-color-red-4)",
                    borderRadius: "var(--mantine-radius-sm)",
                    backgroundColor: isAvailable ? undefined : "var(--mantine-color-red-0)",
                  }}
                >
                  <Switch
                    checked={isAvailable}
                    label={isAvailable ? "Available" : "Unavailable"}
                    onChange={(event) => handleToggle(dayKey, event.currentTarget.checked ? "available" : "unavailable")}
                    disabled={!isEditing}
                  />
                </Box>
                <Group gap="xs" align="center" justify="center">
                  <Button
                    size="xs"
                    variant={isTimeframeVisible ? "subtle" : "light"}
                    color={isTimeframeVisible ? "red" : "blue"}
                    onClick={() => handleToggleTimeframe(dayKey, !isTimeframeVisible)}
                    disabled={!isAvailable || !isEditing}
                  >
                    {isTimeframeVisible ? "Remove timeframe" : "Add timeframe"}
                  </Button>
                  <Text size="xs" c="dimmed">
                    (Optional)
                  </Text>
                </Group>
                {isTimeframeVisible ? (
                  <Group gap="sm" grow justify="center">
                    <TimeInput
                      label="From"
                      value={entry.startTime ?? ""}
                      onChange={(event) => handleTimeChange(dayKey, "startTime", event.currentTarget.value || null)}
                      disabled={!isAvailable || !isEditing}
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
                      disabled={!isAvailable || !isEditing}
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
                  </Group>
                ) : null}
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
            <Button variant="subtle" color="gray" onClick={handleCancelEditing}>
              Cancel
            </Button>
          ) : null}
          <Button onClick={handleSave} loading={saveAvailability.isPending || ensureWeekQuery.isFetching} disabled={!weekId} size="md">
            Save availability
          </Button>
        </Group>
      ) : (
        <Group justify="center">
          <Button size="md" variant="light" onClick={handleStartEditing}>
            Edit availability
          </Button>
        </Group>
      )}
    </Stack>
  );
};

export default AvailabilityPage;















