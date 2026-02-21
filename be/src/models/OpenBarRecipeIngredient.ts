import {
  AllowNull,
  AutoIncrement,
  BelongsTo,
  Column,
  DataType,
  Default,
  ForeignKey,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';
import OpenBarRecipe from './OpenBarRecipe.js';
import OpenBarIngredient from './OpenBarIngredient.js';
import OpenBarIngredientCategory from './OpenBarIngredientCategory.js';

export type OpenBarRecipeIngredientLineType = 'fixed_ingredient' | 'category_selector';

@Table({
  tableName: 'open_bar_recipe_ingredients',
  modelName: 'OpenBarRecipeIngredient',
  timestamps: true,
  underscored: true,
})
export default class OpenBarRecipeIngredient extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @ForeignKey(() => OpenBarRecipe)
  @AllowNull(false)
  @Column({ field: 'recipe_id', type: DataType.INTEGER })
  declare recipeId: number;

  @ForeignKey(() => OpenBarIngredient)
  @AllowNull(true)
  @Column({ field: 'ingredient_id', type: DataType.INTEGER })
  declare ingredientId: number | null;

  @ForeignKey(() => OpenBarIngredientCategory)
  @AllowNull(true)
  @Column({ field: 'category_id', type: DataType.INTEGER })
  declare categoryId: number | null;

  @AllowNull(false)
  @Default('fixed_ingredient')
  @Column({ field: 'line_type', type: DataType.ENUM('fixed_ingredient', 'category_selector') })
  declare lineType: OpenBarRecipeIngredientLineType;

  @AllowNull(false)
  @Column(DataType.DECIMAL(12, 3))
  declare quantity: number;

  @AllowNull(false)
  @Default(0)
  @Column({ field: 'sort_order', type: DataType.INTEGER })
  declare sortOrder: number;

  @AllowNull(false)
  @Default(false)
  @Column({ field: 'is_optional', type: DataType.BOOLEAN })
  declare isOptional: boolean;

  @AllowNull(false)
  @Default(false)
  @Column({ field: 'affects_strength', type: DataType.BOOLEAN })
  declare affectsStrength: boolean;

  @AllowNull(false)
  @Default(false)
  @Column({ field: 'is_top_up', type: DataType.BOOLEAN })
  declare isTopUp: boolean;

  @BelongsTo(() => OpenBarRecipe, { foreignKey: 'recipe_id', as: 'recipe' })
  declare recipe?: any;

  @BelongsTo(() => OpenBarIngredient, { foreignKey: 'ingredient_id', as: 'ingredient' })
  declare ingredient?: any;

  @BelongsTo(() => OpenBarIngredientCategory, { foreignKey: 'category_id', as: 'category' })
  declare category?: OpenBarIngredientCategory;
}
