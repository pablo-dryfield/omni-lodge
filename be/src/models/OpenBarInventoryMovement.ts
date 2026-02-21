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
import User from './User.js';
import OpenBarIngredient from './OpenBarIngredient.js';
import OpenBarSession from './OpenBarSession.js';
import OpenBarDelivery from './OpenBarDelivery.js';
import OpenBarDrinkIssue from './OpenBarDrinkIssue.js';

export type OpenBarMovementType = 'delivery' | 'issue' | 'adjustment' | 'waste' | 'correction';

@Table({
  tableName: 'open_bar_inventory_movements',
  modelName: 'OpenBarInventoryMovement',
  timestamps: true,
  underscored: true,
})
export default class OpenBarInventoryMovement extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @ForeignKey(() => OpenBarIngredient)
  @AllowNull(false)
  @Column({ field: 'ingredient_id', type: DataType.INTEGER })
  declare ingredientId: number;

  @AllowNull(false)
  @Column({ field: 'movement_type', type: DataType.ENUM('delivery', 'issue', 'adjustment', 'waste', 'correction') })
  declare movementType: OpenBarMovementType;

  @AllowNull(false)
  @Column({ field: 'quantity_delta', type: DataType.DECIMAL(12, 3) })
  declare quantityDelta: number;

  @AllowNull(false)
  @Column({ field: 'occurred_at', type: DataType.DATE })
  declare occurredAt: Date;

  @ForeignKey(() => OpenBarSession)
  @AllowNull(true)
  @Column({ field: 'session_id', type: DataType.INTEGER })
  declare sessionId: number | null;

  @ForeignKey(() => OpenBarDelivery)
  @AllowNull(true)
  @Column({ field: 'delivery_id', type: DataType.INTEGER })
  declare deliveryId: number | null;

  @ForeignKey(() => OpenBarDrinkIssue)
  @AllowNull(true)
  @Column({ field: 'issue_id', type: DataType.INTEGER })
  declare issueId: number | null;

  @AllowNull(true)
  @Column(DataType.TEXT)
  declare note: string | null;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column({ field: 'created_by', type: DataType.INTEGER })
  declare createdBy: number | null;

  @BelongsTo(() => OpenBarIngredient, { foreignKey: 'ingredient_id', as: 'ingredient' })
  declare ingredient?: any;

  @BelongsTo(() => OpenBarSession, { foreignKey: 'session_id', as: 'session' })
  declare session?: any;

  @BelongsTo(() => OpenBarDelivery, { foreignKey: 'delivery_id', as: 'delivery' })
  declare delivery?: any;

  @BelongsTo(() => OpenBarDrinkIssue, { foreignKey: 'issue_id', as: 'issue' })
  declare issue?: any;

  @BelongsTo(() => User, { foreignKey: 'created_by', as: 'createdByUser' })
  declare createdByUser?: User;
}
