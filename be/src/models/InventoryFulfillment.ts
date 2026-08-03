import { AllowNull, AutoIncrement, Column, DataType, Default, Model, PrimaryKey, Table } from 'sequelize-typescript';

export type InventoryFulfillmentStatus = 'waiting_stock'|'ready'|'packed'|'shipped'|'collected'|'cancelled';
@Table({ tableName:'inventory_fulfillments', timestamps:true, underscored:true })
export default class InventoryFulfillment extends Model {
  @PrimaryKey @AutoIncrement @Column(DataType.INTEGER) declare id:number;
  @AllowNull(false) @Column({field:'inventory_item_id',type:DataType.INTEGER}) declare inventoryItemId:number;
  @AllowNull(false) @Column({field:'addon_id',type:DataType.INTEGER}) declare addonId:number;
  @AllowNull(true) @Column({field:'booking_id',type:DataType.INTEGER}) declare bookingId:number|null;
  @AllowNull(true) @Column({field:'counter_id',type:DataType.INTEGER}) declare counterId:number|null;
  @AllowNull(false) @Column(DataType.DECIMAL(14,3)) declare quantity:string;
  @AllowNull(false) @Default('waiting_stock') @Column(DataType.STRING(30)) declare status:InventoryFulfillmentStatus;
  @AllowNull(false) @Default('mail') @Column({field:'delivery_method',type:DataType.STRING(20)}) declare deliveryMethod:'mail'|'collection';
  @AllowNull(false) @Column({field:'recipient_name',type:DataType.STRING(180)}) declare recipientName:string;
  @AllowNull(true) @Column(DataType.STRING(180)) declare email:string|null;
  @AllowNull(true) @Column(DataType.STRING(80)) declare phone:string|null;
  @AllowNull(true) @Column(DataType.TEXT) declare address:string|null;
  @AllowNull(true) @Column(DataType.STRING(80)) declare size:string|null;
  @AllowNull(true) @Column({field:'tracking_number',type:DataType.STRING(160)}) declare trackingNumber:string|null;
  @AllowNull(true) @Column({field:'fulfilled_at',type:DataType.DATE}) declare fulfilledAt:Date|null;
  @AllowNull(true) @Column({field:'postage_finance_transaction_id',type:DataType.INTEGER}) declare postageFinanceTransactionId:number|null;
  @AllowNull(true) @Column(DataType.TEXT) declare notes:string|null;
  @AllowNull(false) @Column({field:'created_by',type:DataType.INTEGER}) declare createdBy:number;
  @AllowNull(true) @Column({field:'updated_by',type:DataType.INTEGER}) declare updatedBy:number|null;
  declare createdAt:Date; declare updatedAt:Date;
}
