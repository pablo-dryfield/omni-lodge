import { Model, Table, Column, PrimaryKey, AutoIncrement, AllowNull, Default, DataType } from 'sequelize-typescript';

@Table({
  timestamps: true,
  modelName: 'ProductTypes',
  tableName: 'productTypes'
})
export default class ProductType extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @AllowNull(false)
  @Column(DataType.STRING)
  declare name: string;

  @AllowNull(true)
  @Column(DataType.BOOLEAN)
  declare add: boolean;

  @AllowNull(true)
  @Column(DataType.BOOLEAN)
  declare sub: boolean;

  @AllowNull(true)
  @Column(DataType.BOOLEAN)
  declare mul: boolean;

  @AllowNull(true)
  @Column(DataType.BOOLEAN)
  declare div: boolean;

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
