import { Model, Table, Column, PrimaryKey, AutoIncrement, AllowNull, Default, DataType, Unique, ForeignKey } from 'sequelize-typescript';
import Page from './Page.js';
import User from './User.js';

@Table({
  timestamps: true,
  modelName: 'Module',
  tableName: 'modules'
})
export default class Module extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @ForeignKey(() => Page)
  @AllowNull(false)
  @Column(DataType.INTEGER)
  declare pageId: number;

  @Unique
  @AllowNull(false)
  @Column(DataType.STRING)
  declare slug: string;

  @AllowNull(false)
  @Column(DataType.STRING)
  declare name: string;

  @AllowNull(true)
  @Column(DataType.STRING)
  declare description: string | null;

  @AllowNull(true)
  @Column(DataType.STRING)
  declare componentRef: string | null;

  @AllowNull(false)
  @Default(0)
  @Column(DataType.INTEGER)
  declare sortOrder: number;

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

