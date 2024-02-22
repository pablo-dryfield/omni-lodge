import { Model, Table, Column, PrimaryKey, AutoIncrement, AllowNull, Default, DataType } from 'sequelize-typescript';

@Table({
  timestamps: true,
  modelName: 'Bookings',
  tableName: 'bookings'
})
export default class Booking extends Model<Booking> {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @AllowNull(false)
  @Default(DataType.NOW)
  @Column(DataType.DATE)
  declare checkInDate: Date;

  @AllowNull(false)
  @Default(DataType.NOW)
  @Column(DataType.DATE)
  declare checkOutDate: Date;

  @AllowNull(true)
  @Column(DataType.FLOAT)
  declare totalAmount: number;

  @AllowNull(true)
  @Column(DataType.STRING)
  declare paymentStatus: string;

  @AllowNull(true)
  @Column(DataType.STRING)
  declare roomType: string;

  @AllowNull(true)
  @Column(DataType.FLOAT)
  declare numGuests: number;

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
