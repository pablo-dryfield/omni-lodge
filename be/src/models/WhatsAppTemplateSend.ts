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
import Booking from './Booking.js';
import User from './User.js';
import WhatsAppTemplate from './WhatsAppTemplate.js';

@Table({
  timestamps: true,
  underscored: true,
  modelName: 'WhatsAppTemplateSend',
  tableName: 'whatsapp_template_sends',
})
export default class WhatsAppTemplateSend extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.BIGINT)
  declare id: number;

  @ForeignKey(() => WhatsAppTemplate)
  @AllowNull(false)
  @Column({ field: 'template_id', type: DataType.BIGINT })
  declare templateId: number;

  @ForeignKey(() => Booking)
  @AllowNull(true)
  @Column({ field: 'booking_id', type: DataType.BIGINT })
  declare bookingId: number | null;

  @Index({ name: 'whatsapp_template_sends_provider_key', unique: true })
  @AllowNull(false)
  @Column({ field: 'provider_message_id', type: DataType.STRING(256) })
  declare providerMessageId: string;

  @AllowNull(false)
  @Column({ field: 'template_name', type: DataType.STRING(512) })
  declare templateName: string;

  @AllowNull(false)
  @Column(DataType.STRING(32))
  declare language: string;

  @AllowNull(true)
  @Column({ field: 'recipient_phone_suffix', type: DataType.STRING(8) })
  declare recipientPhoneSuffix: string | null;

  @AllowNull(false)
  @Default([])
  @Column({ field: 'parameter_keys', type: DataType.JSONB })
  declare parameterKeys: string[];

  @AllowNull(false)
  @Default('accepted')
  @Column({ field: 'delivery_status', type: DataType.STRING(32) })
  declare deliveryStatus: string;

  @AllowNull(true)
  @Column({ field: 'delivery_error_code', type: DataType.STRING(64) })
  declare deliveryErrorCode: string | null;

  @AllowNull(true)
  @Column({ field: 'status_updated_at', type: DataType.DATE })
  declare statusUpdatedAt: Date | null;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column({ field: 'created_by', type: DataType.INTEGER })
  declare createdBy: number | null;
}
