import { Model, Table, Column, PrimaryKey, AutoIncrement, AllowNull, Default, DataType, ForeignKey, Unique } from 'sequelize-typescript';
import Module from './Module.js';
import Action from './Action.js';
import User from './User.js';

@Table({
  timestamps: true,
  modelName: 'ModuleAction',
  tableName: 'moduleActions'
})
export default class ModuleAction extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @Unique('module_action_unique')
  @ForeignKey(() => Module)
  @AllowNull(false)
  @Column(DataType.INTEGER)
  declare moduleId: number;

  @Unique('module_action_unique')
  @ForeignKey(() => Action)
  @AllowNull(false)
  @Column(DataType.INTEGER)
  declare actionId: number;

  @AllowNull(false)
  @Default(true)
  @Column(DataType.BOOLEAN)
  declare enabled: boolean;

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

