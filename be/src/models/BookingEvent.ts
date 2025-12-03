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
import {
  BOOKING_EVENT_TYPES,
  BOOKING_PLATFORMS,
  BOOKING_STATUSES,
  type BookingEventType,
  type BookingPlatform,
  type BookingStatus,
} from '../constants/bookings.js';
import Booking from './Booking.js';
import BookingEmail from './BookingEmail.js';

@Table({
  timestamps: true,
  modelName: 'BookingEvents',
  tableName: 'booking_events',
})
export default class BookingEvent extends Model<BookingEvent> {
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

  @ForeignKey(() => BookingEmail)
  @AllowNull(true)
  @Column({
    field: 'email_id',
    type: DataType.BIGINT,
  })
  declare emailId: number | null;

  @BelongsTo(() => BookingEmail, { foreignKey: 'email_id', as: 'email' })
  declare email?: BookingEmail;

  @AllowNull(false)
  @Column({
    type: DataType.ENUM(...BOOKING_EVENT_TYPES),
    field: 'event_type',
  })
  declare eventType: BookingEventType;

  @AllowNull(false)
  @Column({
    type: DataType.ENUM(...BOOKING_PLATFORMS),
  })
  declare platform: BookingPlatform;

  @AllowNull(true)
  @Column({
    field: 'status_after',
    type: DataType.ENUM(...BOOKING_STATUSES),
  })
  declare statusAfter: BookingStatus | null;

  @AllowNull(true)
  @Column({
    field: 'email_message_id',
    type: DataType.STRING(256),
  })
  declare emailMessageId: string | null;

  @AllowNull(true)
  @Column({
    field: 'event_payload',
    type: DataType.JSONB,
  })
  declare eventPayload: Record<string, unknown> | null;

  @AllowNull(true)
  @Column({
    field: 'occurred_at',
    type: DataType.DATE,
  })
  declare occurredAt: Date | null;

  @AllowNull(false)
  @Default(DataType.NOW)
  @Column({
    field: 'ingested_at',
    type: DataType.DATE,
  })
  declare ingestedAt: Date;

  @AllowNull(true)
  @Column({
    field: 'processed_at',
    type: DataType.DATE,
  })
  declare processedAt: Date | null;

  @AllowNull(true)
  @Column({
    field: 'processing_error',
    type: DataType.TEXT,
  })
  declare processingError: string | null;
}
