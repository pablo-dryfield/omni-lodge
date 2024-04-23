import { Model, Table, Column, PrimaryKey, AutoIncrement, AllowNull, Default, DataType } from 'sequelize-typescript';

@Table({
  timestamps: true,
  modelName: 'CounterUsers',
  tableName: 'counterUsers'
})
export default class CounterUser extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @AllowNull(false)
  @Column(DataType.INTEGER)
  declare counterId: number;

  @AllowNull(false)
  @Column(DataType.INTEGER)
  declare userId: number;

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
