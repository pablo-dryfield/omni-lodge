import {
  AllowNull,
  AutoIncrement,
  Column,
  DataType,
  Default,
  HasMany,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';

import ProductAddon from './ProductAddon.js';

@Table({
  timestamps: true,
  modelName: 'Addons',
  tableName: 'addons',
})
export default class Addon extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @AllowNull(false)
  @Column(DataType.STRING)
  declare name: string;

  @AllowNull(true)
  @Column({ field: 'base_price', type: DataType.DECIMAL(10, 2) })
  declare basePrice: number | null;

  @AllowNull(true)
  @Column({ field: 'tax_rate', type: DataType.DECIMAL(5, 4) })
  declare taxRate: number | null;

  @AllowNull(false)
  @Default(true)
  @Column({ field: 'is_active', type: DataType.BOOLEAN })
  declare isActive: boolean;

  @AllowNull(false)
  @Default(DataType.NOW)
  @Column(DataType.DATE)
  declare createdAt: Date;

  @AllowNull(true)
  @Default(DataType.NOW)
  @Column(DataType.DATE)
  declare updatedAt: Date | null;

  @HasMany(() => ProductAddon, { foreignKey: 'addon_id', as: 'productAddons' })
  declare productAddons?: unknown;
}
