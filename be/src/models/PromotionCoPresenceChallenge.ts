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
import PromotionTeamAssignment from './PromotionTeamAssignment.js';
import PromotionSession from './PromotionSession.js';
import PromotionCoPresenceResponse from './PromotionCoPresenceResponse.js';

export type PromotionCoPresenceChallengeStatus = 'active' | 'used' | 'expired' | 'revoked';

@Table({
  tableName: 'promotion_copresence_challenges',
  modelName: 'PromotionCoPresenceChallenge',
  timestamps: true,
  underscored: true,
})
export default class PromotionCoPresenceChallenge extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.BIGINT)
  declare id: number;

  @ForeignKey(() => PromotionTeamAssignment)
  @AllowNull(false)
  @Column({ field: 'team_assignment_id', type: DataType.BIGINT })
  declare teamAssignmentId: number;

  @ForeignKey(() => PromotionSession)
  @AllowNull(true)
  @Column({ field: 'session_id', type: DataType.BIGINT })
  declare sessionId: number | null;

  @ForeignKey(() => User)
  @AllowNull(false)
  @Column({ field: 'issued_by', type: DataType.INTEGER })
  declare issuedBy: number;

  @AllowNull(false)
  @Column({ field: 'nonce_hash', type: DataType.STRING(128) })
  declare nonceHash: string;

  @AllowNull(false)
  @Column({ field: 'expires_at', type: DataType.DATE })
  declare expiresAt: Date;

  @AllowNull(true)
  @Column({ field: 'used_at', type: DataType.DATE })
  declare usedAt: Date | null;

  @AllowNull(false)
  @Default('active')
  @Column(DataType.STRING(16))
  declare status: PromotionCoPresenceChallengeStatus;

  @AllowNull(false)
  @Default({})
  @Column(DataType.JSONB)
  declare metadata: Record<string, unknown>;

  @BelongsTo(() => PromotionTeamAssignment, { foreignKey: 'team_assignment_id', as: 'teamAssignment' })
  declare teamAssignment?: NonAttribute<PromotionTeamAssignment | null>;

  @BelongsTo(() => PromotionSession, { foreignKey: 'session_id', as: 'session' })
  declare session?: NonAttribute<PromotionSession | null>;

  @BelongsTo(() => User, { foreignKey: 'issued_by', as: 'issuer' })
  declare issuer?: NonAttribute<User | null>;

  @HasMany(() => PromotionCoPresenceResponse, { foreignKey: 'challenge_id', as: 'responses' })
  declare responses?: NonAttribute<PromotionCoPresenceResponse[]>;
}
