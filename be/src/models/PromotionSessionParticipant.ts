import {
  AllowNull,
  AutoIncrement,
  BelongsTo,
  Column,
  DataType,
  Default,
  ForeignKey,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';
import type { NonAttribute } from 'sequelize';
import User from './User.js';
import ShiftAssignment from './ShiftAssignment.js';
import PromotionSession, { type PromotionVerificationQuality } from './PromotionSession.js';

export type PromotionParticipantProofStatus = 'pending' | 'own_device' | 'group_selfie_review' | 'manager_override';

@Table({
  tableName: 'promotion_session_participants',
  modelName: 'PromotionSessionParticipant',
  timestamps: true,
  underscored: true,
})
export default class PromotionSessionParticipant extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.BIGINT)
  declare id: number;

  @ForeignKey(() => PromotionSession)
  @AllowNull(false)
  @Column({ field: 'session_id', type: DataType.BIGINT })
  declare sessionId: number;

  @ForeignKey(() => ShiftAssignment)
  @AllowNull(false)
  @Column({ field: 'shift_assignment_id', type: DataType.INTEGER })
  declare shiftAssignmentId: number;

  @ForeignKey(() => User)
  @AllowNull(false)
  @Column({ field: 'user_id', type: DataType.INTEGER })
  declare userId: number;

  @AllowNull(false)
  @Default('pending')
  @Column({ field: 'proof_status', type: DataType.STRING(32) })
  declare proofStatus: PromotionParticipantProofStatus;

  @AllowNull(false)
  @Default('REVIEW_REQUIRED')
  @Column({ field: 'verification_quality', type: DataType.STRING(24) })
  declare verificationQuality: PromotionVerificationQuality;

  @AllowNull(true)
  @Column({ field: 'proof_received_at', type: DataType.DATE })
  declare proofReceivedAt: Date | null;

  @AllowNull(true)
  @Column({ field: 'last_heartbeat_at', type: DataType.DATE })
  declare lastHeartbeatAt: Date | null;

  @AllowNull(true)
  @Column({ field: 'last_sequence', type: DataType.BIGINT })
  declare lastSequence: number | null;

  @AllowNull(false)
  @Default({})
  @Column({ field: 'proof_metadata', type: DataType.JSONB })
  declare proofMetadata: Record<string, unknown>;

  @BelongsTo(() => PromotionSession, { foreignKey: 'session_id', as: 'session' })
  declare session?: NonAttribute<PromotionSession | null>;

  @BelongsTo(() => ShiftAssignment, { foreignKey: 'shift_assignment_id', as: 'shiftAssignment' })
  declare shiftAssignment?: NonAttribute<ShiftAssignment | null>;

  @BelongsTo(() => User, { foreignKey: 'user_id', as: 'user' })
  declare user?: NonAttribute<User | null>;
}
