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
import User from './User.js';

@Table({
  timestamps: true,
  modelName: 'ChannelCommission',
  tableName: 'channel_commissions',
})
export default class ChannelCommission extends Model {
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

  @AllowNull(false)
  @Column(DataType.DECIMAL(6, 4))
  declare rate: number;

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
