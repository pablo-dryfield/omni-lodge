import {
  AllowNull,
  AutoIncrement,
  BelongsTo,
  Column,
  DataType,
  ForeignKey,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';
import Product from './Product.js';
import User from './User.js';

@Table({
  timestamps: true,
  modelName: 'ProductPrice',
  tableName: 'product_prices',
})
export default class ProductPrice extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @ForeignKey(() => Product)
  @AllowNull(false)
  @Column({ field: 'product_id', type: DataType.INTEGER })
  declare productId: number;

  @BelongsTo(() => Product, { foreignKey: 'product_id', as: 'product' })
  declare product?: Product;

  @AllowNull(false)
  @Column(DataType.DECIMAL(10, 2))
  declare price: number;

  @AllowNull(false)
  @Column({ field: 'valid_from', type: DataType.DATEONLY })
  declare validFrom: string;

  @AllowNull(true)
  @Column({ field: 'valid_to', type: DataType.DATEONLY })
  declare validTo: string | null;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column({ field: 'created_by', type: DataType.INTEGER })
  declare createdBy: number | null;

  @BelongsTo(() => User, { foreignKey: 'created_by', as: 'createdByUser' })
  declare createdByUser?: User;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column({ field: 'updated_by', type: DataType.INTEGER })
  declare updatedBy: number | null;

  @BelongsTo(() => User, { foreignKey: 'updated_by', as: 'updatedByUser' })
  declare updatedByUser?: User;
}
