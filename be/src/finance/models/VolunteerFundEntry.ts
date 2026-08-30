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
} from 'sequelize-typescript';
import type { NonAttribute } from 'sequelize';
import User from '../../models/User.js';
import CompensationComponent from '../../models/CompensationComponent.js';
import FinanceTransaction from './FinanceTransaction.js';
import VolunteerFund from './VolunteerFund.js';

export type VolunteerFundEntryType = 'allocation' | 'spend' | 'adjustment' | 'reversal';

@Table({
  tableName: 'volunteer_fund_entries',
  modelName: 'VolunteerFundEntry',
  timestamps: false,
  underscored: true,
})
export default class VolunteerFundEntry extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.BIGINT)
  declare id: number;

  @ForeignKey(() => VolunteerFund)
  @AllowNull(false)
  @Column({ field: 'fund_id', type: DataType.INTEGER })
  declare fundId: number;

  @BelongsTo(() => VolunteerFund, { foreignKey: 'fund_id', as: 'fund' })
  declare fund?: NonAttribute<VolunteerFund>;

  @AllowNull(false)
  @Column({ field: 'entry_type', type: DataType.STRING(24) })
  declare entryType: VolunteerFundEntryType;

  @AllowNull(false)
  @Column({ field: 'amount_minor', type: DataType.BIGINT })
  declare amountMinor: number;

  @AllowNull(false)
  @Column(DataType.STRING(3))
  declare currency: string;

  @AllowNull(false)
  @Column({ field: 'entry_date', type: DataType.DATEONLY })
  declare entryDate: string;

  @AllowNull(true)
  @Column({ field: 'period_start', type: DataType.DATEONLY })
  declare periodStart: string | null;

  @AllowNull(true)
  @Column({ field: 'period_end', type: DataType.DATEONLY })
  declare periodEnd: string | null;

  @AllowNull(false)
  @Column(DataType.TEXT)
  declare description: string;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column({ field: 'attributed_staff_user_id', type: DataType.INTEGER })
  declare attributedStaffUserId: number | null;

  @BelongsTo(() => User, { foreignKey: 'attributed_staff_user_id', as: 'attributedStaffUser' })
  declare attributedStaffUser?: NonAttribute<User | null>;

  @ForeignKey(() => CompensationComponent)
  @AllowNull(true)
  @Column({ field: 'compensation_component_id', type: DataType.INTEGER })
  declare compensationComponentId: number | null;

  @BelongsTo(() => CompensationComponent, {
    foreignKey: 'compensation_component_id',
    as: 'compensationComponent',
  })
  declare compensationComponent?: NonAttribute<CompensationComponent | null>;

  @AllowNull(true)
  @Column({ field: 'source_kind', type: DataType.STRING(64) })
  declare sourceKind: string | null;

  @AllowNull(true)
  @Column({ field: 'source_reference', type: DataType.STRING(255) })
  declare sourceReference: string | null;

  @AllowNull(false)
  @Default({})
  @Column({ field: 'attribution_snapshot', type: DataType.JSONB })
  declare attributionSnapshot: Record<string, unknown>;

  @AllowNull(false)
  @Default({})
  @Column({ field: 'source_snapshot', type: DataType.JSONB })
  declare sourceSnapshot: Record<string, unknown>;

  @ForeignKey(() => FinanceTransaction)
  @AllowNull(true)
  @Column({ field: 'finance_transaction_id', type: DataType.INTEGER })
  declare financeTransactionId: number | null;

  @BelongsTo(() => FinanceTransaction, {
    foreignKey: 'finance_transaction_id',
    as: 'financeTransaction',
  })
  declare financeTransaction?: NonAttribute<FinanceTransaction | null>;

  @AllowNull(true)
  @Column({ field: 'idempotency_key', type: DataType.STRING(180) })
  declare idempotencyKey: string | null;

  @ForeignKey(() => VolunteerFundEntry)
  @AllowNull(true)
  @Column({ field: 'reversal_of_entry_id', type: DataType.BIGINT })
  declare reversalOfEntryId: number | null;

  @BelongsTo(() => VolunteerFundEntry, { foreignKey: 'reversal_of_entry_id', as: 'reversalOfEntry' })
  declare reversalOfEntry?: NonAttribute<VolunteerFundEntry | null>;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column({ field: 'created_by', type: DataType.INTEGER })
  declare createdBy: number | null;

  @BelongsTo(() => User, { foreignKey: 'created_by', as: 'createdByUser' })
  declare createdByUser?: NonAttribute<User | null>;

  @AllowNull(false)
  @Default(DataType.NOW)
  @Column({ field: 'created_at', type: DataType.DATE })
  declare createdAt: Date;
}
