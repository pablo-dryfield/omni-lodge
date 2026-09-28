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
import type { NonAttribute } from 'sequelize';
import User from './User.js';
import PromotionSession from './PromotionSession.js';

@Table({
  tableName: 'promotion_manager_overrides',
  modelName: 'PromotionManagerOverride',
  timestamps: true,
  underscored: true,
  updatedAt: false,
})
export default class PromotionManagerOverride extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.BIGINT)
  declare id: number;

  @ForeignKey(() => PromotionSession)
  @AllowNull(false)
  @Column({ field: 'session_id', type: DataType.BIGINT })
  declare sessionId: number;

  @ForeignKey(() => User)
  @AllowNull(false)
  @Column({ field: 'actor_id', type: DataType.INTEGER })
  declare actorId: number;

  @AllowNull(false)
  @Column({ field: 'override_type', type: DataType.STRING(64) })
  declare overrideType: string;

  @AllowNull(false)
  @Column(DataType.TEXT)
  declare reason: string;

  @AllowNull(false)
  @Column({ field: 'before_json', type: DataType.JSONB })
  declare beforeJson: Record<string, unknown>;

  @AllowNull(false)
  @Column({ field: 'after_json', type: DataType.JSONB })
  declare afterJson: Record<string, unknown>;

  @BelongsTo(() => PromotionSession, { foreignKey: 'session_id', as: 'session' })
  declare session?: NonAttribute<PromotionSession | null>;

  @BelongsTo(() => User, { foreignKey: 'actor_id', as: 'actor' })
  declare actor?: NonAttribute<User | null>;
}
