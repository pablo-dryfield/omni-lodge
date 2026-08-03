import { AllowNull, AutoIncrement, Column, DataType, Model, PrimaryKey, Table } from 'sequelize-typescript';

export type InventoryMovementType = 'initial_stock' | 'purchase' | 'counter_usage' | 'adjustment' | 'damage' | 'return' | 'correction';
@Table({ tableName: 'inventory_movements', timestamps: true, underscored: true })
export default class InventoryMovement extends Model {
  @PrimaryKey @AutoIncrement @Column(DataType.INTEGER) declare id: number;
  @AllowNull(false) @Column({ field: 'inventory_item_id', type: DataType.INTEGER }) declare inventoryItemId: number;
  @AllowNull(false) @Column({ field: 'quantity_delta', type: DataType.DECIMAL(14, 3) }) declare quantityDelta: string;
  @AllowNull(false) @Column(DataType.STRING(30)) declare type: InventoryMovementType;
  @AllowNull(false) @Column(DataType.DATEONLY) declare date: string;
  @AllowNull(true) @Column({ field: 'unit_cost_minor', type: DataType.INTEGER }) declare unitCostMinor: number | null;
  @AllowNull(true) @Column({ field: 'purchase_id', type: DataType.INTEGER }) declare purchaseId: number | null;
  @AllowNull(true) @Column({ field: 'counter_id', type: DataType.INTEGER }) declare counterId: number | null;
  @AllowNull(true) @Column({ field: 'fulfillment_id', type: DataType.INTEGER }) declare fulfillmentId: number | null;
  @AllowNull(true) @Column({ field: 'addon_id', type: DataType.INTEGER }) declare addonId: number | null;
  @AllowNull(true) @Column({ field: 'booking_id', type: DataType.INTEGER }) declare bookingId: number | null;
  @AllowNull(true) @Column({ field: 'incident_kind', type: DataType.STRING(30) }) declare incidentKind: string | null;
  @AllowNull(true) @Column(DataType.TEXT) declare notes: string | null;
  @AllowNull(false) @Column({ field: 'created_by', type: DataType.INTEGER }) declare createdBy: number;
  declare createdAt: Date;
  declare updatedAt: Date;
}
