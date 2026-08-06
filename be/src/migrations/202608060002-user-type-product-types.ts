import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

type MigrationParams = { context: QueryInterface };

export async function up({ context }: MigrationParams): Promise<void> {
  await context.createTable('user_type_product_types', {
    id: {
      type: DataTypes.INTEGER, allowNull: false, autoIncrement: true, primaryKey: true,
    },
    user_type_id: {
      type: DataTypes.INTEGER, allowNull: false,
      references: { model: 'userTypes', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE',
    },
    product_type_id: {
      type: DataTypes.INTEGER, allowNull: false,
      references: { model: 'productTypes', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE',
    },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  // Recover a table created by the earlier failed verification attempt. The
  // migration verifier cannot recognize composite primary keys.
  await context.sequelize.query(`
    DO $$
    DECLARE pk_name text;
    DECLARE pk_column_count integer;
    BEGIN
      SELECT c.conname, cardinality(c.conkey)
      INTO pk_name, pk_column_count
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public'
        AND t.relname = 'user_type_product_types'
        AND c.contype = 'p';

      IF pk_name IS NOT NULL AND pk_column_count > 1 THEN
        EXECUTE format('ALTER TABLE public.user_type_product_types DROP CONSTRAINT %I', pk_name);
      END IF;
    END $$;
  `);
  await context.addColumn('user_type_product_types', 'id', {
    type: DataTypes.INTEGER,
    allowNull: false,
    autoIncrement: true,
    primaryKey: true,
  });
  await context.addConstraint('user_type_product_types', {
    fields: ['id'],
    type: 'primary key',
    name: 'user_type_product_types_pkey',
  });
  await context.addIndex('user_type_product_types', ['user_type_id', 'product_type_id'], {
    name: 'user_type_product_types_unique',
    unique: true,
  });
  await context.addIndex('user_type_product_types', ['product_type_id'], {
    name: 'user_type_product_types_product_type_idx',
  });
}

export async function down({ context }: MigrationParams): Promise<void> {
  await context.dropTable('user_type_product_types');
}
