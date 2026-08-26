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
import type { NonAttribute } from 'sequelize';
import ShiftAssignment from './ShiftAssignment.js';
import User from './User.js';

export type SwapRequestStatus = 'pending_partner' | 'pending_manager' | 'approved' | 'denied' | 'canceled';
export type ShiftRequestType = 'swap' | 'takeover' | 'drop';

export type ShiftAssignmentSnapshotBase = {
  id: number;
  shiftInstanceId: number;
  userId: number;
  shiftRoleId: number | null;
  roleInShift: string;
  assignee: {
    id: number;
    firstName: string | null;
    lastName: string | null;
  } | null;
  shiftInstance: {
    id: number;
    date: string;
    timeStart: string;
    timeEnd: string | null;
    shiftTypeId: number;
    shiftType: {
      id: number;
      name: string;
    } | null;
  } | null;
};

export type ShiftAssignmentSnapshot = ShiftAssignmentSnapshotBase & {
  /** Present for swaps so both original assignment owners remain available after approval. */
  toAssignment?: ShiftAssignmentSnapshotBase | null;
};

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
  @AllowNull(true)
  @Column({ field: 'from_assignment_id', type: DataType.INTEGER })
  declare fromAssignmentId: number | null;

  @ForeignKey(() => ShiftAssignment)
  @AllowNull(true)
  @Column({ field: 'to_assignment_id', type: DataType.INTEGER })
  declare toAssignmentId: number | null;

  @ForeignKey(() => User)
  @AllowNull(false)
  @Column({ field: 'requester_id', type: DataType.INTEGER })
  declare requesterId: number;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column({ field: 'partner_id', type: DataType.INTEGER })
  declare partnerId: number | null;

  @AllowNull(false)
  @Default('swap')
  @Column({ field: 'request_type', type: DataType.ENUM('swap', 'takeover', 'drop') })
  declare requestType: ShiftRequestType;

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

  @AllowNull(true)
  @Column({ field: 'request_note', type: DataType.TEXT })
  declare requestNote: string | null;

  @AllowNull(true)
  @Column({ field: 'partner_response_note', type: DataType.TEXT })
  declare partnerResponseNote: string | null;

  @AllowNull(true)
  @Column({ field: 'assignment_snapshot', type: DataType.JSONB })
  declare assignmentSnapshot: ShiftAssignmentSnapshot | null;

  @BelongsTo(() => ShiftAssignment, {
    foreignKey: 'fromAssignmentId',
    as: 'fromAssignment',
    onDelete: 'SET NULL',
    onUpdate: 'CASCADE',
  })
  declare fromAssignment?: NonAttribute<ShiftAssignment | null>;

  @BelongsTo(() => ShiftAssignment, {
    foreignKey: 'toAssignmentId',
    as: 'toAssignment',
    onDelete: 'SET NULL',
    onUpdate: 'CASCADE',
  })
  declare toAssignment?: NonAttribute<ShiftAssignment | null>;

  @BelongsTo(() => User, {
    foreignKey: 'requesterId',
    as: 'requester',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  })
  declare requester?: NonAttribute<User | null>;

  @BelongsTo(() => User, {
    foreignKey: 'partnerId',
    as: 'partner',
    onDelete: 'SET NULL',
    onUpdate: 'CASCADE',
  })
  declare partner?: NonAttribute<User | null>;

  @BelongsTo(() => User, {
    foreignKey: 'managerId',
    as: 'manager',
    onDelete: 'SET NULL',
    onUpdate: 'CASCADE',
  })
  declare manager?: NonAttribute<User | null>;
}
