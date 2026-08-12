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
import User from './User.js';
import type { StorefrontCartInput, StorefrontQuote } from '../services/storefrontCommerceService.js';

export type StorefrontSavedCartCustomer = {
  fullName?: string;
  email?: string;
  phoneCountry?: string;
  phone?: string;
};

@Table({
  timestamps: true,
  modelName: 'StorefrontSavedCart',
  tableName: 'storefront_saved_carts',
})
export default class StorefrontSavedCart extends Model {
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
  @Default('active')
  @Column(DataType.STRING(32))
  declare status: string;

  @AllowNull(false)
  @Column(DataType.STRING(160))
  declare name: string;

  @AllowNull(false)
  @Column(DataType.JSONB)
  declare cart: StorefrontCartInput;

  @AllowNull(true)
  @Column(DataType.JSONB)
  declare customer: StorefrontSavedCartCustomer | null;

  @AllowNull(false)
  @Column({ field: 'quote_snapshot', type: DataType.JSONB })
  declare quoteSnapshot: StorefrontQuote;

  @AllowNull(false)
  @Default('PLN')
  @Column(DataType.STRING(3))
  declare currency: string;

  @AllowNull(false)
  @Default(0)
  @Column(DataType.DECIMAL(12, 2))
  declare total: number;

  @AllowNull(false)
  @Default(true)
  @Column({ field: 'is_locked', type: DataType.BOOLEAN })
  declare isLocked: boolean;

  @AllowNull(false)
  @Column({ field: 'expires_at', type: DataType.DATE })
  declare expiresAt: Date;

  @AllowNull(true)
  @Column({ field: 'opened_at', type: DataType.DATE })
  declare openedAt: Date | null;

  @AllowNull(true)
  @Column({ field: 'checkout_started_at', type: DataType.DATE })
  declare checkoutStartedAt: Date | null;

  @AllowNull(true)
  @Column({ field: 'paid_at', type: DataType.DATE })
  declare paidAt: Date | null;

  @AllowNull(true)
  @Column({ field: 'disabled_at', type: DataType.DATE })
  declare disabledAt: Date | null;

  @ForeignKey(() => StorefrontOrder)
  @AllowNull(true)
  @Column({ field: 'order_id', type: DataType.BIGINT })
  declare orderId: number | null;

  @ForeignKey(() => User)
  @AllowNull(false)
  @Column({ field: 'created_by_user_id', type: DataType.INTEGER })
  declare createdByUserId: number;

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
