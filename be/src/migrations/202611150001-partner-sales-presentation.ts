import { DataTypes, type QueryInterface } from 'sequelize';
type Params = { context: QueryInterface };
export async function up({ context }: Params): Promise<void> {
  await context.addColumn('partner_profiles', 'sales_page_config', { type: DataTypes.JSONB, allowNull: false, defaultValue: {} });
}
export async function down({ context }: Params): Promise<void> { await context.removeColumn('partner_profiles', 'sales_page_config'); }
export async function verify({ context }: Params): Promise<boolean> { return Boolean((await context.describeTable('partner_profiles')).sales_page_config); }
