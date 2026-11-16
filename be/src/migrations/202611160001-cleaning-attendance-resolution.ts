import type { QueryInterface } from 'sequelize';

type Params = { context: QueryInterface };

// Frozen migration SQL: only exact, published assignments with completed, fully approved proof qualify.
export const BACKFILL_SQL = `
  WITH qualified AS (
    SELECT DISTINCT ON (s.shift_assignment_id) s.*, l.completed_at, i.shift_type_id, i.time_start,
      i.id AS shift_instance_id
    FROM cleaning_submissions s
    JOIN am_task_logs l ON l.id = s.task_log_id AND l.status = 'completed' AND l.completed_at IS NOT NULL
      AND l.meta->'cleaningPhotoWorkflow'->>'managed' = 'true'
    JOIN shift_assignments a ON a.id = s.shift_assignment_id AND a.user_id = s.user_id
    JOIN shift_instances i ON i.id = a.shift_instance_id AND i.date = l.task_date
    JOIN schedule_weeks w ON w.id = i.schedule_week_id AND w.state = 'published'
    WHERE s.status = 'approved' AND s.attendance_resolution IS NULL
      AND s.schedule_snapshot->>'assignmentId' = a.id::text
      AND s.schedule_snapshot->>'shiftInstanceId' = i.id::text
      AND s.schedule_snapshot->>'shiftTypeId' = i.shift_type_id::text
      AND s.schedule_snapshot->>'date' = i.date::text
      AND s.schedule_snapshot->>'timeStart' = i.time_start::text
      AND s.schedule_snapshot->>'timeEnd' IS NOT DISTINCT FROM i.time_end::text
      AND jsonb_array_length(s.required_slots) > 0
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(s.required_slots) slot
        LEFT JOIN LATERAL (SELECT p.status, p.reviewed_by, p.reviewed_at FROM cleaning_photo_versions p
          WHERE p.submission_id = s.id AND p.slot_key = slot->>'key'
          ORDER BY p.version DESC, p.id DESC LIMIT 1) latest ON true
        WHERE latest.status IS DISTINCT FROM 'approved' OR latest.reviewed_by IS NULL OR latest.reviewed_at IS NULL
      )
    ORDER BY s.shift_assignment_id, l.completed_at DESC, s.id DESC
  ), inserted AS (
    INSERT INTO volunteer_shift_attendance
      (shift_assignment_id, subject_user_id, status, notes, recorded_by, recorded_at, revision,
       evidence_task_log_id, evidence_shift_instance_id, evidence_shift_type_id, evidence_rule_key,
       evidence_file_id, check_kind, expected_time, late_minutes, created_at, updated_at)
    SELECT shift_assignment_id, user_id, 'attended',
      'Required cleaning photos approved and review task completed (historical attendance repair).',
      NULL, completed_at, 1, task_log_id, shift_instance_id, shift_type_id, 'cleaning_submission',
      'cleaning-submission-' || id, 'cleaning', left(time_start::text, 5), 0, NOW(), NOW()
    FROM qualified
    ON CONFLICT (shift_assignment_id) DO NOTHING
    RETURNING *
  )
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, meta_json, created_at)
  SELECT NULL, 'cleaning.attendance_backfilled', 'am_task_log', evidence_task_log_id::text,
    jsonb_build_object('source', '202611160001-cleaning-attendance-resolution', 'attendanceId', id,
      'assignmentId', shift_assignment_id, 'userId', subject_user_id, 'evidenceFileId', evidence_file_id,
      'status', status, 'taskCompletedAt', recorded_at,
      'photoIds', (SELECT jsonb_agg(p.id ORDER BY p.id) FROM cleaning_photo_versions p
        WHERE 'cleaning-submission-' || p.submission_id = inserted.evidence_file_id)), NOW()
  FROM inserted;
`;

