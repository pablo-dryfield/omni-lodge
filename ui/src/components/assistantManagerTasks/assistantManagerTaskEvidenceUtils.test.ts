import {
  getShiftEvidenceRuleKeys,
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
