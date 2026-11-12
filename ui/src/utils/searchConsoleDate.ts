export type SearchConsoleDatePreset = "last_7" | "last_28" | "last_90" | "last_180" | "last_365" | "custom";

const DAYS_BY_PRESET = {last_7: 7, last_28: 28, last_90: 90, last_180: 180, last_365: 365};

export const getSearchConsolePresetDates = (preset: SearchConsoleDatePreset, now = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const part = (name: Intl.DateTimeFormatPartTypes) => Number(parts.find(value => value.type === name)!.value);
  // DateInput represents calendar days in the browser's zone, not Pacific instants.
  const endDate = new Date(part("year"), part("month") - 1, part("day"), 12);
  endDate.setDate(endDate.getDate() - 2);
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - (preset === "custom" ? 28 : DAYS_BY_PRESET[preset]) + 1);
  return {startDate, endDate};
};
