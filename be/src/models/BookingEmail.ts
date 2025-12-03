import {
  Model,
  Table,
  Column,
  PrimaryKey,
  AutoIncrement,
  AllowNull,
  DataType,
  Default,
} from 'sequelize-typescript';

@Table({
  timestamps: true,
  modelName: 'BookingEmails',
  tableName: 'booking_emails',
})
export default class BookingEmail extends Model<BookingEmail> {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.BIGINT)
  declare id: number;

  @AllowNull(false)
  @Column({
    field: 'message_id',
    type: DataType.STRING(256),
    unique: true,
  })
  declare messageId: string;

  @AllowNull(true)
  @Column({
    field: 'thread_id',
    type: DataType.STRING(256),
  })
  declare threadId: string | null;

  @AllowNull(true)
  @Column({
    field: 'history_id',
    type: DataType.STRING(128),
  })
  declare historyId: string | null;

  @AllowNull(true)
  @Column({
    field: 'from_address',
    type: DataType.STRING(512),
  })
  declare fromAddress: string | null;

  @AllowNull(true)
  @Column({
    field: 'to_addresses',
    type: DataType.TEXT,
  })
  declare toAddresses: string | null;

  @AllowNull(true)
  @Column({
    field: 'cc_addresses',
    type: DataType.TEXT,
  })
  declare ccAddresses: string | null;

  @AllowNull(true)
  @Column(DataType.STRING(512))
  declare subject: string | null;

  @AllowNull(true)
  @Column(DataType.TEXT)
  declare snippet: string | null;

  @AllowNull(true)
  @Column({
    field: 'received_at',
    type: DataType.DATE,
  })
  declare receivedAt: Date | null;

  @AllowNull(true)
  @Column({
    field: 'internal_date',
    type: DataType.DATE,
  })
  declare internalDate: Date | null;

  @AllowNull(true)
  @Column({
    field: 'raw_payload',
    type: DataType.TEXT,
  })
  declare rawPayload: string | null;

  @AllowNull(true)
  @Column({
    field: 'payload_size',
    type: DataType.INTEGER,
  })
  declare payloadSize: number | null;

  @AllowNull(true)
  @Column({
    field: 'label_ids',
    type: DataType.ARRAY(DataType.STRING),
  })
  declare labelIds: string[] | null;

  @AllowNull(true)
  @Column(DataType.JSONB)
  declare headers: Record<string, string> | null;

  @AllowNull(false)
  @Default('pending')
  @Column({
    field: 'ingestion_status',
    type: DataType.STRING(32),
  })
  declare ingestionStatus: string;

  @AllowNull(true)
  @Column({
    field: 'failure_reason',
    type: DataType.TEXT,
  })
  declare failureReason: string | null;
}
