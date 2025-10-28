import type { Dayjs } from 'dayjs';

declare module 'dayjs' {
  interface Dayjs {
    isoWeek(): number;
    isoWeek(week: number): Dayjs;
    isoWeekYear(): number;
    isoWeekYear(year: number): Dayjs;
  }
}
