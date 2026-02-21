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
import OpenBarRecipeIngredient from './OpenBarRecipeIngredient.js';
import OpenBarDeliveryItem from './OpenBarDeliveryItem.js';
import OpenBarInventoryMovement from './OpenBarInventoryMovement.js';
import OpenBarIngredientCategory from './OpenBarIngredientCategory.js';
import OpenBarIngredientVariant from './OpenBarIngredientVariant.js';

export type OpenBarIngredientUnit = 'ml' | 'unit';
export type OpenBarCupType = 'disposable' | 'reusable';

@Table({
  tableName: 'open_bar_ingredients',
  modelName: 'OpenBarIngredient',
  timestamps: true,
  underscored: true,
})
export default class OpenBarIngredient extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @AllowNull(false)
  @Column(DataType.STRING(120))
  declare name: string;

  @ForeignKey(() => OpenBarIngredientCategory)
  @AllowNull(false)
  @Column({ field: 'category_id', type: DataType.INTEGER })
  declare categoryId: number;

  @AllowNull(false)
  @Default('ml')
  @Column({ field: 'base_unit', type: DataType.ENUM('ml', 'unit') })
  declare baseUnit: OpenBarIngredientUnit;

  @AllowNull(false)
  @Default(0)
  @Column({ field: 'par_level', type: DataType.DECIMAL(12, 3) })
  declare parLevel: number;

  @AllowNull(false)
  @Default(0)
  @Column({ field: 'reorder_level', type: DataType.DECIMAL(12, 3) })
  declare reorderLevel: number;

  @AllowNull(true)
  @Column({ field: 'cost_per_unit', type: DataType.DECIMAL(12, 4) })
  declare costPerUnit: number | null;

  @AllowNull(false)
  @Default(true)
  @Column({ field: 'is_active', type: DataType.BOOLEAN })
  declare isActive: boolean;

  @AllowNull(false)
  @Default(false)
  @Column({ field: 'is_cup', type: DataType.BOOLEAN })
  declare isCup: boolean;

  @AllowNull(true)
  @Column({ field: 'cup_type', type: DataType.ENUM('disposable', 'reusable') })
  declare cupType: OpenBarCupType | null;

  @AllowNull(true)
  @Column({ field: 'cup_capacity_ml', type: DataType.DECIMAL(12, 3) })
  declare cupCapacityMl: number | null;

  @AllowNull(false)
  @Default(false)
  @Column({ field: 'is_ice', type: DataType.BOOLEAN })
  declare isIce: boolean;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column({ field: 'created_by', type: DataType.INTEGER })
  declare createdBy: number | null;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column({ field: 'updated_by', type: DataType.INTEGER })
  declare updatedBy: number | null;

  @BelongsTo(() => User, { foreignKey: 'created_by', as: 'createdByUser' })
  declare createdByUser?: User;

  @BelongsTo(() => User, { foreignKey: 'updated_by', as: 'updatedByUser' })
  declare updatedByUser?: User;

  @BelongsTo(() => OpenBarIngredientCategory, { foreignKey: 'category_id', as: 'categoryRef' })
  declare categoryRef?: OpenBarIngredientCategory;

  @HasMany(() => OpenBarRecipeIngredient, { foreignKey: 'ingredient_id', as: 'recipeIngredients' })
  declare recipeIngredients?: OpenBarRecipeIngredient[];

  @HasMany(() => OpenBarDeliveryItem, { foreignKey: 'ingredient_id', as: 'deliveryItems' })
  declare deliveryItems?: OpenBarDeliveryItem[];

  @HasMany(() => OpenBarIngredientVariant, { foreignKey: 'ingredient_id', as: 'variants' })
  declare variants?: OpenBarIngredientVariant[];

  @HasMany(() => OpenBarInventoryMovement, { foreignKey: 'ingredient_id', as: 'inventoryMovements' })
  declare inventoryMovements?: OpenBarInventoryMovement[];
}
