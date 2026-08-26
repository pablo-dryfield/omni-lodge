import {
  AllowNull,
  AutoIncrement,
  Column,
  CreatedAt,
  DataType,
  Default,
  ForeignKey,
  Model,
  PrimaryKey,
  Table,
  Unique,
  UpdatedAt,
} from 'sequelize-typescript';

import StorefrontOrder from './StorefrontOrder.js';
import type { StorefrontCartInput, StorefrontQuote } from '../services/storefrontCommerceService.js';

export type StorefrontOngoingCartCustomer = {
  fullName: string;
  email: string;
  phoneCountry: string;
  phone: string;
};

@Table({
  timestamps: true,
  modelName: 'StorefrontOngoingCart',
  tableName: 'storefront_ongoing_carts',
})
export default class StorefrontOngoingCart extends Model {
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
  @Column({ field: 'session_id', type: DataType.UUID })
  declare sessionId: string;

  @AllowNull(false)
  @Default('active')
  @Column(DataType.STRING(32))
  declare status: string;

  @AllowNull(false)
  @Column(DataType.JSONB)
  declare cart: StorefrontCartInput;

  @AllowNull(false)
  @Column(DataType.JSONB)
  declare customer: StorefrontOngoingCartCustomer;

  @AllowNull(false)
  @Column({ field: 'quote_snapshot', type: DataType.JSONB })
  declare quoteSnapshot: StorefrontQuote;

  @AllowNull(true)
  @Column(DataType.JSONB)
  declare attribution: Record<string, unknown> | null;

  @AllowNull(false)
  @Default('PLN')
  @Column(DataType.STRING(3))
  declare currency: string;

  @AllowNull(false)
  @Default(0)
  @Column(DataType.DECIMAL(12, 2))
  declare total: number;

  @AllowNull(false)
  @Column({ field: 'last_activity_at', type: DataType.DATE })
  declare lastActivityAt: Date;

  @AllowNull(false)
  @Column({ field: 'recovery_due_at', type: DataType.DATE })
  declare recoveryDueAt: Date;

  @AllowNull(true)
  @Column({ field: 'recovery_sent_at', type: DataType.DATE })
  declare recoverySentAt: Date | null;

  @AllowNull(true)
  @Unique
  @Default(DataType.UUIDV4)
  @Column({ field: 'recovery_token', type: DataType.UUID })
  declare recoveryToken: string | null;

  @AllowNull(true)
  @Column({ field: 'first_recovery_sent_at', type: DataType.DATE })
  declare firstRecoverySentAt: Date | null;

  @AllowNull(true)
  @Column({ field: 'last_recovery_sent_at', type: DataType.DATE })
  declare lastRecoverySentAt: Date | null;

  @AllowNull(true)
  @Column({ field: 'recovery_opened_at', type: DataType.DATE })
  declare recoveryOpenedAt: Date | null;

  @AllowNull(true)
  @Column({ field: 'recovered_at', type: DataType.DATE })
  declare recoveredAt: Date | null;

  @AllowNull(false)
  @Default(0)
  @Column({ field: 'recovery_count', type: DataType.INTEGER })
  declare recoveryCount: number;

  @AllowNull(true)
  @Column({ field: 'recovery_message_id', type: DataType.STRING(255) })
  declare recoveryMessageId: string | null;

  @AllowNull(true)
  @Column({ field: 'recovery_error', type: DataType.TEXT })
  declare recoveryError: string | null;

  @AllowNull(true)
  @Column({ field: 'opened_at', type: DataType.DATE })
  declare openedAt: Date | null;

  @AllowNull(true)
  @Column({ field: 'checkout_started_at', type: DataType.DATE })
  declare checkoutStartedAt: Date | null;

  @AllowNull(true)
  @Column({ field: 'converted_at', type: DataType.DATE })
  declare convertedAt: Date | null;

  @AllowNull(true)
  @Column({ field: 'dismissed_at', type: DataType.DATE })
  declare dismissedAt: Date | null;

  @ForeignKey(() => StorefrontOrder)
  @AllowNull(true)
  @Column({ field: 'order_id', type: DataType.BIGINT })
  declare orderId: number | null;

  @AllowNull(true)
  @Column(DataType.JSONB)
  declare metadata: Record<string, unknown> | null;

  @CreatedAt
  @Column({ field: 'created_at', type: DataType.DATE })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at', type: DataType.DATE })
  declare updatedAt: Date;
}
