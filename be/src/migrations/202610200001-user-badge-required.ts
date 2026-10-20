import type { QueryInterface } from 'sequelize';

type Params = { context: QueryInterface };

export async function up({ context }: Params): Promise<void> {
  await context.sequelize.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS badge_required BOOLEAN NOT NULL DEFAULT TRUE');
}

export async function down({ context }: Params): Promise<void> {
  await context.sequelize.transaction(async (transaction) => {
    await context.sequelize.query(`LOCK TABLE users IN ACCESS EXCLUSIVE MODE;
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM users WHERE badge_required = FALSE) THEN
          RAISE EXCEPTION 'Cannot remove saved staff badge opt-outs';
        END IF;
      END $$;
      ALTER TABLE users DROP COLUMN IF EXISTS badge_required;`, { transaction });
  });
}

export async function verify({ context }: Params): Promise<{ ok: boolean; details: unknown }> {
  const [rows] = await context.sequelize.query(`SELECT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'badge_required'
      AND data_type = 'boolean' AND is_nullable = 'NO' AND column_default = 'true') AS valid_column;`);
  const details = (rows as Array<{ valid_column: boolean }>)[0];
  return { ok: Boolean(details?.valid_column), details };
}
