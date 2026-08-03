import { AllowNull, AutoIncrement, Column, DataType, Model, PrimaryKey, Table } from 'sequelize-typescript';

@Table({ tableName: 'inventory_purchases', timestamps: true, underscored: true })
export default class InventoryPurchase extends Model {
  @PrimaryKey @AutoIncrement @Column(DataType.INTEGER) declare id: number;
  @AllowNull(false) @Column(DataType.DATEONLY) declare date: string;
  @AllowNull(false) @Column({ field: 'vendor_id', type: DataType.INTEGER }) declare vendorId: number;
  @AllowNull(false) @Column({ field: 'finance_transaction_id', type: DataType.INTEGER }) declare financeTransactionId: number;
  @AllowNull(true) @Column({ field: 'invoice_file_id', type: DataType.INTEGER }) declare invoiceFileId: number | null;
  @AllowNull(true) @Column({ field: 'invoice_number', type: DataType.STRING(120) }) declare invoiceNumber: string | null;
  @AllowNull(false) @Column(DataType.STRING(3)) declare currency: string;
  @AllowNull(false) @Column({ field: 'total_minor', type: DataType.INTEGER }) declare totalMinor: number;
  @AllowNull(true) @Column(DataType.TEXT) declare notes: string | null;
  @AllowNull(false) @Column({ field: 'created_by', type: DataType.INTEGER }) declare createdBy: number;
  declare createdAt: Date;
  declare updatedAt: Date;
}
