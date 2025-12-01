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
import User from './User.js';

@Table({
  tableName: 'review_counter_monthly_approvals',
  modelName: 'ReviewCounterMonthlyApproval',
  underscored: true,
  timestamps: true,
})
export default class ReviewCounterMonthlyApproval extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @ForeignKey(() => User)
  @AllowNull(false)
  @Column({ field: 'user_id', type: DataType.INTEGER })
  declare userId: number;

  @AllowNull(false)
  @Column({ field: 'period_start', type: DataType.DATEONLY })
  declare periodStart: string;

  @AllowNull(false)
  @Column({ field: 'payment_approved', type: DataType.BOOLEAN, defaultValue: false })
  declare paymentApproved: boolean;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column({ field: 'payment_approved_by', type: DataType.INTEGER })
  declare paymentApprovedBy: number | null;

  @AllowNull(true)
  @Column({ field: 'payment_approved_at', type: DataType.DATE })
  declare paymentApprovedAt: Date | null;

  @AllowNull(false)
  @Column({ field: 'incentive_approved', type: DataType.BOOLEAN, defaultValue: false })
  declare incentiveApproved: boolean;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column({ field: 'incentive_approved_by', type: DataType.INTEGER })
  declare incentiveApprovedBy: number | null;

  @AllowNull(true)
  @Column({ field: 'incentive_approved_at', type: DataType.DATE })
  declare incentiveApprovedAt: Date | null;

  @AllowNull(false)
  @Default(false)
  @Column({ field: 'base_override_approved', type: DataType.BOOLEAN })
  declare baseOverrideApproved: boolean;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column({ field: 'base_override_approved_by', type: DataType.INTEGER })
  declare baseOverrideApprovedBy: number | null;

  @AllowNull(true)
  @Column({ field: 'base_override_approved_at', type: DataType.DATE })
  declare baseOverrideApprovedAt: Date | null;

  declare subjectUser?: NonAttribute<User | null>;
  @BelongsTo(() => User, { foreignKey: 'user_id' })
  declare subjectUserRef?: NonAttribute<User | null>;

  declare paymentApprovedByUser?: NonAttribute<User | null>;
  @BelongsTo(() => User, { foreignKey: 'payment_approved_by' })
  declare paymentApprovedByUserRef?: NonAttribute<User | null>;

  declare incentiveApprovedByUser?: NonAttribute<User | null>;
  @BelongsTo(() => User, { foreignKey: 'incentive_approved_by' })
  declare incentiveApprovedByUserRef?: NonAttribute<User | null>;

  declare baseOverrideApprovedByUser?: NonAttribute<User | null>;
  @BelongsTo(() => User, { foreignKey: 'base_override_approved_by' })
  declare baseOverrideApprovedByUserRef?: NonAttribute<User | null>;
}
