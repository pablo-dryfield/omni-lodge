import {
  AllowNull,
  AutoIncrement,
  Column,
  CreatedAt,
  DataType,
  Default,
  Model,
  PrimaryKey,
  Table,
  Unique,
  UpdatedAt,
} from 'sequelize-typescript';

@Table({
  timestamps: true,
  modelName: 'StorefrontPromotions',
  tableName: 'storefront_promotions',
})
export default class StorefrontPromotion extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @AllowNull(false)
  @Unique
  @Column(DataType.STRING(64))
  declare code: string;

  @AllowNull(false)
  @Column(DataType.STRING)
  declare name: string;

  @AllowNull(false)
  @Column(DataType.STRING(16))
  declare type: 'percentage' | 'fixed';

  @AllowNull(false)
  @Column(DataType.DECIMAL(12, 2))
  declare value: number;

  @AllowNull(true)
  @Column(DataType.STRING(3))
  declare currency: string | null;

  @AllowNull(false)
  @Default(0)
  @Column({ field: 'min_subtotal', type: DataType.DECIMAL(12, 2) })
  declare minSubtotal: number;

  @AllowNull(true)
  @Column({ field: 'max_redemptions', type: DataType.INTEGER })
  declare maxRedemptions: number | null;

  @AllowNull(false)
  @Default(0)
  @Column({ field: 'redemption_count', type: DataType.INTEGER })
  declare redemptionCount: number;

  @AllowNull(true)
  @Column({ field: 'valid_from', type: DataType.DATE })
  declare validFrom: Date | null;

  @AllowNull(true)
  @Column({ field: 'valid_to', type: DataType.DATE })
  declare validTo: Date | null;

  @AllowNull(false)
  @Default(true)
  @Column({ field: 'is_active', type: DataType.BOOLEAN })
  declare isActive: boolean;

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
