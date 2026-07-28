import {
  AllowNull,
  AutoIncrement,
  Column,
  CreatedAt,
  DataType,
  Default,
  HasMany,
  Model,
  PrimaryKey,
  Table,
  Unique,
  UpdatedAt,
} from 'sequelize-typescript';

import StorefrontOrderItem from './StorefrontOrderItem.js';

@Table({
  timestamps: true,
  modelName: 'StorefrontOrders',
  tableName: 'storefront_orders',
})
export default class StorefrontOrder extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.BIGINT)
  declare id: number;

  @AllowNull(false)
  @Unique
  @Default(DataType.UUIDV4)
  @Column({ field: 'public_id', type: DataType.UUID })
  declare publicId: string;

  @AllowNull(false)
  @Default('draft')
  @Column(DataType.STRING(32))
  declare status: string;

  @AllowNull(false)
  @Default('unpaid')
  @Column({ field: 'payment_status', type: DataType.STRING(32) })
  declare paymentStatus: string;

  @AllowNull(true)
  @Unique
  @Column({ field: 'stripe_checkout_session_id', type: DataType.STRING })
  declare stripeCheckoutSessionId: string | null;

  @AllowNull(true)
  @Column({ field: 'stripe_payment_intent_id', type: DataType.STRING })
  declare stripePaymentIntentId: string | null;

  @AllowNull(false)
  @Default('PLN')
  @Column(DataType.STRING(3))
  declare currency: string;

  @AllowNull(false)
  @Default(0)
  @Column(DataType.DECIMAL(12, 2))
  declare subtotal: number;

  @AllowNull(false)
  @Default(0)
  @Column({ field: 'addon_total', type: DataType.DECIMAL(12, 2) })
  declare addonTotal: number;

  @AllowNull(false)
  @Default(0)
  @Column({ field: 'discount_total', type: DataType.DECIMAL(12, 2) })
  declare discountTotal: number;

  @AllowNull(false)
  @Default(0)
  @Column(DataType.DECIMAL(12, 2))
  declare total: number;

  @AllowNull(false)
  @Column({ field: 'customer_first_name', type: DataType.STRING })
  declare customerFirstName: string;

  @AllowNull(false)
  @Column({ field: 'customer_last_name', type: DataType.STRING })
  declare customerLastName: string;

  @AllowNull(false)
  @Column({ field: 'customer_email', type: DataType.STRING })
  declare customerEmail: string;

  @AllowNull(true)
  @Column({ field: 'customer_phone', type: DataType.STRING })
  declare customerPhone: string | null;

  @AllowNull(true)
  @Column({ field: 'customer_country_code', type: DataType.STRING(2) })
  declare customerCountryCode: string | null;

  @AllowNull(true)
  @Column({ field: 'discount_code', type: DataType.STRING })
  declare discountCode: string | null;

  @AllowNull(true)
  @Column(DataType.JSONB)
  declare attribution: Record<string, unknown> | null;

  @AllowNull(true)
  @Column(DataType.JSONB)
  declare metadata: Record<string, unknown> | null;

  @AllowNull(true)
  @Column({ field: 'paid_at', type: DataType.DATE })
  declare paidAt: Date | null;

  @HasMany(() => StorefrontOrderItem, { foreignKey: 'order_id', as: 'items' })
  declare items?: StorefrontOrderItem[];

  @CreatedAt
  @Column({ field: 'created_at', type: DataType.DATE })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at', type: DataType.DATE })
  declare updatedAt: Date;
}
