import {
  Table,
  Column,
  Model,
  PrimaryKey,
  AutoIncrement,
  DataType,
  CreatedAt,
  UpdatedAt,
  HasMany
} from 'sequelize-typescript';

@Table({
  timestamps: true,
  modelName: 'Guests',
  tableName: 'guests'
})
export default class Guest extends Model<Guest> {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  declare name: string;

  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  declare email?: string;

  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  declare phoneNumber?: string;

  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  declare address?: string;

  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  declare paymentStatus?: string;

  @Column({
    type: DataType.FLOAT,
    allowNull: true,
  })
  declare deposit?: number;

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
