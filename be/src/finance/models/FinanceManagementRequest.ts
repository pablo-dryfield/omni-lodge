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

export type FinanceManagementRequestStatus = 'open' | 'approved' | 'returned' | 'rejected';
export type FinanceManagementRequestPriority = 'low' | 'normal' | 'high';

@Table({
  tableName: 'finance_management_requests',
  timestamps: true,
  underscored: true,
})
export default class FinanceManagementRequest extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @AllowNull(false)
  @Column(DataType.STRING(80))
  declare type: string;

  @AllowNull(false)
  @Column(DataType.STRING(80))
  declare targetEntity: string;

  @AllowNull(true)
  @Column(DataType.INTEGER)
  declare targetId: number | null;

  @AllowNull(false)
  @Column(DataType.JSONB)
  declare payload: Record<string, unknown>;

  @ForeignKey(() => User)
  @AllowNull(false)
  @Column(DataType.INTEGER)
  declare requestedBy: number;

  @BelongsTo(() => User, 'requestedBy')
  declare requester?: User;

  @AllowNull(false)
  @Default('open')
  @Column(DataType.ENUM('open', 'approved', 'returned', 'rejected'))
  declare status: FinanceManagementRequestStatus;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column(DataType.INTEGER)
  declare managerId: number | null;

  @BelongsTo(() => User, 'managerId')
  declare manager?: User | null;

  @AllowNull(true)
  @Column(DataType.TEXT)
  declare decisionNote: string | null;

  @AllowNull(false)
  @Default('normal')
  @Column(DataType.ENUM('low', 'normal', 'high'))
  declare priority: FinanceManagementRequestPriority;

  @AllowNull(true)
  @Column(DataType.DATE)
  declare dueAt: Date | null;
}

