import {
  AllowNull,
  AutoIncrement,
  BelongsTo,
  Column,
  DataType,
  Default,
  ForeignKey,
  HasMany,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';
import type { NonAttribute } from 'sequelize';
import User from './User.js';
import Venue from './Venue.js';
import PromotionRoutePlan from './PromotionRoutePlan.js';
import PromotionRouteCheckpoint from './PromotionRouteCheckpoint.js';

export type PromotionRouteVersionStatus = 'draft' | 'published' | 'retired';

export type PromotionRoutePolicyJson = {
  maxHorizontalAccuracyMeters: number;
  startDwellSeconds: number;
  checkpointDwellSeconds: number;
  finishDwellSeconds: number;
  consecutiveFixesRequired: number;
  reminderOffsetsMinutes: number[];
  preShiftCheckInWindowMinutes: number;
  streetExpectedDurationMinutes: number;
  hostelExpectedDurationMinutes: number;
  minimumStreetDurationMinutes?: number | null;
  minimumHostelDurationMinutes?: number | null;
  requiredParticipantProof?: 'self' | 'all_assigned';
  participantProofMaxAgeSeconds?: number;
  participantProofMaxDistanceMeters?: number;
};

export type PromotionCoordinateJson = {
  latitude: number;
  longitude: number;
};

@Table({
  tableName: 'promotion_route_versions',
  modelName: 'PromotionRouteVersion',
  timestamps: true,
  underscored: true,
})
export default class PromotionRouteVersion extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.BIGINT)
  declare id: number;

  @ForeignKey(() => PromotionRoutePlan)
  @AllowNull(false)
  @Column({ field: 'route_plan_id', type: DataType.BIGINT })
  declare routePlanId: number;

  @AllowNull(false)
  @Column({ field: 'version_number', type: DataType.INTEGER })
  declare versionNumber: number;

  @AllowNull(false)
  @Default('draft')
  @Column(DataType.STRING(24))
  declare status: PromotionRouteVersionStatus;

  @AllowNull(false)
  @Column({ field: 'route_name', type: DataType.STRING(160) })
  declare routeName: string;

  @ForeignKey(() => Venue)
  @AllowNull(true)
  @Column({ field: 'default_hostel_venue_id', type: DataType.INTEGER })
  declare defaultHostelVenueId: number | null;

  @AllowNull(true)
  @Column({ field: 'hostel_name', type: DataType.STRING(160) })
  declare hostelName: string | null;

  @AllowNull(false)
  @Column({ field: 'start_label', type: DataType.STRING(160) })
  declare startLabel: string;

  @AllowNull(false)
  @Column({ field: 'start_latitude', type: DataType.DOUBLE })
  declare startLatitude: number;

  @AllowNull(false)
  @Column({ field: 'start_longitude', type: DataType.DOUBLE })
  declare startLongitude: number;

  @AllowNull(false)
  @Column({ field: 'start_radius_meters', type: DataType.DOUBLE })
  declare startRadiusMeters: number;

  @AllowNull(false)
  @Column({ field: 'finish_label', type: DataType.STRING(160) })
  declare finishLabel: string;

  @AllowNull(false)
  @Column({ field: 'finish_latitude', type: DataType.DOUBLE })
  declare finishLatitude: number;

  @AllowNull(false)
  @Column({ field: 'finish_longitude', type: DataType.DOUBLE })
  declare finishLongitude: number;

  @AllowNull(false)
  @Column({ field: 'finish_radius_meters', type: DataType.DOUBLE })
  declare finishRadiusMeters: number;

  @AllowNull(false)
  @Default([])
  @Column({ field: 'street_polyline', type: DataType.JSONB })
  declare streetPolyline: PromotionCoordinateJson[];

  @AllowNull(false)
  @Default([])
  @Column({ field: 'hostel_polyline', type: DataType.JSONB })
  declare hostelPolyline: PromotionCoordinateJson[];

  @AllowNull(false)
  @Column({ field: 'policy_json', type: DataType.JSONB })
  declare policyJson: PromotionRoutePolicyJson;

  @AllowNull(true)
  @Column({ field: 'published_at', type: DataType.DATE })
  declare publishedAt: Date | null;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column({ field: 'created_by', type: DataType.INTEGER })
  declare createdBy: number | null;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column({ field: 'published_by', type: DataType.INTEGER })
  declare publishedBy: number | null;

  @BelongsTo(() => PromotionRoutePlan, { foreignKey: 'route_plan_id', as: 'routePlan' })
  declare routePlan?: NonAttribute<PromotionRoutePlan | null>;

  @BelongsTo(() => Venue, { foreignKey: 'default_hostel_venue_id', as: 'defaultHostelVenue' })
  declare defaultHostelVenue?: NonAttribute<Venue | null>;

  @BelongsTo(() => User, { foreignKey: 'created_by', as: 'createdByUser' })
  declare createdByUser?: NonAttribute<User | null>;

  @BelongsTo(() => User, { foreignKey: 'published_by', as: 'publishedByUser' })
  declare publishedByUser?: NonAttribute<User | null>;

  @HasMany(() => PromotionRouteCheckpoint, { foreignKey: 'route_version_id', as: 'checkpoints' })
  declare checkpoints?: NonAttribute<PromotionRouteCheckpoint[]>;
}

