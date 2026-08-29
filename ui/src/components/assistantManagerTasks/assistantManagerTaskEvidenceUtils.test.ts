import type {
  AssistantManagerTaskEvidenceItem,
  AssistantManagerTaskEvidenceRule,
  AssistantManagerTaskExpectedEvidenceItem,
} from '../../types/assistantManagerTasks/AssistantManagerTask';
import {
  getMissingExpectedShiftImageEvidenceItems,
  getShiftEvidenceRuleKeys,
  mergeUploadedEvidenceItem,
  resolveImageEvidenceSubject,
} from './assistantManagerTaskEvidenceUtils';

describe('assistant manager task image evidence subjects', () => {
  it('only treats rules referenced by shift evidence sources as shift-linked', () => {
    expect(getShiftEvidenceRuleKeys()).toEqual(new Set());
    expect(
      getShiftEvidenceRuleKeys({
        shiftEvidenceSources: [
          {
            key: 'promotion_shift',
            label: 'Promotion shift',
            evidenceRuleKey: 'promotion_photo',
            shiftTypeIds: [2, '3'],
          },
          {
            key: 'cleaning_shift',
            label: 'Cleaning shift',
            ruleKey: 'legacy_cleaning_photo',
            shiftTypeId: 4,
          },
          {
            key: 'missing_shift_types',
            label: 'Incomplete source',
            evidenceRuleKey: 'ignored_photo',
          },
          {
            key: 'missing_label',
            evidenceRuleKey: 'also_ignored_photo',
            shiftTypeIds: [2],
          },
          null,
        ],
      }),
    ).toEqual(new Set(['promotion_photo', 'legacy_cleaning_photo']));
  });

  it('does not attach any staff subject to an ordinary image rule', () => {
    expect(
      resolveImageEvidenceSubject({
        ruleKey: 'promotion_chat_screenshot',
        shiftEvidenceRuleKeys: new Set(),
        subjectOverride: {
          subjectUserId: 27,
          subjectName: 'Stale Expected Staff Member',
        },
        selectedSubjectUserId: '191',
        assignedUserId: 191,
        assignedUserName: 'Jamie Felton',
      }),
    ).toEqual({
      subjectUserId: null,
      subjectName: null,
    });
  });

  it('uses the selected staff member for a configured shift-linked rule', () => {
    expect(
      resolveImageEvidenceSubject({
        ruleKey: 'promotion_photo',
        shiftEvidenceRuleKeys: new Set(['promotion_photo']),
        selectedSubjectUserId: '191',
        assignedUserId: 42,
        assignedUserName: 'Assigned Manager',
        userNameById: new Map([['191', 'Jamie Felton']]),
      }),
    ).toEqual({
      subjectUserId: 191,
      subjectName: 'Jamie Felton',
    });
  });

  it('preserves an explicit expected-item subject', () => {
    expect(
      resolveImageEvidenceSubject({
        ruleKey: 'promotion_photo',
        shiftEvidenceRuleKeys: new Set(['promotion_photo']),
        subjectOverride: {
          subjectUserId: 27,
          subjectName: 'Expected Staff Member',
        },
        selectedSubjectUserId: '191',
        assignedUserId: 191,
        assignedUserName: 'Jamie Felton',
      }),
    ).toEqual({
      subjectUserId: 27,
      subjectName: 'Expected Staff Member',
    });
  });
});

