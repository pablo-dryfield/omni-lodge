import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const TABLE_ASSIGNMENTS = 'am_task_assignments';
const TARGET_SCOPE_ENUM = 'enum_am_task_assignments_target_scope';
const TARGET_SCOPE_ENUM_OLD = 'enum_am_task_assignments_target_scope_old';

export async function up({ context }: MigrationParams): Promise<void> {
  const qi = context;
  const transaction = await qi.sequelize.transaction();

  try {
    await qi.addColumn(
      TABLE_ASSIGNMENTS,
      'user_type_id',
      {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'userTypes', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      { transaction },
    );

    await qi.addColumn(
      TABLE_ASSIGNMENTS,
      'shift_role_id',
      {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'shift_roles', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      { transaction },
    );

    await qi.addIndex(TABLE_ASSIGNMENTS, ['user_type_id'], {
      name: 'am_task_assignments_user_type_idx',
      transaction,
    });

    await qi.addIndex(TABLE_ASSIGNMENTS, ['shift_role_id'], {
      name: 'am_task_assignments_shift_role_idx',
      transaction,
    });

    await qi.sequelize.query(
      `ALTER TYPE "${TARGET_SCOPE_ENUM}" RENAME TO "${TARGET_SCOPE_ENUM_OLD}";`,
      { transaction },
    );

    await qi.sequelize.query(
      `CREATE TYPE "${TARGET_SCOPE_ENUM}" AS ENUM ('staff_type', 'user', 'user_type', 'shift_role');`,
      { transaction },
    );

    await qi.sequelize.query(
      `
      ALTER TABLE "${TABLE_ASSIGNMENTS}"
      ALTER COLUMN "target_scope" DROP DEFAULT;
      `,
      { transaction },
    );

    await qi.sequelize.query(
      `
      ALTER TABLE "${TABLE_ASSIGNMENTS}"
      ALTER COLUMN "target_scope"
      TYPE "${TARGET_SCOPE_ENUM}"
      USING "target_scope"::text::"${TARGET_SCOPE_ENUM}";
      `,
      { transaction },
    );

    await qi.sequelize.query(
      `
      ALTER TABLE "${TABLE_ASSIGNMENTS}"
      ALTER COLUMN "target_scope" SET DEFAULT 'staff_type';
      `,
      { transaction },
    );

    await qi.sequelize.query(`DROP TYPE "${TARGET_SCOPE_ENUM_OLD}";`, { transaction });

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
      `ALTER TYPE "${TARGET_SCOPE_ENUM}" RENAME TO "${TARGET_SCOPE_ENUM_OLD}";`,
      { transaction },
    );

    await qi.sequelize.query(
      `CREATE TYPE "${TARGET_SCOPE_ENUM}" AS ENUM ('staff_type', 'user');`,
      { transaction },
    );

    await qi.sequelize.query(
      `
      ALTER TABLE "${TABLE_ASSIGNMENTS}"
      ALTER COLUMN "target_scope" DROP DEFAULT;
      `,
      { transaction },
    );

    await qi.sequelize.query(
      `
      ALTER TABLE "${TABLE_ASSIGNMENTS}"
      ALTER COLUMN "target_scope"
      TYPE "${TARGET_SCOPE_ENUM}"
      USING CASE
        WHEN "target_scope"::text IN ('staff_type', 'user') THEN "target_scope"::text::"${TARGET_SCOPE_ENUM}"
        WHEN "target_scope"::text IN ('user_type', 'shift_role') THEN 'staff_type'::"${TARGET_SCOPE_ENUM}"
      END;
      `,
      { transaction },
    );

    await qi.sequelize.query(
      `
      ALTER TABLE "${TABLE_ASSIGNMENTS}"
      ALTER COLUMN "target_scope" SET DEFAULT 'staff_type';
      `,
      { transaction },
    );

    await qi.sequelize.query(`DROP TYPE "${TARGET_SCOPE_ENUM_OLD}";`, { transaction });

    await qi.removeIndex(TABLE_ASSIGNMENTS, 'am_task_assignments_shift_role_idx', { transaction }).catch(() => {});
    await qi.removeIndex(TABLE_ASSIGNMENTS, 'am_task_assignments_user_type_idx', { transaction }).catch(() => {});
    await qi.removeColumn(TABLE_ASSIGNMENTS, 'shift_role_id', { transaction }).catch(() => {});
    await qi.removeColumn(TABLE_ASSIGNMENTS, 'user_type_id', { transaction }).catch(() => {});

    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}
