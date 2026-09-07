import type {
  AssistantManagerTaskEvidenceItem,
  AssistantManagerTaskLog,
  AssistantManagerTaskTemplate,
} from '../../types/assistantManagerTasks/AssistantManagerTask';

export const isCleaningManagedTask = (
  log?: Pick<AssistantManagerTaskLog, 'meta'> | null,
  template?: Pick<AssistantManagerTaskTemplate, 'scheduleConfig'> | null,
): boolean => {
  if (!log) return false;
  const workflow = log.meta?.cleaningPhotoWorkflow;
  return template?.scheduleConfig.cleaningPhotoApprovalEnabled === true || Boolean(
    workflow && typeof workflow === 'object' && !Array.isArray(workflow) &&
    (workflow as Record<string, unknown>).managed === true,
  );
};

export const canManuallyManageTask = (
  hasManagementAccess: boolean,
  log?: Pick<AssistantManagerTaskLog, 'meta'> | null,
  template?: Pick<AssistantManagerTaskTemplate, 'scheduleConfig'> | null,
): boolean => hasManagementAccess && Boolean(log) && !isCleaningManagedTask(log, template);

// A subject can have several approved slots for the same rule. Keep every photo,
// while retaining one empty placeholder when evidence has not arrived yet.
export const getSubjectImageEvidenceItems = (
  items: AssistantManagerTaskEvidenceItem[], ruleKey: string, subjectUserId: number,
): Array<AssistantManagerTaskEvidenceItem | undefined> => {
  const matching = items.filter((item) => item.ruleKey === ruleKey && item.type === 'image' &&
    Number(item.subjectUserId ?? -1) === subjectUserId);
  return matching.length ? matching : [undefined];
};
