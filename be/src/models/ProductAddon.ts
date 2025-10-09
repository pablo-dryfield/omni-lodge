import {
  AllowNull,
  AutoIncrement,
  BelongsTo,
  Column,
  DataType,
  Default,
  ForeignKey,
  Model,
  PrimaryKey,
  Table,
  Unique,
} from 'sequelize-typescript';

import Addon from './Addon.js';
import Product from './Product.js';

@Table({
  timestamps: true,
  modelName: 'ProductAddons',
  tableName: 'product_addons',
})
export default class ProductAddon extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @ForeignKey(() => Product)
  @AllowNull(false)
  @Unique('product_addons_product_addon_unique')
  @Column({ field: 'product_id', type: DataType.INTEGER })
  declare productId: number;

  @ForeignKey(() => Addon)
  @AllowNull(false)
  @Unique('product_addons_product_addon_unique')
  @Column({ field: 'addon_id', type: DataType.INTEGER })
  declare addonId: number;

  @AllowNull(true)
  @Column({ field: 'max_per_attendee', type: DataType.INTEGER })
  declare maxPerAttendee: number | null;

  @AllowNull(true)
  @Column({ field: 'price_override', type: DataType.DECIMAL(10, 2) })
  declare priceOverride: number | null;

  @AllowNull(false)
  @Default(0)
  @Column({ field: 'sort_order', type: DataType.INTEGER })
  declare sortOrder: number;

  @AllowNull(false)
  @Default(DataType.NOW)
  @Column(DataType.DATE)
  declare createdAt: Date;

  @AllowNull(true)
  @Default(DataType.NOW)
  @Column(DataType.DATE)
  declare updatedAt: Date | null;

  @BelongsTo(() => Product, { foreignKey: 'product_id', as: 'product' })
  declare product?: unknown;

  @BelongsTo(() => Addon, { foreignKey: 'addon_id', as: 'addon' })
  declare addon?: unknown;
}
