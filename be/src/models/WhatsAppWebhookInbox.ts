import {
  AllowNull,
  AutoIncrement,
  Column,
  DataType,
  Default,
  Index,
  Model,
  PrimaryKey,
  Table,
  Unique,
} from 'sequelize-typescript';

@Table({
  timestamps: true,
  modelName: 'WhatsAppWebhookInbox',
  tableName: 'whatsapp_webhook_inbox',
  underscored: true,
})
export default class WhatsAppWebhookInbox extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.BIGINT)
  declare id: number;

  @Unique
  @AllowNull(false)
  @Column({ field: 'delivery_hash', type: DataType.STRING(64) })
  declare deliveryHash: string;

  @AllowNull(false)
  @Column({ field: 'payload_ciphertext', type: DataType.BLOB })
  declare payloadCiphertext: Buffer;

  @AllowNull(false)
  @Column({ field: 'payload_iv', type: DataType.BLOB })
  declare payloadIv: Buffer;

  @AllowNull(false)
  @Column({ field: 'payload_auth_tag', type: DataType.BLOB })
  declare payloadAuthTag: Buffer;

  @AllowNull(false)
  @Column({ field: 'encryption_key_id', type: DataType.STRING(64) })
  declare encryptionKeyId: string;

  @AllowNull(false)
  @Column({ field: 'onboarding_generation', type: DataType.STRING(64) })
  declare onboardingGeneration: string;

  @Index('whatsapp_webhook_inbox_ready_idx')
  @AllowNull(false)
  @Default('queued')
  @Column(DataType.STRING(16))
  declare status: 'queued' | 'processing' | 'failed';

  @AllowNull(false)
  @Default(0)
  @Column({ field: 'attempt_count', type: DataType.INTEGER })
  declare attemptCount: number;

  @Index('whatsapp_webhook_inbox_ready_idx')
  @AllowNull(false)
  @Column({ field: 'next_attempt_at', type: DataType.DATE })
  declare nextAttemptAt: Date;

  @AllowNull(false)
  @Column({ field: 'received_at', type: DataType.DATE })
  declare receivedAt: Date;

  @AllowNull(true)
  @Column({ field: 'last_error_code', type: DataType.STRING(64) })
  declare lastErrorCode: string | null;

  @AllowNull(true)
  @Column({ field: 'lease_token', type: DataType.STRING(64) })
  declare leaseToken: string | null;
}
