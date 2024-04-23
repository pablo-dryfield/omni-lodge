import { Model, Table, Column, PrimaryKey, AutoIncrement, AllowNull, Default, DataType } from 'sequelize-typescript';

@Table({
  timestamps: true,
  modelName: 'Counters',
  tableName: 'counters'
})
export default class Counter extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @AllowNull(false)
  @Column(DataType.INTEGER)
  declare userId: number;

  @AllowNull(false)
  @Column(DataType.DECIMAL(10, 2))
  declare total: number;

  @AllowNull(false)
  @Column(DataType.DATE)
  declare date: Date;

  @AllowNull(false)
  @Default(DataType.NOW)
  @Column(DataType.DATE)
  declare createdAt: Date;

  @AllowNull(true)
  @Default(DataType.NOW)
  @Column(DataType.DATE)
  declare updatedAt: Date;

  @AllowNull(false)
  @Column(DataType.INTEGER)
  declare createdBy: number;

  @AllowNull(true)
  @Column(DataType.INTEGER)
  declare updatedBy: number;
}
