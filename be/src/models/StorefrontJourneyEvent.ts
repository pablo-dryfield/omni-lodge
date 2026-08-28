import {
  AllowNull,
  AutoIncrement,
  Column,
  CreatedAt,
  DataType,
  ForeignKey,
  Model,
  PrimaryKey,
  Table,
  Unique,
} from 'sequelize-typescript';

import StorefrontJourneyVisit from './StorefrontJourneyVisit.js';
import StorefrontOngoingCart from './StorefrontOngoingCart.js';

@Table({
  timestamps: true,
  updatedAt: false,
  modelName: 'StorefrontJourneyEvent',
  tableName: 'storefront_journey_events',
})
export default class StorefrontJourneyEvent extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.BIGINT)
  declare id: number;

  @AllowNull(false)
  @Unique
  @Column({ field: 'public_id', type: DataType.UUID })
  declare publicId: string;

  @ForeignKey(() => StorefrontJourneyVisit)
  @AllowNull(false)
  @Column({ field: 'visit_id', type: DataType.BIGINT })
  declare visitId: number;

  @ForeignKey(() => StorefrontOngoingCart)
  @AllowNull(false)
  @Column({ field: 'ongoing_cart_id', type: DataType.BIGINT })
  declare ongoingCartId: number;

  @AllowNull(true)
  @Column({ field: 'page_id', type: DataType.UUID })
  declare pageId: string | null;

  @AllowNull(false)
  @Column(DataType.STRING(64))
  declare type: string;

  @AllowNull(false)
  @Column(DataType.STRING(16))
  declare source: string;

  @AllowNull(false)
  @Column(DataType.STRING(16))
  declare severity: string;

  @AllowNull(true)
  @Column(DataType.INTEGER)
  declare sequence: number | null;

  @AllowNull(false)
  @Column({ field: 'occurred_at', type: DataType.DATE })
  declare occurredAt: Date;

  @AllowNull(true)
  @Column(DataType.JSONB)
  declare details: Record<string, unknown> | null;

  @CreatedAt
  @Column({ field: 'received_at', type: DataType.DATE })
  declare receivedAt: Date;
}
