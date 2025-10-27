
import { Select, SelectProps, Stack, Text } from "@mantine/core";
import dayjs from "dayjs";
import isoWeek from "dayjs/plugin/isoWeek";
import { formatScheduleWeekLabel, getUpcomingWeeks } from "../../api/scheduling";

dayjs.extend(isoWeek);

export interface WeekSelectorProps {
  value: string | null;
  onChange: (value: string) => void;
  label?: string;
  description?: string;
  weeks?: Array<{ value: string; label: string }>;
  selectProps?: Partial<SelectProps>;
}

const WeekSelector = ({
  value,
  onChange,
  label = "Week",
  description,
  weeks = getUpcomingWeeks(8),
  selectProps,
}: WeekSelectorProps) => {
  const options = weeks.map((week) => ({
    value: week.value,
    label: week.label,
  }));

  const formatted = value
    ? (() => {
        const [year, weekPart] = value.split("-W");
        return formatScheduleWeekLabel(Number(year), Number(weekPart));
      })()
    : null;

  return (
    <Stack gap={4}>
      <Select
        data={options}
        label={label}
        description={description}
        placeholder="Select ISO week"
        value={value ?? undefined}
        onChange={(next) => next && onChange(next)}
        searchable
        nothingFoundMessage="No weeks"
        {...selectProps}
      />
      {formatted && (
        <Text size="sm" c="dimmed">
          {formatted}
        </Text>
      )}
    </Stack>
  );
};

export default WeekSelector;
