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
  HasMany,
} from 'sequelize-typescript';
import type { NonAttribute } from 'sequelize';
import ShiftInstance from './ShiftInstance.js';
import User from './User.js';
import SwapRequest from './SwapRequest.js';
import ShiftRole from './ShiftRole.js';

@Table({
  tableName: 'shift_assignments',
  modelName: 'ShiftAssignment',
  timestamps: true,
})
export default class ShiftAssignment extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @ForeignKey(() => ShiftInstance)
  @AllowNull(false)
  @Column({ field: 'shift_instance_id', type: DataType.INTEGER })
  declare shiftInstanceId: number;

  @ForeignKey(() => User)
  @AllowNull(false)
  @Column({ field: 'user_id', type: DataType.INTEGER })
  declare userId: number;

  @ForeignKey(() => ShiftRole)
  @AllowNull(true)
  @Column({ field: 'shift_role_id', type: DataType.INTEGER })
  declare shiftRoleId: number | null;

  @AllowNull(false)
  @Column({ field: 'role_in_shift', type: DataType.STRING(80) })
  declare roleInShift: string;

  @BelongsTo(() => ShiftInstance)
  declare shiftInstance?: NonAttribute<ShiftInstance | null>;

  @BelongsTo(() => User, { foreignKey: 'user_id', as: 'assignee' })
  declare assignee?: NonAttribute<User | null>;

  @BelongsTo(() => ShiftRole, { foreignKey: 'shift_role_id', as: 'shiftRole' })
  declare shiftRole?: NonAttribute<ShiftRole | null>;

  @HasMany(() => SwapRequest, { foreignKey: 'from_assignment_id', as: 'outgoingSwapRequests' })
  declare outgoingSwapRequests?: SwapRequest[];

  @HasMany(() => SwapRequest, { foreignKey: 'to_assignment_id', as: 'incomingSwapRequests' })
  declare incomingSwapRequests?: SwapRequest[];
}
