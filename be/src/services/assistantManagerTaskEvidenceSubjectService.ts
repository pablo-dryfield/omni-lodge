export type AssistantManagerTaskShiftEvidenceSourceReference = {
  key: string;
  evidenceRuleKey: string;
};

export type AssistantManagerTaskExpectedEvidenceSourceReference = {
  sourceKey: string;
  ruleKey: string;
};

export type AssistantManagerTaskExpectedEvidenceRosterItem =
  AssistantManagerTaskExpectedEvidenceSourceReference & {
    id: string;
    subjectUserId: number;
  };

type AssistantManagerTaskEvidenceSubject = {
  subjectUserId: number | null;
  subjectName: string | null;
};

const buildSourceRuleKey = (sourceKey: string, ruleKey: string): string =>
  `${sourceKey}\u0000${ruleKey}`;

const buildSourceRuleSubjectKey = (
  item: AssistantManagerTaskExpectedEvidenceRosterItem,
): string => `${item.sourceKey}\u0000${item.ruleKey}\u0000${item.subjectUserId}`;

export const retainEvidenceSubjectForConfiguredShiftRule = ({
  ruleKey,
  shiftEvidenceSources,
  subjectUserId,
  subjectName,
}: {
  ruleKey: string;
  shiftEvidenceSources: AssistantManagerTaskShiftEvidenceSourceReference[];
  subjectUserId: number | null;
  subjectName: string | null;
}): AssistantManagerTaskEvidenceSubject => {
  const isShiftEvidenceRule = shiftEvidenceSources.some(
    (source) => source.evidenceRuleKey === ruleKey,
  );

  return isShiftEvidenceRule && subjectUserId != null
    ? { subjectUserId, subjectName }
    : { subjectUserId: null, subjectName: null };
};

export const filterExpectedEvidenceItemsForCurrentShiftSources = <
  T extends AssistantManagerTaskExpectedEvidenceSourceReference,
>(
  expectedEvidenceItems: T[],
  shiftEvidenceSources: AssistantManagerTaskShiftEvidenceSourceReference[],
): T[] => {
  if (shiftEvidenceSources.length === 0) {
    return [];
  }

  const configuredSourceRuleKeys = new Set(
    shiftEvidenceSources.map((source) =>
      buildSourceRuleKey(source.key, source.evidenceRuleKey),
    ),
  );

  return expectedEvidenceItems.filter((item) =>
    configuredSourceRuleKeys.has(buildSourceRuleKey(item.sourceKey, item.ruleKey)),
  );
};

/**
 * Keeps shift evidence expectations aligned with the live published roster.
 *
 * A task log may already contain a stored expectation snapshot from when the
 * task was generated. That snapshot should not be treated as the whole truth:
 * people can be swapped, added, or removed in the schedule before the task is
 * completed. Use the live roster as the authoritative set of expected
 * `(source, rule, subject)` slots, while retaining the existing item IDs for
 * unchanged slots to avoid unnecessary UI churn.
 */
export const reconcileExpectedEvidenceItemsForCurrentRoster = <
  T extends AssistantManagerTaskExpectedEvidenceRosterItem,
>(
  storedExpectedEvidenceItems: readonly T[],
  liveExpectedEvidenceItems: readonly T[],
): T[] => {
  if (liveExpectedEvidenceItems.length === 0) {
    return [];
  }

  const storedBySourceRuleSubject = new Map<string, T>();
  storedExpectedEvidenceItems.forEach((item) => {
    const key = buildSourceRuleSubjectKey(item);
    if (!storedBySourceRuleSubject.has(key)) {
      storedBySourceRuleSubject.set(key, item);
    }
  });

  return liveExpectedEvidenceItems.map((liveItem) => {
    const storedItem = storedBySourceRuleSubject.get(buildSourceRuleSubjectKey(liveItem));
    return storedItem ? { ...liveItem, id: storedItem.id } : liveItem;
  });
};
