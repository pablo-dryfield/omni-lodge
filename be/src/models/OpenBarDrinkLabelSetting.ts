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
import User from './User.js';

export type OpenBarDrinkLabelDisplayMode = 'recipe_name' | 'recipe_with_ingredients' | 'ingredients_only';

@Table({
  tableName: 'open_bar_drink_label_settings',
  modelName: 'OpenBarDrinkLabelSetting',
  timestamps: true,
  underscored: true,
})
export default class OpenBarDrinkLabelSetting extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @AllowNull(false)
  @Column({ field: 'drink_type', type: DataType.ENUM('classic', 'cocktail', 'beer', 'soft', 'custom') })
  declare drinkType: 'classic' | 'cocktail' | 'beer' | 'soft' | 'custom';

  @AllowNull(false)
  @Default('recipe_name')
  @Column({ field: 'display_mode', type: DataType.ENUM('recipe_name', 'recipe_with_ingredients', 'ingredients_only') })
  declare displayMode: OpenBarDrinkLabelDisplayMode;

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
}
