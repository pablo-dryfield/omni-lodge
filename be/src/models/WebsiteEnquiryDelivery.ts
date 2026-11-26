import { AllowNull, Column, CreatedAt, DataType, Default, Model, PrimaryKey, Table, UpdatedAt } from 'sequelize-typescript';

/** Delivery identity plus a snapshot; only the explicit reviewed-removal workflow may clear contents. */
@Table({ timestamps: true, modelName: 'WebsiteEnquiryDelivery', tableName: 'website_enquiry_deliveries' })
export default class WebsiteEnquiryDelivery extends Model {
  @PrimaryKey @Column({ field: 'request_id', type: DataType.UUID }) declare requestId: string;
  @AllowNull(false) @Column({ field: 'form_id', type: DataType.STRING(80) }) declare formId: string;
  @AllowNull(false) @Column({ field: 'payload_hash', type: DataType.STRING(64) }) declare payloadHash: string;
  @AllowNull(false) @Column(DataType.STRING(16)) declare status: 'sending' | 'sent' | 'uncertain';
  @AllowNull(false) @Column({ field: 'rfc_message_id', type: DataType.STRING(160) }) declare rfcMessageId: string;
  @AllowNull(true) @Column({ field: 'provider_message_id', type: DataType.STRING(200) }) declare providerMessageId: string | null;
  @AllowNull(true) @Column({ field: 'sent_at', type: DataType.DATE }) declare sentAt: Date | null;
  @AllowNull(true) @Column({field:'enquiry_data',type:DataType.JSONB}) declare enquiryData: import('../services/websiteEnquiryService.js').EnquirySnapshot | null;
  @AllowNull(true) @Column({field:'customer_name',type:DataType.TEXT}) declare customerName: string | null;
  @AllowNull(true) @Column({field:'customer_email',type:DataType.TEXT}) declare customerEmail: string | null;
  @AllowNull(true) @Column(DataType.TEXT) declare subject: string | null;
  @AllowNull(false) @Default('staging') @Column({field:'source_environment',type:DataType.STRING(20)}) declare sourceEnvironment: 'staging';
  @AllowNull(false) @Default('new') @Column({field:'handling_status',type:DataType.STRING(20)}) declare handlingStatus: 'new' | 'in_progress' | 'replied' | 'closed';
  @AllowNull(true) @Column({field:'assigned_to',type:DataType.INTEGER}) declare assignedTo: number | null;
  @AllowNull(false) @Default('') @Column({field:'staff_notes',type:DataType.TEXT}) declare staffNotes: string;
  @AllowNull(false) @Default(1) @Column(DataType.INTEGER) declare version: number;
  @AllowNull(true) @Column({field:'redacted_at',type:DataType.DATE}) declare redactedAt: Date | null;
  @AllowNull(true) @Column({field:'redacted_by',type:DataType.INTEGER}) declare redactedBy: number | null;
  @CreatedAt @Column({ field: 'created_at', type: DataType.DATE }) declare createdAt: Date;
  @UpdatedAt @Column({ field: 'updated_at', type: DataType.DATE }) declare updatedAt: Date;
}
