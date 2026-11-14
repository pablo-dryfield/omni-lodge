import { DataTypes, type QueryInterface } from 'sequelize';
type Params = { context: QueryInterface };
export async function up({ context }: Params): Promise<void> {
  await context.sequelize.transaction(async transaction => {
    await context.addColumn('partner_bookings', 'payment_received', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }, { transaction });
    await context.sequelize.query("UPDATE partner_bookings p SET payment_received = true FROM storefront_orders o WHERE p.order_id = o.id AND o.payment_status = 'paid'", { transaction });
  });
}
export async function down({ context }: Params): Promise<void> { await context.removeColumn('partner_bookings', 'payment_received'); }
