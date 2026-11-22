import { AllowNull, Column, CreatedAt, DataType, Model, PrimaryKey, Table, UpdatedAt } from 'sequelize-typescript';

/** Delivery metadata only: no message body, email address, visitor IP or application content. */
@Table({ timestamps: true, modelName: 'WebsiteEnquiryDelivery', tableName: 'website_enquiry_deliveries' })
export default class WebsiteEnquiryDelivery extends Model {
  @PrimaryKey @Column({ field: 'request_id', type: DataType.UUID }) declare requestId: string;
  @AllowNull(false) @Column({ field: 'form_id', type: DataType.STRING(80) }) declare formId: string;
  @AllowNull(false) @Column({ field: 'payload_hash', type: DataType.STRING(64) }) declare payloadHash: string;
  @AllowNull(false) @Column(DataType.STRING(16)) declare status: 'sending' | 'sent' | 'uncertain';
  @AllowNull(false) @Column({ field: 'rfc_message_id', type: DataType.STRING(160) }) declare rfcMessageId: string;
  @AllowNull(true) @Column({ field: 'provider_message_id', type: DataType.STRING(200) }) declare providerMessageId: string | null;
  @AllowNull(true) @Column({ field: 'sent_at', type: DataType.DATE }) declare sentAt: Date | null;
  @CreatedAt @Column({ field: 'created_at', type: DataType.DATE }) declare createdAt: Date;
  @UpdatedAt @Column({ field: 'updated_at', type: DataType.DATE }) declare updatedAt: Date;
}
