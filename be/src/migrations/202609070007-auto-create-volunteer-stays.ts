import type { QueryInterface } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const AUTO_STAY_REASON = 'Automatically created from the active Volunteer profile.';

const defaultMappingsSql = `
  normalized_shift_types AS (
    SELECT id,
      trim(BOTH '_' FROM regexp_replace(lower(coalesce(key, '') || ' ' || coalesce(name, '')), '[^a-z0-9]+', '_', 'g')) AS identity
    FROM shift_types
  ),
  classified_shift_types AS (
    SELECT id,
      CASE
        WHEN identity LIKE '%social_media%' OR ('_' || identity || '_') LIKE '%_socialmedia_%' THEN 'socialMedia'
        WHEN identity LIKE '%promotion%' OR ('_' || identity || '_') LIKE '%_promo_%' THEN 'promotion'
        WHEN identity LIKE '%pub_crawl%' OR identity ~ '(^|_)(guide|guiding)($|_)' THEN 'guiding'
        ELSE NULL
      END AS bucket
    FROM normalized_shift_types
  ),
  default_mappings AS (
    SELECT jsonb_build_object(
      'guiding', coalesce(jsonb_agg(id ORDER BY id) FILTER (WHERE bucket = 'guiding'), '[]'::jsonb),
      'promotion', coalesce(jsonb_agg(id ORDER BY id) FILTER (WHERE bucket = 'promotion'), '[]'::jsonb),
      'socialMedia', coalesce(jsonb_agg(id ORDER BY id) FILTER (WHERE bucket = 'socialMedia'), '[]'::jsonb)
    ) AS shift_type_ids
    FROM classified_shift_types
  )`;

const eligibleVolunteersSql = `
  eligible_volunteers AS (
    SELECT u.id AS user_id,
      u.arrival_date::date AS start_date,
      u.departure_date::date AS end_date,
      CASE
        WHEN regexp_replace(lower(ut.slug), '[^a-z0-9]+', '_', 'g') IN ('social_media', 'socialmedia') THEN 'social_media'
        WHEN regexp_replace(lower(ut.slug), '[^a-z0-9]+', '_', 'g') IN ('guide', 'pub_crawl_guide', 'pubcrawl_guide') THEN 'guide'
        ELSE NULL
      END AS position,
      mappings.shift_type_ids
    FROM users u
    JOIN staff_profiles profile ON profile.user_id = u.id
    JOIN "userTypes" ut ON ut.id = u."userTypeId"
    CROSS JOIN default_mappings mappings
    WHERE u.status IS TRUE
      AND profile.active IS TRUE
      AND profile.staff_type = 'volunteer'
      AND u.arrival_date IS NOT NULL
      AND u.departure_date IS NOT NULL
      AND u.departure_date::date > u.arrival_date::date
      AND u.departure_date::date > (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Warsaw')::date
  ),
  auto_creatable_volunteers AS (
    SELECT *
    FROM eligible_volunteers
    WHERE position IS NOT NULL
      AND (
        (position = 'guide'
          AND jsonb_array_length(shift_type_ids->'guiding') > 0
          AND jsonb_array_length(shift_type_ids->'promotion') > 0)
        OR (position = 'social_media' AND jsonb_array_length(shift_type_ids->'socialMedia') > 0)
      )
  )`;

export async function up({ context }: MigrationParams): Promise<void> {
  await context.sequelize.transaction(async (transaction) => {
    await context.sequelize.query(`
      WITH ${defaultMappingsSql},
      ${eligibleVolunteersSql},
      inserted_stays AS (
        INSERT INTO volunteer_stays (
          user_id, start_date, end_date, position, monthly_targets, shift_type_ids,
          feedback, change_reason, revision, created_by, updated_by, created_at, updated_at
        )
        SELECT candidate.user_id,
          candidate.start_date,
          candidate.end_date,
          candidate.position,
          '{"reviews":15,"guidingShifts":12,"promotionShifts":12,"socialMediaShifts":16,"cleaningTasks":5,"attendancePercent":90}'::jsonb,
          candidate.shift_type_ids,
          NULL,
          '${AUTO_STAY_REASON}',
          1,
          NULL,
          NULL,
          NOW(),
          NOW()
        FROM auto_creatable_volunteers candidate
        WHERE NOT EXISTS (
          SELECT 1
          FROM volunteer_stays existing
          WHERE existing.user_id = candidate.user_id
            AND existing.start_date < candidate.end_date
            AND existing.end_date > candidate.start_date
        )
        RETURNING *
      ),
      inserted_revisions AS (
        INSERT INTO volunteer_stay_revisions (stay_id, revision, snapshot, reason, actor_id, created_at)
        SELECT stay.id,
          1,
          jsonb_build_object(
            'id', stay.id,
            'userId', stay.user_id,
            'startDate', stay.start_date,
            'endDate', stay.end_date,
            'position', stay.position,
            'monthlyTargets', stay.monthly_targets,
            'shiftTypeIds', stay.shift_type_ids,
            'feedback', stay.feedback,
            'changeReason', stay.change_reason,
            'revision', stay.revision,
            'createdBy', stay.created_by,
            'updatedBy', stay.updated_by,
            'createdAt', stay.created_at,
            'updatedAt', stay.updated_at
          ),
          stay.change_reason,
          NULL,
          NOW()
        FROM inserted_stays stay
        RETURNING stay_id
      )
      INSERT INTO audit_logs (actor_id, action, entity, entity_id, meta_json, created_at)
      SELECT NULL,
        'volunteer_stay.auto_created',
        'volunteer_stay',
        stay.id::text,
        jsonb_build_object(
          'userId', stay.user_id,
          'stayId', stay.id,
          'revision', 1,
          'reason', stay.change_reason,
          'source', 'migration_active_volunteer_backfill'
        ),
        NOW()
      FROM inserted_stays stay;
    `, { transaction });
  });
}

export async function down(): Promise<void> {
  // This is an append-only data migration. Auto-created stays may already have
  // progress, feedback, or later manual revisions, so rollback must preserve them.
}

export async function verify({ context }: MigrationParams): Promise<{ ok: boolean; details: unknown }> {
  const [rows] = await context.sequelize.query(`
    WITH ${defaultMappingsSql},
    ${eligibleVolunteersSql}
    SELECT
      (SELECT count(*)::integer
       FROM auto_creatable_volunteers candidate
       WHERE NOT EXISTS (
         SELECT 1 FROM volunteer_stays existing
         WHERE existing.user_id = candidate.user_id
           AND existing.start_date < candidate.end_date
           AND existing.end_date > candidate.start_date
       )) AS missing_eligible_stays,
      (SELECT count(*)::integer
       FROM volunteer_stays stay
       WHERE stay.change_reason = '${AUTO_STAY_REASON}') AS auto_created_stays,
      (SELECT count(*)::integer
       FROM volunteer_stays stay
       WHERE stay.change_reason = '${AUTO_STAY_REASON}'
         AND NOT EXISTS (
           SELECT 1 FROM volunteer_stay_revisions revision
           WHERE revision.stay_id = stay.id AND revision.revision = 1
         )) AS missing_initial_revisions;
  `);
  const details = (rows as Array<{
    missing_eligible_stays: number;
    auto_created_stays: number;
    missing_initial_revisions: number;
  }>)[0];
  return {
    ok: Boolean(details && Number(details.missing_eligible_stays) === 0 && Number(details.missing_initial_revisions) === 0),
    details,
  };
}
