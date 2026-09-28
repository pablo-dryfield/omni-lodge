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
import ShiftInstance from './ShiftInstance.js';
import ShiftAssignment from './ShiftAssignment.js';
import PromotionRouteVersion from './PromotionRouteVersion.js';
import PromotionTeamAssignment from './PromotionTeamAssignment.js';
import PromotionSessionParticipant from './PromotionSessionParticipant.js';
import PromotionLocationSample from './PromotionLocationSample.js';
import PromotionCheckpointVisit from './PromotionCheckpointVisit.js';
import PromotionIncident from './PromotionIncident.js';
import PromotionManagerOverride from './PromotionManagerOverride.js';

export type PromotionLifecycleStatus = 'NOT_STARTED' | 'STREET_ACTIVE' | 'HOSTEL_ACTIVE' | 'COMPLETED' | 'ABORTED';
export type PromotionVerificationQuality = 'VERIFIED' | 'DEGRADED' | 'REVIEW_REQUIRED';

@Table({
  tableName: 'promotion_sessions',
  modelName: 'PromotionSession',
  timestamps: true,
  underscored: true,
})
export default class PromotionSession extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.BIGINT)
  declare id: number;

  @ForeignKey(() => ShiftInstance)
  @AllowNull(false)
  @Column({ field: 'shift_instance_id', type: DataType.INTEGER })
  declare shiftInstanceId: number;

  @ForeignKey(() => ShiftAssignment)
  @AllowNull(false)
  @Column({ field: 'assignment_id', type: DataType.INTEGER })
  declare assignmentId: number;

  @ForeignKey(() => PromotionTeamAssignment)
  @AllowNull(false)
  @Column({ field: 'team_assignment_id', type: DataType.BIGINT })
  declare teamAssignmentId: number;

  @ForeignKey(() => PromotionRouteVersion)
  @AllowNull(false)
  @Column({ field: 'route_version_id', type: DataType.BIGINT })
  declare routeVersionId: number;

  @ForeignKey(() => User)
  @AllowNull(false)
  @Column({ field: 'started_by', type: DataType.INTEGER })
  declare startedBy: number;

  @AllowNull(false)
  @Default('STREET_ACTIVE')
  @Column(DataType.STRING(24))
  declare lifecycle: PromotionLifecycleStatus;

  @AllowNull(false)
  @Default('VERIFIED')
  @Column({ field: 'verification_quality', type: DataType.STRING(24) })
  declare verificationQuality: PromotionVerificationQuality;

  @AllowNull(false)
  @Default(1)
  @Column({ field: 'session_version', type: DataType.INTEGER })
  declare sessionVersion: number;

  @AllowNull(false)
  @Column({ field: 'idempotency_key', type: DataType.STRING(160) })
  declare idempotencyKey: string;

  @AllowNull(true)
  @Column({ field: 'first_accepted_proof_at', type: DataType.DATE })
  declare firstAcceptedProofAt: Date | null;

  @AllowNull(true)
  @Column({ field: 'street_started_at', type: DataType.DATE })
  declare streetStartedAt: Date | null;

  @AllowNull(true)
  @Column({ field: 'street_completed_at', type: DataType.DATE })
  declare streetCompletedAt: Date | null;

  @AllowNull(true)
  @Column({ field: 'hostel_started_at', type: DataType.DATE })
  declare hostelStartedAt: Date | null;

  @AllowNull(true)
  @Column({ field: 'completed_at', type: DataType.DATE })
  declare completedAt: Date | null;

  @AllowNull(true)
  @Column({ field: 'aborted_at', type: DataType.DATE })
  declare abortedAt: Date | null;

  @AllowNull(true)
  @Column({ field: 'actual_street_duration_seconds', type: DataType.INTEGER })
  declare actualStreetDurationSeconds: number | null;

  @AllowNull(true)
  @Column({ field: 'actual_hostel_duration_seconds', type: DataType.INTEGER })
  declare actualHostelDurationSeconds: number | null;

  @AllowNull(false)
  @Default([])
  @Column({ field: 'quality_flags', type: DataType.JSONB })
  declare qualityFlags: string[];

  @AllowNull(false)
  @Default({})
  @Column({ field: 'server_metadata', type: DataType.JSONB })
  declare serverMetadata: Record<string, unknown>;

  @BelongsTo(() => ShiftInstance, { foreignKey: 'shift_instance_id', as: 'shiftInstance' })
  declare shiftInstance?: NonAttribute<ShiftInstance | null>;

  @BelongsTo(() => ShiftAssignment, { foreignKey: 'assignment_id', as: 'assignment' })
  declare assignment?: NonAttribute<ShiftAssignment | null>;

  @BelongsTo(() => PromotionTeamAssignment, { foreignKey: 'team_assignment_id', as: 'teamAssignment' })
  declare teamAssignment?: NonAttribute<PromotionTeamAssignment | null>;

  @BelongsTo(() => PromotionRouteVersion, { foreignKey: 'route_version_id', as: 'routeVersion' })
  declare routeVersion?: NonAttribute<PromotionRouteVersion | null>;

  @BelongsTo(() => User, { foreignKey: 'started_by', as: 'startedByUser' })
  declare startedByUser?: NonAttribute<User | null>;

  @HasMany(() => PromotionSessionParticipant, { foreignKey: 'session_id', as: 'participants' })
  declare participants?: NonAttribute<PromotionSessionParticipant[]>;

  @HasMany(() => PromotionLocationSample, { foreignKey: 'session_id', as: 'locationSamples' })
  declare locationSamples?: NonAttribute<PromotionLocationSample[]>;

  @HasMany(() => PromotionCheckpointVisit, { foreignKey: 'session_id', as: 'checkpointVisits' })
  declare checkpointVisits?: NonAttribute<PromotionCheckpointVisit[]>;

  @HasMany(() => PromotionIncident, { foreignKey: 'session_id', as: 'incidents' })
  declare incidents?: NonAttribute<PromotionIncident[]>;

  @HasMany(() => PromotionManagerOverride, { foreignKey: 'session_id', as: 'managerOverrides' })
  declare managerOverrides?: NonAttribute<PromotionManagerOverride[]>;
}
