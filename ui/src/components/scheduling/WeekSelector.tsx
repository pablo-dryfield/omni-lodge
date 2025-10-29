import { Select, SelectProps, Stack, Text } from "@mantine/core";
import dayjs from "dayjs";
import isoWeek from "dayjs/plugin/isoWeek";
import { formatScheduleWeekLabel, getUpcomingWeeks } from "../../api/scheduling";

dayjs.extend(isoWeek);

type WeekOption = { value: string; label: string };

export interface WeekSelectorProps {
  value: string | null;
  onChange: (value: string) => void;
  label?: string;
  description?: string;
  weeks?: WeekOption[];
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

  const { styles: injectedStyles, ...restSelectProps } = selectProps ?? {};

  const baseStyles = {
    input: { textAlign: "center" },
    dropdown: { textAlign: "center" },
    item: { justifyContent: "center", textAlign: "center" },
    option: { justifyContent: "center", textAlign: "center" },
    optionLabel: { textAlign: "center", width: "100%" },
  };

  const injected = (injectedStyles as Record<string, any>) ?? {};

  const mergedStyles = {
    ...injected,
    input: { ...baseStyles.input, ...(injected.input ?? {}) },
    dropdown: { ...baseStyles.dropdown, ...(injected.dropdown ?? {}) },
    item: { ...baseStyles.item, ...(injected.item ?? {}) },
    option: { ...baseStyles.option, ...(injected.option ?? {}) },
    optionLabel: { ...baseStyles.optionLabel, ...(injected.optionLabel ?? {}) },
  } as SelectProps["styles"];

  return (
    <Stack gap={4} align="center" w="100%">
      <Select
        data={options}
        labelProps={{ style: { textAlign: "center" } }}
        description={description}
        placeholder="Select ISO week"
        value={value ?? undefined}
        onChange={(next) => next && onChange(next)}
        searchable
        nothingFoundMessage="No weeks"
        w="100%"
        {...restSelectProps}
        styles={mergedStyles}
      />
    </Stack>
  );
};

export default WeekSelector;

