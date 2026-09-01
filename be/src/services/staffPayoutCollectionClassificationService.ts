type StaffPayoutCollectionClassificationInput = {
  meta?: Record<string, unknown> | null;
  description?: string | null;
  note?: string | null;
};

/**
 * Reimbursements travel in the same payout receipt as compensation, but they
 * settle a Finance expense rather than the staff compensation liability.
 * New records carry an explicit immutable marker; the text fallback keeps
 * already-created reimbursement rows from corrupting historical ledgers.
 */
export const isStaffPayoutReimbursementCollection = (
  input: StaffPayoutCollectionClassificationInput,
): boolean => {
  if (
    input.meta?.settlementKind === 'reimbursement'
    || input.meta?.excludeFromStaffPayoutLedger === true
  ) {
    return true;
  }
  const metaLineLabel = typeof input.meta?.lineLabel === 'string'
    ? input.meta.lineLabel.trim()
    : '';
  const description = typeof input.description === 'string' ? input.description.trim() : '';
  const note = typeof input.note === 'string' ? input.note.trim() : '';
  return [metaLineLabel, description, note]
    .some((value) => value.toLowerCase().includes('reimbursement'));
};
