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
import User from './User.js';
import Venue from './Venue.js';
import NightReport from './NightReport.js';
import OpenBarDrinkIssue from './OpenBarDrinkIssue.js';
import OpenBarInventoryMovement from './OpenBarInventoryMovement.js';
import OpenBarSessionType from './OpenBarSessionType.js';
import OpenBarSessionMembership from './OpenBarSessionMembership.js';

export type OpenBarSessionStatus = 'draft' | 'active' | 'closed';

@Table({
  tableName: 'open_bar_sessions',
  modelName: 'OpenBarSession',
  timestamps: true,
  underscored: true,
})
export default class OpenBarSession extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @AllowNull(false)
  @Column({ field: 'session_name', type: DataType.STRING(160) })
  declare sessionName: string;

  @AllowNull(false)
  @Column({ field: 'business_date', type: DataType.DATEONLY })
  declare businessDate: string;

  @ForeignKey(() => Venue)
  @AllowNull(true)
  @Column({ field: 'venue_id', type: DataType.INTEGER })
  declare venueId: number | null;

  @ForeignKey(() => NightReport)
  @AllowNull(true)
  @Column({ field: 'night_report_id', type: DataType.INTEGER })
  declare nightReportId: number | null;

  @ForeignKey(() => OpenBarSessionType)
  @AllowNull(true)
  @Column({ field: 'session_type_id', type: DataType.INTEGER })
  declare sessionTypeId: number | null;

  @AllowNull(true)
  @Column({ field: 'time_limit_minutes', type: DataType.INTEGER })
  declare timeLimitMinutes: number | null;

  @AllowNull(false)
  @Default('draft')
  @Column({ field: 'status', type: DataType.ENUM('draft', 'active', 'closed') })
  declare status: OpenBarSessionStatus;

  @AllowNull(true)
  @Column({ field: 'opened_at', type: DataType.DATE })
  declare openedAt: Date | null;

  @AllowNull(true)
  @Column({ field: 'closed_at', type: DataType.DATE })
  declare closedAt: Date | null;

  @AllowNull(true)
  @Column(DataType.TEXT)
  declare notes: string | null;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column({ field: 'created_by', type: DataType.INTEGER })
  declare createdBy: number | null;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column({ field: 'updated_by', type: DataType.INTEGER })
  declare updatedBy: number | null;

  @BelongsTo(() => User, { foreignKey: 'created_by', as: 'createdByUser' })
  declare createdByUser?: User;

  @BelongsTo(() => User, { foreignKey: 'updated_by', as: 'updatedByUser' })
  declare updatedByUser?: User;

  @BelongsTo(() => Venue, { foreignKey: 'venue_id', as: 'venue' })
  declare venue?: Venue;

  @BelongsTo(() => NightReport, { foreignKey: 'night_report_id', as: 'nightReport' })
  declare nightReport?: NightReport;

  @BelongsTo(() => OpenBarSessionType, { foreignKey: 'session_type_id', as: 'sessionType' })
  declare sessionType?: any;

  @HasMany(() => OpenBarDrinkIssue, { foreignKey: 'session_id', as: 'issues' })
  declare issues?: OpenBarDrinkIssue[];

  @HasMany(() => OpenBarInventoryMovement, { foreignKey: 'session_id', as: 'movements' })
  declare movements?: OpenBarInventoryMovement[];

  @HasMany(() => OpenBarSessionMembership, { foreignKey: 'session_id', as: 'memberships' })
  declare memberships?: any[];
}
