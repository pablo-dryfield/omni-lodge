import type { QueryInterface, Transaction } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const TASK_PRORATION_CONFIG = `{
  "enabled": true,
  "effectiveStart": "2026-08-01",
  "treatWaivedAsComplete": true,
  "treatPendingAsComplete": false
}`;

export async function up({ context }: MigrationParams): Promise<void> {
  const transaction: Transaction = await context.sequelize.transaction();
  try {
    await context.sequelize.query(
      `UPDATE compensation_components
       SET config = jsonb_set(
             config,
             '{monthlyBase,taskCompletionProration}',
             CAST(:taskProrationConfig AS jsonb),
             TRUE
           ),
           updated_at = NOW()
       WHERE slug = 'assistant-manager-salary'
         AND category = 'base'
         AND calculation_method = 'per_unit'
         AND jsonb_typeof(config->'monthlyBase') = 'object'
         AND NOT ((config->'monthlyBase') ? 'taskCompletionProration');`,
      {
        replacements: { taskProrationConfig: TASK_PRORATION_CONFIG },
        transaction,
      },
    );
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export async function down({ context }: MigrationParams): Promise<void> {
  const transaction: Transaction = await context.sequelize.transaction();
  try {
    await context.sequelize.query(
      `UPDATE compensation_components
       SET config = jsonb_set(
             config,
             '{monthlyBase}',
             (config->'monthlyBase') - 'taskCompletionProration',
             TRUE
           ),
           updated_at = NOW()
       WHERE slug = 'assistant-manager-salary'
         AND config->'monthlyBase'->'taskCompletionProration' =
             CAST(:taskProrationConfig AS jsonb);`,
      {
        replacements: { taskProrationConfig: TASK_PRORATION_CONFIG },
        transaction,
      },
    );
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}
