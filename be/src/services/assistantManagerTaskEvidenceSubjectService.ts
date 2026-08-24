export type AssistantManagerTaskShiftEvidenceSourceReference = {
  key: string;
  evidenceRuleKey: string;
};

export type AssistantManagerTaskExpectedEvidenceSourceReference = {
  sourceKey: string;
  ruleKey: string;
};

type AssistantManagerTaskEvidenceSubject = {
  subjectUserId: number | null;
  subjectName: string | null;
};

const buildSourceRuleKey = (sourceKey: string, ruleKey: string): string =>
  `${sourceKey}\u0000${ruleKey}`;

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
