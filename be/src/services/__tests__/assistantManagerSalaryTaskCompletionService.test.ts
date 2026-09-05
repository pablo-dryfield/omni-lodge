import {
  allocateAssistantManagerSalaryAcrossDays,
  calculateAssistantManagerSalaryTaskCompletion,
  mergeAssistantManagerSalaryDailyBreakdowns,
  partitionAssistantManagerSalaryDaysForTaskProration,
  shouldIncludeAssistantManagerTaskLogInCompensationScore,
} from '../assistantManagerSalaryTaskCompletionService.js';

describe('Assistant Manager Salary daily task completion', () => {
  it('excludes Social Media tasks retained only as supersession audit records', () => {
    const supersededMeta = {
      socialMediaPublishSupersession: {
        version: 1,
        contentId: 41,
        supersededByTaskLogId: 89,
      },
    };
    expect(shouldIncludeAssistantManagerTaskLogInCompensationScore(
      'waived',
      supersededMeta,
    )).toBe(false);
    expect(shouldIncludeAssistantManagerTaskLogInCompensationScore(
      'pending',
      supersededMeta,
    )).toBe(true);
    expect(shouldIncludeAssistantManagerTaskLogInCompensationScore('waived', {
      socialMediaContentId: 41,
    })).toBe(true);
  });

  it('allocates the rounded salary total without losing remainder cents', () => {
    const dates = Array.from({ length: 15 }, (_, index) => `2026-08-${String(index + 1).padStart(2, '0')}`);
    const rows = allocateAssistantManagerSalaryAcrossDays(1_250, dates);

    expect(rows).toHaveLength(15);
    expect(rows.slice(0, 5).every((row) => row.baseAmount === 83.34)).toBe(true);
    expect(rows.slice(5).every((row) => row.baseAmount === 83.33)).toBe(true);
    expect(rows.reduce((sum, row) => sum + Math.round(row.baseAmount * 100), 0)).toBe(125_000);
  });

  it('keeps salary dates before the configured cutover outside task proration', () => {
    expect(partitionAssistantManagerSalaryDaysForTaskProration([
      { date: '2026-07-31', baseAmount: 83.33 },
      { date: '2026-08-01', baseAmount: 83.33 },
    ], '2026-08-01')).toEqual({
      unchangedDailyBase: [{ date: '2026-07-31', baseAmount: 83.33 }],
      proratedDailyBase: [{ date: '2026-08-01', baseAmount: 83.33 }],
    });
  });

  it('pays each day by point completion and treats waived work as satisfied', () => {
    const rows = calculateAssistantManagerSalaryTaskCompletion({
      dailyBase: [
        { date: '2026-08-01', baseAmount: 100 },
        { date: '2026-08-02', baseAmount: 100 },
        { date: '2026-08-03', baseAmount: 100 },
      ],
      progressByDate: new Map([
        ['2026-08-01', {
          totalTasks: 4,
          completedTasks: 1,
          waivedTasks: 1,
          pendingTasks: 2,
          missedTasks: 0,
          totalPoints: 4,
          completedPoints: 1,
          waivedPoints: 1,
          pendingPoints: 2,
          missedPoints: 0,
        }],
        ['2026-08-02', {
          totalTasks: 2,
          completedTasks: 0,
          waivedTasks: 0,
          pendingTasks: 0,
          missedTasks: 2,
          totalPoints: 2,
          completedPoints: 0,
          waivedPoints: 0,
          pendingPoints: 0,
          missedPoints: 2,
        }],
      ]),
    });

    expect(rows).toEqual([
      {
        date: '2026-08-01',
        baseAmount: 100,
        completedPercent: 50,
        missingPercent: 50,
        deductionAmount: 50,
        payableAmount: 50,
        totalTasks: 4,
        completedTasks: 1,
        waivedTasks: 1,
        incompleteTasks: 2,
      },
      {
        date: '2026-08-02',
        baseAmount: 100,
        completedPercent: 0,
        missingPercent: 100,
        deductionAmount: 100,
        payableAmount: 0,
        totalTasks: 2,
        completedTasks: 0,
        waivedTasks: 0,
        incompleteTasks: 2,
      },
      {
        date: '2026-08-03',
        baseAmount: 100,
        completedPercent: 100,
        missingPercent: 0,
        deductionAmount: 0,
        payableAmount: 100,
        totalTasks: 0,
        completedTasks: 0,
        waivedTasks: 0,
        incompleteTasks: 0,
      },
    ]);
  });

  it('rounds payable and deduction per day to currency cents', () => {
    const [row] = calculateAssistantManagerSalaryTaskCompletion({
      dailyBase: [{ date: '2026-08-01', baseAmount: 83.33 }],
      progressByDate: new Map([
        ['2026-08-01', {
          totalTasks: 3,
          completedTasks: 1,
          waivedTasks: 0,
          pendingTasks: 2,
          missedTasks: 0,
          totalPoints: 3,
          completedPoints: 1,
          waivedPoints: 0,
          pendingPoints: 2,
          missedPoints: 0,
        }],
      ]),
    });

    expect(row).toEqual({
      date: '2026-08-01',
      baseAmount: 83.33,
      completedPercent: 33.33,
      missingPercent: 66.67,
      deductionAmount: 55.55,
      payableAmount: 27.78,
      totalTasks: 3,
      completedTasks: 1,
      waivedTasks: 0,
      incompleteTasks: 2,
    });
  });

  it('preserves takeover task ownership in the auditable daily row', () => {
    const [row] = calculateAssistantManagerSalaryTaskCompletion({
      dailyBase: [{ date: '2026-08-08', baseAmount: 83.33 }],
      progressByDate: new Map([['2026-08-08', {
        totalTasks: 11,
        completedTasks: 11,
        waivedTasks: 0,
        pendingTasks: 0,
        missedTasks: 0,
        totalPoints: 22,
        completedPoints: 22,
        waivedPoints: 0,
        pendingPoints: 0,
        missedPoints: 0,
        taskOwnerUserId: 188,
        taskOwnerName: 'Natalie Looper',
        attributionMethod: 'shift_instance',
        shiftInstanceIds: [2376],
      }]]),
      salaryRecipientUserId: 1,
      salaryRecipientName: 'Pablo Camacho',
      takeoverSplit: {
        enabled: true,
        effectiveStart: '2026-08-01',
        shiftTakerPercent: 50,
      },
    });

    expect(row).toMatchObject({
      completedPercent: 100,
      missingPercent: 0,
      deductionAmount: 0,
      payableAmount: 83.33,
      totalTasks: 11,
      completedTasks: 11,
      taskOwnerUserId: 188,
      taskOwnerName: 'Natalie Looper',
      attributionMethod: 'shift_instance',
      shiftInstanceIds: [2376],
      takeoverSplitPolicy: {
        shiftTakerUserId: 1,
        shiftTakerName: 'Pablo Camacho',
        taskOwnerUserId: 188,
        taskOwnerName: 'Natalie Looper',
        shiftTakerPercent: 50,
        taskOwnerPercent: 50,
      },
    });
    expect(mergeAssistantManagerSalaryDailyBreakdowns([row])[0]).toMatchObject({
      taskOwnerUserId: 188,
      taskOwnerName: 'Natalie Looper',
      attributionMethod: 'shift_instance',
      shiftInstanceIds: [2376],
      takeoverSplitPolicy: expect.objectContaining({
        shiftTakerUserId: 1,
        taskOwnerUserId: 188,
      }),
    });
  });

  it('keeps an approved no-task takeover fully payable and eligible for the split', () => {
    const [row] = calculateAssistantManagerSalaryTaskCompletion({
      dailyBase: [{ date: '2026-08-09', baseAmount: 83.33 }],
      progressByDate: new Map([['2026-08-09', {
        totalTasks: 0,
        completedTasks: 0,
        waivedTasks: 0,
        pendingTasks: 0,
        missedTasks: 0,
        totalPoints: 0,
        completedPoints: 0,
        waivedPoints: 0,
        pendingPoints: 0,
        missedPoints: 0,
        taskOwnerUserId: 188,
        taskOwnerName: 'Natalie Looper',
        attributionMethod: 'shift_assignment',
        shiftInstanceIds: [2376],
      }]]),
      salaryRecipientUserId: 1,
      salaryRecipientName: 'Pablo Camacho',
      takeoverSplit: {
        enabled: true,
        effectiveStart: '2026-08-01',
        shiftTakerPercent: 50,
      },
    });

    expect(row).toMatchObject({
      completedPercent: 100,
      deductionAmount: 0,
      payableAmount: 83.33,
      takeoverSplitPolicy: {
        shiftTakerUserId: 1,
        taskOwnerUserId: 188,
        shiftTakerPercent: 50,
        taskOwnerPercent: 50,
      },
    });
  });

  it('merges assignment rows by date without presenting ambiguous task counts', () => {
    expect(mergeAssistantManagerSalaryDailyBreakdowns([
      {
        date: '2026-08-01', baseAmount: 80, completedPercent: 50,
        missingPercent: 50, deductionAmount: 40, payableAmount: 40,
        totalTasks: 2, completedTasks: 1, waivedTasks: 0, incompleteTasks: 1,
      },
      {
        date: '2026-08-01', baseAmount: 20, completedPercent: 100,
        missingPercent: 0, deductionAmount: 0, payableAmount: 20,
        totalTasks: 1, completedTasks: 0, waivedTasks: 1, incompleteTasks: 0,
      },
    ])).toEqual([{
      date: '2026-08-01',
      baseAmount: 100,
      completedPercent: 60,
      missingPercent: 40,
      deductionAmount: 40,
      payableAmount: 60,
    }]);
  });

  it('preserves task-derived percentages instead of deriving them from rounded money', () => {
    expect(mergeAssistantManagerSalaryDailyBreakdowns([{
      date: '2026-08-01',
      baseAmount: 83.33,
      completedPercent: 94.44,
      missingPercent: 5.56,
      deductionAmount: 4.63,
      payableAmount: 78.70,
      totalTasks: 36,
      completedTasks: 34,
      waivedTasks: 0,
      incompleteTasks: 2,
    }])[0]).toMatchObject({
      completedPercent: 94.44,
      missingPercent: 5.56,
      payableAmount: 78.70,
    });
  });

  it('omits task counts across overlapping salary assignments even when tuples match', () => {
    const sharedTaskCounts = {
      totalTasks: 4,
      completedTasks: 2,
      waivedTasks: 1,
      incompleteTasks: 1,
    };
    const sharedAttribution = {
      taskOwnerUserId: 188,
      taskOwnerName: 'Natalie Looper',
      attributionMethod: 'shift_instance' as const,
      shiftInstanceIds: [2376],
    };

    expect(mergeAssistantManagerSalaryDailyBreakdowns([
      {
        date: '2026-08-01', baseAmount: 80, completedPercent: 75,
        missingPercent: 25, deductionAmount: 20, payableAmount: 60,
        ...sharedTaskCounts,
        ...sharedAttribution,
      },
      {
        date: '2026-08-01', baseAmount: 20, completedPercent: 75,
        missingPercent: 25, deductionAmount: 5, payableAmount: 15,
        ...sharedTaskCounts,
        ...sharedAttribution,
      },
    ])[0]).toMatchObject({
      baseAmount: 100,
      payableAmount: 75,
      ...sharedAttribution,
    });
    expect(mergeAssistantManagerSalaryDailyBreakdowns([
      {
        date: '2026-08-01', baseAmount: 80, completedPercent: 75,
        missingPercent: 25, deductionAmount: 20, payableAmount: 60,
        ...sharedTaskCounts,
        ...sharedAttribution,
      },
      {
        date: '2026-08-01', baseAmount: 20, completedPercent: 75,
        missingPercent: 25, deductionAmount: 5, payableAmount: 15,
        ...sharedTaskCounts,
        ...sharedAttribution,
      },
    ])[0]).not.toHaveProperty('totalTasks');
  });

  it('omits conflicting task-owner attribution when salary assignments overlap', () => {
    const [merged] = mergeAssistantManagerSalaryDailyBreakdowns([
      {
        date: '2026-08-08', baseAmount: 50, completedPercent: 100,
        missingPercent: 0, deductionAmount: 0, payableAmount: 50,
        taskOwnerUserId: 188, taskOwnerName: 'Natalie Looper',
        attributionMethod: 'shift_instance', shiftInstanceIds: [2376],
      },
      {
        date: '2026-08-08', baseAmount: 50, completedPercent: 100,
        missingPercent: 0, deductionAmount: 0, payableAmount: 50,
        taskOwnerUserId: 1, taskOwnerName: 'Pablo Camacho',
        attributionMethod: 'salary_recipient',
      },
    ]);

    expect(merged).not.toHaveProperty('taskOwnerUserId');
    expect(merged).not.toHaveProperty('attributionMethod');
  });
});
