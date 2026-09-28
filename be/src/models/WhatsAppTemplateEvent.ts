import {
  AllowNull,
  AutoIncrement,
  Column,
  DataType,
  Default,
  ForeignKey,
  Index,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';
import User from './User.js';
import WhatsAppTemplate from './WhatsAppTemplate.js';

@Table({
  timestamps: false,
  underscored: true,
  modelName: 'WhatsAppTemplateEvent',
  tableName: 'whatsapp_template_events',
})
export default class WhatsAppTemplateEvent extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.BIGINT)
  declare id: number;

  @ForeignKey(() => WhatsAppTemplate)
  @Index('whatsapp_template_events_template_time_idx')
  @AllowNull(true)
  @Column({ field: 'template_id', type: DataType.BIGINT })
  declare templateId: number | null;

  @Index('whatsapp_template_events_meta_time_idx')
  @AllowNull(false)
  @Column({ field: 'meta_template_id', type: DataType.STRING(64) })
  declare metaTemplateId: string;

  @AllowNull(false)
  @Column({ field: 'event_type', type: DataType.STRING(64) })
  declare eventType: string;

  @AllowNull(true)
  @Column({ field: 'event_value', type: DataType.STRING(128) })
  declare eventValue: string | null;

  @AllowNull(true)
  @Column({ field: 'previous_value', type: DataType.STRING(128) })
  declare previousValue: string | null;

  @AllowNull(false)
  @Column(DataType.STRING(24))
  declare source: 'webhook' | 'sync' | 'operation';

  @AllowNull(true)
  @Column(DataType.JSONB)
  declare payload: Record<string, unknown> | null;

  @Index({ name: 'whatsapp_template_events_fingerprint_key', unique: true })
  @AllowNull(true)
  @Column(DataType.STRING(64))
  declare fingerprint: string | null;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column({ field: 'actor_id', type: DataType.INTEGER })
  declare actorId: number | null;

  @Index('whatsapp_template_events_template_time_idx')
  @Index('whatsapp_template_events_meta_time_idx')
  @AllowNull(false)
  @Default(DataType.NOW)
  @Column({ field: 'occurred_at', type: DataType.DATE })
  declare occurredAt: Date;

  @AllowNull(false)
  @Default(DataType.NOW)
  @Column({ field: 'created_at', type: DataType.DATE })
  declare createdAt: Date;
}
