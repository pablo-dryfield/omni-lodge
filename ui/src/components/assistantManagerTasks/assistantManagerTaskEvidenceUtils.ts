import type {
  AssistantManagerTaskEvidenceItem,
  AssistantManagerTaskEvidenceRule,
  AssistantManagerTaskExpectedEvidenceItem,
} from '../../types/assistantManagerTasks/AssistantManagerTask';

const SHIFT_EVIDENCE_SOURCES_CONFIG_KEY = 'shiftEvidenceSources';

type EvidenceSubjectOverride = {
  subjectUserId?: number | null;
  subjectName?: string | null;
};

type ResolveImageEvidenceSubjectOptions = {
  ruleKey: string;
  shiftEvidenceRuleKeys: ReadonlySet<string>;
  subjectOverride?: EvidenceSubjectOverride;
  selectedSubjectUserId?: string | number | null;
  assignedUserId: number;
  assignedUserName?: string | null;
  userNameById?: ReadonlyMap<string, string>;
};

export type ResolvedImageEvidenceSubject = {
  subjectUserId: number | null;
  subjectName: string | null;
};

const buildShiftEvidenceSlotKey = (ruleKey: string, subjectUserId: number): string =>
  `${ruleKey}\u0000${subjectUserId}`;

const normalizePositiveInteger = (value: unknown): number | null => {
  const normalized = Number(value);
  return Number.isInteger(normalized) && normalized > 0 ? normalized : null;
};

export const getShiftEvidenceRuleKeys = (
  scheduleConfig?: Record<string, unknown> | null,
): Set<string> => {
  const rawSources = scheduleConfig?.[SHIFT_EVIDENCE_SOURCES_CONFIG_KEY];
  if (!Array.isArray(rawSources)) {
    return new Set();
  }

  return new Set(
    rawSources
      .map((entry) => {
        if (!entry || typeof entry !== 'object') {
          return '';
        }

        const source = entry as Record<string, unknown>;
        const sourceKey = typeof source.key === 'string' ? source.key.trim() : '';
        const sourceLabel = typeof source.label === 'string' ? source.label.trim() : '';
        const rawRuleKey = source.evidenceRuleKey ?? source.ruleKey;
        const ruleKey = typeof rawRuleKey === 'string' ? rawRuleKey.trim() : '';
        const shiftTypeIds = Array.isArray(source.shiftTypeIds)
          ? source.shiftTypeIds
              .map((value) => Number(value))
              .filter((value) => Number.isInteger(value) && value > 0)
          : typeof source.shiftTypeId === 'number' &&
              Number.isInteger(source.shiftTypeId) &&
              source.shiftTypeId > 0
            ? [source.shiftTypeId]
            : [];

        return sourceKey && sourceLabel && ruleKey && shiftTypeIds.length > 0 ? ruleKey : '';
      })
      .filter(Boolean),
  );
};

export const resolveImageEvidenceSubject = ({
  ruleKey,
  shiftEvidenceRuleKeys,
  subjectOverride,
  selectedSubjectUserId,
  assignedUserId,
  assignedUserName,
  userNameById,
}: ResolveImageEvidenceSubjectOptions): ResolvedImageEvidenceSubject => {
  const usesShiftEvidenceSubject = shiftEvidenceRuleKeys.has(ruleKey);

  if (!usesShiftEvidenceSubject) {
    return {
      subjectUserId: null,
      subjectName: null,
    };
  }

  const overrideUserId = normalizePositiveInteger(subjectOverride?.subjectUserId);
  const selectedUserId = normalizePositiveInteger(selectedSubjectUserId);
  const normalizedAssignedUserId = normalizePositiveInteger(assignedUserId);
  const subjectUserId = overrideUserId ?? selectedUserId ?? normalizedAssignedUserId;
  if (subjectUserId == null) {
    return {
      subjectUserId: null,
      subjectName: null,
    };
  }

  const overrideSubjectName = subjectOverride?.subjectName?.trim();
  const assignedSubjectName =
    subjectUserId === normalizedAssignedUserId ? assignedUserName?.trim() : null;

  return {
    subjectUserId,
    subjectName:
      overrideSubjectName ||
      userNameById?.get(String(subjectUserId)) ||
      assignedSubjectName ||
      `User #${subjectUserId}`,
  };
};

export const mergeUploadedEvidenceItem = (
  items: readonly AssistantManagerTaskEvidenceItem[],
  rule: AssistantManagerTaskEvidenceRule,
  nextItem: AssistantManagerTaskEvidenceItem,
  shiftEvidenceRuleKeys: ReadonlySet<string>,
): AssistantManagerTaskEvidenceItem[] => {
  const hasSubject = nextItem.subjectUserId != null;
  const isShiftEvidenceSubjectUpload =
    shiftEvidenceRuleKeys.has(rule.key) &&
    rule.type === 'image' &&
    nextItem.type === 'image' &&
    hasSubject;
  const replaceSameSubject =
    hasSubject && (isShiftEvidenceSubjectUpload || rule.multiple === true);

  const remainingItems = replaceSameSubject
    ? items.filter(
        (item) =>
          !(
            item.ruleKey === rule.key &&
            item.type === rule.type &&
            item.subjectUserId === nextItem.subjectUserId
          ),
      )
    : rule.multiple
      ? items
      : items.filter((item) => !(item.ruleKey === rule.key && item.type === rule.type));

  return [...remainingItems, nextItem];
};

export const getMissingExpectedShiftImageEvidenceItems = (
  expectedItems: readonly AssistantManagerTaskExpectedEvidenceItem[],
  evidenceItems: readonly AssistantManagerTaskEvidenceItem[],
): AssistantManagerTaskExpectedEvidenceItem[] => {
  const uploadedSlotKeys = new Set<string>();

  evidenceItems.forEach((item) => {
    if (item.type !== 'image' || item.subjectUserId == null) {
      return;
    }

    uploadedSlotKeys.add(buildShiftEvidenceSlotKey(item.ruleKey, item.subjectUserId));
  });

  return expectedItems.filter(
    (item) =>
      !uploadedSlotKeys.has(buildShiftEvidenceSlotKey(item.ruleKey, item.subjectUserId)),
  );
};
