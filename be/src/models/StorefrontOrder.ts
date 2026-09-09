import {
  AllowNull,
  AutoIncrement,
  BelongsTo,
  Column,
  CreatedAt,
  DataType,
  Default,
  ForeignKey,
  HasMany,
  Model,
  PrimaryKey,
  Table,
  Unique,
  UpdatedAt,
} from 'sequelize-typescript';
import type { NonAttribute } from 'sequelize';

import StorefrontOrderItem from './StorefrontOrderItem.js';
import User from './User.js';

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

  @AllowNull(false)
  @Default('storefront')
  @Column({ field: 'order_source', type: DataType.STRING(32) })
  declare orderSource: string;

  @AllowNull(false)
  @Default('unknown')
  @Column({ field: 'payment_method', type: DataType.STRING(32) })
  declare paymentMethod: string;

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

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column({ field: 'created_by_user_id', type: DataType.INTEGER })
  declare createdByUserId: number | null;

  @BelongsTo(() => User, { foreignKey: 'created_by_user_id', as: 'createdByUser' })
  declare createdByUser?: NonAttribute<User>;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column({ field: 'payment_received_by_user_id', type: DataType.INTEGER })
  declare paymentReceivedByUserId: number | null;

  @BelongsTo(() => User, { foreignKey: 'payment_received_by_user_id', as: 'paymentReceivedByUser' })
  declare paymentReceivedByUser?: NonAttribute<User>;

  @AllowNull(true)
  @Unique
  @Column({ field: 'payment_reference', type: DataType.STRING(64) })
  declare paymentReference: string | null;

  @AllowNull(true)
  @Column({ field: 'payment_due_at', type: DataType.DATE })
  declare paymentDueAt: Date | null;

  @AllowNull(true)
  @Column({ field: 'bank_transfer_email_sent_at', type: DataType.DATE })
  declare bankTransferEmailSentAt: Date | null;

  @AllowNull(true)
  @Column({ field: 'bank_transfer_cancellation_email_sent_at', type: DataType.DATE })
  declare bankTransferCancellationEmailSentAt: Date | null;

  @AllowNull(true)
  @Unique
  @Column({ field: 'idempotency_key', type: DataType.UUID })
  declare idempotencyKey: string | null;

  @AllowNull(true)
  @Column({ field: 'idempotency_request_hash', type: DataType.STRING(64) })
  declare idempotencyRequestHash: string | null;

  @AllowNull(true)
  @Column({ field: 'payment_note', type: DataType.TEXT })
  declare paymentNote: string | null;

  @AllowNull(true)
  @Column({ field: 'customer_email_sent_at', type: DataType.DATE })
  declare customerEmailSentAt: Date | null;

  @AllowNull(true)
  @Column({ field: 'internal_email_sent_at', type: DataType.DATE })
  declare internalEmailSentAt: Date | null;

  @HasMany(() => StorefrontOrderItem, { foreignKey: 'order_id', as: 'items' })
  declare items?: NonAttribute<StorefrontOrderItem[]>;

  @CreatedAt
  @Column({ field: 'created_at', type: DataType.DATE })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at', type: DataType.DATE })
  declare updatedAt: Date;
}