describe('assistant manager task uploaded evidence merging', () => {
  const shiftImageRule: AssistantManagerTaskEvidenceRule = {
    key: 'promotion_photo',
    label: 'Promotion photo',
    type: 'image',
    multiple: false,
  };
  const firstStaffImage: AssistantManagerTaskEvidenceItem = {
    id: 'image-staff-191',
    ruleKey: shiftImageRule.key,
    type: 'image',
    subjectUserId: 191,
    subjectName: 'Jamie Felton',
  };
  const secondStaffImage: AssistantManagerTaskEvidenceItem = {
    id: 'image-staff-27',
    ruleKey: shiftImageRule.key,
    type: 'image',
    subjectUserId: 27,
    subjectName: 'Expected Staff Member',
  };

  it('keeps different staff images for a shift rule even when multiple is false', () => {
    expect(
      mergeUploadedEvidenceItem(
        [firstStaffImage],
        shiftImageRule,
        secondStaffImage,
        new Set([shiftImageRule.key]),
      ),
    ).toEqual([firstStaffImage, secondStaffImage]);
  });

  it('replaces only the same staff image for a shift rule', () => {
    const replacementImage: AssistantManagerTaskEvidenceItem = {
      ...firstStaffImage,
      id: 'replacement-image-staff-191',
    };

    expect(
      mergeUploadedEvidenceItem(
        [firstStaffImage, secondStaffImage],
        shiftImageRule,
        replacementImage,
        new Set([shiftImageRule.key]),
      ),
    ).toEqual([secondStaffImage, replacementImage]);
  });

  it('preserves single-item replacement for an ordinary image rule', () => {
    const replacementImage: AssistantManagerTaskEvidenceItem = {
      ...secondStaffImage,
      id: 'ordinary-replacement',
    };

    expect(
      mergeUploadedEvidenceItem(
        [firstStaffImage],
        shiftImageRule,
        replacementImage,
        new Set(),
      ),
    ).toEqual([replacementImage]);
  });

  it('preserves append behavior for an ordinary multiple image rule', () => {
    const ordinaryMultipleRule = { ...shiftImageRule, multiple: true };
    const nextImage: AssistantManagerTaskEvidenceItem = {
      id: 'ordinary-image-without-subject',
      ruleKey: ordinaryMultipleRule.key,
      type: 'image',
    };

    expect(
      mergeUploadedEvidenceItem(
        [firstStaffImage],
        ordinaryMultipleRule,
        nextImage,
        new Set(),
      ),
    ).toEqual([firstStaffImage, nextImage]);
  });
});

describe('assistant manager task missing shift evidence', () => {
  const expectedItems: AssistantManagerTaskExpectedEvidenceItem[] = [
    {
      id: 'promotion-191',
      sourceKey: 'promotion_shift',
      sourceLabel: 'Promotion shift',
      ruleKey: 'promotion_photo',
      type: 'image',
      subjectUserId: 191,
      subjectName: 'Jamie Felton',
      shiftTypeIds: [2],
    },
    {
      id: 'promotion-27',
      sourceKey: 'promotion_shift',
      sourceLabel: 'Promotion shift',
      ruleKey: 'promotion_photo',
      type: 'image',
      subjectUserId: 27,
      subjectName: 'Expected Staff Member',
      shiftTypeIds: [2],
    },
    {
      id: 'cleaning-27',
      sourceKey: 'cleaning_shift',
      sourceLabel: 'Cleaning shift',
      ruleKey: 'cleaning_photo',
      type: 'image',
      subjectUserId: 27,
      subjectName: 'Expected Staff Member',
      shiftTypeIds: [4],
    },
  ];

  it('matches uploaded image slots by both rule key and staff user id', () => {
    const uploadedItems: AssistantManagerTaskEvidenceItem[] = [
      {
        id: 'uploaded-promotion-191',
        ruleKey: 'promotion_photo',
        type: 'image',
        subjectUserId: 191,
      },
      {
        id: 'wrong-rule-for-27',
        ruleKey: 'another_photo',
        type: 'image',
        subjectUserId: 27,
      },
      {
        id: 'wrong-type-for-promotion-27',
        ruleKey: 'promotion_photo',
        type: 'link',
        subjectUserId: 27,
        value: 'https://example.com',
      },
      {
        id: 'uploaded-cleaning-27',
        ruleKey: 'cleaning_photo',
        type: 'image',
        subjectUserId: 27,
      },
    ];

    expect(
      getMissingExpectedShiftImageEvidenceItems(expectedItems, uploadedItems),
    ).toEqual([expectedItems[1]]);
  });

  it('returns every expected slot when no subject-tagged image exists', () => {
    expect(
      getMissingExpectedShiftImageEvidenceItems(expectedItems, [
        {
          id: 'unassigned-image',
          ruleKey: 'promotion_photo',
          type: 'image',
          subjectUserId: null,
        },
      ]),
    ).toEqual(expectedItems);
  });
});
