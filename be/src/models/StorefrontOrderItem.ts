import {
  AllowNull,
  AutoIncrement,
  BelongsTo,
  Column,
  CreatedAt,
  DataType,
  ForeignKey,
  Model,
  PrimaryKey,
  Table,
  UpdatedAt,
} from 'sequelize-typescript';

import Product from './Product.js';
import StorefrontOrder from './StorefrontOrder.js';

@Table({
  timestamps: true,
  modelName: 'StorefrontOrderItems',
  tableName: 'storefront_order_items',
})
export default class StorefrontOrderItem extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.BIGINT)
  declare id: number;

  @ForeignKey(() => StorefrontOrder)
  @AllowNull(false)
  @Column({ field: 'order_id', type: DataType.BIGINT })
  declare orderId: number;

  @ForeignKey(() => Product)
  @AllowNull(false)
  @Column({ field: 'product_id', type: DataType.INTEGER })
  declare productId: number;

  @AllowNull(false)
  @Column({ field: 'product_name', type: DataType.STRING })
  declare productName: string;

  @AllowNull(false)
  @Column({ field: 'product_slug', type: DataType.STRING })
  declare productSlug: string;

  @AllowNull(false)
  @Column(DataType.INTEGER)
  declare quantity: number;

  @AllowNull(true)
  @Column({ field: 'experience_date', type: DataType.DATEONLY })
  declare experienceDate: string | null;

  @AllowNull(true)
  @Column({ field: 'experience_time', type: DataType.STRING(16) })
  declare experienceTime: string | null;

  @AllowNull(false)
  @Column({ field: 'unit_price', type: DataType.DECIMAL(12, 2) })
  declare unitPrice: number;

  @AllowNull(false)
  @Column({ field: 'base_total', type: DataType.DECIMAL(12, 2) })
  declare baseTotal: number;

  @AllowNull(false)
  @Column({ field: 'addon_total', type: DataType.DECIMAL(12, 2) })
  declare addonTotal: number;

  @AllowNull(false)
  @Column(DataType.DECIMAL(12, 2))
  declare total: number;

  @AllowNull(false)
  @Column(DataType.JSONB)
  declare addons: Array<Record<string, unknown>>;

  @AllowNull(false)
  @Column(DataType.JSONB)
  declare options: Record<string, unknown>;

  @BelongsTo(() => StorefrontOrder, { foreignKey: 'order_id', as: 'order' })
  declare order?: StorefrontOrder;

  @BelongsTo(() => Product, { foreignKey: 'product_id', as: 'product' })
  declare product?: Product;

  @CreatedAt
  @Column({ field: 'created_at', type: DataType.DATE })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at', type: DataType.DATE })
  declare updatedAt: Date;
}
