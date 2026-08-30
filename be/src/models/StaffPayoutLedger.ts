import {
  AllowNull,
  AutoIncrement,
  BelongsTo,
  Column,
  DataType,
  Default,
  ForeignKey,
  Model,
  PrimaryKey,
  Table,
} from "sequelize-typescript";
import type { NonAttribute } from "sequelize";
import User from "./User.js";
import type { StaffPayoutSettlementSnapshot } from "../types/StaffPayoutSettlementSnapshot.js";

// Keep the historical model import surface intact while the contract itself
// stays decorator-free and safe for services/tests to consume directly.
export {
  STAFF_PAYOUT_SETTLEMENT_SNAPSHOT_LEGACY_VERSION,
  STAFF_PAYOUT_SETTLEMENT_SNAPSHOT_SEGMENTED_VERSION,
} from "../types/StaffPayoutSettlementSnapshot.js";
export type {
  StaffPayoutSettlementSegmentFields,
  StaffPayoutSettlementSnapshot,
  StaffPayoutSettlementSnapshotSource,
  StaffPayoutSettlementSnapshotSourceBase,
  StaffPayoutSettlementSnapshotSourceV1,
  StaffPayoutSettlementSnapshotSourceV2,
  StaffPayoutSettlementSnapshotV1,
  StaffPayoutSettlementSnapshotV2,
} from "../types/StaffPayoutSettlementSnapshot.js";

@Table({
  tableName: "staff_payout_ledgers",
  modelName: "StaffPayoutLedger",
  timestamps: true,
})
export default class StaffPayoutLedger extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @ForeignKey(() => User)
  @AllowNull(false)
  @Column({ field: "staff_user_id", type: DataType.INTEGER })
  declare staffUserId: number;

  @BelongsTo(() => User, { foreignKey: "staff_user_id", as: "staffUser" })
  declare staffUser?: NonAttribute<User>;

  @AllowNull(false)
  @Column({ field: "range_start", type: DataType.DATEONLY })
  declare rangeStart: string;

  @AllowNull(false)
  @Column({ field: "range_end", type: DataType.DATEONLY })
  declare rangeEnd: string;

  @AllowNull(false)
  @Default("PLN")
  @Column({ field: "currency_code", type: DataType.STRING(3) })
  declare currencyCode: string;

  @AllowNull(false)
  @Default(0)
  @Column({ field: "opening_balance_minor", type: DataType.INTEGER })
  declare openingBalanceMinor: number;

  @AllowNull(false)
  @Default(0)
  @Column({ field: "due_amount_minor", type: DataType.INTEGER })
  declare dueAmountMinor: number;

  @AllowNull(false)
  @Default(0)
  @Column({ field: "paid_amount_minor", type: DataType.INTEGER })
  declare paidAmountMinor: number;

  @AllowNull(false)
  @Default(0)
  @Column({ field: "closing_balance_minor", type: DataType.INTEGER })
  declare closingBalanceMinor: number;

  @AllowNull(true)
  @Column({ field: "settlement_snapshot", type: DataType.JSONB })
  declare settlementSnapshot: StaffPayoutSettlementSnapshot | null;

  @AllowNull(false)
  @Default(DataType.NOW)
  @Column({ field: "created_at", type: DataType.DATE })
  declare createdAt: Date;

  @AllowNull(true)
  @Column({ field: "updated_at", type: DataType.DATE })
  declare updatedAt: Date | null;
}
