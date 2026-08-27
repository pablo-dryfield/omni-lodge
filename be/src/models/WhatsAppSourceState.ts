import {
  AllowNull,
  Column,
  DataType,
  Default,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';

@Table({
  timestamps: true,
  modelName: 'WhatsAppSourceState',
  tableName: 'whatsapp_source_state',
  underscored: true,
})
export default class WhatsAppSourceState extends Model {
  @PrimaryKey
  @Default(1)
  @Column(DataType.SMALLINT)
  declare id: number;

  @AllowNull(false)
  @Default('unavailable')
  @Column(DataType.STRING(32))
  declare status: 'unavailable' | 'connected' | 'degraded';

  @AllowNull(false)
  @Default('not_started')
  @Column({ field: 'history_sync_status', type: DataType.STRING(32) })
  declare historySyncStatus: 'not_started' | 'in_progress' | 'complete' | 'failed';

  @AllowNull(true)
  @Column({ field: 'history_sync_progress', type: DataType.SMALLINT })
  declare historySyncProgress: number | null;

  @AllowNull(true)
  @Column({ field: 'last_webhook_at', type: DataType.DATE })
  declare lastWebhookAt: Date | null;

  @AllowNull(true)
  @Column({ field: 'last_successful_ingest_at', type: DataType.DATE })
  declare lastSuccessfulIngestAt: Date | null;

  @AllowNull(true)
  @Column({ field: 'last_message_at', type: DataType.DATE })
  declare lastMessageAt: Date | null;

  @AllowNull(true)
  @Column({ field: 'last_error_at', type: DataType.DATE })
  declare lastErrorAt: Date | null;

  @AllowNull(true)
  @Column({ field: 'last_error_code', type: DataType.STRING(64) })
  declare lastErrorCode: string | null;

  @AllowNull(true)
  @Column({ field: 'onboarding_generation', type: DataType.STRING(64) })
  declare onboardingGeneration: string | null;

  @AllowNull(true)
  @Column({ field: 'disconnected_generation', type: DataType.STRING(64) })
  declare disconnectedGeneration: string | null;
}
