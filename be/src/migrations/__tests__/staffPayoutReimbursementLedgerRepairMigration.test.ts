const buildContext = () => {
  const transaction = {
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
  };
  const query = jest.fn().mockResolvedValue([[], {}]);
  const context = {
    sequelize: {
      transaction: jest.fn().mockResolvedValue(transaction),
      query,
    },
  };
  return { context: context as never, query, transaction };
};

describe('staff payout reimbursement ledger repair migration', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('backs up and repairs every matching carry chain without hardcoded users', async () => {
    const { context, query, transaction } = buildContext();
    const migration = await import('../202609070008-staff-payout-reimbursement-ledger-repair');

    await migration.up({ context });

    expect(transaction.commit).toHaveBeenCalledTimes(1);
    expect(transaction.rollback).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalled();
    query.mock.calls.forEach(([, options]) => expect(options.transaction).toBe(transaction));

    const sql = query.mock.calls.map(([statement]) => String(statement)).join('\n');
    expect(sql).toContain('staff_payout_reimbursement_ledger_repair_202609070008');
    expect(sql).toContain("meta->>'settlementKind' = 'reimbursement'");
    expect(sql).toContain("meta->'excludeFromStaffPayoutLedger' = 'true'::jsonb");
    expect(sql).toContain("JSONB_TYPEOF(ledger.settlement_snapshot) IS DISTINCT FROM 'object'");
    expect(sql).toContain("JSONB_TYPEOF(ledger.settlement_snapshot->'sources') IS DISTINCT FROM 'array'");
    expect(sql).toContain('WHEN ledger.settlement_snapshot IS NOT NULL');
    expect(sql).toContain('A populated snapshot is the immutable due authority');
    expect(sql).toContain('affiliate_payout_logs');
    expect(sql).toContain('JSONB_ARRAY_ELEMENTS');
    expect(sql).toContain('ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW');
    expect(sql).not.toMatch(/\b(?:35|69|184|188)\b/);
    expect(sql).not.toMatch(/Natalie|Evelina|Nermin|Maia/);
  });

  it('rolls back the whole repair when any validation or write fails', async () => {
    const { context, query, transaction } = buildContext();
    query.mockRejectedValueOnce(new Error('repair failed'));
    const migration = await import('../202609070008-staff-payout-reimbursement-ledger-repair');

    await expect(migration.up({ context })).rejects.toThrow('repair failed');

    expect(transaction.rollback).toHaveBeenCalledTimes(1);
    expect(transaction.commit).not.toHaveBeenCalled();
  });

  it('restores only an unchanged repaired chain during rollback', async () => {
    const { context, query, transaction } = buildContext();
    query.mockResolvedValueOnce([
      [{ backup_table: 'staff_payout_reimbursement_ledger_repair_202609070008' }],
      {},
    ]);
    const migration = await import('../202609070008-staff-payout-reimbursement-ledger-repair');

    await migration.down({ context });

    expect(transaction.commit).toHaveBeenCalledTimes(1);
    expect(transaction.rollback).not.toHaveBeenCalled();
    const sql = query.mock.calls.map(([statement]) => String(statement)).join('\n');
    expect(sql).toContain('Cannot undo staff payout reimbursement ledger repair after later ledger changes.');
    expect(sql).toContain('original_due_amount_minor');
    expect(sql).toContain('DROP TABLE staff_payout_reimbursement_ledger_repair_202609070008');
  });

  it('reports verification failures instead of accepting a broken carry chain', async () => {
    const { context, query } = buildContext();
    query.mockResolvedValueOnce([
      [{
        backup_count: '8',
        direct_repair_count: '5',
        unfinished_count: '0',
        direct_due_mismatch_count: '0',
        equation_mismatch_count: '0',
        continuity_mismatch_count: '1',
        reimbursement_snapshot_count: '0',
        canonical_paid_mismatch_count: '0',
        unrepaired_collection_count: '0',
      }],
      {},
    ]);
    const migration = await import('../202609070008-staff-payout-reimbursement-ledger-repair');

    await expect(migration.verify({ context })).resolves.toEqual({
      ok: false,
      details: expect.objectContaining({
        backupCount: 8,
        directRepairCount: 5,
        continuityMismatchCount: 1,
      }),
    });
  });
});
