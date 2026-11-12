import dayjs from "dayjs";
import {getSearchConsolePresetDates, type SearchConsoleDatePreset} from "./searchConsoleDate";

const dates = (preset: SearchConsoleDatePreset, instant: string) => {
  const range = getSearchConsolePresetDates(preset, new Date(instant));
  return [dayjs(range.startDate).format("YYYY-MM-DD"), dayjs(range.endDate).format("YYYY-MM-DD")];
};

it.each([
  ["2026-11-12T23:30:00Z", "2026-10-14", "2026-11-10"],
  ["2026-11-13T07:59:00Z", "2026-10-14", "2026-11-10"],
  ["2026-11-13T08:01:00Z", "2026-10-15", "2026-11-11"],
  ["2026-07-01T00:30:00Z", "2026-06-01", "2026-06-28"],
  ["2026-03-08T10:01:00Z", "2026-02-07", "2026-03-06"],
  ["2028-03-02T10:00:00Z", "2028-02-02", "2028-02-29"],
  ["2027-01-01T08:30:00Z", "2026-12-03", "2026-12-30"],
])("uses the Pacific calendar day at %s", (instant, start, end) => {
  expect(dates("last_28", instant)).toEqual([start, end]);
});

it.each<[SearchConsoleDatePreset, string]>([
  ["last_7", "2026-11-04"], ["last_28", "2026-10-14"], ["last_90", "2026-08-13"],
  ["last_180", "2026-05-15"], ["last_365", "2025-11-11"], ["custom", "2026-10-14"],
])("keeps inclusive %s preset length and existing custom initial range", (preset, start) => {
  expect(dates(preset, "2026-11-12T23:30:00Z")).toEqual([start, "2026-11-10"]);
});
