import { DataTypes, type QueryInterface } from 'sequelize';
type Params = { context: QueryInterface };
export async function up({ context }: Params): Promise<void> {
  await context.addColumn('partner_bookings', 'commission_earned', { type: DataTypes.DECIMAL(12, 2), allowNull: true });
}
export async function down({ context }: Params): Promise<void> { await context.removeColumn('partner_bookings', 'commission_earned'); }
