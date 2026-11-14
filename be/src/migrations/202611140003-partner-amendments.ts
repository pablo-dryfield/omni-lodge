import { DataTypes, type QueryInterface } from 'sequelize';
type Params = { context: QueryInterface };
const id = () => ({ type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false });
const str = (length: number, allowNull = false) => ({ type: DataTypes.STRING(length), allowNull });
const cash = () => ({ type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 });
const stamps = () => ({ created_at: { type: DataTypes.DATE, allowNull: false }, updated_at: { type: DataTypes.DATE, allowNull: false } });
const ref = () => ({ type: DataTypes.INTEGER, allowNull: false, references: { model: 'partner_bookings', key: 'id' }, onDelete: 'RESTRICT' });
export async function up({ context: q }: Params): Promise<void> {
  await q.sequelize.transaction(async transaction => {
    const options = { transaction };
    await q.addColumn('partner_bookings', 'amendment_refunded_amount', cash(), options);
    await q.createTable('partner_payments', { id: id(), booking_id: ref(), reference: str(80), amount: cash(), commission: cash(), payment_intent_id: { ...str(128, true), unique: true }, transfer_id: str(128, true), reversed_amount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 }, ...stamps() }, options);
    await q.addIndex('partner_payments', ['booking_id', 'reference'], { ...options, unique: true });
    await q.createTable('partner_amendments', { id: id(), booking_id: ref(), reference: str(160), request_hash: str(64), previous_hash: str(64), selection: { type: DataTypes.JSONB, allowNull: false }, quote: { type: DataTypes.JSONB, allowNull: false }, status: str(24), difference: cash(), reason: str(1000), actor_id: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'users', key: 'id' } }, notify_customer: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true }, checkout_session_id: { ...str(128, true), unique: true }, checkout_url: { type: DataTypes.TEXT, allowNull: true }, payment_email_sent_at: { type: DataTypes.DATE, allowNull: true }, notification_sent_at: { type: DataTypes.DATE, allowNull: true }, failure_reason: str(256, true), ...stamps() }, options);
    await q.addIndex('partner_amendments', ['booking_id', 'reference'], { ...options, unique: true });
    await q.addIndex('partner_amendments', ['status', 'id'], options);
    await q.sequelize.query("ALTER TABLE partner_payments ADD CONSTRAINT partner_payment_amounts CHECK (amount >= 0 AND commission >= 0 AND commission <= amount AND reversed_amount >= 0); ALTER TABLE partner_amendments ADD CONSTRAINT partner_amendment_status CHECK (status IN ('pending_payment','applying','completed','expired','failed'));", options);
  });
}
export async function down({ context: q }: Params): Promise<void> {
  await q.sequelize.transaction(async transaction => {
    await q.dropTable('partner_amendments', { transaction });
    await q.dropTable('partner_payments', { transaction });
    await q.removeColumn('partner_bookings', 'amendment_refunded_amount', { transaction });
  });
}
