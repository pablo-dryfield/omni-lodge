import { Model, Table, Column, PrimaryKey, AutoIncrement, AllowNull, Default, DataType, Unique } from 'sequelize-typescript';

@Table({
  timestamps: true,
  modelName: 'Action',
  tableName: 'actions'
})
export default class Action extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @Unique
  @AllowNull(false)
  @Column(DataType.STRING)
  declare key: string;

  @AllowNull(false)
  @Column(DataType.STRING)
  declare name: string;

  @AllowNull(true)
  @Column(DataType.STRING)
  declare description: string | null;

  @AllowNull(false)
  @Default(true)
  @Column(DataType.BOOLEAN)
  declare isAssignable: boolean;

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

  @AllowNull(true)
  @Column(DataType.INTEGER)
  declare createdBy: number | null;

  @AllowNull(true)
  @Column(DataType.INTEGER)
  declare updatedBy: number | null;
}

