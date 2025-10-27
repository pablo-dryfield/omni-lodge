
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, Group, Stack, Switch, Text, Title } from "@mantine/core";
import { TimeInput } from "@mantine/dates";
import dayjs from "dayjs";
import isoWeek from "dayjs/plugin/isoWeek";
import weekday from "dayjs/plugin/weekday";
import { useGenerateWeek, useAvailability, useSaveAvailability, getUpcomingWeeks } from "../../api/scheduling";
import WeekSelector from "../../components/scheduling/WeekSelector";
import type { AvailabilityPayload } from "../../types/scheduling";

dayjs.extend(isoWeek);
dayjs.extend(weekday);

const LOCK_HOUR = Number(process.env.REACT_APP_SCHED_LOCK_HOUR ?? 18);

const AvailabilityPage = () => {
  const weekOptions = useMemo(() => getUpcomingWeeks(6), []);
  const [selectedWeek, setSelectedWeek] = useState<string>(weekOptions[0]?.value ?? "");
  const [weekId, setWeekId] = useState<number | null>(null);
  const [entries, setEntries] = useState<Record<string, { status: "available" | "unavailable"; startTime?: string | null; endTime?: string | null }>>({});

  const generateWeek = useGenerateWeek();
  const availabilityQuery = useAvailability(weekId);
  const saveAvailability = useSaveAvailability();

  const ensureWeek = useCallback(
    async (weekValue: string) => {
      const result = await generateWeek.mutateAsync({ week: weekValue });
      setWeekId(result.week.id);
    },
    [generateWeek],
  );

  useEffect(() => {
    if (selectedWeek) {
      void ensureWeek(selectedWeek);
    }
  }, [selectedWeek, ensureWeek]);

  useEffect(() => {
    if (availabilityQuery.data) {
      const map: Record<string, { status: "available" | "unavailable"; startTime?: string | null; endTime?: string | null }> = {};
      availabilityQuery.data.forEach((entry) => {
        map[entry.day] = {
          status: entry.status,
          startTime: entry.startTime ?? null,
          endTime: entry.endTime ?? null,
        };
      });
      setEntries(map);
    }
  }, [availabilityQuery.data]);

  const weekStart = useMemo(() => {
    if (!selectedWeek) {
      return null;
    }
    const [year, weekPart] = selectedWeek.split("-W");
    return dayjs()
      .isoWeekYear(Number(year))
      .isoWeek(Number(weekPart))
      .startOf("isoWeek");
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
    setEntries((current) => ({
      ...current,
      [day]: {
        status,
        startTime: current[day]?.startTime ?? null,
        endTime: current[day]?.endTime ?? null,
      },
    }));
  };

  const handleTimeChange = (day: string, key: "startTime" | "endTime", value: string | null) => {
    setEntries((current) => ({
      ...current,
      [day]: {
        status: current[day]?.status ?? "available",
        startTime: key === "startTime" ? value : current[day]?.startTime ?? null,
        endTime: key === "endTime" ? value : current[day]?.endTime ?? null,
      },
    }));
  };

  const handleSave = async () => {
    if (!weekId || !weekStart) {
      return;
    }

    const payload: AvailabilityPayload = {
      scheduleWeekId: weekId,
      entries: Array.from({ length: 7 }).map((_, index) => {
        const day = weekStart.add(index, "day").format("YYYY-MM-DD");
        const current = entries[day] ?? { status: "available" as const };
        return {
          day,
          status: current.status,
          startTime: current.startTime ?? null,
          endTime: current.endTime ?? null,
        };
      }),
    };

    await saveAvailability.mutateAsync(payload);
  };

  return (
    <Stack mt="lg" gap="lg">
      <Group justify="space-between" align="flex-end">
        <Stack gap={4}>
          <Title order={3}>Availability</Title>
          {deadline && (
            <Text size="sm" c={deadline.isBefore(dayjs()) ? "red" : "dimmed"}>
              {countdownLabel}
            </Text>
          )}
        </Stack>
        <WeekSelector value={selectedWeek} onChange={setSelectedWeek} />
      </Group>

      <Stack>
        {Array.from({ length: 7 }).map((_, index) => {
          if (!weekStart) {
            return null;
          }
          const date = weekStart.add(index, "day");
          const dayKey = date.format("YYYY-MM-DD");
          const entry = entries[dayKey] ?? { status: "available" as const };
          const isAvailable = entry.status === "available";

          return (
            <Card key={dayKey} withBorder shadow="xs" radius="md">
              <Group justify="space-between" align="flex-end">
                <Stack gap={4}>
                  <Text fw={600}>{date.format("dddd, MMM D")}</Text>
                  <Switch
                    checked={isAvailable}
                    label={isAvailable ? "Available" : "Unavailable"}
                    onChange={(event) => handleToggle(dayKey, event.currentTarget.checked ? "available" : "unavailable")}
                  />
                </Stack>
                <Group gap="sm">
                  <TimeInput
                    label="From"
                    value={entry.startTime ? dayjs(entry.startTime, "HH:mm").toDate() : null}
                    onChange={(value) => handleTimeChange(dayKey, "startTime", value ? dayjs(value).format("HH:mm") : null)}
                    disabled={!isAvailable}
                  />
                  <TimeInput
                    label="To"
                    value={entry.endTime ? dayjs(entry.endTime, "HH:mm").toDate() : null}
                    onChange={(value) => handleTimeChange(dayKey, "endTime", value ? dayjs(value).format("HH:mm") : null)}
                    disabled={!isAvailable}
                  />
                </Group>
              </Group>
            </Card>
          );
        })}
      </Stack>

      {saveAvailability.error && (
        <Alert color="red" title="Failed to save">
          {(saveAvailability.error as Error).message}
        </Alert>
      )}

      <Button
        onClick={handleSave}
        loading={saveAvailability.isPending || generateWeek.isPending}
        disabled={!weekId}
        size="md"
        alignSelf="flex-end"
      >
        Save availability
      </Button>
    </Stack>
  );
};

export default AvailabilityPage;
