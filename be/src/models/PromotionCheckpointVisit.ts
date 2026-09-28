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
import PromotionSession from './PromotionSession.js';
import PromotionRouteCheckpoint, { type PromotionPhase } from './PromotionRouteCheckpoint.js';

@Table({
  tableName: 'promotion_checkpoint_visits',
  modelName: 'PromotionCheckpointVisit',
  timestamps: true,
  underscored: true,
})
export default class PromotionCheckpointVisit extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.BIGINT)
  declare id: number;

  @ForeignKey(() => PromotionSession)
  @AllowNull(false)
  @Column({ field: 'session_id', type: DataType.BIGINT })
  declare sessionId: number;

  @ForeignKey(() => PromotionRouteCheckpoint)
  @AllowNull(false)
  @Column({ field: 'route_checkpoint_id', type: DataType.BIGINT })
  declare routeCheckpointId: number;

  @AllowNull(false)
  @Column(DataType.STRING(16))
  declare phase: PromotionPhase;

  @AllowNull(false)
  @Column(DataType.INTEGER)
  declare sequence: number;

  @AllowNull(false)
  @Column({ field: 'accepted_at', type: DataType.DATE })
  declare acceptedAt: Date;

  @AllowNull(false)
  @Column({ field: 'dwell_seconds', type: DataType.INTEGER })
  declare dwellSeconds: number;

  @AllowNull(false)
  @Column({ field: 'idempotency_key', type: DataType.STRING(160) })
  declare idempotencyKey: string;

  @AllowNull(false)
  @Default({})
  @Column({ field: 'evidence_json', type: DataType.JSONB })
  declare evidenceJson: Record<string, unknown>;

  @BelongsTo(() => PromotionSession, { foreignKey: 'session_id', as: 'session' })
  declare session?: NonAttribute<PromotionSession | null>;

  @BelongsTo(() => PromotionRouteCheckpoint, { foreignKey: 'route_checkpoint_id', as: 'routeCheckpoint' })
  declare routeCheckpoint?: NonAttribute<PromotionRouteCheckpoint | null>;
}
