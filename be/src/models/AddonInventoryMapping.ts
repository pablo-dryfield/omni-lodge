import { AllowNull, AutoIncrement, Column, DataType, Default, Model, PrimaryKey, Table } from 'sequelize-typescript';

@Table({ tableName: 'addon_inventory_mappings', timestamps: true, underscored: true })
export default class AddonInventoryMapping extends Model {
  @PrimaryKey @AutoIncrement @Column(DataType.INTEGER) declare id: number;
  @AllowNull(false) @Column({ field: 'addon_id', type: DataType.INTEGER }) declare addonId: number;
  @AllowNull(false) @Column({ field: 'inventory_item_id', type: DataType.INTEGER }) declare inventoryItemId: number;
  @AllowNull(false) @Default(1) @Column({ field: 'quantity_per_addon', type: DataType.DECIMAL(14, 3) }) declare quantityPerAddon: string;
  @AllowNull(true) @Column(DataType.STRING(40)) declare variant: string | null;
  @AllowNull(false) @Default(true) @Column({ field: 'is_active', type: DataType.BOOLEAN }) declare isActive: boolean;
  declare createdAt: Date;
  declare updatedAt: Date;
}
