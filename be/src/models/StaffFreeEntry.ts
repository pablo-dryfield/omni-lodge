import { AllowNull, AutoIncrement, Column, DataType, ForeignKey, Model, PrimaryKey, Table } from 'sequelize-typescript';
import Counter from './Counter.js';
import User from './User.js';
import type { StaffFreeBenefit, StaffFreePolicy } from '../services/staffFreeEntryPolicy.js';

/** Permanent visit ledger. Corrections cancel entries rather than erasing their history. */
@Table({ tableName: 'staff_free_entries', modelName: 'StaffFreeEntry', timestamps: true, underscored: true })
export default class StaffFreeEntry extends Model {
  @PrimaryKey @AutoIncrement @Column(DataType.INTEGER) declare id: number;
  @ForeignKey(() => Counter) @AllowNull(false) @Column({ field: 'counter_id', type: DataType.INTEGER }) declare counterId: number;
  @ForeignKey(() => User) @AllowNull(false) @Column({ field: 'user_id', type: DataType.INTEGER }) declare userId: number;
  @AllowNull(false) @Column({ field: 'visit_date', type: DataType.DATEONLY }) declare visitDate: string;
  @AllowNull(false) @Column({ field: 'staff_type', type: DataType.STRING(64) }) declare staffType: string;
  @AllowNull(false) @Column(DataType.STRING(32)) declare benefit: StaffFreeBenefit;
  @AllowNull(false) @Column({ field: 'checked_in_before', type: DataType.INTEGER }) declare checkedInBefore: number;
  @AllowNull(false) @Column({ field: 'policy_snapshot', type: DataType.JSONB }) declare policySnapshot: StaffFreePolicy;
  @AllowNull(true) @Column({ field: 'override_reason', type: DataType.TEXT }) declare overrideReason: string | null;
  @ForeignKey(() => User) @AllowNull(false) @Column({ field: 'created_by', type: DataType.INTEGER }) declare createdBy: number;
  @AllowNull(true) @Column({ field: 'cancelled_at', type: DataType.DATE }) declare cancelledAt: Date | null;
  @ForeignKey(() => User) @AllowNull(true) @Column({ field: 'cancelled_by', type: DataType.INTEGER }) declare cancelledBy: number | null;
  @AllowNull(true) @Column({ field: 'cancellation_reason', type: DataType.TEXT }) declare cancellationReason: string | null;
  @AllowNull(true) @Column({ field: 'paid_amount', type: DataType.DECIMAL(12, 2) }) declare paidAmount: number | null;
  @AllowNull(true) @Column(DataType.JSONB) declare payment: { currency: 'PLN'; methodId: number; methodName: string; status: 'received' | 'awaiting' } | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}
