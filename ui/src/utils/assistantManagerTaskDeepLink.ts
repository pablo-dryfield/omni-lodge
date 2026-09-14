const TASK_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const normalizeAssistantManagerTaskDate = (
  value: string | null | undefined,
): string | null => {
  const candidate = value?.trim() ?? '';
  if (!TASK_DATE_PATTERN.test(candidate)) {
    return null;
  }

  const parsed = new Date(`${candidate}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== candidate) {
    return null;
  }

  return candidate;
};

export const parseAssistantManagerTaskDeepLink = (
  params: Pick<URLSearchParams, 'get'>,
): { taskId: number | null; taskDate: string | null } => {
  const rawTaskId = params.get('task');
  const numericTaskId = rawTaskId ? Number(rawTaskId) : Number.NaN;
  const taskId = Number.isInteger(numericTaskId) && numericTaskId > 0
    ? numericTaskId
    : null;

  return {
    taskId,
    taskDate: taskId == null
      ? null
      : normalizeAssistantManagerTaskDate(params.get('taskDate')),
  };
};

export const buildAssistantManagerTaskDeepLink = (
  taskLogId: number,
  taskDate?: string | null,
): string => {
  const params = new URLSearchParams({
    section: 'dashboard',
    task: String(taskLogId),
  });
  const normalizedTaskDate = normalizeAssistantManagerTaskDate(taskDate);
  if (normalizedTaskDate) {
    params.set('taskDate', normalizedTaskDate);
  }

  return `/assistant-manager-tasks?${params.toString()}`;
};
