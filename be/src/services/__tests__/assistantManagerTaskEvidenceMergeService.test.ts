import {
  findMissingExpectedShiftEvidencePairs,
  mergeUploadedImageEvidenceItems,
} from '../assistantManagerTaskEvidenceMergeService';

type EvidenceItem = {
  id: string;
  ruleKey: string;
  type: 'image' | 'link';
  subjectUserId?: number | null;
  valid?: boolean;
  storagePath?: string | null;
  driveFileId?: string | null;
  driveWebViewLink?: string | null;
};

const promotionRule = {
  key: 'promotion_screenshot',
  type: 'image' as const,
  multiple: false,
};

const imageItem = (
  id: string,
  ruleKey: string,
  subjectUserId: number | null = null,
): EvidenceItem => ({
  id,
  ruleKey,
  type: 'image',
  subjectUserId,
  storagePath: `assistant-manager-tasks/${id}.jpg`,
});

describe('mergeUploadedImageEvidenceItems', () => {
  it('replaces only the same shift subject even when the legacy rule is non-multiple', () => {
    const sameSubject = imageItem('same-subject-old', promotionRule.key, 191);
    const otherSubject = imageItem('other-subject', promotionRule.key, 192);
    const sameRuleLink: EvidenceItem = {
      id: 'same-rule-link',
      ruleKey: promotionRule.key,
      type: 'link',
      subjectUserId: 191,
    };
    const unrelatedRule = imageItem('unrelated-rule', 'cleaning_photo', 191);
    const existingItems = [sameSubject, otherSubject, sameRuleLink, unrelatedRule];
    const nextImageItem = imageItem('same-subject-new', promotionRule.key, 191);

    const result = mergeUploadedImageEvidenceItems({
      existingItems,
      nextImageItem,
      rule: promotionRule,
      isShiftBased: true,
    });

    expect(result.removedItems).toEqual([sameSubject]);
    expect(result.remainingItems).toEqual([otherSubject, sameRuleLink, unrelatedRule]);
    expect(result.nextItems).toEqual([
      otherSubject,
      sameRuleLink,
      unrelatedRule,
      nextImageItem,
    ]);
    expect(existingItems).toEqual([sameSubject, otherSubject, sameRuleLink, unrelatedRule]);
  });

  it('uses subject-aware replacement for a multiple shift rule', () => {
    const sameSubject = imageItem('same-subject-old', promotionRule.key, 191);
    const otherSubject = imageItem('other-subject', promotionRule.key, 192);
    const nextImageItem = imageItem('same-subject-new', promotionRule.key, 191);

    const result = mergeUploadedImageEvidenceItems({
      existingItems: [sameSubject, otherSubject],
      nextImageItem,
      rule: { ...promotionRule, multiple: true },
      isShiftBased: true,
    });

    expect(result.removedItems).toEqual([sameSubject]);
    expect(result.nextItems).toEqual([otherSubject, nextImageItem]);
  });

  it('appends a first upload for another shift subject', () => {
    const existingSubject = imageItem('existing-subject', promotionRule.key, 191);
    const nextImageItem = imageItem('new-subject', promotionRule.key, 192);

    const result = mergeUploadedImageEvidenceItems({
      existingItems: [existingSubject],
      nextImageItem,
      rule: promotionRule,
      isShiftBased: true,
    });

    expect(result.removedItems).toEqual([]);
    expect(result.remainingItems).toEqual([existingSubject]);
    expect(result.nextItems).toEqual([existingSubject, nextImageItem]);
  });

  it('replaces all same-rule images for an ordinary non-multiple rule', () => {
    const firstImage = imageItem('first', promotionRule.key, 191);
    const secondImage = imageItem('second', promotionRule.key, 192);
    const sameRuleLink: EvidenceItem = {
      id: 'link',
      ruleKey: promotionRule.key,
      type: 'link',
    };
    const unrelatedRule = imageItem('unrelated', 'cleaning_photo');
    const nextImageItem = imageItem('next', promotionRule.key);

    const result = mergeUploadedImageEvidenceItems({
      existingItems: [firstImage, sameRuleLink, unrelatedRule, secondImage],
      nextImageItem,
      rule: promotionRule,
      isShiftBased: false,
    });

    expect(result.removedItems).toEqual([firstImage, secondImage]);
    expect(result.remainingItems).toEqual([sameRuleLink, unrelatedRule]);
    expect(result.nextItems).toEqual([sameRuleLink, unrelatedRule, nextImageItem]);
  });

  it('appends for an ordinary multiple rule', () => {
    const existingImage = imageItem('existing', promotionRule.key);
    const nextImageItem = imageItem('next', promotionRule.key);

    const result = mergeUploadedImageEvidenceItems({
      existingItems: [existingImage],
      nextImageItem,
      rule: { ...promotionRule, multiple: true },
      isShiftBased: false,
    });

    expect(result.removedItems).toEqual([]);
    expect(result.remainingItems).toEqual([existingImage]);
    expect(result.nextItems).toEqual([existingImage, nextImageItem]);
  });

  it('falls back to normal rule cardinality when shift evidence has no subject', () => {
    const existingImage = imageItem('existing', promotionRule.key, 191);
    const nextImageItem = imageItem('next', promotionRule.key);

    const result = mergeUploadedImageEvidenceItems({
      existingItems: [existingImage],
      nextImageItem,
      rule: promotionRule,
      isShiftBased: true,
    });

    expect(result.removedItems).toEqual([existingImage]);
    expect(result.nextItems).toEqual([nextImageItem]);
  });

  it('rejects an uploaded item that does not match the provided rule', () => {
    expect(() =>
      mergeUploadedImageEvidenceItems({
        existingItems: [],
        nextImageItem: imageItem('next', 'another_rule'),
        rule: promotionRule,
        isShiftBased: false,
      }),
    ).toThrow('Uploaded evidence item does not match the provided image rule');
  });
});

