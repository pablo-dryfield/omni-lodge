import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const TABLE_BOOKINGS = 'bookings';
const TABLE_BOOKING_EMAILS = 'booking_emails';
const TABLE_BOOKING_EVENTS = 'booking_events';
const TABLE_BOOKING_ADDONS = 'booking_addons';
const TABLE_CHANNELS = 'channels';
const TABLE_GUESTS = 'guests';
const TABLE_PRODUCTS = 'products';
const TABLE_ADDONS = 'addons';
const TABLE_USERS = 'users';

const BOOKING_PLATFORMS = [
  'fareharbor',
  'ecwid',
  'viator',
  'getyourguide',
  'freetour',
  'xperiencepoland',
  'airbnb',
  'manual',
  'unknown',
] as const;

const BOOKING_STATUSES = [
  'pending',
  'confirmed',
  'amended',
  'cancelled',
  'completed',
  'no_show',
  'unknown',
] as const;

const BOOKING_PAYMENT_STATUSES = [
  'unknown',
  'unpaid',
  'deposit',
  'partial',
  'paid',
  'refunded',
] as const;

const BOOKING_EVENT_TYPES = ['created', 'amended', 'cancelled', 'replayed', 'note'] as const;

const dropEnumTypes = async (qi: QueryInterface, enumNames: string[]): Promise<void> => {
  for (const typeName of enumNames) {
    await qi.sequelize.query(`DROP TYPE IF EXISTS "${typeName}";`);
  }
};

