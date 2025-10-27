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
  @Column({ field: 'target_entity', type: DataType.STRING(80) })
  declare targetEntity: string;

  @AllowNull(true)
  @Column({ field: 'target_id', type: DataType.INTEGER })
  declare targetId: number | null;

  @AllowNull(false)
  @Column({ field: 'payload', type: DataType.JSONB })
  declare payload: Record<string, unknown>;

  @ForeignKey(() => User)
  @AllowNull(false)
  @Column({ field: 'requested_by', type: DataType.INTEGER })
  declare requestedBy: number;

  @BelongsTo(() => User, 'requestedBy')
  declare requester?: User;

  @AllowNull(false)
  @Default('open')
  @Column({ field: 'status', type: DataType.ENUM('open', 'approved', 'returned', 'rejected') })
  declare status: FinanceManagementRequestStatus;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column({ field: 'manager_id', type: DataType.INTEGER })
  declare managerId: number | null;

  @BelongsTo(() => User, 'managerId')
  declare manager?: User | null;

  @AllowNull(true)
  @Column({ field: 'decision_note', type: DataType.TEXT })
  declare decisionNote: string | null;

  @AllowNull(false)
  @Default('normal')
  @Column({ field: 'priority', type: DataType.ENUM('low', 'normal', 'high') })
  declare priority: FinanceManagementRequestPriority;

  @AllowNull(true)
  @Column({ field: 'due_at', type: DataType.DATE })
  declare dueAt: Date | null;

  @AllowNull(false)
  @Default(DataType.NOW)
  @Column({ field: 'created_at', type: DataType.DATE })
  declare createdAt: Date;

  @AllowNull(true)
  @Column({ field: 'updated_at', type: DataType.DATE })
  declare updatedAt: Date | null;
}
