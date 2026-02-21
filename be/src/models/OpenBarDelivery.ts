import {
  AllowNull,
  AutoIncrement,
  BelongsTo,
  Column,
  DataType,
  ForeignKey,
  HasMany,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';
import User from './User.js';
import OpenBarDeliveryItem from './OpenBarDeliveryItem.js';
import OpenBarInventoryMovement from './OpenBarInventoryMovement.js';

@Table({
  tableName: 'open_bar_deliveries',
  modelName: 'OpenBarDelivery',
  timestamps: true,
  underscored: true,
})
export default class OpenBarDelivery extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @AllowNull(true)
  @Column({ field: 'supplier_name', type: DataType.STRING(160) })
  declare supplierName: string | null;

  @AllowNull(true)
  @Column({ field: 'invoice_ref', type: DataType.STRING(120) })
  declare invoiceRef: string | null;

  @AllowNull(false)
  @Column({ field: 'delivered_at', type: DataType.DATE })
  declare deliveredAt: Date;

  @AllowNull(true)
  @Column(DataType.TEXT)
  declare notes: string | null;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column({ field: 'received_by', type: DataType.INTEGER })
  declare receivedBy: number | null;

  @BelongsTo(() => User, { foreignKey: 'received_by', as: 'receivedByUser' })
  declare receivedByUser?: User;

  @HasMany(() => OpenBarDeliveryItem, { foreignKey: 'delivery_id', as: 'items' })
  declare items?: OpenBarDeliveryItem[];

  @HasMany(() => OpenBarInventoryMovement, { foreignKey: 'delivery_id', as: 'movements' })
  declare movements?: OpenBarInventoryMovement[];
}
