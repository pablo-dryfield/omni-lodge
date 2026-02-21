import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const TABLE_VARIANTS = 'open_bar_ingredient_variants';
const TABLE_INGREDIENTS = 'open_bar_ingredients';
const TABLE_DELIVERY_ITEMS = 'open_bar_delivery_items';
const LEGACY_DELIVERY_UNIQUE = 'open_bar_delivery_items_delivery_ingredient_uq';
const FK_VARIANT_ON_DELIVERY = 'open_bar_delivery_items_variant_id_fkey';

export async function up({ context }: MigrationParams): Promise<void> {
  const qi = context;
  const transaction = await qi.sequelize.transaction();
  try {
    await qi.createTable(
      TABLE_VARIANTS,
      {
        id: {
          type: DataTypes.INTEGER,
          autoIncrement: true,
          primaryKey: true,
        },
        ingredient_id: {
          type: DataTypes.INTEGER,
          allowNull: false,
          references: { model: TABLE_INGREDIENTS, key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        name: {
          type: DataTypes.STRING(160),
          allowNull: false,
        },
        brand: {
          type: DataTypes.STRING(120),
          allowNull: true,
        },
        package_label: {
          type: DataTypes.STRING(160),
          allowNull: true,
        },
        base_quantity: {
          type: DataTypes.DECIMAL(12, 3),
          allowNull: false,
          defaultValue: 1,
        },
        is_active: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: true,
        },
        created_by: {
          type: DataTypes.INTEGER,
          allowNull: true,
          references: { model: 'users', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        updated_by: {
          type: DataTypes.INTEGER,
          allowNull: true,
          references: { model: 'users', key: 'id' },
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
        },
      },
      { transaction },
    );

    await qi.addConstraint(TABLE_VARIANTS, {
      type: 'unique',
      name: 'open_bar_ingredient_variants_ingredient_name_uq',
      fields: ['ingredient_id', 'name'],
      transaction,
    });

    await qi.addIndex(TABLE_VARIANTS, ['ingredient_id'], {
      name: 'open_bar_ingredient_variants_ingredient_idx',
      transaction,
    });

    await qi.addIndex(TABLE_VARIANTS, ['is_active'], {
      name: 'open_bar_ingredient_variants_active_idx',
      transaction,
    });

    await qi.addColumn(
      TABLE_DELIVERY_ITEMS,
      'variant_id',
      {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: TABLE_VARIANTS, key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      { transaction },
    );

    await qi.addColumn(
      TABLE_DELIVERY_ITEMS,
      'purchase_units',
      {
        type: DataTypes.DECIMAL(12, 3),
        allowNull: true,
      },
      { transaction },
    );

    await qi.addColumn(
      TABLE_DELIVERY_ITEMS,
      'purchase_unit_cost',
      {
        type: DataTypes.DECIMAL(12, 4),
        allowNull: true,
      },
      { transaction },
    );

    await qi.addIndex(TABLE_DELIVERY_ITEMS, ['variant_id'], {
      name: 'open_bar_delivery_items_variant_idx',
      transaction,
    });

    await qi.removeConstraint(TABLE_DELIVERY_ITEMS, LEGACY_DELIVERY_UNIQUE, { transaction }).catch(() => {});

    await qi.sequelize.query(
      `
      INSERT INTO ${TABLE_VARIANTS}
        (ingredient_id, name, brand, package_label, base_quantity, is_active, created_at, updated_at)
      SELECT
        ingredients.id,
        CONCAT(ingredients.name, ' - Generic'),
        NULL,
        'Generic',
        1,
        true,
        NOW(),
        NOW()
      FROM ${TABLE_INGREDIENTS} AS ingredients
      ON CONFLICT (ingredient_id, name) DO NOTHING;
      `,
      { transaction },
    );

    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export async function down({ context }: MigrationParams): Promise<void> {
  const qi = context;
  const transaction = await qi.sequelize.transaction();
  try {
    await qi.removeIndex(TABLE_DELIVERY_ITEMS, 'open_bar_delivery_items_variant_idx', { transaction }).catch(() => {});
    await qi.removeConstraint(TABLE_DELIVERY_ITEMS, FK_VARIANT_ON_DELIVERY, { transaction }).catch(() => {});
    await qi.removeColumn(TABLE_DELIVERY_ITEMS, 'purchase_unit_cost', { transaction }).catch(() => {});
    await qi.removeColumn(TABLE_DELIVERY_ITEMS, 'purchase_units', { transaction }).catch(() => {});
    await qi.removeColumn(TABLE_DELIVERY_ITEMS, 'variant_id', { transaction }).catch(() => {});

    await qi.addConstraint(TABLE_DELIVERY_ITEMS, {
      type: 'unique',
      name: LEGACY_DELIVERY_UNIQUE,
      fields: ['delivery_id', 'ingredient_id'],
      transaction,
    }).catch(() => {});

    await qi.dropTable(TABLE_VARIANTS, { transaction });
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}
