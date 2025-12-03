import {
  Model,
  Table,
  Column,
  PrimaryKey,
  AutoIncrement,
  AllowNull,
  DataType,
  ForeignKey,
  BelongsTo,
  Default,
} from 'sequelize-typescript';
import Booking from './Booking.js';
import Addon from './Addon.js';
import BookingEvent from './BookingEvent.js';

@Table({
  timestamps: true,
  modelName: 'BookingAddons',
  tableName: 'booking_addons',
})
export default class BookingAddon extends Model<BookingAddon> {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.BIGINT)
  declare id: number;

  @ForeignKey(() => Booking)
  @AllowNull(false)
  @Column({
    field: 'booking_id',
    type: DataType.BIGINT,
  })
  declare bookingId: number;

  @BelongsTo(() => Booking, { foreignKey: 'booking_id', as: 'booking' })
  declare booking?: Booking;

  @ForeignKey(() => Addon)
  @AllowNull(true)
  @Column({
    field: 'addon_id',
    type: DataType.INTEGER,
  })
  declare addonId: number | null;

  @BelongsTo(() => Addon, { foreignKey: 'addon_id', as: 'addon' })
  declare addon?: Addon;

  @AllowNull(true)
  @Column({
    field: 'platform_addon_id',
    type: DataType.STRING(192),
  })
  declare platformAddonId: string | null;

  @AllowNull(true)
  @Column({
    field: 'platform_addon_name',
    type: DataType.STRING(255),
  })
  declare platformAddonName: string | null;

  @AllowNull(false)
  @Default(1)
  @Column(DataType.INTEGER)
  declare quantity: number;

  @AllowNull(true)
  @Column({
    field: 'unit_price',
    type: DataType.DECIMAL(12, 2),
  })
  declare unitPrice: string | null;

  @AllowNull(true)
  @Column({
    field: 'total_price',
    type: DataType.DECIMAL(12, 2),
  })
  declare totalPrice: string | null;

  @AllowNull(true)
  @Column({
    field: 'currency',
    type: DataType.STRING(3),
  })
  declare currency: string | null;

  @AllowNull(true)
  @Column({
    field: 'tax_amount',
    type: DataType.DECIMAL(12, 2),
  })
  declare taxAmount: string | null;

  @AllowNull(false)
  @Default(false)
  @Column({
    field: 'is_included',
    type: DataType.BOOLEAN,
  })
  declare isIncluded: boolean;

  @AllowNull(true)
  @Column(DataType.JSONB)
  declare metadata: Record<string, unknown> | null;

  @ForeignKey(() => BookingEvent)
  @AllowNull(true)
  @Column({
    field: 'source_event_id',
    type: DataType.BIGINT,
  })
  declare sourceEventId: number | null;

  @BelongsTo(() => BookingEvent, { foreignKey: 'source_event_id', as: 'sourceEvent' })
  declare sourceEvent?: BookingEvent;
}
