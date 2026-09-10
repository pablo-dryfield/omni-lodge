import {
  AllowNull,
  AutoIncrement,
  BelongsTo,
  Column,
  DataType,
  ForeignKey,
  HasMany,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';
import type { NonAttribute } from 'sequelize';

import User from './User.js';
import ErrorMonitoringNote from './ErrorMonitoringNote.js';
import ErrorMonitoringOccurrence from './ErrorMonitoringOccurrence.js';

export type ErrorMonitoringSource = 'client' | 'server' | 'request' | 'process';
export type ErrorMonitoringLevel = 'warning' | 'error' | 'fatal';
export type ErrorMonitoringStatus = 'open' | 'investigating' | 'resolved' | 'ignored';

@Table({
  tableName: 'error_monitoring_issues',
  modelName: 'ErrorMonitoringIssue',
  timestamps: false,
})
export default class ErrorMonitoringIssue extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.BIGINT)
  declare id: number;

  @AllowNull(false)
  @Column(DataType.STRING(64))
  declare fingerprint: string;

  @AllowNull(false)
  @Column(DataType.STRING(24))
  declare source: ErrorMonitoringSource;

  @AllowNull(false)
  @Column(DataType.STRING(64))
  declare kind: string;

  @AllowNull(false)
  @Column(DataType.STRING(500))
  declare title: string;

  @AllowNull(false)
  @Column({ field: 'normalized_message', type: DataType.TEXT })
  declare normalizedMessage: string;

  @AllowNull(true)
  @Column(DataType.STRING(500))
  declare culprit: string | null;

  @AllowNull(false)
  @Column(DataType.STRING(16))
  declare severity: ErrorMonitoringLevel;

  @AllowNull(false)
  @Column(DataType.STRING(20))
  declare status: ErrorMonitoringStatus;

  @AllowNull(false)
  @Column({ field: 'first_seen_at', type: DataType.DATE })
  declare firstSeenAt: Date;

  @AllowNull(false)
  @Column({ field: 'last_seen_at', type: DataType.DATE })
  declare lastSeenAt: Date;

  @AllowNull(false)
  @Column({ field: 'occurrence_count', type: DataType.BIGINT })
  declare occurrenceCount: number;

  @AllowNull(false)
  @Column({ field: 'affected_user_count', type: DataType.INTEGER })
  declare affectedUserCount: number;

  @AllowNull(false)
  @Column({ field: 'reopened_count', type: DataType.INTEGER })
  declare reopenedCount: number;

  @AllowNull(true)
  @Column({ field: 'last_regressed_at', type: DataType.DATE })
  declare lastRegressedAt: Date | null;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column({ field: 'last_user_id', type: DataType.INTEGER })
  declare lastUserId: number | null;

  @AllowNull(true)
  @Column({ field: 'last_route', type: DataType.STRING(500) })
  declare lastRoute: string | null;

  @AllowNull(true)
  @Column({ field: 'last_page_url', type: DataType.TEXT })
  declare lastPageUrl: string | null;

  @AllowNull(true)
  @Column({ field: 'last_release', type: DataType.STRING(120) })
  declare lastRelease: string | null;

  @AllowNull(true)
  @Column({ field: 'last_environment', type: DataType.STRING(50) })
  declare lastEnvironment: string | null;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column({ field: 'assigned_to_user_id', type: DataType.INTEGER })
  declare assignedToUserId: number | null;

  @AllowNull(true)
  @Column({ field: 'status_changed_at', type: DataType.DATE })
  declare statusChangedAt: Date | null;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column({ field: 'status_changed_by_user_id', type: DataType.INTEGER })
  declare statusChangedByUserId: number | null;

  @AllowNull(true)
  @Column({ field: 'resolved_at', type: DataType.DATE })
  declare resolvedAt: Date | null;

  @AllowNull(false)
  @Column({ field: 'created_at', type: DataType.DATE })
  declare createdAt: Date;

  @AllowNull(false)
  @Column({ field: 'updated_at', type: DataType.DATE })
  declare updatedAt: Date;

  @BelongsTo(() => User, { foreignKey: 'lastUserId', as: 'lastUser' })
  declare lastUser?: NonAttribute<User | null>;

  @BelongsTo(() => User, { foreignKey: 'assignedToUserId', as: 'assignedTo' })
  declare assignedTo?: NonAttribute<User | null>;

  @BelongsTo(() => User, { foreignKey: 'statusChangedByUserId', as: 'statusChangedBy' })
  declare statusChangedBy?: NonAttribute<User | null>;

  @HasMany(() => ErrorMonitoringOccurrence, { foreignKey: 'issueId', as: 'occurrences' })
  declare occurrences?: NonAttribute<ErrorMonitoringOccurrence[]>;

  @HasMany(() => ErrorMonitoringNote, { foreignKey: 'issueId', as: 'notes' })
  declare notes?: NonAttribute<ErrorMonitoringNote[]>;
}
