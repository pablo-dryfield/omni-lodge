import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

type Params = { context: QueryInterface };
export async function up({ context: qi }: Params): Promise<void> {
  const transaction = await qi.sequelize.transaction();
  try {
    await qi.createTable('inventory_items', {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true }, name: { type: DataTypes.STRING(160), allowNull: false },
      sku: { type: DataTypes.STRING(80), allowNull: false, unique: true }, unit: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'unit' },
      reorder_level: { type: DataTypes.DECIMAL(14,3), allowNull: false, defaultValue: 0 }, is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      created_by: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'users', key: 'id' } }, updated_by: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'users', key: 'id' } },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }, updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    }, { transaction });
    await qi.createTable('addon_inventory_mappings', {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true }, addon_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'addons', key: 'id' }, onDelete: 'CASCADE' },
      inventory_item_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'inventory_items', key: 'id' }, onDelete: 'CASCADE' }, quantity_per_addon: { type: DataTypes.DECIMAL(14,3), allowNull: false, defaultValue: 1 },
      is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true }, created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }, updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    }, { transaction });
    await qi.addConstraint('addon_inventory_mappings', { fields: ['addon_id','inventory_item_id'], type: 'unique', name: 'addon_inventory_mapping_unique', transaction });
    await qi.createTable('inventory_purchases', {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true }, date: { type: DataTypes.DATEONLY, allowNull: false }, vendor_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'finance_vendors', key: 'id' } },
      finance_transaction_id: { type: DataTypes.INTEGER, allowNull: false, unique: true, references: { model: 'finance_transactions', key: 'id' } }, invoice_file_id: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'finance_files', key: 'id' } },
      invoice_number: { type: DataTypes.STRING(120), allowNull: true }, currency: { type: DataTypes.STRING(3), allowNull: false }, total_minor: { type: DataTypes.INTEGER, allowNull: false }, notes: { type: DataTypes.TEXT, allowNull: true },
      created_by: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'users', key: 'id' } }, created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }, updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    }, { transaction });
    await qi.createTable('inventory_purchase_items', {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true }, purchase_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'inventory_purchases', key: 'id' }, onDelete: 'CASCADE' }, inventory_item_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'inventory_items', key: 'id' } },
      quantity: { type: DataTypes.DECIMAL(14,3), allowNull: false }, unit_cost_minor: { type: DataTypes.INTEGER, allowNull: false }, line_total_minor: { type: DataTypes.INTEGER, allowNull: false }, created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }, updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    }, { transaction });
    await qi.createTable('inventory_movements', {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true }, inventory_item_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'inventory_items', key: 'id' } }, quantity_delta: { type: DataTypes.DECIMAL(14,3), allowNull: false }, type: { type: DataTypes.STRING(30), allowNull: false }, date: { type: DataTypes.DATEONLY, allowNull: false },
      unit_cost_minor: { type: DataTypes.INTEGER, allowNull: true }, purchase_id: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'inventory_purchases', key: 'id' }, onDelete: 'CASCADE' }, counter_id: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'counters', key: 'id' }, onDelete: 'CASCADE' }, notes: { type: DataTypes.TEXT, allowNull: true }, created_by: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'users', key: 'id' } }, created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }, updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    }, { transaction });
    await qi.addIndex('inventory_movements', ['inventory_item_id','date'], { name: 'inventory_movements_item_date_idx', transaction });
    await qi.addIndex('inventory_movements', ['counter_id','inventory_item_id'], { name: 'inventory_movements_counter_item_idx', transaction });
    await transaction.commit();
  } catch (error) { await transaction.rollback(); throw error; }
}
export async function down({ context: qi }: Params): Promise<void> {
  const transaction = await qi.sequelize.transaction();
  try { for (const table of ['inventory_movements','inventory_purchase_items','inventory_purchases','addon_inventory_mappings','inventory_items']) await qi.dropTable(table, { transaction }); await transaction.commit(); }
  catch (error) { await transaction.rollback(); throw error; }
}
