import type { QueryInterface, Transaction } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const TABLE_TEMPLATES = 'am_task_templates';
const RULES_JSON = JSON.stringify([
  {
    action: 'waive',
    noteEquals: "The activity didn't operate.",
    productNames: ['Pub Crawl'],
    taskDateOffsetDays: 1,
  },
]);

const TARGET_TEMPLATE_NAMES = [
  'Daily - Photo workflow and Facebook album',
  'Daily - Rejoin message to previous day group',
  'Daily - Send picture link to previous day group',
];

const updateNightReportWaiverRules = async (qi: QueryInterface, transaction: Transaction) => {
  await qi.sequelize.query(
    `
    UPDATE ${TABLE_TEMPLATES}
    SET
      schedule_config = jsonb_set(
        COALESCE(schedule_config, '{}'::jsonb),
        '{nightReportRules}',
        CAST(:rules AS jsonb),
        true
      ),
      updated_at = NOW()
    WHERE name IN (:templateNames);
    `,
    {
      transaction,
      replacements: {
        rules: RULES_JSON,
        templateNames: TARGET_TEMPLATE_NAMES,
      },
    },
  );
};

export async function up({ context }: MigrationParams): Promise<void> {
  const qi = context;
  const transaction = await qi.sequelize.transaction();
  try {
    await updateNightReportWaiverRules(qi, transaction);
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
    await qi.sequelize.query(
      `
      UPDATE ${TABLE_TEMPLATES}
      SET
        schedule_config = COALESCE(schedule_config, '{}'::jsonb) - 'nightReportRules',
        updated_at = NOW()
      WHERE name IN (:templateNames);
      `,
      {
        transaction,
        replacements: {
          templateNames: TARGET_TEMPLATE_NAMES,
        },
      },
    );
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

