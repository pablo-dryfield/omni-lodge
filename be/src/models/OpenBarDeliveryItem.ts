import {
  AllowNull,
  AutoIncrement,
  BelongsTo,
  Column,
  DataType,
  ForeignKey,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';
import OpenBarDelivery from './OpenBarDelivery.js';
import OpenBarIngredient from './OpenBarIngredient.js';
import OpenBarIngredientVariant from './OpenBarIngredientVariant.js';

@Table({
  tableName: 'open_bar_delivery_items',
  modelName: 'OpenBarDeliveryItem',
  timestamps: true,
  underscored: true,
})
export default class OpenBarDeliveryItem extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @ForeignKey(() => OpenBarDelivery)
  @AllowNull(false)
  @Column({ field: 'delivery_id', type: DataType.INTEGER })
  declare deliveryId: number;

  @ForeignKey(() => OpenBarIngredient)
  @AllowNull(false)
  @Column({ field: 'ingredient_id', type: DataType.INTEGER })
  declare ingredientId: number;

  @AllowNull(false)
  @Column(DataType.DECIMAL(12, 3))
  declare quantity: number;

  @AllowNull(true)
  @Column({ field: 'unit_cost', type: DataType.DECIMAL(12, 4) })
  declare unitCost: number | null;

  @ForeignKey(() => OpenBarIngredientVariant)
  @AllowNull(true)
  @Column({ field: 'variant_id', type: DataType.INTEGER })
  declare variantId: number | null;

  @AllowNull(true)
  @Column({ field: 'purchase_units', type: DataType.DECIMAL(12, 3) })
  declare purchaseUnits: number | null;

  @AllowNull(true)
  @Column({ field: 'purchase_unit_cost', type: DataType.DECIMAL(12, 4) })
  declare purchaseUnitCost: number | null;

  @BelongsTo(() => OpenBarDelivery, { foreignKey: 'delivery_id', as: 'delivery' })
  declare delivery?: any;

  @BelongsTo(() => OpenBarIngredient, { foreignKey: 'ingredient_id', as: 'ingredient' })
  declare ingredient?: any;

  @BelongsTo(() => OpenBarIngredientVariant, { foreignKey: 'variant_id', as: 'variant' })
  declare variant?: any;
}
