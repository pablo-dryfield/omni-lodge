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

import StorefrontOngoingCart from './StorefrontOngoingCart.js';

@Table({
  timestamps: true,
  modelName: 'StorefrontJourneyVisit',
  tableName: 'storefront_journey_visits',
})
export default class StorefrontJourneyVisit extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.BIGINT)
  declare id: number;

  @AllowNull(false)
  @Unique
  @Column({ field: 'public_id', type: DataType.UUID })
  declare publicId: string;

  @ForeignKey(() => StorefrontOngoingCart)
  @AllowNull(false)
  @Column({ field: 'ongoing_cart_id', type: DataType.BIGINT })
  declare ongoingCartId: number;

  @AllowNull(true)
  @Column({ field: 'browser_instance_id', type: DataType.UUID })
  declare browserInstanceId: string | null;

  @AllowNull(true)
  @Column({ field: 'first_page_id', type: DataType.UUID })
  declare firstPageId: string | null;

  @AllowNull(true)
  @Column({ field: 'last_page_id', type: DataType.UUID })
  declare lastPageId: string | null;

  @AllowNull(false)
  @Column({ field: 'started_at', type: DataType.DATE })
  declare startedAt: Date;

  @AllowNull(false)
  @Column({ field: 'last_activity_at', type: DataType.DATE })
  declare lastActivityAt: Date;

  @AllowNull(false)
  @Column({ field: 'qualified_at', type: DataType.DATE })
  declare qualifiedAt: Date;

  @AllowNull(false)
  @Default(false)
  @Column({ field: 'clarity_sampled', type: DataType.BOOLEAN })
  declare claritySampled: boolean;

  @AllowNull(true)
  @Column({ field: 'clarity_session_id', type: DataType.STRING(255) })
  declare claritySessionId: string | null;

  @CreatedAt
  @Column({ field: 'created_at', type: DataType.DATE })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at', type: DataType.DATE })
  declare updatedAt: Date;
}
