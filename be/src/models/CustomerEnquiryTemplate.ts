import { AllowNull, Column, CreatedAt, DataType, Default, Model, PrimaryKey, Table, UpdatedAt } from 'sequelize-typescript';

@Table({ timestamps: true, tableName: 'customer_enquiry_templates', modelName: 'CustomerEnquiryTemplate' })
export default class CustomerEnquiryTemplate extends Model {
  @PrimaryKey @Column({field:'form_id',type:DataType.STRING(80)}) declare formId: string;
  @AllowNull(false) @Column({field:'subject_template',type:DataType.STRING(512)}) declare subjectTemplate: string;
  @AllowNull(false) @Column({field:'body_template',type:DataType.TEXT}) declare bodyTemplate: string;
  @AllowNull(false) @Default('plain_text') @Column(DataType.STRING(20)) declare layout: 'plain_text' | 'branded';
  @AllowNull(false) @Default(1) @Column(DataType.INTEGER) declare version: number;
  @AllowNull(true) @Column({field:'updated_by',type:DataType.INTEGER}) declare updatedBy: number | null;
  @CreatedAt @Column({field:'created_at',type:DataType.DATE}) declare createdAt: Date;
  @UpdatedAt @Column({field:'updated_at',type:DataType.DATE}) declare updatedAt: Date;
}
