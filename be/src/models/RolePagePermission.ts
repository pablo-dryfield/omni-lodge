import { Model, Table, Column, PrimaryKey, AutoIncrement, AllowNull, Default, DataType, ForeignKey, Unique } from 'sequelize-typescript';
import UserType from './UserType.js';
import Page from './Page.js';
import User from './User.js';

@Table({
  timestamps: true,
  modelName: 'RolePagePermission',
  tableName: 'rolePagePermissions'
})
export default class RolePagePermission extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @Unique('role_page_unique')
  @ForeignKey(() => UserType)
  @AllowNull(false)
  @Column(DataType.INTEGER)
  declare userTypeId: number;

  @Unique('role_page_unique')
  @ForeignKey(() => Page)
  @AllowNull(false)
  @Column(DataType.INTEGER)
  declare pageId: number;

  @AllowNull(false)
  @Default(true)
  @Column(DataType.BOOLEAN)
  declare canView: boolean;

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

