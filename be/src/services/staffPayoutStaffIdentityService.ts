export type StaffPayoutStaffIdentity = {
  firstName: string;
  lastName: string;
  fullName: string;
};

const normalizeNamePart = (value: unknown): string => (
  typeof value === 'string' ? value.trim() : ''
);

/**
 * Builds the stable display-name fields exposed by Pays without changing the
 * staff user id used by payout and ledger accounting.
 */
export const buildStaffPayoutStaffIdentity = (params: {
  userId: number;
  firstName: unknown;
  lastName: unknown;
}): StaffPayoutStaffIdentity => {
  const firstName = normalizeNamePart(params.firstName);
  const lastName = normalizeNamePart(params.lastName);
  const fullName = [firstName, lastName].filter(Boolean).join(' ');

  if (fullName) {
    return { firstName, lastName, fullName };
  }

  const fallback = `User ${params.userId}`;
  return {
    firstName: fallback,
    lastName: '',
    fullName: fallback,
  };
};
