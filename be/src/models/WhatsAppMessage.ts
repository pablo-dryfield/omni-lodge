import {
  AllowNull,
  AutoIncrement,
  Column,
  DataType,
  Index,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';

@Table({
  timestamps: true,
  modelName: 'WhatsAppMessage',
  tableName: 'whatsapp_messages',
  underscored: true,
})
export default class WhatsAppMessage extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.BIGINT)
  declare id: number;

  @Index({ name: 'whatsapp_messages_phone_provider_unique', unique: true })
  @AllowNull(false)
  @Column({ field: 'phone_number_id', type: DataType.STRING(64) })
  declare phoneNumberId: string;

  @Index({ name: 'whatsapp_messages_phone_provider_unique', unique: true })
  @AllowNull(false)
  @Column({ field: 'provider_message_id', type: DataType.STRING(256) })
  declare providerMessageId: string;

  @AllowNull(false)
  @Column(DataType.STRING(16))
  declare direction: 'inbound' | 'outbound';

  @AllowNull(false)
  @Column(DataType.STRING(32))
  declare source: 'messages' | 'history' | 'smb_message_echoes';

  @AllowNull(false)
  @Column({ field: 'message_type', type: DataType.STRING(64) })
  declare messageType: string;

  @AllowNull(true)
  @Column({ field: 'contact_key', type: DataType.STRING(64) })
  declare contactKey: string | null;

  @AllowNull(true)
  @Column({ field: 'contact_phone_suffix', type: DataType.STRING(8) })
  declare contactPhoneSuffix: string | null;

  @AllowNull(true)
  @Column({ field: 'contact_display_name', type: DataType.STRING(256) })
  declare contactDisplayName: string | null;

  @AllowNull(true)
  @Column({ field: 'text_content', type: DataType.TEXT })
  declare textContent: string | null;

  @AllowNull(true)
  @Column({ field: 'context_provider_message_id', type: DataType.STRING(256) })
  declare contextProviderMessageId: string | null;

  @AllowNull(false)
  @Column({ field: 'occurred_at', type: DataType.DATE })
  declare occurredAt: Date;

  @AllowNull(true)
  @Column({ field: 'content_updated_at', type: DataType.DATE })
  declare contentUpdatedAt: Date | null;

  @AllowNull(true)
  @Column({ field: 'delivery_status', type: DataType.STRING(32) })
  declare deliveryStatus: string | null;

  @AllowNull(true)
  @Column({ field: 'status_updated_at', type: DataType.DATE })
  declare statusUpdatedAt: Date | null;

  @AllowNull(true)
  @Column({ field: 'edited_at', type: DataType.DATE })
  declare editedAt: Date | null;

  @AllowNull(true)
  @Column({ field: 'revoked_at', type: DataType.DATE })
  declare revokedAt: Date | null;
}
