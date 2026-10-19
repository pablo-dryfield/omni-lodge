import type { QueryInterface } from 'sequelize';
type Params = { context: QueryInterface };

export async function up({ context }: Params): Promise<void> {
  await context.sequelize.transaction(async (transaction) => {
    await context.sequelize.query(`ALTER TABLE volunteer_stays ADD COLUMN IF NOT EXISTS assessment JSONB;
    ALTER TABLE volunteer_stays ADD COLUMN IF NOT EXISTS target_overrides JSONB;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'volunteer_stays'::regclass
        AND conname = 'volunteer_stays_assessment_ck') THEN
        ALTER TABLE volunteer_stays ADD CONSTRAINT volunteer_stays_assessment_ck
          CHECK (assessment IS NULL OR jsonb_typeof(assessment) = 'object');
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'volunteer_stays'::regclass
        AND conname = 'volunteer_stays_target_overrides_ck') THEN
        ALTER TABLE volunteer_stays ADD CONSTRAINT volunteer_stays_target_overrides_ck
          CHECK (target_overrides IS NULL OR jsonb_typeof(target_overrides) = 'object');
      END IF;
    END $$;`, { transaction });
  });
}

export async function down({ context }: Params): Promise<void> {
  // Feedback and waiver evidence must never be discarded by a rollback.
  await context.sequelize.transaction(async (transaction) => {
    await context.sequelize.query(`LOCK TABLE volunteer_stays IN ACCESS EXCLUSIVE MODE;
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM volunteer_stays WHERE assessment IS NOT NULL OR target_overrides IS NOT NULL) THEN
          RAISE EXCEPTION 'Cannot remove saved volunteer assessments';
        END IF;
      END $$;
      ALTER TABLE volunteer_stays DROP COLUMN IF EXISTS assessment, DROP COLUMN IF EXISTS target_overrides;`, { transaction });
  });
}

export async function verify({ context }: Params): Promise<{ ok: boolean; details: unknown }> {
  const [rows] = await context.sequelize.query(`SELECT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'volunteer_stays' AND column_name = 'assessment' AND data_type = 'jsonb') AS column_exists,
    EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'volunteer_stays'::regclass
      AND conname = 'volunteer_stays_assessment_ck') AS check_exists,
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'volunteer_stays'
      AND column_name = 'target_overrides' AND data_type = 'jsonb') AS overrides_exist,
    EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'volunteer_stays'::regclass
      AND conname = 'volunteer_stays_target_overrides_ck') AS overrides_check;`);
  const details = (rows as Array<{ column_exists: boolean; check_exists: boolean; overrides_exist: boolean; overrides_check: boolean }>)[0];
  return { ok: Boolean(details?.column_exists && details.check_exists && details.overrides_exist && details.overrides_check), details };
}
