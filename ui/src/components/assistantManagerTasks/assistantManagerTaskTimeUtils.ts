import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';

dayjs.extend(customParseFormat);

export const TASK_TIME_INPUT_FORMATS = ['HH:mm', 'H:mm', 'HH:mm:ss', 'h:mm A', 'h A'];

export const normalizeTemplateTimeInput = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = dayjs(trimmed, TASK_TIME_INPUT_FORMATS, true);
  return parsed.isValid() ? parsed.format('HH:mm') : null;
};
