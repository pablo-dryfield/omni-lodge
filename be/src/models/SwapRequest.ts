import {
  Model,
  Table,
  Column,
  PrimaryKey,
  AutoIncrement,
  AllowNull,
  DataType,
  ForeignKey,
  BelongsTo,
  Default,
} from 'sequelize-typescript';
import ShiftAssignment from './ShiftAssignment.js';
import User from './User.js';

export type SwapRequestStatus = 'pending_partner' | 'pending_manager' | 'approved' | 'denied' | 'canceled';

@Table({
  tableName: 'swap_requests',
  modelName: 'SwapRequest',
  timestamps: true,
})
export default class SwapRequest extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @ForeignKey(() => ShiftAssignment)
  @AllowNull(false)
  @Column({ field: 'from_assignment_id', type: DataType.INTEGER })
  declare fromAssignmentId: number;

  @ForeignKey(() => ShiftAssignment)
  @AllowNull(false)
  @Column({ field: 'to_assignment_id', type: DataType.INTEGER })
  declare toAssignmentId: number;

  @ForeignKey(() => User)
  @AllowNull(false)
  @Column({ field: 'requester_id', type: DataType.INTEGER })
  declare requesterId: number;

  @ForeignKey(() => User)
  @AllowNull(false)
  @Column({ field: 'partner_id', type: DataType.INTEGER })
  declare partnerId: number;

  @AllowNull(false)
  @Default('pending_partner')
  @Column({ type: DataType.ENUM('pending_partner', 'pending_manager', 'approved', 'denied', 'canceled') })
  declare status: SwapRequestStatus;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column({ field: 'manager_id', type: DataType.INTEGER })
  declare managerId: number | null;

  @AllowNull(true)
  @Column({ field: 'decision_reason', type: DataType.TEXT })
  declare decisionReason: string | null;

  @BelongsTo(() => ShiftAssignment, { foreignKey: 'from_assignment_id', as: 'fromAssignment' })
  declare fromAssignment?: ShiftAssignment | null;

  @BelongsTo(() => ShiftAssignment, { foreignKey: 'to_assignment_id', as: 'toAssignment' })
  declare toAssignment?: ShiftAssignment | null;

  @BelongsTo(() => User, { foreignKey: 'requester_id', as: 'requester' })
  declare requester?: User | null;

  @BelongsTo(() => User, { foreignKey: 'partner_id', as: 'partner' })
  declare partner?: User | null;

  @BelongsTo(() => User, { foreignKey: 'manager_id', as: 'manager' })
  declare manager?: User | null;
}
