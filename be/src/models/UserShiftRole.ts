import {
  Table,
  Model,
  Column,
  ForeignKey,
  AllowNull,
  DataType,
  BelongsTo,
  PrimaryKey,
} from 'sequelize-typescript';
import type { NonAttribute } from 'sequelize';
import User from './User.js';
import ShiftRole from './ShiftRole.js';

@Table({
  tableName: 'user_shift_roles',
  modelName: 'UserShiftRole',
  timestamps: true,
})
export default class UserShiftRole extends Model {
  @PrimaryKey
  @ForeignKey(() => User)
  @AllowNull(false)
  @Column({ field: 'user_id', type: DataType.INTEGER })
  declare userId: number;

  @PrimaryKey
  @ForeignKey(() => ShiftRole)
  @AllowNull(false)
  @Column({ field: 'shift_role_id', type: DataType.INTEGER })
  declare shiftRoleId: number;

  @BelongsTo(() => User)
  declare user?: NonAttribute<User | null>;

  @BelongsTo(() => ShiftRole)
  declare shiftRole?: NonAttribute<ShiftRole | null>;
}

