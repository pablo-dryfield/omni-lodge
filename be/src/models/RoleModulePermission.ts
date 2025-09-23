import { Model, Table, Column, PrimaryKey, AutoIncrement, AllowNull, Default, DataType, ForeignKey, Unique } from 'sequelize-typescript';
import UserType from './UserType.js';
import Module from './Module.js';
import Action from './Action.js';
import User from './User.js';

@Table({
  timestamps: true,
  modelName: 'RoleModulePermission',
  tableName: 'roleModulePermissions'
})
export default class RoleModulePermission extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @Unique('role_module_unique')
  @ForeignKey(() => UserType)
  @AllowNull(false)
  @Column(DataType.INTEGER)
  declare userTypeId: number;

  @Unique('role_module_unique')
  @ForeignKey(() => Module)
  @AllowNull(false)
  @Column(DataType.INTEGER)
  declare moduleId: number;

  @Unique('role_module_unique')
  @ForeignKey(() => Action)
  @AllowNull(false)
  @Column(DataType.INTEGER)
  declare actionId: number;

  @AllowNull(false)
  @Default(false)
  @Column(DataType.BOOLEAN)
  declare allowed: boolean;

  @AllowNull(false)
  @Default(true)
  @Column(DataType.BOOLEAN)
  declare status: boolean;

  @AllowNull(false)
  @Default(DataType.NOW)
  @Column(DataType.DATE)
  declare createdAt: Date;

  @AllowNull(true)
  @Default(DataType.NOW)
  @Column(DataType.DATE)
  declare updatedAt: Date;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column(DataType.INTEGER)
  declare createdBy: number | null;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column(DataType.INTEGER)
  declare updatedBy: number | null;
}

