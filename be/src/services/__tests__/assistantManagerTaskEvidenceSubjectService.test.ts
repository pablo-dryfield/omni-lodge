import {
  filterExpectedEvidenceItemsForCurrentShiftSources,
  reconcileExpectedEvidenceItemsForCurrentRoster,
  retainEvidenceSubjectForConfiguredShiftRule,
} from '../assistantManagerTaskEvidenceSubjectService';

describe('assistant-manager task evidence subjects', () => {
  const promotionSource = {
    key: 'promotion_shift',
    evidenceRuleKey: 'promotion_screenshot',
  };

  it('removes the subject from an ordinary image evidence rule', () => {
    expect(
      retainEvidenceSubjectForConfiguredShiftRule({
        ruleKey: 'task_screenshot',
        shiftEvidenceSources: [],
        subjectUserId: 191,
        subjectName: 'Jamie Felton',
      }),
    ).toEqual({
      subjectUserId: null,
      subjectName: null,
    });
  });

  it('removes the subject when only another rule is shift-sourced', () => {
    expect(
      retainEvidenceSubjectForConfiguredShiftRule({
        ruleKey: 'task_screenshot',
        shiftEvidenceSources: [promotionSource],
        subjectUserId: 191,
        subjectName: 'Jamie Felton',
      }),
    ).toEqual({
      subjectUserId: null,
      subjectName: null,
    });
  });

  it('retains the subject for a currently configured shift evidence rule', () => {
    expect(
      retainEvidenceSubjectForConfiguredShiftRule({
        ruleKey: 'promotion_screenshot',
        shiftEvidenceSources: [promotionSource],
        subjectUserId: 191,
        subjectName: 'Jamie Felton',
      }),
    ).toEqual({
      subjectUserId: 191,
      subjectName: 'Jamie Felton',
    });
  });

  it('removes an orphaned subject name when no subject user is provided', () => {
    expect(
      retainEvidenceSubjectForConfiguredShiftRule({
        ruleKey: 'promotion_screenshot',
        shiftEvidenceSources: [promotionSource],
        subjectUserId: null,
        subjectName: 'Jamie Felton',
      }),
    ).toEqual({
      subjectUserId: null,
      subjectName: null,
    });
  });
});

describe('stored assistant-manager task expected evidence', () => {
  const expectedEvidenceItems = [
    {
      id: 'current',
      sourceKey: 'promotion_shift',
      ruleKey: 'promotion_screenshot',
    },
    {
      id: 'changed-rule',
      sourceKey: 'promotion_shift',
      ruleKey: 'old_screenshot',
    },
    {
      id: 'removed-source',
      sourceKey: 'cleaning_shift',
      ruleKey: 'promotion_screenshot',
    },
  ];

  it('returns no stored items after all shift evidence sources are removed', () => {
    expect(
      filterExpectedEvidenceItemsForCurrentShiftSources(expectedEvidenceItems, []),
    ).toEqual([]);
  });

  it('keeps only items whose source key and rule key still match', () => {
    expect(
      filterExpectedEvidenceItemsForCurrentShiftSources(expectedEvidenceItems, [
        {
          key: 'promotion_shift',
          evidenceRuleKey: 'promotion_screenshot',
        },
      ]),
    ).toEqual([expectedEvidenceItems[0]]);
  });

  it('reconciles stored expected slots against the live roster', () => {
    const storedSlots = [
      {
        id: 'stored-henry',
        sourceKey: 'promotion_shift',
        sourceLabel: 'Promotion',
        ruleKey: 'promotion_screenshot',
        type: 'image' as const,
        subjectUserId: 101,
        subjectName: 'Henry Brown',
        shiftTypeIds: [7],
      },
      {
        id: 'stored-removed',
        sourceKey: 'promotion_shift',
        sourceLabel: 'Promotion',
        ruleKey: 'promotion_screenshot',
        type: 'image' as const,
        subjectUserId: 102,
        subjectName: 'Removed Person',
        shiftTypeIds: [7],
      },
    ];
    const liveSlots = [
      {
        id: 'live-henry',
        sourceKey: 'promotion_shift',
        sourceLabel: 'Promotion',
        ruleKey: 'promotion_screenshot',
        type: 'image' as const,
        subjectUserId: 101,
        subjectName: 'Henry Brown',
        shiftTypeIds: [7],
      },
      {
        id: 'live-yanna',
        sourceKey: 'promotion_shift',
        sourceLabel: 'Promotion',
        ruleKey: 'promotion_screenshot',
        type: 'image' as const,
        subjectUserId: 103,
        subjectName: 'Yanna Yolova',
        shiftTypeIds: [7],
      },
    ];

    expect(reconcileExpectedEvidenceItemsForCurrentRoster(storedSlots, liveSlots)).toEqual([
      {
        ...liveSlots[0],
        id: 'stored-henry',
      },
      liveSlots[1],
    ]);
  });

  it('clears expected slots when the current roster no longer matches the shift evidence source', () => {
    expect(
      reconcileExpectedEvidenceItemsForCurrentRoster([
        {
          id: 'stored-henry',
          sourceKey: 'promotion_shift',
          ruleKey: 'promotion_screenshot',
          subjectUserId: 101,
        },
      ], []),
    ).toEqual([]);
  });
});
