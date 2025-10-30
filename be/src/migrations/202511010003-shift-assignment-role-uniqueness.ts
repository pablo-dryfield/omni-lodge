import type { QueryInterface } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const OLD_CONSTRAINT = 'shift_assignments_unique_member';
const NEW_INDEX = 'shift_assignments_unique_user_role';

export async function up({ context }: MigrationParams): Promise<void> {
  const qi = context;

  await qi.sequelize.transaction(async (transaction) => {
    await qi.sequelize.query(
      `ALTER TABLE "shift_assignments" DROP CONSTRAINT IF EXISTS "${OLD_CONSTRAINT}";`,
      { transaction },
    );

    await qi.sequelize.query(
      `
        CREATE UNIQUE INDEX IF NOT EXISTS "${NEW_INDEX}"
        ON "shift_assignments" (
          "shift_instance_id",
          "user_id",
          COALESCE("shift_role_id", -1),
          lower("role_in_shift")
        );
      `,
      { transaction },
    );
  });
}

export async function down({ context }: MigrationParams): Promise<void> {
  const qi = context;

  await qi.sequelize.transaction(async (transaction) => {
    await qi.sequelize.query(
      `DROP INDEX IF EXISTS "${NEW_INDEX}";`,
      { transaction },
    );

    await qi.sequelize.query(
      `
        ALTER TABLE "shift_assignments"
        ADD CONSTRAINT "${OLD_CONSTRAINT}"
        UNIQUE ("shift_instance_id", "user_id");
      `,
      { transaction },
    );
  });
}

