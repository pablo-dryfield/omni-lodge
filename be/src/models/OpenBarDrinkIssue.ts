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
import OpenBarSession from './OpenBarSession.js';
import OpenBarRecipe from './OpenBarRecipe.js';
import OpenBarInventoryMovement from './OpenBarInventoryMovement.js';

@Table({
  tableName: 'open_bar_drink_issues',
  modelName: 'OpenBarDrinkIssue',
  timestamps: true,
  underscored: true,
})
export default class OpenBarDrinkIssue extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @ForeignKey(() => OpenBarSession)
  @AllowNull(false)
  @Column({ field: 'session_id', type: DataType.INTEGER })
  declare sessionId: number;

  @ForeignKey(() => OpenBarRecipe)
  @AllowNull(false)
  @Column({ field: 'recipe_id', type: DataType.INTEGER })
  declare recipeId: number;

  @AllowNull(false)
  @Column(DataType.INTEGER)
  declare servings: number;

  @AllowNull(false)
  @Column({ field: 'issued_at', type: DataType.DATE })
  declare issuedAt: Date;

  @AllowNull(true)
  @Column({ field: 'order_ref', type: DataType.STRING(120) })
  declare orderRef: string | null;

  @AllowNull(true)
  @Column({ field: 'display_name_snapshot', type: DataType.STRING(255) })
  declare displayNameSnapshot: string | null;

  @AllowNull(true)
  @Column(DataType.TEXT)
  declare notes: string | null;

  @AllowNull(false)
  @Default(false)
  @Column({ field: 'is_staff_drink', type: DataType.BOOLEAN })
  declare isStaffDrink: boolean;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column({ field: 'issued_by', type: DataType.INTEGER })
  declare issuedBy: number | null;

  @BelongsTo(() => OpenBarSession, { foreignKey: 'session_id', as: 'session' })
  declare session?: any;

  @BelongsTo(() => OpenBarRecipe, { foreignKey: 'recipe_id', as: 'recipe' })
  declare recipe?: any;

  @BelongsTo(() => User, { foreignKey: 'issued_by', as: 'issuedByUser' })
  declare issuedByUser?: User;

  @HasMany(() => OpenBarInventoryMovement, { foreignKey: 'issue_id', as: 'movements' })
  declare movements?: OpenBarInventoryMovement[];
}
