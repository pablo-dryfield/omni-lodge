export const STAFF_PAYOUT_SETTLEMENT_SNAPSHOT_LEGACY_VERSION = 1 as const;
export const STAFF_PAYOUT_SETTLEMENT_SNAPSHOT_SEGMENTED_VERSION = 2 as const;

export type StaffPayoutSettlementSnapshotSourceBase = {
  sourceKey: string;
  componentId: number | null;
  category: string;
  grossAmountMinor: number;
  destination: 'staff_vendor' | 'volunteer_fund' | 'excluded';
  fundId: number | null;
  ruleId: number;
  currency: string;
};

/**
 * Immutable earning-period identity added in settlement snapshot v2. The
 * `legacyExtrapolation` flag is intentionally persisted: a segment projected
 * backwards from the first known staff-type period must never become
 * indistinguishable from directly evidenced history.
 */
export type StaffPayoutSettlementSegmentFields = {
  segmentKey: string;
  earningStart: string;
  earningEnd: string;
  staffTypePeriodId: number;
  staffType: string;
  legacyExtrapolation: boolean;
};

export type StaffPayoutSettlementSnapshotSourceV1 =
  StaffPayoutSettlementSnapshotSourceBase;

export type StaffPayoutSettlementSnapshotSourceV2 =
  StaffPayoutSettlementSnapshotSourceBase & StaffPayoutSettlementSegmentFields;

/**
 * Compatibility view used by existing controller call sites while v2 is
 * integrated. Persisted snapshots themselves remain strictly versioned by the
 * V1/V2 types below.
 */
export type StaffPayoutSettlementSnapshotSource =
  StaffPayoutSettlementSnapshotSourceBase & Partial<StaffPayoutSettlementSegmentFields>;

export type StaffPayoutSettlementSnapshotV1 = {
  version: typeof STAFF_PAYOUT_SETTLEMENT_SNAPSHOT_LEGACY_VERSION;
  sources: StaffPayoutSettlementSnapshotSourceV1[];
};

export type StaffPayoutSettlementSnapshotV2 = {
  version: typeof STAFF_PAYOUT_SETTLEMENT_SNAPSHOT_SEGMENTED_VERSION;
  sources: StaffPayoutSettlementSnapshotSourceV2[];
};

export type StaffPayoutSettlementSnapshot =
  | StaffPayoutSettlementSnapshotV1
  | StaffPayoutSettlementSnapshotV2;
