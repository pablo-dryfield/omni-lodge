import {
  Table,
  Column,
  Model,
  PrimaryKey,
  AutoIncrement,
  DataType,
  CreatedAt,
  UpdatedAt,
  BelongsTo,
  ForeignKey
} from 'sequelize-typescript';

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

  @Column({
    type: DataType.DATE,
    allowNull: false,
  })
  declare checkInDate: Date;

  @Column({
    type: DataType.DATE,
    allowNull: false,
  })
  declare checkOutDate: Date;

  @Column({
    type: DataType.FLOAT,
    allowNull: true,
  })
  declare totalAmount?: number;

  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  declare paymentStatus?: string;

  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  declare roomType?: string;

  @Column({
    type: DataType.INTEGER,
    allowNull: true,
  })
  declare numGuests?: number;

  @Column({
    type: DataType.TEXT,
    allowNull: true,
  })
  declare notes?: string;

  @CreatedAt
  declare createdAt: Date;

  @UpdatedAt
  declare updatedAt: Date;

  @Column({
    type: DataType.INTEGER,
    allowNull: true,
  })
  declare createdBy?: number;

  @Column({
    type: DataType.INTEGER,
    allowNull: true,
  })
  declare updatedBy?: number;
}
