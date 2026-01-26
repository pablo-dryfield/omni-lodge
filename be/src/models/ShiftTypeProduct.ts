import {
  Table,
  Column,
  Model,
  DataType,
  ForeignKey,
  AllowNull,
  PrimaryKey,
  Default,
  BelongsTo,
} from 'sequelize-typescript';
import ShiftType from './ShiftType.js';
import Product from './Product.js';

@Table({
  tableName: 'shift_type_products',
  modelName: 'ShiftTypeProduct',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
})
export default class ShiftTypeProduct extends Model {
  @PrimaryKey
  @ForeignKey(() => ShiftType)
  @AllowNull(false)
  @Column({ field: 'shift_type_id', type: DataType.INTEGER })
  declare shiftTypeId: number;

  @PrimaryKey
  @ForeignKey(() => Product)
  @AllowNull(false)
  @Column({ field: 'product_id', type: DataType.INTEGER })
  declare productId: number;

  @AllowNull(false)
  @Default(DataType.NOW)
  @Column({ field: 'created_at', type: DataType.DATE })
  declare createdAt: Date;

  @AllowNull(false)
  @Default(DataType.NOW)
  @Column({ field: 'updated_at', type: DataType.DATE })
  declare updatedAt: Date;

  @BelongsTo(() => ShiftType, { foreignKey: 'shift_type_id', as: 'shiftType' })
  declare shiftType?: ShiftType;

  @BelongsTo(() => Product, { foreignKey: 'product_id', as: 'product' })
  declare product?: Product;
}
