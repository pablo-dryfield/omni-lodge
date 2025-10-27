import {
  Table,
  Model,
  Column,
  DataType,
  PrimaryKey,
  AutoIncrement,
  AllowNull,
  Default,
  ForeignKey,
  BelongsTo,
} from 'sequelize-typescript';
import User from '../../models/User.js';

export type FinanceRecurringFrequency = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';
export type FinanceRecurringStatus = 'active' | 'paused';

@Table({
  tableName: 'finance_recurring_rules',
  timestamps: true,
  underscored: true,
})
export default class FinanceRecurringRule extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @AllowNull(false)
  @Column(DataType.ENUM('income', 'expense'))
  declare kind: 'income' | 'expense';

  @AllowNull(false)
  @Column(DataType.JSONB)
  declare templateJson: Record<string, unknown>;

  @AllowNull(false)
  @Column(DataType.ENUM('daily', 'weekly', 'monthly', 'quarterly', 'yearly'))
  declare frequency: FinanceRecurringFrequency;

  @AllowNull(false)
  @Default(1)
  @Column(DataType.INTEGER)
  declare interval: number;

  @AllowNull(true)
  @Column(DataType.INTEGER)
  declare byMonthDay: number | null;

  @AllowNull(false)
  @Column(DataType.DATEONLY)
  declare startDate: string;

  @AllowNull(true)
  @Column(DataType.DATEONLY)
  declare endDate: string | null;

  @AllowNull(false)
  @Column(DataType.STRING(64))
  declare timezone: string;

  @AllowNull(true)
  @Column(DataType.DATE)
  declare nextRunDate: Date | null;

  @AllowNull(true)
  @Column(DataType.DATE)
  declare lastRunAt: Date | null;

  @AllowNull(false)
  @Default('active')
  @Column(DataType.ENUM('active', 'paused'))
  declare status: FinanceRecurringStatus;

  @ForeignKey(() => User)
  @AllowNull(false)
  @Column(DataType.INTEGER)
  declare createdBy: number;

  @BelongsTo(() => User, 'createdBy')
  declare creator?: User;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column(DataType.INTEGER)
  declare updatedBy: number | null;

  @BelongsTo(() => User, 'updatedBy')
  declare updater?: User | null;
}

