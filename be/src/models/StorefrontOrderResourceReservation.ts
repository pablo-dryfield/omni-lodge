import {
  AllowNull,
  AutoIncrement,
  BelongsTo,
  Column,
  CreatedAt,
  DataType,
  Default,
  ForeignKey,
  Model,
  PrimaryKey,
  Table,
  UpdatedAt,
} from 'sequelize-typescript';
import type { NonAttribute } from 'sequelize';

import StorefrontOrder from './StorefrontOrder.js';
import StorefrontOrderItem from './StorefrontOrderItem.js';

export type StorefrontReservationResourceType = 'inventory' | 'promotion';
export type StorefrontReservationStatus = 'held' | 'consumed' | 'released';

/**
 * A temporary commercial hold owned by a storefront order.
 *
 * Inventory rows deliberately do not create InventoryFulfillment records or
 * InventoryMovement rows. They only reduce sellable availability until the
 * experience has passed; the counter workflow remains the single source of
 * truth for physical stock consumption.
 */
@Table({
  timestamps: true,
  modelName: 'StorefrontOrderResourceReservations',
  tableName: 'storefront_order_resource_reservations',
  underscored: true,
})
export default class StorefrontOrderResourceReservation extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.BIGINT)
  declare id: number;

  @ForeignKey(() => StorefrontOrder)
  @AllowNull(false)
  @Column({ field: 'order_id', type: DataType.BIGINT })
  declare orderId: number;

  @BelongsTo(() => StorefrontOrder, { foreignKey: 'order_id', as: 'order' })
  declare order?: NonAttribute<StorefrontOrder>;

  @ForeignKey(() => StorefrontOrderItem)
  @AllowNull(true)
  @Column({ field: 'order_item_id', type: DataType.BIGINT })
  declare orderItemId: number | null;

  @BelongsTo(() => StorefrontOrderItem, { foreignKey: 'order_item_id', as: 'orderItem' })
  declare orderItem?: NonAttribute<StorefrontOrderItem>;

  @AllowNull(false)
  @Column({ field: 'resource_type', type: DataType.STRING(24) })
  declare resourceType: StorefrontReservationResourceType;

  @AllowNull(false)
  @Column({ field: 'reservation_key', type: DataType.STRING(180) })
  declare reservationKey: string;

  @AllowNull(true)
  @Column({ field: 'inventory_item_id', type: DataType.INTEGER })
  declare inventoryItemId: number | null;

  @AllowNull(true)
  @Column({ field: 'promotion_id', type: DataType.INTEGER })
  declare promotionId: number | null;

  @AllowNull(true)
  @Column({ field: 'addon_id', type: DataType.INTEGER })
  declare addonId: number | null;

  @AllowNull(true)
  @Column(DataType.STRING(40))
  declare variant: string | null;

  @AllowNull(false)
  @Default(1)
  @Column(DataType.DECIMAL(14, 3))
  declare quantity: string;

  @AllowNull(false)
  @Default('held')
  @Column(DataType.STRING(20))
  declare status: StorefrontReservationStatus;

  @AllowNull(false)
  @Column({ field: 'expires_at', type: DataType.DATE })
  declare expiresAt: Date;

  @AllowNull(true)
  @Column({ field: 'commit_expires_at', type: DataType.DATE })
  declare commitExpiresAt: Date | null;

  @AllowNull(true)
  @Column({ field: 'consumed_at', type: DataType.DATE })
  declare consumedAt: Date | null;

  @AllowNull(true)
  @Column({ field: 'released_at', type: DataType.DATE })
  declare releasedAt: Date | null;

  @CreatedAt
  @Column({ field: 'created_at', type: DataType.DATE })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at', type: DataType.DATE })
  declare updatedAt: Date;
}
