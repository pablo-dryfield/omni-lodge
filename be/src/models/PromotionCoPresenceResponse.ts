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
import PromotionCoPresenceChallenge from './PromotionCoPresenceChallenge.js';
import type { PromotionVerificationQuality } from './PromotionSession.js';

export type PromotionCoPresenceResponseStatus = 'accepted' | 'rejected' | 'review_required';
export type PromotionCoPresenceResponseKind = 'own_device' | 'group_selfie_fallback';

@Table({
  tableName: 'promotion_copresence_responses',
  modelName: 'PromotionCoPresenceResponse',
  timestamps: true,
  underscored: true,
})
export default class PromotionCoPresenceResponse extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.BIGINT)
  declare id: number;

  @ForeignKey(() => PromotionCoPresenceChallenge)
  @AllowNull(false)
  @Column({ field: 'challenge_id', type: DataType.BIGINT })
  declare challengeId: number;

  @ForeignKey(() => ShiftAssignment)
  @AllowNull(false)
  @Column({ field: 'shift_assignment_id', type: DataType.INTEGER })
  declare shiftAssignmentId: number;

  @ForeignKey(() => User)
  @AllowNull(false)
  @Column({ field: 'user_id', type: DataType.INTEGER })
  declare userId: number;

  @AllowNull(false)
  @Default('own_device')
  @Column({ field: 'response_kind', type: DataType.STRING(32) })
  declare responseKind: PromotionCoPresenceResponseKind;

  @AllowNull(false)
  @Default('review_required')
  @Column(DataType.STRING(24))
  declare status: PromotionCoPresenceResponseStatus;

  @AllowNull(false)
  @Default('REVIEW_REQUIRED')
  @Column({ field: 'verification_quality', type: DataType.STRING(24) })
  declare verificationQuality: PromotionVerificationQuality;

  @AllowNull(false)
  @Column({ field: 'responded_at', type: DataType.DATE })
  declare respondedAt: Date;

  @AllowNull(true)
  @Column(DataType.DOUBLE)
  declare latitude: number | null;

  @AllowNull(true)
  @Column(DataType.DOUBLE)
  declare longitude: number | null;

  @AllowNull(true)
  @Column({ field: 'horizontal_accuracy_meters', type: DataType.DOUBLE })
  declare horizontalAccuracyMeters: number | null;

  @AllowNull(true)
  @Column({ field: 'distance_from_start_meters', type: DataType.DOUBLE })
  declare distanceFromStartMeters: number | null;

  @AllowNull(true)
  @Column({ field: 'rejection_reason', type: DataType.TEXT })
  declare rejectionReason: string | null;

  @AllowNull(true)
  @Column({ field: 'photo_evidence_ref', type: DataType.STRING(255) })
  declare photoEvidenceRef: string | null;

  @AllowNull(false)
  @Default({})
  @Column({ field: 'proof_metadata', type: DataType.JSONB })
  declare proofMetadata: Record<string, unknown>;

  @BelongsTo(() => PromotionCoPresenceChallenge, { foreignKey: 'challenge_id', as: 'challenge' })
  declare challenge?: NonAttribute<PromotionCoPresenceChallenge | null>;

  @BelongsTo(() => ShiftAssignment, { foreignKey: 'shift_assignment_id', as: 'shiftAssignment' })
  declare shiftAssignment?: NonAttribute<ShiftAssignment | null>;

  @BelongsTo(() => User, { foreignKey: 'user_id', as: 'user' })
  declare user?: NonAttribute<User | null>;
}
