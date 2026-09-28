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
import type { PromotionPhase } from './PromotionRouteCheckpoint.js';

@Table({
  tableName: 'promotion_location_samples',
  modelName: 'PromotionLocationSample',
  timestamps: true,
  underscored: true,
})
export default class PromotionLocationSample extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.BIGINT)
  declare id: number;

  @ForeignKey(() => PromotionSession)
  @AllowNull(false)
  @Column({ field: 'session_id', type: DataType.BIGINT })
  declare sessionId: number;

  @ForeignKey(() => PromotionSessionParticipant)
  @AllowNull(false)
  @Column({ field: 'participant_session_id', type: DataType.BIGINT })
  declare participantSessionId: number;

  @ForeignKey(() => User)
  @AllowNull(false)
  @Column({ field: 'user_id', type: DataType.INTEGER })
  declare userId: number;

  @AllowNull(false)
  @Column({ field: 'event_id', type: DataType.UUID })
  declare eventId: string;

  @AllowNull(false)
  @Column(DataType.BIGINT)
  declare sequence: number;

  @AllowNull(false)
  @Column({ field: 'captured_at', type: DataType.DATE })
  declare capturedAt: Date;

  @AllowNull(false)
  @Column({ field: 'elapsed_realtime_nanos', type: DataType.STRING(32) })
  declare elapsedRealtimeNanos: string;

  @AllowNull(false)
  @Column({ field: 'boot_id', type: DataType.STRING(128) })
  declare bootId: string;

  @AllowNull(false)
  @Column(DataType.DOUBLE)
  declare latitude: number;

  @AllowNull(false)
  @Column(DataType.DOUBLE)
  declare longitude: number;

  @AllowNull(false)
  @Column({ field: 'horizontal_accuracy_meters', type: DataType.DOUBLE })
  declare horizontalAccuracyMeters: number;

  @AllowNull(true)
  @Column({ field: 'speed_meters_per_second', type: DataType.DOUBLE })
  declare speedMetersPerSecond: number | null;

  @AllowNull(true)
  @Column({ field: 'bearing_degrees', type: DataType.DOUBLE })
  declare bearingDegrees: number | null;

  @AllowNull(false)
  @Column(DataType.STRING(16))
  declare phase: PromotionPhase;

  @AllowNull(true)
  @Column({ field: 'mock_location_signal', type: DataType.BOOLEAN })
  declare mockLocationSignal: boolean | null;

  @AllowNull(false)
  @Default([])
  @Column({ field: 'review_flags', type: DataType.JSONB })
  declare reviewFlags: string[];

  @AllowNull(false)
  @Default(DataType.NOW)
  @Column({ field: 'server_received_at', type: DataType.DATE })
  declare serverReceivedAt: Date;

  @BelongsTo(() => PromotionSession, { foreignKey: 'session_id', as: 'session' })
  declare session?: NonAttribute<PromotionSession | null>;

  @BelongsTo(() => PromotionSessionParticipant, { foreignKey: 'participant_session_id', as: 'participant' })
  declare participant?: NonAttribute<PromotionSessionParticipant | null>;

  @BelongsTo(() => User, { foreignKey: 'user_id', as: 'user' })
  declare user?: NonAttribute<User | null>;
}
