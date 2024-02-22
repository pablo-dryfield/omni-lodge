import { Model, Table, Column, PrimaryKey, AutoIncrement, AllowNull, Default, DataType } from 'sequelize-typescript';

@Table({
  timestamps: true,
  modelName: 'Guests',
  tableName: 'guests'
})
export default class Guest extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @AllowNull(false)
  @Column(DataType.STRING)
  declare name: string;

  @AllowNull(false)
  @Column(DataType.STRING)
  declare email: string;

  @AllowNull(true)
  @Column(DataType.STRING)
  declare phoneNumber: string;

  @AllowNull(true)
  @Column(DataType.STRING)
  declare address: string;

  @AllowNull(false)
  @Column(DataType.STRING)
  declare paymentStatus: string;

  @AllowNull(true)
  @Column(DataType.FLOAT)
  declare deposit: number;

  @AllowNull(true)
  @Column(DataType.TEXT)
  declare notes: string;

  @AllowNull(false)
  @Default(DataType.NOW)
  @Column(DataType.DATE)
  declare createdAt: Date;

  @AllowNull(false)
  @Default(DataType.NOW)
  @Column(DataType.DATE)
  declare updatedAt: Date;

  @AllowNull(true)
  @Column(DataType.INTEGER)
  declare createdBy?: number;

  @AllowNull(true)
  @Column(DataType.INTEGER)
  declare updatedBy?: number;

}
