import { Model, Table, Column, PrimaryKey, AutoIncrement, AllowNull, Default, DataType } from 'sequelize-typescript';

@Table({
  timestamps: true,
  modelName: 'Products',
  tableName: 'products'
})
export default class Product extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @AllowNull(false)
  @Column(DataType.STRING)
  declare name: string;

  @AllowNull(false)
  @Column(DataType.INTEGER)
  declare productTypeId: number;

  @AllowNull(false)
  @Column(DataType.DECIMAL(10, 2))
  declare price: number;

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

  @AllowNull(false)
  @Default(true)
  @Column(DataType.BOOLEAN)
  declare status: boolean;
}
