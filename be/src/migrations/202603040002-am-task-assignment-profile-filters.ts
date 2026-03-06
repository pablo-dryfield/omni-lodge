import type { QueryInterface, Transaction } from 'sequelize';
import { DataTypes, QueryTypes } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const TABLE_ASSIGNMENTS = 'am_task_assignments';

type IdRow = { id: number };

const findUserTypeId = async (qi: QueryInterface, transaction: Transaction) => {
  const rows = await qi.sequelize.query<IdRow>(
    `
    SELECT id
    FROM "userTypes"
    WHERE LOWER(name) = 'assistant manager'
       OR LOWER(slug) IN ('assistant_manager', 'assistant-manager')
    ORDER BY id ASC
    LIMIT 1;
    `,
    {
      transaction,
      type: QueryTypes.SELECT,
    },
  );

  return rows[0]?.id ?? null;
};

const findShiftRoleId = async (qi: QueryInterface, transaction: Transaction) => {
  const rows = await qi.sequelize.query<IdRow>(
    `
    SELECT id
    FROM shift_roles
    WHERE LOWER(name) = 'manager'
       OR LOWER(slug) = 'manager'
    ORDER BY id ASC
    LIMIT 1;
    `,
    {
      transaction,
      type: QueryTypes.SELECT,
    },
  );

  return rows[0]?.id ?? null;
};

export async function up({ context }: MigrationParams): Promise<void> {
  const qi = context;
  const transaction = await qi.sequelize.transaction();

  try {
    await qi.addColumn(
      TABLE_ASSIGNMENTS,
      'lives_in_accom',
      {
        type: DataTypes.BOOLEAN,
        allowNull: true,
      },
      { transaction },
    );

    const assistantManagerUserTypeId = await findUserTypeId(qi, transaction);
    const managerShiftRoleId = await findShiftRoleId(qi, transaction);

    if (assistantManagerUserTypeId && managerShiftRoleId) {
      await qi.sequelize.query(
        `
        UPDATE ${TABLE_ASSIGNMENTS}
        SET
          target_scope = 'shift_role',
          staff_type = NULL,
          lives_in_accom = NULL,
          user_type_id = :assistantManagerUserTypeId,
          shift_role_id = :managerShiftRoleId,
          updated_at = NOW()
        WHERE target_scope = 'staff_type'
          AND staff_type = 'assistant_manager'
          AND user_id IS NULL
          AND effective_start IS NULL
          AND effective_end IS NULL;
        `,
        {
          transaction,
          replacements: {
            assistantManagerUserTypeId,
            managerShiftRoleId,
          },
        },
      );
    }

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
    const assistantManagerUserTypeId = await findUserTypeId(qi, transaction);
    const managerShiftRoleId = await findShiftRoleId(qi, transaction);

    if (assistantManagerUserTypeId && managerShiftRoleId) {
      await qi.sequelize.query(
        `
        UPDATE ${TABLE_ASSIGNMENTS}
        SET
          target_scope = 'staff_type',
          staff_type = 'assistant_manager',
          user_type_id = NULL,
          shift_role_id = NULL,
          updated_at = NOW()
        WHERE target_scope = 'shift_role'
          AND user_type_id = :assistantManagerUserTypeId
          AND shift_role_id = :managerShiftRoleId
          AND user_id IS NULL
          AND effective_start IS NULL
          AND effective_end IS NULL;
        `,
        {
          transaction,
          replacements: {
            assistantManagerUserTypeId,
            managerShiftRoleId,
          },
        },
      );
    }

    await qi.removeColumn(TABLE_ASSIGNMENTS, 'lives_in_accom', { transaction });
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}
