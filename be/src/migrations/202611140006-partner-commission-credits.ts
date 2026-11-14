import { DataTypes, type QueryInterface } from 'sequelize';
type Params = { context: QueryInterface };
export async function up({ context }: Params): Promise<void> {
  await context.addColumn('partner_bookings', 'partner_credit_paid', { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 });
}
export async function down({ context }: Params): Promise<void> { await context.removeColumn('partner_bookings', 'partner_credit_paid'); }
