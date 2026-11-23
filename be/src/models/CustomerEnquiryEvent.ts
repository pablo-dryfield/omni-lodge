import { AllowNull, AutoIncrement, Column, CreatedAt, DataType, Model, PrimaryKey, Table } from 'sequelize-typescript';

@Table({timestamps:true,updatedAt:false,tableName:'customer_enquiry_events',modelName:'CustomerEnquiryEvent'})
export default class CustomerEnquiryEvent extends Model {
  @PrimaryKey @AutoIncrement @Column(DataType.BIGINT) declare id: number;
  @AllowNull(true) @Column({field:'request_id',type:DataType.UUID}) declare requestId: string | null;
  @AllowNull(true) @Column({field:'form_id',type:DataType.STRING(80)}) declare formId: string | null;
  @AllowNull(false) @Column(DataType.STRING(40)) declare kind: string;
  @AllowNull(false) @Column({field:'actor_id',type:DataType.INTEGER}) declare actorId: number;
  @AllowNull(false) @Column(DataType.JSONB) declare changes: Record<string,unknown>;
  @CreatedAt @Column({field:'created_at',type:DataType.DATE}) declare createdAt: Date;
}
