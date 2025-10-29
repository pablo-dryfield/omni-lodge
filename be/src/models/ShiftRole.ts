import {
  Table,
  Model,
  Column,
  PrimaryKey,
  AutoIncrement,
  AllowNull,
  DataType,
  Unique,
  BelongsToMany,
} from 'sequelize-typescript';
import type { NonAttribute } from 'sequelize';
import User from './User.js';
import UserShiftRole from './UserShiftRole.js';

@Table({
  tableName: 'shift_roles',
  modelName: 'ShiftRole',
  timestamps: true,
})
export default class ShiftRole extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @AllowNull(false)
  @Unique
  @Column(DataType.STRING(120))
  declare name: string;

  @AllowNull(false)
  @Unique
  @Column(DataType.STRING(160))
  declare slug: string;

  @BelongsToMany(() => User, () => UserShiftRole)
  declare users?: NonAttribute<Array<User & { UserShiftRole: UserShiftRole }>>;
}

