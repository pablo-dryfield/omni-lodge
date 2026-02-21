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
import OpenBarDrinkIssue from './OpenBarDrinkIssue.js';
import OpenBarIngredient from './OpenBarIngredient.js';

export type OpenBarDrinkType = 'classic' | 'cocktail' | 'beer' | 'soft' | 'custom';
export type OpenBarDrinkLabelDisplayMode = 'recipe_name' | 'recipe_with_ingredients' | 'ingredients_only';

@Table({
  tableName: 'open_bar_recipes',
  modelName: 'OpenBarRecipe',
  timestamps: true,
  underscored: true,
})
export default class OpenBarRecipe extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @AllowNull(false)
  @Column(DataType.STRING(120))
  declare name: string;

  @AllowNull(false)
  @Default('custom')
  @Column({ field: 'drink_type', type: DataType.ENUM('classic', 'cocktail', 'beer', 'soft', 'custom') })
  declare drinkType: OpenBarDrinkType;

  @AllowNull(false)
  @Default(1)
  @Column({ field: 'default_servings', type: DataType.INTEGER })
  declare defaultServings: number;

  @AllowNull(true)
  @Column({ field: 'label_display_mode', type: DataType.ENUM('recipe_name', 'recipe_with_ingredients', 'ingredients_only') })
  declare labelDisplayMode: OpenBarDrinkLabelDisplayMode | null;

  @AllowNull(true)
  @Column(DataType.TEXT)
  declare instructions: string | null;

  @AllowNull(false)
  @Default(true)
  @Column({ field: 'is_active', type: DataType.BOOLEAN })
  declare isActive: boolean;

  @AllowNull(false)
  @Default(false)
  @Column({ field: 'ask_strength', type: DataType.BOOLEAN })
  declare askStrength: boolean;

  @AllowNull(false)
  @Default(false)
  @Column({ field: 'has_ice', type: DataType.BOOLEAN })
  declare hasIce: boolean;

  @AllowNull(false)
  @Default(0)
  @Column({ field: 'ice_cubes', type: DataType.INTEGER })
  declare iceCubes: number;

  @ForeignKey(() => OpenBarIngredient)
  @AllowNull(true)
  @Column({ field: 'cup_ingredient_id', type: DataType.INTEGER })
  declare cupIngredientId: number | null;

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

  @HasMany(() => OpenBarRecipeIngredient, { foreignKey: 'recipe_id', as: 'ingredients' })
  declare ingredients?: OpenBarRecipeIngredient[];

  @HasMany(() => OpenBarDrinkIssue, { foreignKey: 'recipe_id', as: 'drinkIssues' })
  declare drinkIssues?: OpenBarDrinkIssue[];

  @BelongsTo(() => OpenBarIngredient, { foreignKey: 'cup_ingredient_id', as: 'cupIngredient' })
  declare cupIngredient?: any;
}
