import { DataTypes, type QueryInterface } from 'sequelize';
type Params = { context: QueryInterface };
export async function up({ context }: Params): Promise<void> {
  await context.sequelize.transaction(async transaction => {
    await context.addColumn('partner_bookings', 'commission_calculation', { type: DataTypes.JSONB, allowNull: true }, { transaction });
    await context.addColumn('partner_bookings', 'commission_transferred', { type: DataTypes.DECIMAL(12, 2), allowNull: true }, { transaction });
  });
}
export async function down({ context }: Params): Promise<void> {
  await context.sequelize.transaction(async transaction => {
    await context.removeColumn('partner_bookings', 'commission_transferred', { transaction });
    await context.removeColumn('partner_bookings', 'commission_calculation', { transaction });
  });
}
