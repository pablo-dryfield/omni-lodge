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

import Addon from './Addon.js';
import Channel from './Channel.js';
import Counter from './Counter.js';

export type MetricKind = 'people' | 'addon';
export type MetricTallyType = 'booked' | 'attended';
export type MetricPeriod = 'before_cutoff' | 'after_cutoff' | null;

@Table({
  timestamps: true,
  modelName: 'CounterChannelMetrics',
  tableName: 'counter_channel_metrics',
})
export default class CounterChannelMetric extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @ForeignKey(() => Counter)
  @AllowNull(false)
  @Column({ field: 'counter_id', type: DataType.INTEGER })
  declare counterId: number;

  @ForeignKey(() => Channel)
  @AllowNull(false)
  @Column({ field: 'channel_id', type: DataType.INTEGER })
  declare channelId: number;

  @AllowNull(false)
  @Column({ type: DataType.ENUM('people', 'addon') })
  declare kind: MetricKind;

  @ForeignKey(() => Addon)
  @AllowNull(true)
  @Column({ field: 'addon_id', type: DataType.INTEGER })
  declare addonId: number | null;

  @AllowNull(false)
  @Column({ field: 'tally_type', type: DataType.ENUM('booked', 'attended') })
  declare tallyType: MetricTallyType;

  @AllowNull(true)
  @Column({ field: 'period', type: DataType.ENUM('before_cutoff', 'after_cutoff') })
  declare period: 'before_cutoff' | 'after_cutoff' | null;

  @AllowNull(false)
  @Default(0)
  @Column(DataType.INTEGER)
  declare qty: number;

  @AllowNull(false)
  @Default(DataType.NOW)
  @Column(DataType.DATE)
  declare createdAt: Date;

  @AllowNull(true)
  @Default(DataType.NOW)
  @Column(DataType.DATE)
  declare updatedAt: Date | null;

  @BelongsTo(() => Counter, { foreignKey: 'counter_id', as: 'counter' })
  declare counter?: unknown;

  @BelongsTo(() => Channel, { foreignKey: 'channel_id', as: 'channel' })
  declare channel?: unknown;

  @BelongsTo(() => Addon, { foreignKey: 'addon_id', as: 'addon' })
  declare addon?: unknown;
}
