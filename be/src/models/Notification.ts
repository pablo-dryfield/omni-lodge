import {
  Model,
  Table,
  Column,
  PrimaryKey,
  AutoIncrement,
  AllowNull,
  DataType,
  ForeignKey,
  BelongsTo,
  Default,
} from 'sequelize-typescript';
import User from './User.js';

export type NotificationChannel = 'in_app' | 'email';

@Table({
  tableName: 'notifications',
  modelName: 'Notification',
  timestamps: false,
})
export default class Notification extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @ForeignKey(() => User)
  @AllowNull(false)
  @Column({ field: 'user_id', type: DataType.INTEGER })
  declare userId: number;

  @AllowNull(false)
  @Column({ type: DataType.ENUM('in_app', 'email') })
  declare channel: NotificationChannel;

  @AllowNull(false)
  @Column({ field: 'template_key', type: DataType.STRING(120) })
  declare templateKey: string;

  @AllowNull(true)
  @Column({ field: 'payload_json', type: DataType.JSONB })
  declare payloadJson: Record<string, unknown> | null;

  @AllowNull(false)
  @Default(DataType.NOW)
  @Column({ field: 'sent_at', type: DataType.DATE })
  declare sentAt: Date;

  @BelongsTo(() => User, { foreignKey: 'user_id', as: 'user' })
  declare user?: User;
}
