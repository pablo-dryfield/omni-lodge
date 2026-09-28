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
import User from './User.js';
import Venue from './Venue.js';
import ShiftInstance from './ShiftInstance.js';
import PromotionRouteVersion from './PromotionRouteVersion.js';

@Table({
  tableName: 'promotion_team_assignments',
  modelName: 'PromotionTeamAssignment',
  timestamps: true,
  underscored: true,
})
export default class PromotionTeamAssignment extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.BIGINT)
  declare id: number;

  @ForeignKey(() => ShiftInstance)
  @AllowNull(false)
  @Column({ field: 'shift_instance_id', type: DataType.INTEGER })
  declare shiftInstanceId: number;

  @ForeignKey(() => PromotionRouteVersion)
  @AllowNull(false)
  @Column({ field: 'route_version_id', type: DataType.BIGINT })
  declare routeVersionId: number;

  @ForeignKey(() => Venue)
  @AllowNull(true)
  @Column({ field: 'hostel_venue_id', type: DataType.INTEGER })
  declare hostelVenueId: number | null;

  @AllowNull(true)
  @Column({ field: 'hostel_label', type: DataType.STRING(160) })
  declare hostelLabel: string | null;

  @AllowNull(false)
  @Column({ field: 'team_key', type: DataType.STRING(120) })
  declare teamKey: string;

  @AllowNull(true)
  @Column(DataType.TEXT)
  declare notes: string | null;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column({ field: 'created_by', type: DataType.INTEGER })
  declare createdBy: number | null;

  @BelongsTo(() => ShiftInstance, { foreignKey: 'shift_instance_id', as: 'shiftInstance' })
  declare shiftInstance?: NonAttribute<ShiftInstance | null>;

  @BelongsTo(() => PromotionRouteVersion, { foreignKey: 'route_version_id', as: 'routeVersion' })
  declare routeVersion?: NonAttribute<PromotionRouteVersion | null>;

  @BelongsTo(() => Venue, { foreignKey: 'hostel_venue_id', as: 'hostelVenue' })
  declare hostelVenue?: NonAttribute<Venue | null>;

  @BelongsTo(() => User, { foreignKey: 'created_by', as: 'createdByUser' })
  declare createdByUser?: NonAttribute<User | null>;
}

