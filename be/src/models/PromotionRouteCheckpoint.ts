import {
  AllowNull,
  AutoIncrement,
  BelongsTo,
  Column,
  DataType,
  ForeignKey,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';
import type { NonAttribute } from 'sequelize';
import PromotionRouteVersion from './PromotionRouteVersion.js';

export type PromotionPhase = 'street' | 'hostel';

@Table({
  tableName: 'promotion_route_checkpoints',
  modelName: 'PromotionRouteCheckpoint',
  timestamps: true,
  underscored: true,
})
export default class PromotionRouteCheckpoint extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.BIGINT)
  declare id: number;

  @ForeignKey(() => PromotionRouteVersion)
  @AllowNull(false)
  @Column({ field: 'route_version_id', type: DataType.BIGINT })
  declare routeVersionId: number;

  @AllowNull(false)
  @Column(DataType.STRING(16))
  declare phase: PromotionPhase;

  @AllowNull(false)
  @Column(DataType.INTEGER)
  declare sequence: number;

  @AllowNull(false)
  @Column(DataType.STRING(160))
  declare label: string;

  @AllowNull(false)
  @Column(DataType.TEXT)
  declare instruction: string;

  @AllowNull(false)
  @Column(DataType.DOUBLE)
  declare latitude: number;

  @AllowNull(false)
  @Column(DataType.DOUBLE)
  declare longitude: number;

  @AllowNull(false)
  @Column({ field: 'radius_meters', type: DataType.DOUBLE })
  declare radiusMeters: number;

  @AllowNull(false)
  @Column({ field: 'required_dwell_seconds', type: DataType.INTEGER })
  declare requiredDwellSeconds: number;

  @BelongsTo(() => PromotionRouteVersion, { foreignKey: 'route_version_id', as: 'routeVersion' })
  declare routeVersion?: NonAttribute<PromotionRouteVersion | null>;
}

