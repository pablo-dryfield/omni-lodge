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

import User from './User.js';
import ErrorMonitoringIssue, { type ErrorMonitoringLevel, type ErrorMonitoringSource } from './ErrorMonitoringIssue.js';

@Table({
  tableName: 'error_monitoring_occurrences',
  modelName: 'ErrorMonitoringOccurrence',
  timestamps: false,
})
export default class ErrorMonitoringOccurrence extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.BIGINT)
  declare id: number;

  @AllowNull(false)
  @Column({ field: 'event_id', type: DataType.UUID })
  declare eventId: string;

  @AllowNull(true)
  @Column({ field: 'client_event_id', type: DataType.STRING(128) })
  declare clientEventId: string | null;

  @ForeignKey(() => ErrorMonitoringIssue)
  @AllowNull(false)
  @Column({ field: 'issue_id', type: DataType.BIGINT })
  declare issueId: number;

  @AllowNull(false)
  @Column(DataType.STRING(24))
  declare source: ErrorMonitoringSource;

  @AllowNull(false)
  @Column(DataType.STRING(64))
  declare kind: string;

  @AllowNull(false)
  @Column(DataType.STRING(16))
  declare level: ErrorMonitoringLevel;

  @AllowNull(false)
  @Column({ field: 'event_count', type: DataType.INTEGER })
  declare eventCount: number;

  @AllowNull(true)
  @Column({ field: 'error_name', type: DataType.STRING(160) })
  declare errorName: string | null;

  @AllowNull(false)
  @Column(DataType.TEXT)
  declare message: string;

  @AllowNull(true)
  @Column(DataType.TEXT)
  declare stack: string | null;

  @AllowNull(true)
  @Column({ field: 'component_stack', type: DataType.TEXT })
  declare componentStack: string | null;

  @AllowNull(false)
  @Column({ field: 'occurred_at', type: DataType.DATE })
  declare occurredAt: Date;

  @AllowNull(false)
  @Column({ field: 'received_at', type: DataType.DATE })
  declare receivedAt: Date;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column({ field: 'user_id', type: DataType.INTEGER })
  declare userId: number | null;

  @AllowNull(true)
  @Column({ field: 'session_id_hash', type: DataType.STRING(64) })
  declare sessionIdHash: string | null;

  @AllowNull(true)
  @Column({ field: 'request_id', type: DataType.STRING(100) })
  declare requestId: string | null;

  @AllowNull(true)
  @Column({ field: 'http_method', type: DataType.STRING(12) })
  declare httpMethod: string | null;

  @AllowNull(true)
  @Column({ field: 'http_url_path', type: DataType.TEXT })
  declare httpUrlPath: string | null;

  @AllowNull(true)
  @Column({ field: 'http_status', type: DataType.INTEGER })
  declare httpStatus: number | null;

  @AllowNull(true)
  @Column({ field: 'duration_ms', type: DataType.DECIMAL(12, 3) })
  declare durationMs: number | null;

  @AllowNull(true)
  @Column({ field: 'response_size_bytes', type: DataType.BIGINT })
  declare responseSizeBytes: number | null;

  @AllowNull(true)
  @Column({ field: 'page_url_path', type: DataType.TEXT })
  declare pageUrlPath: string | null;

  @AllowNull(true)
  @Column(DataType.STRING(500))
  declare route: string | null;

  @AllowNull(true)
  @Column(DataType.STRING(120))
  declare release: string | null;

  @AllowNull(true)
  @Column(DataType.STRING(50))
  declare environment: string | null;

  @AllowNull(true)
  @Column({ field: 'user_agent', type: DataType.STRING(1000) })
  declare userAgent: string | null;

  @AllowNull(true)
  @Column({ field: 'ip_hash', type: DataType.STRING(64) })
  declare ipHash: string | null;

  @AllowNull(true)
  @Column({ field: 'context_json', type: DataType.JSONB })
  declare context: Record<string, unknown> | null;

  @AllowNull(true)
  @Column({ field: 'tags_json', type: DataType.JSONB })
  declare tags: Record<string, unknown> | null;

  @AllowNull(true)
  @Column({ field: 'breadcrumbs_json', type: DataType.JSONB })
  declare breadcrumbs: Array<Record<string, unknown>> | null;

  @AllowNull(false)
  @Column({ field: 'created_at', type: DataType.DATE })
  declare createdAt: Date;

  @BelongsTo(() => ErrorMonitoringIssue, { foreignKey: 'issueId', as: 'issue' })
  declare issue?: ErrorMonitoringIssue;

  @BelongsTo(() => User, { foreignKey: 'userId', as: 'user' })
  declare user?: User | null;
}
