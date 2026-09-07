import type { QueryInterface } from 'sequelize';

type MigrationParams = { context: QueryInterface };

export async function up({ context }: MigrationParams): Promise<void> {
  await context.sequelize.transaction(async (transaction) => {
    await context.sequelize.query(`
      ALTER TABLE volunteer_shift_attendance
        ADD COLUMN evidence_shift_instance_id INTEGER,
        ADD COLUMN evidence_shift_type_id INTEGER,
        ADD CONSTRAINT volunteer_attendance_shift_identity_ck CHECK (
          (evidence_shift_instance_id IS NULL AND evidence_shift_type_id IS NULL)
          OR (evidence_task_log_id IS NOT NULL AND evidence_shift_instance_id IS NOT NULL AND evidence_shift_type_id IS NOT NULL
            AND evidence_shift_instance_id > 0 AND evidence_shift_type_id > 0)
        );
      -- Do not infer identities for existing photo checks from a possibly reassigned roster.
      -- They remain unconfirmed in reports until a manager rechecks the original task evidence.
    `, { transaction });
  });
}

export async function down({ context }: MigrationParams): Promise<void> {
  await context.sequelize.transaction(async (transaction) => {
    await context.sequelize.query(`
      LOCK TABLE volunteer_shift_attendance IN ACCESS EXCLUSIVE MODE;
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM volunteer_shift_attendance
          WHERE evidence_shift_instance_id IS NOT NULL OR evidence_shift_type_id IS NOT NULL) THEN
          RAISE EXCEPTION 'Cannot remove attendance shift identity while bound photo checks exist';
        END IF;
      END $$;
      ALTER TABLE volunteer_shift_attendance DROP CONSTRAINT volunteer_attendance_shift_identity_ck,
        DROP COLUMN evidence_shift_instance_id, DROP COLUMN evidence_shift_type_id;
    `, { transaction });
  });
}

export async function verify({ context }: MigrationParams): Promise<{ ok: boolean; details: unknown }> {
  const [rows] = await context.sequelize.query(`
    SELECT EXISTS (SELECT 1 FROM pg_constraint
      WHERE conrelid = to_regclass('public.volunteer_shift_attendance')
        AND conname = 'volunteer_attendance_shift_identity_ck') AS identity_check_exists,
      (SELECT COUNT(*) = 2 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'volunteer_shift_attendance'
         AND column_name IN ('evidence_shift_instance_id', 'evidence_shift_type_id')) AS identity_columns_exist;
  `);
  const details = (rows as Array<Record<string, boolean>>)[0];
  return { ok: Boolean(details && Object.values(details).every(Boolean)), details };
}
