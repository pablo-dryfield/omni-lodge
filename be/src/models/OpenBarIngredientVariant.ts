import {
  AllowNull,
  AutoIncrement,
  BelongsTo,
  Column,
  DataType,
  Default,
  ForeignKey,
  HasMany,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';
import User from './User.js';
import OpenBarIngredient from './OpenBarIngredient.js';
import OpenBarDeliveryItem from './OpenBarDeliveryItem.js';

@Table({
  tableName: 'open_bar_ingredient_variants',
  modelName: 'OpenBarIngredientVariant',
  timestamps: true,
  underscored: true,
})
export default class OpenBarIngredientVariant extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @ForeignKey(() => OpenBarIngredient)
  @AllowNull(false)
  @Column({ field: 'ingredient_id', type: DataType.INTEGER })
  declare ingredientId: number;

  @AllowNull(false)
  @Column(DataType.STRING(160))
  declare name: string;

  @AllowNull(true)
  @Column(DataType.STRING(120))
  declare brand: string | null;

  @AllowNull(true)
  @Column({ field: 'package_label', type: DataType.STRING(160) })
  declare packageLabel: string | null;

  @AllowNull(false)
  @Default(1)
  @Column({ field: 'base_quantity', type: DataType.DECIMAL(12, 3) })
  declare baseQuantity: number;

  @AllowNull(false)
  @Default(true)
  @Column({ field: 'is_active', type: DataType.BOOLEAN })
  declare isActive: boolean;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column({ field: 'created_by', type: DataType.INTEGER })
  declare createdBy: number | null;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column({ field: 'updated_by', type: DataType.INTEGER })
  declare updatedBy: number | null;

  @BelongsTo(() => OpenBarIngredient, { foreignKey: 'ingredient_id', as: 'ingredient' })
  declare ingredient?: any;

  @BelongsTo(() => User, { foreignKey: 'created_by', as: 'createdByUser' })
  declare createdByUser?: User;

  @BelongsTo(() => User, { foreignKey: 'updated_by', as: 'updatedByUser' })
  declare updatedByUser?: User;

  @HasMany(() => OpenBarDeliveryItem, { foreignKey: 'variant_id', as: 'deliveryItems' })
  declare deliveryItems?: any[];
}
