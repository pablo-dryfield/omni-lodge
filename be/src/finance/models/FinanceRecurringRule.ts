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
  @Column({ field: 'template_json', type: DataType.JSONB })
  declare templateJson: Record<string, unknown>;

  @AllowNull(false)
  @Column({ field: 'frequency', type: DataType.ENUM('daily', 'weekly', 'monthly', 'quarterly', 'yearly') })
  declare frequency: FinanceRecurringFrequency;

  @AllowNull(false)
  @Default(1)
  @Column({ field: 'interval', type: DataType.INTEGER })
  declare interval: number;

  @AllowNull(true)
  @Column({ field: 'by_month_day', type: DataType.INTEGER })
  declare byMonthDay: number | null;

  @AllowNull(false)
  @Column({ field: 'start_date', type: DataType.DATEONLY })
  declare startDate: string;

  @AllowNull(true)
  @Column({ field: 'end_date', type: DataType.DATEONLY })
  declare endDate: string | null;

  @AllowNull(false)
  @Column({ field: 'timezone', type: DataType.STRING(64) })
  declare timezone: string;

  @AllowNull(true)
  @Column({ field: 'next_run_date', type: DataType.DATE })
  declare nextRunDate: Date | null;

  @AllowNull(true)
  @Column({ field: 'last_run_at', type: DataType.DATE })
  declare lastRunAt: Date | null;

  @AllowNull(false)
  @Default('active')
  @Column({ field: 'status', type: DataType.ENUM('active', 'paused') })
  declare status: FinanceRecurringStatus;

  @ForeignKey(() => User)
  @AllowNull(false)
  @Column({ field: 'created_by', type: DataType.INTEGER })
  declare createdBy: number;

  @BelongsTo(() => User, 'createdBy')
  declare creator?: User;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column({ field: 'updated_by', type: DataType.INTEGER })
  declare updatedBy: number | null;

  @BelongsTo(() => User, 'updatedBy')
  declare updater?: User | null;

  @AllowNull(false)
  @Default(DataType.NOW)
  @Column({ field: 'created_at', type: DataType.DATE })
  declare createdAt: Date;

  @AllowNull(true)
  @Column({ field: 'updated_at', type: DataType.DATE })
  declare updatedAt: Date | null;
}