export async function up({ context }: MigrationParams): Promise<void> {
  const qi = context;

  await qi.dropTable(TABLE_BOOKINGS);

  await qi.createTable(TABLE_BOOKINGS, {
    id: {
      type: DataTypes.BIGINT,
      allowNull: false,
      autoIncrement: true,
      primaryKey: true,
    },
    platform: {
      type: DataTypes.ENUM(...BOOKING_PLATFORMS),
      allowNull: false,
      defaultValue: 'unknown',
    },
    platform_booking_id: {
      type: DataTypes.STRING(192),
      allowNull: false,
    },
    platform_order_id: {
      type: DataTypes.STRING(192),
      allowNull: true,
    },
    last_email_message_id: {
      type: DataTypes.STRING(256),
      allowNull: true,
    },
    channel_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: TABLE_CHANNELS, key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    },
    guest_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: TABLE_GUESTS, key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    },
    status: {
      type: DataTypes.ENUM(...BOOKING_STATUSES),
      allowNull: false,
      defaultValue: 'unknown',
    },
    payment_status: {
      type: DataTypes.ENUM(...BOOKING_PAYMENT_STATUSES),
      allowNull: false,
      defaultValue: 'unknown',
    },
    payment_method: {
      type: DataTypes.STRING(128),
      allowNull: true,
    },
    experience_date: {
      type: DataTypes.DATEONLY,
      allowNull: true,
    },
    experience_start_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    experience_end_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    product_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: TABLE_PRODUCTS, key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    },
    product_name: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    product_variant: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    guest_first_name: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    guest_last_name: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    guest_email: {
      type: DataTypes.STRING(320),
      allowNull: true,
    },
    guest_phone: {
      type: DataTypes.STRING(64),
      allowNull: true,
    },
    pickup_location: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    hotel_name: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    party_size_total: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    party_size_adults: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    party_size_children: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    currency: {
      type: DataTypes.STRING(3),
      allowNull: true,
    },
    base_amount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: true,
    },
    addons_amount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: true,
    },
    discount_amount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: true,
    },
    price_gross: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: true,
    },
    price_net: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: true,
    },
    commission_amount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: true,
    },
    commission_rate: {
      type: DataTypes.DECIMAL(5, 2),
      allowNull: true,
    },
    addons_snapshot: {
      type: DataTypes.JSONB,
      allowNull: true,
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    raw_payload_location: {
      type: DataTypes.STRING(512),
      allowNull: true,
    },
    source_received_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    processed_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    cancelled_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    created_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: TABLE_USERS, key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    },
    updated_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: TABLE_USERS, key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    updated_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  });

  await qi.addIndex(TABLE_BOOKINGS, ['platform', 'platform_booking_id'], {
    name: 'bookings_platform_booking_id_idx',
    unique: true,
  });
  await qi.addIndex(TABLE_BOOKINGS, ['channel_id'], { name: 'bookings_channel_idx' });
  await qi.addIndex(TABLE_BOOKINGS, ['experience_date'], { name: 'bookings_experience_date_idx' });

  await qi.createTable(TABLE_BOOKING_EMAILS, {
    id: {
      type: DataTypes.BIGINT,
      allowNull: false,
      autoIncrement: true,
      primaryKey: true,
    },
    message_id: {
      type: DataTypes.STRING(256),
      allowNull: false,
      unique: true,
    },
    thread_id: {
      type: DataTypes.STRING(256),
      allowNull: true,
    },
    history_id: {
      type: DataTypes.STRING(128),
      allowNull: true,
    },
    from_address: {
      type: DataTypes.STRING(512),
      allowNull: true,
    },
    to_addresses: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    cc_addresses: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    subject: {
      type: DataTypes.STRING(512),
      allowNull: true,
    },
    snippet: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    received_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    internal_date: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    raw_payload: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    payload_size: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    label_ids: {
      type: DataTypes.ARRAY(DataTypes.STRING),
      allowNull: true,
    },
    headers: {
      type: DataTypes.JSONB,
      allowNull: true,
    },
    ingestion_status: {
      type: DataTypes.STRING(32),
      allowNull: false,
      defaultValue: 'pending',
    },
    failure_reason: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    updated_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  });

  await qi.addIndex(TABLE_BOOKING_EMAILS, ['thread_id'], { name: 'booking_emails_thread_idx' });

  await qi.createTable(TABLE_BOOKING_EVENTS, {
    id: {
      type: DataTypes.BIGINT,
      allowNull: false,
      autoIncrement: true,
      primaryKey: true,
    },
    booking_id: {
      type: DataTypes.BIGINT,
      allowNull: false,
      references: { model: TABLE_BOOKINGS, key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
    email_id: {
      type: DataTypes.BIGINT,
      allowNull: true,
      references: { model: TABLE_BOOKING_EMAILS, key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    },
    event_type: {
      type: DataTypes.ENUM(...BOOKING_EVENT_TYPES),
      allowNull: false,
    },
    platform: {
      type: DataTypes.ENUM(...BOOKING_PLATFORMS),
      allowNull: false,
    },
    status_after: {
      type: DataTypes.ENUM(...BOOKING_STATUSES),
      allowNull: true,
    },
    email_message_id: {
      type: DataTypes.STRING(256),
      allowNull: true,
    },
    event_payload: {
      type: DataTypes.JSONB,
      allowNull: true,
    },
    occurred_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    ingested_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    processed_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    processing_error: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    updated_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  });

  await qi.addIndex(TABLE_BOOKING_EVENTS, ['booking_id'], { name: 'booking_events_booking_idx' });
  await qi.addIndex(TABLE_BOOKING_EVENTS, ['email_message_id'], {
    name: 'booking_events_email_message_idx',
    unique: true,
  });

  await qi.createTable(TABLE_BOOKING_ADDONS, {
    id: {
      type: DataTypes.BIGINT,
      allowNull: false,
      autoIncrement: true,
      primaryKey: true,
    },
    booking_id: {
      type: DataTypes.BIGINT,
      allowNull: false,
      references: { model: TABLE_BOOKINGS, key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
    addon_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: TABLE_ADDONS, key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    },
    source_event_id: {
      type: DataTypes.BIGINT,
      allowNull: true,
      references: { model: TABLE_BOOKING_EVENTS, key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    },
    platform_addon_id: {
      type: DataTypes.STRING(192),
      allowNull: true,
    },
    platform_addon_name: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    quantity: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
    },
    unit_price: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: true,
    },
    total_price: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: true,
    },
    currency: {
      type: DataTypes.STRING(3),
      allowNull: true,
    },
    tax_amount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: true,
    },
    is_included: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    metadata: {
      type: DataTypes.JSONB,
      allowNull: true,
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    updated_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  });

  await qi.addIndex(TABLE_BOOKING_ADDONS, ['booking_id'], { name: 'booking_addons_booking_idx' });
  await qi.addIndex(TABLE_BOOKING_ADDONS, ['booking_id', 'platform_addon_id'], {
    name: 'booking_addons_platform_unique_idx',
    unique: true,
  });
}

export async function down({ context }: MigrationParams): Promise<void> {
  const qi = context;

  await qi.dropTable(TABLE_BOOKING_ADDONS);
  await qi.dropTable(TABLE_BOOKING_EVENTS);
  await qi.dropTable(TABLE_BOOKING_EMAILS);
  await qi.dropTable(TABLE_BOOKINGS);

  await dropEnumTypes(qi, [
    'enum_booking_events_event_type',
    'enum_booking_events_platform',
    'enum_booking_events_status_after',
    'enum_bookings_platform',
    'enum_bookings_status',
    'enum_bookings_payment_status',
  ]);

  await qi.createTable(TABLE_BOOKINGS, {
    id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      autoIncrement: true,
      primaryKey: true,
    },
    guest_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: TABLE_GUESTS, key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    },
    channel_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: TABLE_CHANNELS, key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    },
    check_in_date: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    check_out_date: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    total_amount: {
      type: DataTypes.FLOAT,
      allowNull: true,
    },
    payment_status: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    room_type: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    num_guests: {
      type: DataTypes.FLOAT,
      allowNull: true,
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    created_by: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: TABLE_USERS, key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
    updated_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: TABLE_USERS, key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    updated_at: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: DataTypes.NOW,
    },
  });
}
