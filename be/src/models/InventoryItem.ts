import { AllowNull, AutoIncrement, Column, DataType, Default, Model, PrimaryKey, Table } from 'sequelize-typescript';

@Table({ tableName: 'inventory_items', timestamps: true, underscored: true })
export default class InventoryItem extends Model {
  @PrimaryKey @AutoIncrement @Column(DataType.INTEGER) declare id: number;
  @AllowNull(false) @Column(DataType.STRING(160)) declare name: string;
  @AllowNull(false) @Column(DataType.STRING(80)) declare sku: string;
  @AllowNull(false) @Default('unit') @Column(DataType.STRING(30)) declare unit: string;
  @AllowNull(false) @Default(0) @Column({ field: 'reorder_level', type: DataType.DECIMAL(14, 3) }) declare reorderLevel: string;
  @AllowNull(false) @Default(true) @Column({ field: 'is_active', type: DataType.BOOLEAN }) declare isActive: boolean;
  @AllowNull(false) @Column({ field: 'created_by', type: DataType.INTEGER }) declare createdBy: number;
  @AllowNull(true) @Column({ field: 'updated_by', type: DataType.INTEGER }) declare updatedBy: number | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}
