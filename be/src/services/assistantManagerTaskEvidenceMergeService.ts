export type AssistantManagerTaskEvidenceMergeItem = {
  ruleKey: string;
  type: string;
  subjectUserId?: number | null;
};

export type AssistantManagerTaskImageEvidenceRuleIdentity = {
  key: string;
  type: 'image';
  multiple: boolean;
};

export type MergeUploadedImageEvidenceResult<
  TItem extends AssistantManagerTaskEvidenceMergeItem,
> = {
  remainingItems: TItem[];
  removedItems: TItem[];
  nextItems: TItem[];
};

const hasMatchingRuleAndType = (
  item: AssistantManagerTaskEvidenceMergeItem,
  rule: AssistantManagerTaskImageEvidenceRuleIdentity,
): boolean => item.ruleKey === rule.key && item.type === rule.type;

/**
 * Merges an uploaded image into a task log's evidence collection.
 *
 * Shift-based evidence is identified by subject before considering the rule's
 * legacy `multiple` option. This permits one current image per expected staff
 * member even when an older template still describes the underlying rule as
 * non-multiple. Ordinary multiple rules append; ordinary non-multiple rules
 * replace every image belonging to the same rule.
 */
export const mergeUploadedImageEvidenceItems = <
  TItem extends AssistantManagerTaskEvidenceMergeItem,
>({
  existingItems,
  nextImageItem,
  rule,
  isShiftBased,
}: {
  existingItems: readonly TItem[];
  nextImageItem: TItem;
  rule: AssistantManagerTaskImageEvidenceRuleIdentity;
  isShiftBased: boolean;
}): MergeUploadedImageEvidenceResult<TItem> => {
  if (
    nextImageItem.ruleKey !== rule.key ||
    nextImageItem.type !== rule.type
  ) {
    throw new Error('Uploaded evidence item does not match the provided image rule');
  }

  const hasShiftSubject =
    isShiftBased &&
    Number.isInteger(nextImageItem.subjectUserId) &&
    Number(nextImageItem.subjectUserId) > 0;

  const shouldReplace = (item: TItem): boolean => {
    if (!hasMatchingRuleAndType(item, rule)) {
      return false;
    }

    if (hasShiftSubject) {
      return item.subjectUserId === nextImageItem.subjectUserId;
    }

    return !rule.multiple;
  };

  const removedItems = existingItems.filter(shouldReplace);
  const remainingItems = existingItems.filter((item) => !shouldReplace(item));

  return {
    remainingItems,
    removedItems,
    nextItems: [...remainingItems, nextImageItem],
  };
};

export type AssistantManagerTaskExpectedShiftEvidencePair = {
  ruleKey: string;
  subjectUserId: number;
};

export type AssistantManagerTaskStoredShiftEvidenceItem =
  AssistantManagerTaskEvidenceMergeItem & {
    valid?: boolean;
    storagePath?: string | null;
    driveFileId?: string | null;
    driveWebViewLink?: string | null;
  };

export type AssistantManagerTaskStoredImageEvidenceItem = {
  id?: string | null;
  type: string;
  storagePath?: string | null;
  driveFileId?: string | null;
};

/**
 * Finds stored image files that are no longer referenced by the next evidence
 * collection. Matching by both item id and Drive id protects legacy entries
 * whose generated item id may have changed while retaining the same file.
 */
export const findRemovedStoredImageEvidenceItems = <
  TItem extends AssistantManagerTaskStoredImageEvidenceItem,
>(
  previousItems: readonly TItem[],
  nextItems: readonly AssistantManagerTaskStoredImageEvidenceItem[],
): TItem[] => {
  const nextImageIds = new Set(
    nextItems
      .filter((item) => item.type === 'image' && typeof item.id === 'string')
      .map((item) => (item.id as string).trim())
      .filter(Boolean),
  );
  const nextImageDriveIds = new Set(
    nextItems
      .filter((item) => item.type === 'image' && typeof item.driveFileId === 'string')
      .map((item) => (item.driveFileId as string).trim())
      .filter(Boolean),
  );
  const nextImageStoragePaths = new Set(
    nextItems
      .filter((item) => item.type === 'image' && typeof item.storagePath === 'string')
      .map((item) => (item.storagePath as string).trim())
      .filter(Boolean),
  );

  return previousItems.filter((item) => {
    if (item.type !== 'image' || !Boolean(item.storagePath || item.driveFileId)) {
      return false;
    }
    const itemId = typeof item.id === 'string' ? item.id.trim() : '';
    const driveFileId = typeof item.driveFileId === 'string' ? item.driveFileId.trim() : '';
    const storagePath = typeof item.storagePath === 'string' ? item.storagePath.trim() : '';
    return !(itemId && nextImageIds.has(itemId)) &&
      !(driveFileId && nextImageDriveIds.has(driveFileId)) &&
      !(storagePath && nextImageStoragePaths.has(storagePath));
  });
};

const hasStoredImageContent = (
  item: AssistantManagerTaskStoredShiftEvidenceItem,
): boolean => {
  if (item.valid === false) {
    return false;
  }

  return (
    item.valid === true ||
    Boolean(item.storagePath || item.driveFileId || item.driveWebViewLink)
  );
};

const buildExpectedPairKey = (
  pair: AssistantManagerTaskExpectedShiftEvidencePair,
): string => `${pair.ruleKey}\u0000${pair.subjectUserId}`;

/**
 * Returns the unique expected (rule, subject) pairs that do not have a stored
 * image. The returned order follows the expected-items order.
 */
export const findMissingExpectedShiftEvidencePairs = <
  TExpected extends AssistantManagerTaskExpectedShiftEvidencePair,
>(
  expectedPairs: readonly TExpected[],
  evidenceItems: readonly AssistantManagerTaskStoredShiftEvidenceItem[],
): TExpected[] => {
  const satisfiedPairKeys = new Set(
    evidenceItems
      .filter(
        (item) =>
          item.type === 'image' &&
          Number.isInteger(item.subjectUserId) &&
          Number(item.subjectUserId) > 0 &&
          hasStoredImageContent(item),
      )
      .map((item) =>
        buildExpectedPairKey({
          ruleKey: item.ruleKey,
          subjectUserId: Number(item.subjectUserId),
        }),
      ),
  );

  const seenExpectedPairKeys = new Set<string>();
  const missingPairs: TExpected[] = [];

  expectedPairs.forEach((pair) => {
    const pairKey = buildExpectedPairKey(pair);
    if (seenExpectedPairKeys.has(pairKey)) {
      return;
    }
    seenExpectedPairKeys.add(pairKey);
    if (!satisfiedPairKeys.has(pairKey)) {
      missingPairs.push(pair);
    }
  });

  return missingPairs;
};
