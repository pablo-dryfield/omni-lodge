import type { QueryInterface } from 'sequelize';

type MigrationParams = { context: QueryInterface };

export async function up({ context }: MigrationParams): Promise<void> {
  await context.sequelize.transaction(async (transaction) => {
    await context.sequelize.query(`
      ALTER TABLE cleaning_photo_versions
        ADD COLUMN self_review_authorized BOOLEAN NOT NULL DEFAULT FALSE,
        DROP CONSTRAINT cleaning_photo_independent_review_ck,
        ADD CONSTRAINT cleaning_photo_independent_review_ck CHECK (
          reviewed_by IS NULL OR reviewed_by <> uploaded_by OR self_review_authorized
        ),
        ADD CONSTRAINT cleaning_photo_self_review_authority_ck CHECK (
          NOT self_review_authorized OR (reviewed_by IS NOT NULL AND reviewed_by = uploaded_by
            AND status IN ('approved', 'rejected'))
        );
    `, { transaction });
  });
}

export async function down({ context }: MigrationParams): Promise<void> {
  await context.sequelize.transaction(async (transaction) => {
    await context.sequelize.query(`
      LOCK TABLE cleaning_photo_versions IN ACCESS EXCLUSIVE MODE;
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM cleaning_photo_versions WHERE self_review_authorized) THEN
          RAISE EXCEPTION 'Cannot remove assigned self-review authorization while saved review history exists';
        END IF;
      END $$;
      ALTER TABLE cleaning_photo_versions
        DROP CONSTRAINT cleaning_photo_self_review_authority_ck,
        DROP CONSTRAINT cleaning_photo_independent_review_ck,
        ADD CONSTRAINT cleaning_photo_independent_review_ck CHECK (reviewed_by IS NULL OR reviewed_by <> uploaded_by),
        DROP COLUMN self_review_authorized;
    `, { transaction });
  });
}

export async function verify({ context }: MigrationParams): Promise<{ ok: boolean; details: unknown }> {
  const [rows] = await context.sequelize.query(`
    SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
      AND table_name = 'cleaning_photo_versions' AND column_name = 'self_review_authorized'
      AND data_type = 'boolean' AND is_nullable = 'NO') AS authorization_column,
      EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('public.cleaning_photo_versions')
        AND conname = 'cleaning_photo_independent_review_ck' AND convalidated
        AND pg_get_constraintdef(oid) LIKE '%self_review_authorized%') AS independent_review_guard,
      EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('public.cleaning_photo_versions')
        AND conname = 'cleaning_photo_self_review_authority_ck' AND convalidated) AS self_review_guard;
  `);
  const details = (rows as Array<Record<string, boolean>>)[0];
  return { ok: Boolean(details && details.authorization_column && details.independent_review_guard && details.self_review_guard), details };
}
