import {
  AllowNull,
  AutoIncrement,
  Column,
  DataType,
  ForeignKey,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';
import User from './User.js';

@Table({
  timestamps: true,
  modelName: 'CustomerEmailThreadParticipant',
  tableName: 'customer_email_thread_participants',
  underscored: true,
})
export default class CustomerEmailThreadParticipant extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @AllowNull(false)
  @Column({ field: 'thread_id', type: DataType.STRING(256) })
  declare threadId: string;

  @ForeignKey(() => User)
  @AllowNull(false)
  @Column({ field: 'user_id', type: DataType.INTEGER })
  declare userId: number;

  @AllowNull(true)
  @Column({ field: 'first_message_id', type: DataType.STRING(256) })
  declare firstMessageId: string | null;

  @AllowNull(true)
  @Column({ field: 'last_message_id', type: DataType.STRING(256) })
  declare lastMessageId: string | null;

  @AllowNull(false)
  @Column({ field: 'first_sent_at', type: DataType.DATE })
  declare firstSentAt: Date;

  @AllowNull(false)
  @Column({ field: 'last_sent_at', type: DataType.DATE })
  declare lastSentAt: Date;
}
