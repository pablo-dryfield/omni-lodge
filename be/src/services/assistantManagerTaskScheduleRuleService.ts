export type AssistantManagerTaskScheduledWorkdayPlacement = 'start' | 'middle' | 'end';

export type TaskDateGenerationCandidate<TShiftInfo> = {
  userId: number;
  shiftInfo: TShiftInfo | null;
};

const SCHEDULED_WORKDAY_PLACEMENT_VALUES = new Set<AssistantManagerTaskScheduledWorkdayPlacement>([
  'start',
  'middle',
  'end',
]);

export const normalizeRequiredShiftTemplateIds = (value: unknown): number[] => {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  return Array.from(
    new Set(
      values
        .map((entry) => Number(entry))
        .filter((entry) => Number.isInteger(entry) && entry > 0),
    ),
  );
};

export const normalizeScheduledWorkdayPlacement = (
  value: unknown,
): AssistantManagerTaskScheduledWorkdayPlacement => {
  if (typeof value !== 'string') {
    return 'start';
  }
  const normalized = value.trim().toLowerCase() as AssistantManagerTaskScheduledWorkdayPlacement;
  return SCHEDULED_WORKDAY_PLACEMENT_VALUES.has(normalized) ? normalized : 'start';
};

export const resolveAssigneeShiftRequirement = (scheduleConfig: unknown): boolean => {
  if (!scheduleConfig || typeof scheduleConfig !== 'object') {
    return true;
  }
  const config = scheduleConfig as Record<string, unknown>;
  return !(
    config.requireShift === false ||
    config.requireScheduledShift === false ||
    config.allowOffDays === true
  );
};

export const taskDateMatchesRequiredShiftTemplates = (
  requiredShiftTemplateIds: number[],
  shiftTemplateIdsOnDate: ReadonlySet<number> | undefined,
): boolean => {
  if (requiredShiftTemplateIds.length === 0) {
    return true;
  }
  if (!shiftTemplateIdsOnDate || shiftTemplateIdsOnDate.size === 0) {
    return false;
  }
  return requiredShiftTemplateIds.some((templateId) => shiftTemplateIdsOnDate.has(templateId));
};

export const buildTaskDateGenerationCandidates = <TShiftInfo>({
  requireShift,
  scheduledCandidates,
  audienceUserIds,
}: {
  requireShift: boolean;
  scheduledCandidates: Array<{ userId: number; shiftInfo: TShiftInfo }>;
  audienceUserIds: number[];
}): TaskDateGenerationCandidate<TShiftInfo>[] => {
  const scheduledByUserId = new Map<number, { userId: number; shiftInfo: TShiftInfo }>();
  scheduledCandidates.forEach((candidate) => {
    if (!scheduledByUserId.has(candidate.userId)) {
      scheduledByUserId.set(candidate.userId, candidate);
    }
  });

  if (requireShift) {
    return Array.from(scheduledByUserId.values()).map((candidate) => ({
      userId: candidate.userId,
      shiftInfo: candidate.shiftInfo,
    }));
  }

  return Array.from(new Set(audienceUserIds)).map((userId) => ({
    userId,
    shiftInfo: scheduledByUserId.get(userId)?.shiftInfo ?? null,
  }));
};

export const selectScheduledCandidatesForWeek = <T>(
  candidates: T[],
  quota: number,
  placement: AssistantManagerTaskScheduledWorkdayPlacement,
  getDate: (candidate: T) => string,
): T[] => {
  if (!Number.isInteger(quota) || quota <= 0 || candidates.length === 0) {
    return [];
  }

  const ordered = [...candidates].sort((left, right) => getDate(left).localeCompare(getDate(right)));
  if (quota >= ordered.length) {
    return ordered;
  }

  if (placement === 'end') {
    return ordered.slice(-quota);
  }
  if (placement === 'middle') {
    const firstIndex = Math.floor((ordered.length - quota) / 2);
    return ordered.slice(firstIndex, firstIndex + quota);
  }

  return ordered.slice(0, quota);
};
