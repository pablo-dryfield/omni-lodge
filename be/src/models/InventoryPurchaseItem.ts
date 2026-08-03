import { AllowNull, AutoIncrement, Column, DataType, Model, PrimaryKey, Table } from 'sequelize-typescript';

@Table({ tableName: 'inventory_purchase_items', timestamps: true, underscored: true })
export default class InventoryPurchaseItem extends Model {
  @PrimaryKey @AutoIncrement @Column(DataType.INTEGER) declare id: number;
  @AllowNull(false) @Column({ field: 'purchase_id', type: DataType.INTEGER }) declare purchaseId: number;
  @AllowNull(false) @Column({ field: 'inventory_item_id', type: DataType.INTEGER }) declare inventoryItemId: number;
  @AllowNull(false) @Column(DataType.DECIMAL(14, 3)) declare quantity: string;
  @AllowNull(false) @Column({ field: 'unit_cost_minor', type: DataType.INTEGER }) declare unitCostMinor: number;
  @AllowNull(false) @Column({ field: 'line_total_minor', type: DataType.INTEGER }) declare lineTotalMinor: number;
  declare createdAt: Date;
  declare updatedAt: Date;
}
