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

@Table({
  timestamps: true,
  underscored: true,
  modelName: 'WhatsAppTemplate',
  tableName: 'whatsapp_templates',
})
export default class WhatsAppTemplate extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.BIGINT)
  declare id: number;

  @Index({ name: 'whatsapp_templates_waba_meta_key', unique: true })
  @Index('whatsapp_templates_waba_name_language_idx')
  @AllowNull(false)
  @Column({ field: 'waba_id', type: DataType.STRING(64) })
  declare wabaId: string;

  @Index({ name: 'whatsapp_templates_waba_meta_key', unique: true })
  @AllowNull(false)
  @Column({ field: 'meta_template_id', type: DataType.STRING(64) })
  declare metaTemplateId: string;

  @Index('whatsapp_templates_waba_name_language_idx')
  @AllowNull(false)
  @Column(DataType.STRING(512))
  declare name: string;

  @Index('whatsapp_templates_waba_name_language_idx')
  @AllowNull(false)
  @Column(DataType.STRING(32))
  declare language: string;

  @AllowNull(false)
  @Column(DataType.STRING(32))
  declare category: string;

  @AllowNull(false)
  @Column(DataType.STRING(32))
  declare status: string;

  @AllowNull(true)
  @Column({ field: 'quality_score', type: DataType.STRING(16) })
  declare qualityScore: string | null;

  @AllowNull(false)
  @Default('POSITIONAL')
  @Column({ field: 'parameter_format', type: DataType.STRING(16) })
  declare parameterFormat: string;

  @AllowNull(false)
  @Default([])
  @Column(DataType.JSONB)
  declare components: Record<string, unknown>[];

  @AllowNull(false)
  @Default({})
  @Column({ field: 'booking_bindings', type: DataType.JSONB })
  declare bookingBindings: Record<string, unknown>;

  @AllowNull(true)
  @Column({ field: 'message_send_ttl_seconds', type: DataType.INTEGER })
  declare messageSendTtlSeconds: number | null;

  @AllowNull(true)
  @Column({ field: 'previous_category', type: DataType.STRING(32) })
  declare previousCategory: string | null;

  @AllowNull(true)
  @Column({ field: 'correct_category', type: DataType.STRING(32) })
  declare correctCategory: string | null;

  @AllowNull(true)
  @Column({ field: 'rejected_reason', type: DataType.STRING(128) })
  declare rejectedReason: string | null;

  @AllowNull(true)
  @Column({ field: 'reason_info', type: DataType.TEXT })
  declare reasonInfo: string | null;

  @AllowNull(true)
  @Column({ field: 'recommendation_info', type: DataType.TEXT })
  declare recommendationInfo: string | null;

  @AllowNull(true)
  @Column({ field: 'provider_updated_at', type: DataType.DATE })
  declare providerUpdatedAt: Date | null;

  @AllowNull(false)
  @Column({ field: 'last_synced_at', type: DataType.DATE })
  declare lastSyncedAt: Date;

  @AllowNull(false)
  @Column({ field: 'definition_hash', type: DataType.STRING(64) })
  declare definitionHash: string;

  @AllowNull(false)
  @Default('synced')
  @Column({ field: 'local_state', type: DataType.STRING(24) })
  declare localState: string;

  @AllowNull(true)
  @Column({ field: 'status_updated_at', type: DataType.DATE })
  declare statusUpdatedAt: Date | null;

  @AllowNull(true)
  @Column({ field: 'quality_updated_at', type: DataType.DATE })
  declare qualityUpdatedAt: Date | null;

  @AllowNull(true)
  @Column({ field: 'category_updated_at', type: DataType.DATE })
  declare categoryUpdatedAt: Date | null;

  @AllowNull(true)
  @Column({ field: 'components_updated_at', type: DataType.DATE })
  declare componentsUpdatedAt: Date | null;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column({ field: 'created_by', type: DataType.INTEGER })
  declare createdBy: number | null;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column({ field: 'updated_by', type: DataType.INTEGER })
  declare updatedBy: number | null;
}
