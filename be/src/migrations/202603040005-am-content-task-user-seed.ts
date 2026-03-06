import type { QueryInterface, Transaction } from 'sequelize';
import { QueryTypes } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const TABLE_TEMPLATES = 'am_task_templates';
const TABLE_ASSIGNMENTS = 'am_task_assignments';
const TEMPLATE_NAME = 'Weekly - IG and TikTok posts';
const ASSISTANT_USER_ID = 35;

type IdRow = { id: number };

const NEXT_SCHEDULE_CONFIG = {
  daysOfWeek: [1, 4],
  time: '15:00',
  durationHours: 0.75,
  timesPerWeekPerAssignedUser: 2,
  priority: 'medium',
  points: 2,
  tags: ['social', 'instagram', 'tiktok'],
  requireShift: false,
};

const PREVIOUS_SCHEDULE_CONFIG = {
  daysOfWeek: [1, 4],
  time: '15:00',
  durationHours: 0.75,
  priority: 'medium',
  points: 2,
  tags: ['social', 'instagram', 'tiktok'],
  requireShift: false,
};

const findTemplateId = async (qi: QueryInterface, transaction: Transaction) => {
  const rows = await qi.sequelize.query<IdRow>(
    `
    SELECT id
    FROM ${TABLE_TEMPLATES}
    WHERE name = :name
    ORDER BY id ASC
    LIMIT 1;
    `,
    {
      transaction,
      type: QueryTypes.SELECT,
      replacements: { name: TEMPLATE_NAME },
    },
  );

  return rows[0]?.id ?? null;
};

const ensureDirectUserAssignment = async (
  qi: QueryInterface,
  transaction: Transaction,
  templateId: number,
  userId: number,
) => {
  const rows = await qi.sequelize.query<IdRow>(
    `
    SELECT id
    FROM ${TABLE_ASSIGNMENTS}
    WHERE template_id = :templateId
      AND target_scope = 'user'
      AND user_id = :userId
    ORDER BY id ASC
    LIMIT 1;
    `,
    {
      transaction,
      type: QueryTypes.SELECT,
      replacements: { templateId, userId },
    },
  );

  if (rows[0]?.id) {
    await qi.sequelize.query(
      `
      UPDATE ${TABLE_ASSIGNMENTS}
      SET
        staff_type = NULL,
        lives_in_accom = NULL,
        user_type_id = NULL,
        shift_role_id = NULL,
        effective_start = NULL,
        effective_end = NULL,
        is_active = true,
        updated_at = NOW()
      WHERE id = :id;
      `,
      {
        transaction,
        type: QueryTypes.UPDATE,
        replacements: { id: rows[0].id },
      },
    );
    return;
  }

  await qi.sequelize.query(
    `
    INSERT INTO ${TABLE_ASSIGNMENTS}
      (template_id, target_scope, staff_type, lives_in_accom, user_id, user_type_id, shift_role_id, effective_start, effective_end, is_active, created_at, updated_at)
    VALUES
      (:templateId, 'user', NULL, NULL, :userId, NULL, NULL, NULL, NULL, true, NOW(), NOW());
    `,
    {
      transaction,
      type: QueryTypes.INSERT,
      replacements: { templateId, userId },
    },
  );
};

export const up = async ({ context: qi }: MigrationParams): Promise<void> => {
  await qi.sequelize.transaction(async (transaction) => {
    const templateId = await findTemplateId(qi, transaction);
    if (!templateId) {
      return;
    }

    await qi.sequelize.query(
      `
      UPDATE ${TABLE_TEMPLATES}
      SET schedule_config = CAST(:scheduleConfig AS jsonb),
          updated_at = NOW()
      WHERE id = :templateId;
      `,
      {
        transaction,
        type: QueryTypes.UPDATE,
        replacements: {
          templateId,
          scheduleConfig: JSON.stringify(NEXT_SCHEDULE_CONFIG),
        },
      },
    );

    await qi.sequelize.query(
      `
      DELETE FROM ${TABLE_ASSIGNMENTS}
      WHERE template_id = :templateId
        AND NOT (target_scope = 'user' AND user_id = :userId);
      `,
      {
        transaction,
        type: QueryTypes.DELETE,
        replacements: {
          templateId,
          userId: ASSISTANT_USER_ID,
        },
      },
    );

    await ensureDirectUserAssignment(qi, transaction, templateId, ASSISTANT_USER_ID);
  });
};

export const down = async ({ context: qi }: MigrationParams): Promise<void> => {
  await qi.sequelize.transaction(async (transaction) => {
    const templateId = await findTemplateId(qi, transaction);
    if (!templateId) {
      return;
    }

    await qi.sequelize.query(
      `
      UPDATE ${TABLE_TEMPLATES}
      SET schedule_config = CAST(:scheduleConfig AS jsonb),
          updated_at = NOW()
      WHERE id = :templateId;
      `,
      {
        transaction,
        type: QueryTypes.UPDATE,
        replacements: {
          templateId,
          scheduleConfig: JSON.stringify(PREVIOUS_SCHEDULE_CONFIG),
        },
      },
    );

    await qi.sequelize.query(
      `
      DELETE FROM ${TABLE_ASSIGNMENTS}
      WHERE template_id = :templateId
        AND target_scope = 'user'
        AND user_id = :userId;
      `,
      {
        transaction,
        type: QueryTypes.DELETE,
        replacements: {
          templateId,
          userId: ASSISTANT_USER_ID,
        },
      },
    );
  });
};
