import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';
type Params = { context: QueryInterface };
export async function up({ context: query }: Params) {
  const transaction = await query.sequelize.transaction();
  try {
    await query.addColumn('bookings', 'attended_tshirt_sizes', { type: DataTypes.JSONB, allowNull: true }, { transaction });
    await query.addColumn('addon_inventory_mappings', 'variant', { type: DataTypes.STRING(40), allowNull: true }, { transaction });
    await transaction.commit();
  } catch (error) { await transaction.rollback(); throw error; }
}
export async function down({ context: query }: Params) {
  const transaction = await query.sequelize.transaction();
  try { await query.removeColumn('addon_inventory_mappings', 'variant', { transaction }); await query.removeColumn('bookings', 'attended_tshirt_sizes', { transaction }); await transaction.commit(); }
  catch (error) { await transaction.rollback(); throw error; }
}
