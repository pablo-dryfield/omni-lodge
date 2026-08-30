import type { QueryInterface, Transaction } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const TAKEOVER_SPLIT_CONFIG = `{
  "enabled": true,
  "effectiveStart": "2026-08-01",
  "shiftTakerPercent": 50
}`;

export async function up({ context }: MigrationParams): Promise<void> {
  const transaction: Transaction = await context.sequelize.transaction();
  try {
    await context.sequelize.query(
      `UPDATE compensation_components
       SET config = jsonb_set(
             config,
             '{monthlyBase,taskCompletionProration,takeoverSplit}',
             CAST(:takeoverSplitConfig AS jsonb),
             TRUE
           ),
           updated_at = NOW()
       WHERE slug = 'assistant-manager-salary'
         AND category = 'base'
         AND calculation_method = 'per_unit'
         AND jsonb_typeof(config->'monthlyBase'->'taskCompletionProration') = 'object'
         AND NOT ((config->'monthlyBase'->'taskCompletionProration') ? 'takeoverSplit');`,
      {
        replacements: { takeoverSplitConfig: TAKEOVER_SPLIT_CONFIG },
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
             '{monthlyBase,taskCompletionProration}',
             (config->'monthlyBase'->'taskCompletionProration') - 'takeoverSplit',
             TRUE
           ),
           updated_at = NOW()
       WHERE slug = 'assistant-manager-salary'
         AND config->'monthlyBase'->'taskCompletionProration'->'takeoverSplit' =
             CAST(:takeoverSplitConfig AS jsonb);`,
      {
        replacements: { takeoverSplitConfig: TAKEOVER_SPLIT_CONFIG },
        transaction,
      },
    );
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}
