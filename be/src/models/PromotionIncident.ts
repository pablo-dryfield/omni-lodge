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
import PromotionSession from './PromotionSession.js';
import PromotionSessionParticipant from './PromotionSessionParticipant.js';

@Table({
  tableName: 'promotion_incidents',
  modelName: 'PromotionIncident',
  timestamps: true,
  underscored: true,
})
export default class PromotionIncident extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.BIGINT)
  declare id: number;

  @ForeignKey(() => PromotionSession)
  @AllowNull(false)
  @Column({ field: 'session_id', type: DataType.BIGINT })
  declare sessionId: number;

  @ForeignKey(() => PromotionSessionParticipant)
  @AllowNull(true)
  @Column({ field: 'participant_session_id', type: DataType.BIGINT })
  declare participantSessionId: number | null;

  @ForeignKey(() => User)
  @AllowNull(false)
  @Column({ field: 'reported_by', type: DataType.INTEGER })
  declare reportedBy: number;

  @AllowNull(false)
  @Column(DataType.STRING(48))
  declare category: string;

  @AllowNull(false)
  @Column(DataType.TEXT)
  declare reason: string;

  @AllowNull(false)
  @Default('open')
  @Column(DataType.STRING(24))
  declare status: 'open' | 'reviewed' | 'resolved';

  @AllowNull(false)
  @Default({})
  @Column({ field: 'evidence_json', type: DataType.JSONB })
  declare evidenceJson: Record<string, unknown>;

  @BelongsTo(() => PromotionSession, { foreignKey: 'session_id', as: 'session' })
  declare session?: NonAttribute<PromotionSession | null>;

  @BelongsTo(() => PromotionSessionParticipant, { foreignKey: 'participant_session_id', as: 'participant' })
  declare participant?: NonAttribute<PromotionSessionParticipant | null>;

  @BelongsTo(() => User, { foreignKey: 'reported_by', as: 'reporter' })
  declare reporter?: NonAttribute<User | null>;
}
