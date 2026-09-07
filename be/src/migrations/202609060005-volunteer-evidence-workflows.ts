import type { QueryInterface } from 'sequelize';

type MigrationParams = { context: QueryInterface };

export async function up({ context }: MigrationParams): Promise<void> {
  await context.sequelize.transaction(async (transaction) => {
    await context.sequelize.query(`
      ALTER TABLE volunteer_shift_attendance
        ADD COLUMN IF NOT EXISTS subject_user_id INTEGER REFERENCES users(id) ON DELETE RESTRICT,
        ADD COLUMN IF NOT EXISTS evidence_task_log_id INTEGER REFERENCES am_task_logs(id) ON DELETE RESTRICT,
        ADD COLUMN IF NOT EXISTS evidence_rule_key VARCHAR(100),
        ADD COLUMN IF NOT EXISTS evidence_file_id VARCHAR(255),
        ADD COLUMN IF NOT EXISTS check_kind VARCHAR(32),
        ADD COLUMN IF NOT EXISTS expected_time VARCHAR(5),
        ADD COLUMN IF NOT EXISTS late_minutes INTEGER,
        ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1;
      UPDATE volunteer_shift_attendance attendance SET subject_user_id = assignment.user_id
        FROM shift_assignments assignment WHERE attendance.shift_assignment_id = assignment.id
          AND attendance.subject_user_id IS NULL;
      ALTER TABLE volunteer_shift_attendance
        ADD CONSTRAINT volunteer_attendance_revision_ck CHECK (revision > 0),
        ADD CONSTRAINT volunteer_attendance_late_minutes_ck CHECK (late_minutes IS NULL OR late_minutes >= 0),
        ADD CONSTRAINT volunteer_attendance_proof_ck CHECK (
          (evidence_task_log_id IS NULL AND evidence_rule_key IS NULL AND evidence_file_id IS NULL
            AND check_kind IS NULL AND expected_time IS NULL)
          OR (evidence_task_log_id IS NOT NULL AND evidence_rule_key IS NOT NULL AND evidence_file_id IS NOT NULL
            AND check_kind IS NOT NULL AND check_kind IN ('meeting_point', 'promotion_chat') AND expected_time IS NOT NULL
            AND expected_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
        );
      CREATE INDEX volunteer_attendance_evidence_log_idx ON volunteer_shift_attendance (evidence_task_log_id);
      CREATE TABLE cleaning_submissions (
        id SERIAL PRIMARY KEY,
        task_log_id INTEGER NOT NULL REFERENCES am_task_logs(id) ON DELETE RESTRICT,
        shift_assignment_id INTEGER REFERENCES shift_assignments(id) ON DELETE SET NULL,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        required_slots JSONB NOT NULL CHECK (jsonb_typeof(required_slots) = 'array' AND jsonb_array_length(required_slots) > 0),
        reviewer_user_ids JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(reviewer_user_ids) = 'array'),
        schedule_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(schedule_snapshot) = 'object'),
        revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
        status VARCHAR(24) NOT NULL DEFAULT 'awaiting_upload'
          CHECK (status IN ('awaiting_upload','awaiting_review','approved','escalated')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT cleaning_submission_assignment_uq UNIQUE (task_log_id, shift_assignment_id)
      );
      CREATE INDEX cleaning_submissions_user_status_idx ON cleaning_submissions (user_id, status);
      CREATE TABLE cleaning_photo_versions (
        id SERIAL PRIMARY KEY,
        submission_id INTEGER NOT NULL REFERENCES cleaning_submissions(id) ON DELETE RESTRICT,
        slot_key VARCHAR(160) NOT NULL,
        version INTEGER NOT NULL CHECK (version > 0),
        storage_path TEXT, drive_file_id VARCHAR(255), drive_web_view_link TEXT,
        file_name VARCHAR(255) NOT NULL, mime_type VARCHAR(80) NOT NULL,
        file_size INTEGER NOT NULL CHECK (file_size > 0 AND file_size <= 10485760),
        sha256 VARCHAR(64) NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
        width INTEGER NOT NULL CHECK (width > 0), height INTEGER NOT NULL CHECK (height > 0),
        status VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
        uploaded_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        uploaded_at TIMESTAMPTZ NOT NULL,
        reviewed_by INTEGER REFERENCES users(id) ON DELETE RESTRICT,
        reviewed_at TIMESTAMPTZ, rejection_reason TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT cleaning_photo_slot_version_uq UNIQUE (submission_id, slot_key, version),
        CONSTRAINT cleaning_photo_storage_ck CHECK (storage_path IS NOT NULL OR drive_file_id IS NOT NULL),
        CONSTRAINT cleaning_photo_pixels_ck CHECK (width::bigint * height::bigint <= 24000000),
        CONSTRAINT cleaning_photo_review_ck CHECK (
          (status = 'pending' AND reviewed_by IS NULL AND reviewed_at IS NULL AND rejection_reason IS NULL)
          OR (status = 'approved' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND rejection_reason IS NULL)
          OR (status = 'rejected' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL
            AND rejection_reason IS NOT NULL AND length(trim(rejection_reason)) > 0)
        ),
        CONSTRAINT cleaning_photo_independent_review_ck CHECK (reviewed_by IS NULL OR reviewed_by <> uploaded_by)
      );`, { transaction });
  });
}

export async function down({ context }: MigrationParams): Promise<void> {
  await context.sequelize.transaction(async (transaction) => {
    await context.sequelize.query(`
      LOCK TABLE cleaning_submissions, cleaning_photo_versions, volunteer_shift_attendance IN ACCESS EXCLUSIVE MODE;
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM cleaning_submissions) OR EXISTS (SELECT 1 FROM cleaning_photo_versions)
          OR EXISTS (SELECT 1 FROM volunteer_shift_attendance WHERE evidence_task_log_id IS NOT NULL) THEN
          RAISE EXCEPTION 'Cannot remove volunteer evidence workflows while review history exists';
        END IF;
      END $$;
      DROP TABLE cleaning_photo_versions;
      DROP TABLE cleaning_submissions;
      DROP INDEX volunteer_attendance_evidence_log_idx;
      ALTER TABLE volunteer_shift_attendance
        DROP CONSTRAINT volunteer_attendance_revision_ck,
        DROP CONSTRAINT volunteer_attendance_late_minutes_ck,
        DROP CONSTRAINT volunteer_attendance_proof_ck,
        DROP COLUMN evidence_task_log_id, DROP COLUMN evidence_rule_key, DROP COLUMN evidence_file_id,
        DROP COLUMN check_kind, DROP COLUMN expected_time, DROP COLUMN late_minutes, DROP COLUMN revision,
        DROP COLUMN subject_user_id;
    `, { transaction });
  });
}

export async function verify({ context }: MigrationParams): Promise<{ ok: boolean; details: unknown }> {
  const [rows] = await context.sequelize.query(`
    SELECT to_regclass('public.cleaning_submissions') IS NOT NULL AS submissions_exist,
      to_regclass('public.cleaning_photo_versions') IS NOT NULL AS photos_exist,
      EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('public.volunteer_shift_attendance')
        AND conname = 'volunteer_attendance_proof_ck') AS attendance_checks_exist,
      EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('public.cleaning_photo_versions')
        AND conname = 'cleaning_photo_slot_version_uq') AS versions_unique;
  `);
  const details = (rows as Array<Record<string, boolean>>)[0];
  return { ok: Boolean(details && Object.values(details).every(Boolean)), details };
}
