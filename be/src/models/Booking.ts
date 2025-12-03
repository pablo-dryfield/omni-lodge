import {
  Model,
  Table,
  Column,
  PrimaryKey,
  AutoIncrement,
  AllowNull,
  Default,
  DataType,
  ForeignKey,
  BelongsTo,
} from 'sequelize-typescript';
import { BOOKING_PAYMENT_STATUSES, BOOKING_PLATFORMS, BOOKING_STATUSES, type BookingPaymentStatus, type BookingPlatform, type BookingStatus } from '../constants/bookings.js';
import Channel from './Channel.js';
import Guest from './Guest.js';
import Product from './Product.js';
import User from './User.js';

@Table({
  timestamps: true,
  modelName: 'Bookings',
  tableName: 'bookings',
})
export default class Booking extends Model<Booking> {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.BIGINT)
  declare id: number;

  @AllowNull(false)
  @Column({
    type: DataType.ENUM(...BOOKING_PLATFORMS),
  })
  declare platform: BookingPlatform;

  @AllowNull(false)
  @Column({
    field: 'platform_booking_id',
    type: DataType.STRING(192),
  })
  declare platformBookingId: string;

  @AllowNull(true)
  @Column({
    field: 'platform_order_id',
    type: DataType.STRING(192),
  })
  declare platformOrderId: string | null;

  @AllowNull(true)
  @Column({
    field: 'last_email_message_id',
    type: DataType.STRING(256),
  })
  declare lastEmailMessageId: string | null;

  @ForeignKey(() => Channel)
  @AllowNull(true)
  @Column({
    field: 'channel_id',
    type: DataType.INTEGER,
  })
  declare channelId: number | null;

  @BelongsTo(() => Channel, { foreignKey: 'channel_id', as: 'channel' })
  declare channel?: Channel;

  @ForeignKey(() => Guest)
  @AllowNull(true)
  @Column({
    field: 'guest_id',
    type: DataType.INTEGER,
  })
  declare guestId: number | null;

  @BelongsTo(() => Guest, { foreignKey: 'guest_id', as: 'guest' })
  declare guest?: Guest;

  @AllowNull(false)
  @Default('unknown')
  @Column({
    type: DataType.ENUM(...BOOKING_STATUSES),
  })
  declare status: BookingStatus;

  @AllowNull(false)
  @Default('unknown')
  @Column({
    field: 'payment_status',
    type: DataType.ENUM(...BOOKING_PAYMENT_STATUSES),
  })
  declare paymentStatus: BookingPaymentStatus;

  @AllowNull(true)
  @Column({
    field: 'payment_method',
    type: DataType.STRING(128),
  })
  declare paymentMethod: string | null;

  @AllowNull(true)
  @Column({
    field: 'experience_date',
    type: DataType.DATEONLY,
  })
  declare experienceDate: string | null;

  @AllowNull(true)
  @Column({
    field: 'experience_start_at',
    type: DataType.DATE,
  })
  declare experienceStartAt: Date | null;

  @AllowNull(true)
  @Column({
    field: 'experience_end_at',
    type: DataType.DATE,
  })
  declare experienceEndAt: Date | null;

  @ForeignKey(() => Product)
  @AllowNull(true)
  @Column({
    field: 'product_id',
    type: DataType.INTEGER,
  })
  declare productId: number | null;

  @BelongsTo(() => Product, { foreignKey: 'product_id', as: 'product' })
  declare product?: Product;

  @AllowNull(true)
  @Column({
    field: 'product_name',
    type: DataType.STRING(255),
  })
  declare productName: string | null;

  @AllowNull(true)
  @Column({
    field: 'product_variant',
    type: DataType.STRING(255),
  })
  declare productVariant: string | null;

  @AllowNull(true)
  @Column({
    field: 'guest_first_name',
    type: DataType.STRING(255),
  })
  declare guestFirstName: string | null;

  @AllowNull(true)
  @Column({
    field: 'guest_last_name',
    type: DataType.STRING(255),
  })
  declare guestLastName: string | null;

  @AllowNull(true)
  @Column({
    field: 'guest_email',
    type: DataType.STRING(320),
  })
  declare guestEmail: string | null;

  @AllowNull(true)
  @Column({
    field: 'guest_phone',
    type: DataType.STRING(64),
  })
  declare guestPhone: string | null;

  @AllowNull(true)
  @Column({
    field: 'pickup_location',
    type: DataType.TEXT,
  })
  declare pickupLocation: string | null;

  @AllowNull(true)
  @Column({
    field: 'hotel_name',
    type: DataType.STRING(255),
  })
  declare hotelName: string | null;

  @AllowNull(true)
  @Column({
    field: 'party_size_total',
    type: DataType.INTEGER,
  })
  declare partySizeTotal: number | null;

  @AllowNull(true)
  @Column({
    field: 'party_size_adults',
    type: DataType.INTEGER,
  })
  declare partySizeAdults: number | null;

  @AllowNull(true)
  @Column({
    field: 'party_size_children',
    type: DataType.INTEGER,
  })
  declare partySizeChildren: number | null;

  @AllowNull(true)
  @Column({
    field: 'currency',
    type: DataType.STRING(3),
  })
  declare currency: string | null;

  @AllowNull(true)
  @Column({
    field: 'base_amount',
    type: DataType.DECIMAL(12, 2),
  })
  declare baseAmount: string | null;

  @AllowNull(true)
  @Column({
    field: 'addons_amount',
    type: DataType.DECIMAL(12, 2),
  })
  declare addonsAmount: string | null;

  @AllowNull(true)
  @Column({
    field: 'discount_amount',
    type: DataType.DECIMAL(12, 2),
  })
  declare discountAmount: string | null;

  @AllowNull(true)
  @Column({
    field: 'price_gross',
    type: DataType.DECIMAL(12, 2),
  })
  declare priceGross: string | null;

  @AllowNull(true)
  @Column({
    field: 'price_net',
    type: DataType.DECIMAL(12, 2),
  })
  declare priceNet: string | null;

  @AllowNull(true)
  @Column({
    field: 'commission_amount',
    type: DataType.DECIMAL(12, 2),
  })
  declare commissionAmount: string | null;

  @AllowNull(true)
  @Column({
    field: 'commission_rate',
    type: DataType.DECIMAL(5, 2),
  })
  declare commissionRate: string | null;

  @AllowNull(true)
  @Column({
    field: 'addons_snapshot',
    type: DataType.JSONB,
  })
  declare addonsSnapshot: Record<string, unknown> | null;

  @AllowNull(true)
  @Column(DataType.TEXT)
  declare notes: string | null;

  @AllowNull(true)
  @Column({
    field: 'raw_payload_location',
    type: DataType.STRING(512),
  })
  declare rawPayloadLocation: string | null;

  @AllowNull(true)
  @Column({
    field: 'source_received_at',
    type: DataType.DATE,
  })
  declare sourceReceivedAt: Date | null;

  @AllowNull(true)
  @Column({
    field: 'processed_at',
    type: DataType.DATE,
  })
  declare processedAt: Date | null;

  @AllowNull(true)
  @Column({
    field: 'cancelled_at',
    type: DataType.DATE,
  })
  declare cancelledAt: Date | null;

  @AllowNull(false)
  @Default(DataType.NOW)
  @Column({
    field: 'created_at',
    type: DataType.DATE,
  })
  declare createdAt: Date;

  @AllowNull(false)
  @Default(DataType.NOW)
  @Column({
    field: 'updated_at',
    type: DataType.DATE,
  })
  declare updatedAt: Date;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column({
    field: 'created_by',
    type: DataType.INTEGER,
  })
  declare createdBy: number | null;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column({
    field: 'updated_by',
    type: DataType.INTEGER,
  })
  declare updatedBy: number | null;

  @BelongsTo(() => User, { foreignKey: 'created_by', as: 'createdByUser' })
  declare createdByUser?: User;

  @BelongsTo(() => User, { foreignKey: 'updated_by', as: 'updatedByUser' })
  declare updatedByUser?: User;

}
