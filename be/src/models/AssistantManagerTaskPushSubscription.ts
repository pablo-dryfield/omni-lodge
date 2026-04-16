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

@Table({
  tableName: 'am_task_push_subscriptions',
  modelName: 'AssistantManagerTaskPushSubscription',
  timestamps: true,
  underscored: true,
})
export default class AssistantManagerTaskPushSubscription extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @ForeignKey(() => User)
  @AllowNull(false)
  @Column({ field: 'user_id', type: DataType.INTEGER })
  declare userId: number;

  @AllowNull(false)
  @Column(DataType.TEXT)
  declare endpoint: string;

  @AllowNull(false)
  @Column(DataType.TEXT)
  declare p256dh: string;

  @AllowNull(false)
  @Column(DataType.TEXT)
  declare auth: string;

  @AllowNull(true)
  @Column({ field: 'expiration_time', type: DataType.BIGINT })
  declare expirationTime: string | null;

  @AllowNull(true)
  @Column({ field: 'user_agent', type: DataType.TEXT })
  declare userAgent: string | null;

  @AllowNull(false)
  @Default(true)
  @Column({ field: 'is_active', type: DataType.BOOLEAN })
  declare isActive: boolean;

  @AllowNull(true)
  @Column({ field: 'last_success_at', type: DataType.DATE })
  declare lastSuccessAt: Date | null;

  @AllowNull(true)
  @Column({ field: 'last_failure_at', type: DataType.DATE })
  declare lastFailureAt: Date | null;

  @AllowNull(true)
  @Column({ field: 'last_failure_reason', type: DataType.TEXT })
  declare lastFailureReason: string | null;

  @BelongsTo(() => User, { foreignKey: 'user_id', as: 'user' })
  declare user?: NonAttribute<User>;
}