describe('findMissingExpectedShiftEvidencePairs', () => {
  it('returns each missing rule-and-subject pair once in expected order', () => {
    const expectedPairs = [
      { ruleKey: promotionRule.key, subjectUserId: 191, subjectName: 'Jamie' },
      { ruleKey: promotionRule.key, subjectUserId: 192, subjectName: 'Aimee' },
      { ruleKey: promotionRule.key, subjectUserId: 192, subjectName: 'Aimee duplicate' },
      { ruleKey: 'cleaning_photo', subjectUserId: 193, subjectName: 'Natalie' },
    ];
    const evidenceItems: EvidenceItem[] = [
      imageItem('stored-jamie', promotionRule.key, 191),
      {
        id: 'invalid-aimee',
        ruleKey: promotionRule.key,
        type: 'image',
        subjectUserId: 192,
        valid: false,
        storagePath: 'assistant-manager-tasks/invalid-aimee.jpg',
      },
      {
        id: 'cleaning-link',
        ruleKey: 'cleaning_photo',
        type: 'link',
        subjectUserId: 193,
        storagePath: 'assistant-manager-tasks/not-an-image.jpg',
      },
      imageItem('unrelated-subject', promotionRule.key, 194),
    ];

    expect(findMissingExpectedShiftEvidencePairs(expectedPairs, evidenceItems)).toEqual([
      expectedPairs[1],
      expectedPairs[3],
    ]);
  });

  it('recognizes valid image evidence from each supported stored-content marker', () => {
    const expectedPairs = [
      { ruleKey: 'by-valid', subjectUserId: 1 },
      { ruleKey: 'by-storage-path', subjectUserId: 2 },
      { ruleKey: 'by-drive-id', subjectUserId: 3 },
      { ruleKey: 'by-drive-link', subjectUserId: 4 },
    ];
    const evidenceItems: EvidenceItem[] = [
      {
        id: 'valid',
        ruleKey: 'by-valid',
        type: 'image',
        subjectUserId: 1,
        valid: true,
      },
      {
        id: 'storage',
        ruleKey: 'by-storage-path',
        type: 'image',
        subjectUserId: 2,
        storagePath: 'assistant-manager-tasks/storage.jpg',
      },
      {
        id: 'drive-id',
        ruleKey: 'by-drive-id',
        type: 'image',
        subjectUserId: 3,
        driveFileId: 'drive-file-id',
      },
      {
        id: 'drive-link',
        ruleKey: 'by-drive-link',
        type: 'image',
        subjectUserId: 4,
        driveWebViewLink: 'https://drive.google.com/file/d/123/view',
      },
    ];

    expect(findMissingExpectedShiftEvidencePairs(expectedPairs, evidenceItems)).toEqual([]);
  });

  it('does not let another rule or subject satisfy an expected pair', () => {
    const expectedPair = { ruleKey: promotionRule.key, subjectUserId: 191 };
    const evidenceItems = [
      imageItem('wrong-rule', 'another_rule', 191),
      imageItem('wrong-subject', promotionRule.key, 192),
      imageItem('missing-subject', promotionRule.key),
    ];

    expect(findMissingExpectedShiftEvidencePairs([expectedPair], evidenceItems)).toEqual([
      expectedPair,
    ]);
  });
});
