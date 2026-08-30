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

export type StaffPayoutSettlementSnapshotSource = {
  sourceKey: string;
  componentId: number | null;
  category: string;
  grossAmountMinor: number;
  destination: "staff_vendor" | "volunteer_fund" | "excluded";
  fundId: number | null;
  ruleId: number;
  currency: string;
};

export type StaffPayoutSettlementSnapshot = {
  version: 1;
  sources: StaffPayoutSettlementSnapshotSource[];
};

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
