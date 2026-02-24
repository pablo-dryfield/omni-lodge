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
import Channel from './Channel.js';
import Product from './Product.js';
import User from './User.js';
import type { WalkInTicketType } from '../constants/walkInTicketTypes.js';

@Table({
  timestamps: true,
  modelName: 'ChannelProductPrice',
  tableName: 'channel_product_prices',
})
export default class ChannelProductPrice extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @ForeignKey(() => Channel)
  @AllowNull(false)
  @Column({ field: 'channel_id', type: DataType.INTEGER })
  declare channelId: number;

  @BelongsTo(() => Channel, { foreignKey: 'channel_id', as: 'channel' })
  declare channel?: Channel;

  @ForeignKey(() => Product)
  @AllowNull(false)
  @Column({ field: 'product_id', type: DataType.INTEGER })
  declare productId: number;

  @BelongsTo(() => Product, { foreignKey: 'product_id', as: 'product' })
  declare product?: Product;

  @AllowNull(false)
  @Column(DataType.DECIMAL(10, 2))
  declare price: number;

  @AllowNull(false)
  @Column({ field: 'ticket_type', type: DataType.STRING(64), defaultValue: 'normal' })
  declare ticketType: WalkInTicketType;

  @AllowNull(false)
  @Column({ field: 'currency_code', type: DataType.STRING(3), defaultValue: 'PLN' })
  declare currencyCode: string;

  @AllowNull(false)
  @Column({ field: 'valid_from', type: DataType.DATEONLY })
  declare validFrom: string;

  @AllowNull(true)
  @Column({ field: 'valid_to', type: DataType.DATEONLY })
  declare validTo: string | null;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column({ field: 'created_by', type: DataType.INTEGER })
  declare createdBy: number | null;

  @BelongsTo(() => User, { foreignKey: 'created_by', as: 'createdByUser' })
  declare createdByUser?: User;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column({ field: 'updated_by', type: DataType.INTEGER })
  declare updatedBy: number | null;

  @BelongsTo(() => User, { foreignKey: 'updated_by', as: 'updatedByUser' })
  declare updatedByUser?: User;
}