export async function up({ context }: Params): Promise<void> {
  await context.sequelize.transaction(async (transaction) => {
    await context.sequelize.query(`
      ALTER TABLE cleaning_submissions ADD COLUMN attendance_resolution JSONB;
      ALTER TABLE cleaning_submissions DROP CONSTRAINT cleaning_submissions_status_check;
      ALTER TABLE cleaning_submissions ADD CONSTRAINT cleaning_submissions_status_check
        CHECK (status IN ('awaiting_upload','awaiting_review','approved','escalated','absent','excused'));
      ALTER TABLE cleaning_submissions ADD CONSTRAINT cleaning_attendance_resolution_ck CHECK (
        (status NOT IN ('absent','excused') AND attendance_resolution IS NULL) OR
        (status IN ('absent','excused') AND attendance_resolution IS NOT NULL
          AND jsonb_typeof(attendance_resolution) = 'object'
          AND COALESCE(attendance_resolution->>'status' = status, false)
          AND COALESCE(length(trim(attendance_resolution->>'reason')) BETWEEN 1 AND 2000, false)
          AND COALESCE((attendance_resolution->>'recordedBy') ~ '^[1-9][0-9]*$', false)
          AND COALESCE(length(attendance_resolution->>'recordedAt') > 0, false))
      );
      ALTER TABLE volunteer_shift_attendance DROP CONSTRAINT volunteer_attendance_proof_ck;
      ALTER TABLE volunteer_shift_attendance ADD CONSTRAINT volunteer_attendance_proof_ck CHECK (
        (evidence_task_log_id IS NULL AND evidence_rule_key IS NULL AND evidence_file_id IS NULL
          AND check_kind IS NULL AND expected_time IS NULL) OR
        (evidence_task_log_id IS NOT NULL AND evidence_rule_key IS NOT NULL AND evidence_file_id IS NOT NULL
          AND check_kind IS NOT NULL AND check_kind IN ('meeting_point','promotion_chat','cleaning') AND expected_time IS NOT NULL
          AND expected_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
      );
    `, { transaction });
    await context.sequelize.query(BACKFILL_SQL, { transaction });
  });
}

export async function down({ context }: Params): Promise<void> {
  await context.sequelize.transaction(async (transaction) => {
    await context.sequelize.query(`
      LOCK TABLE cleaning_submissions, volunteer_shift_attendance IN ACCESS EXCLUSIVE MODE;
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM cleaning_submissions WHERE attendance_resolution IS NOT NULL)
          OR EXISTS (SELECT 1 FROM volunteer_shift_attendance WHERE check_kind = 'cleaning') THEN
          RAISE EXCEPTION 'Cannot remove cleaning attendance while decisions or attendance history exist';
        END IF;
      END $$;
      ALTER TABLE cleaning_submissions DROP CONSTRAINT cleaning_attendance_resolution_ck,
        DROP COLUMN attendance_resolution, DROP CONSTRAINT cleaning_submissions_status_check;
      ALTER TABLE cleaning_submissions ADD CONSTRAINT cleaning_submissions_status_check
        CHECK (status IN ('awaiting_upload','awaiting_review','approved','escalated'));
      ALTER TABLE volunteer_shift_attendance DROP CONSTRAINT volunteer_attendance_proof_ck;
      ALTER TABLE volunteer_shift_attendance ADD CONSTRAINT volunteer_attendance_proof_ck CHECK (
        (evidence_task_log_id IS NULL AND evidence_rule_key IS NULL AND evidence_file_id IS NULL
          AND check_kind IS NULL AND expected_time IS NULL) OR
        (evidence_task_log_id IS NOT NULL AND evidence_rule_key IS NOT NULL AND evidence_file_id IS NOT NULL
          AND check_kind IS NOT NULL AND check_kind IN ('meeting_point','promotion_chat') AND expected_time IS NOT NULL
          AND expected_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
      );
    `, { transaction });
  });
}

export async function verify({ context }: Params): Promise<{ ok: boolean; details: unknown }> {
  const [rows] = await context.sequelize.query(`SELECT
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
      AND table_name = 'cleaning_submissions' AND column_name = 'attendance_resolution') AS resolution_exists,
    EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'cleaning_submissions'::regclass
      AND conname = 'cleaning_attendance_resolution_ck') AS resolution_check,
    EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'volunteer_shift_attendance'::regclass
      AND conname = 'volunteer_attendance_proof_ck' AND pg_get_constraintdef(oid) LIKE '%cleaning%') AS cleaning_proof`);
  const details = (rows as Array<Record<string, boolean>>)[0];
  return { ok: Boolean(details && Object.values(details).every(Boolean)), details };
}
