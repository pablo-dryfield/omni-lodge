import type { Dayjs } from 'dayjs';

type ResolvePlannerRangeParams = {
  requestedStart: Dayjs;
  requestedEnd: Dayjs;
  plannerStartDate: Dayjs | null;
  preserveRequestedSpan: boolean;
};

export const resolveAssistantManagerTaskPlannerRange = ({
  requestedStart,
  requestedEnd,
  plannerStartDate,
  preserveRequestedSpan,
}: ResolvePlannerRangeParams): { start: Dayjs; end: Dayjs } => {
  if (!plannerStartDate || !requestedStart.isBefore(plannerStartDate, 'day')) {
    return { start: requestedStart, end: requestedEnd };
  }

  const requestedSpanDays = Math.max(
    1,
    requestedEnd.startOf('day').diff(requestedStart.startOf('day'), 'day') + 1,
  );
  const shiftEntireRange =
    preserveRequestedSpan || requestedEnd.isBefore(plannerStartDate, 'day');

  return {
    start: plannerStartDate,
    end: shiftEntireRange
      ? plannerStartDate.add(requestedSpanDays - 1, 'day').endOf('day')
      : requestedEnd,
  };
};
