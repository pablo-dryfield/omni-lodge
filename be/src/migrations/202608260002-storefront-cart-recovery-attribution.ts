import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

type MigrationParams = { context: QueryInterface };

export async function up({ context }: MigrationParams): Promise<void> {
  await context.addColumn('storefront_ongoing_carts', 'recovery_token', {
    type: DataTypes.UUID,
    allowNull: true,
  });
  await context.addColumn('storefront_ongoing_carts', 'first_recovery_sent_at', {
    type: DataTypes.DATE,
    allowNull: true,
  });
  await context.addColumn('storefront_ongoing_carts', 'last_recovery_sent_at', {
    type: DataTypes.DATE,
    allowNull: true,
  });
  await context.addColumn('storefront_ongoing_carts', 'recovery_opened_at', {
    type: DataTypes.DATE,
    allowNull: true,
  });
  await context.addColumn('storefront_ongoing_carts', 'recovered_at', {
    type: DataTypes.DATE,
    allowNull: true,
  });
  await context.addColumn('storefront_ongoing_carts', 'recovery_count', {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  });

  await context.sequelize.query(`
    UPDATE storefront_ongoing_carts
    SET
      first_recovery_sent_at = recovery_sent_at,
      last_recovery_sent_at = recovery_sent_at,
      recovery_count = CASE
        WHEN COALESCE(metadata->>'recoveryCount', '') ~ '^[0-9]+$'
          THEN (metadata->>'recoveryCount')::integer
        WHEN recovery_sent_at IS NOT NULL THEN 1
        ELSE 0
      END
  `);

  await context.addIndex('storefront_ongoing_carts', ['recovery_token'], {
    unique: true,
    name: 'storefront_ongoing_carts_recovery_token_unique',
  });
  await context.addIndex('storefront_ongoing_carts', ['recovery_opened_at']);
  await context.addIndex('storefront_ongoing_carts', ['recovered_at']);
}

export async function down({ context }: MigrationParams): Promise<void> {
  await context.removeIndex('storefront_ongoing_carts', ['recovered_at']);
  await context.removeIndex('storefront_ongoing_carts', ['recovery_opened_at']);
  await context.removeIndex('storefront_ongoing_carts', 'storefront_ongoing_carts_recovery_token_unique');
  await context.removeColumn('storefront_ongoing_carts', 'recovery_count');
  await context.removeColumn('storefront_ongoing_carts', 'recovered_at');
  await context.removeColumn('storefront_ongoing_carts', 'recovery_opened_at');
  await context.removeColumn('storefront_ongoing_carts', 'last_recovery_sent_at');
  await context.removeColumn('storefront_ongoing_carts', 'first_recovery_sent_at');
  await context.removeColumn('storefront_ongoing_carts', 'recovery_token');
}
