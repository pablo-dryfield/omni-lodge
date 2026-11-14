import { DataTypes, type QueryInterface } from 'sequelize';
import { ensurePartnerAccessControl } from '../services/partners/partnerAccessSeed.js';

type Params = { context: QueryInterface };
const id = () => ({ type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false });
const str = (length: number, allowNull = false) => ({ type: DataTypes.STRING(length), allowNull });
const json = (allowNull = false) => ({ type: DataTypes.JSONB, allowNull });
const cash = () => ({ type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 });
const date = () => ({ type: DataTypes.DATE, allowNull: true });
const ref = (table: string, allowNull = false, big = false) => ({ type: big ? DataTypes.BIGINT : DataTypes.INTEGER, allowNull, references: { model: table, key: 'id' }, onDelete: 'RESTRICT' });
const stamps = () => ({ created_at: { type: DataTypes.DATE, allowNull: false }, updated_at: { type: DataTypes.DATE, allowNull: false } });

export async function up({ context: q }: Params): Promise<void> {
  await q.sequelize.transaction(async transaction => {
    const options = { transaction };
    await q.createTable('partner_profiles', {
      id: id(), channel_id: { ...ref('channels'), unique: true }, public_code: { ...str(64), unique: true }, name: str(160), status: { ...str(24), defaultValue: 'active' }, agreement: json(), version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 }, created_by: ref('users'), connect_accounts: json(true), ...stamps(),
    }, options);
    await q.createTable('partner_members', { id: id(), partner_id: ref('partner_profiles'), user_id: ref('users'), role: str(20), active: { type: DataTypes.BOOLEAN, defaultValue: true, allowNull: false }, ...stamps() }, options);
    await q.addIndex('partner_members', ['partner_id', 'user_id'], { ...options, unique: true });
    await q.createTable('partner_credentials', { id: id(), partner_id: ref('partner_profiles'), label: str(100), token_hash: { ...str(64), unique: true }, scopes: json(), expires_at: { type: DataTypes.DATE, allowNull: false }, revoked_at: date(), last_used_at: date(), ...stamps() }, options);
    await q.createTable('partner_bookings', {
      id: id(), partner_id: ref('partner_profiles'), external_reference: str(160), request_hash: str(64), order_id: { ...ref('storefront_orders', true, true), unique: true }, status: { ...str(32), defaultValue: 'requested' }, payment_mode: str(24), source: str(24), selection: json(), snapshot: json(), total: cash(), commission: cash(), refunded_amount: cash(), settled_amount: cash(), transfer_id: str(128, true), reversed_amount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 }, checkout_url: { type: DataTypes.TEXT, allowNull: true }, access_hash: str(64, true), created_by: ref('users', true), reconciliation_error: str(256, true), ...stamps(),
    }, options);
    await q.addIndex('partner_bookings', ['partner_id', 'external_reference'], { ...options, unique: true });
    await q.addIndex('partner_bookings', ['partner_id', 'status', 'id'], options);
    await q.createTable('partner_offerings', { id: id(), partner_id: ref('partner_profiles'), code: str(64), kind: str(20), name: str(160), items: json(), active: { type: DataTypes.BOOLEAN, defaultValue: true, allowNull: false }, ...stamps() }, options);
    await q.addIndex('partner_offerings', ['partner_id', 'code'], { ...options, unique: true });
    await q.createTable('partner_events', { id: id(), partner_id: ref('partner_profiles'), booking_id: ref('partner_bookings', true), actor_id: ref('users', true), type: str(80), data: json(), ...stamps() }, options);
    await q.addIndex('partner_events', ['partner_id', 'id'], options);
    await q.createTable('partner_webhooks', { id: id(), partner_id: { ...ref('partner_profiles'), unique: true }, url: { type: DataTypes.TEXT, allowNull: false }, secret: json(), active: { type: DataTypes.BOOLEAN, defaultValue: true, allowNull: false }, ...stamps() }, options);
    await q.createTable('partner_deliveries', { id: id(), partner_id: ref('partner_profiles'), event_id: ref('partner_events'), attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 }, status: { ...str(24), defaultValue: 'pending' }, next_attempt_at: date(), last_status: { type: DataTypes.INTEGER, allowNull: true }, ...stamps() }, options);
    await q.addIndex('partner_deliveries', ['partner_id', 'event_id'], { ...options, unique: true });
    await q.addIndex('partner_deliveries', ['status', 'next_attempt_at'], options);
    await q.sequelize.query(`ALTER TABLE partner_profiles ADD CONSTRAINT partner_profile_status CHECK (status IN ('active','suspended'));
      ALTER TABLE partner_members ADD CONSTRAINT partner_member_role CHECK (role IN ('owner','agent','developer'));
      ALTER TABLE partner_bookings ADD CONSTRAINT partner_booking_amounts CHECK (total >= 0 AND commission >= 0 AND commission <= total AND refunded_amount >= 0 AND refunded_amount <= total AND settled_amount >= 0 AND reversed_amount >= 0);
      ALTER TABLE partner_bookings ADD CONSTRAINT partner_booking_payment_mode CHECK (payment_mode IN ('platform','partner','arrival'));
      ALTER TABLE partner_offerings ADD CONSTRAINT partner_offering_kind CHECK (kind IN ('package','voucher'));`, options);
    await ensurePartnerAccessControl(transaction);
  });
}

export async function down({ context: q }: Params): Promise<void> {
  await q.sequelize.transaction(async transaction => {
    for (const table of ['partner_deliveries', 'partner_webhooks', 'partner_events', 'partner_offerings', 'partner_bookings', 'partner_credentials', 'partner_members', 'partner_profiles']) await q.dropTable(table, { transaction });
  });
}
