import type { QueryInterface } from 'sequelize';

type MigrationParams = { context: QueryInterface };

export async function up({ context }: MigrationParams): Promise<void> {
  const transaction = await context.sequelize.transaction();
  try {
    // No inferred agreements are backfilled: a manager confirms the dates, role,
    // targets and shift mapping. Calendar feedback remains unchanged.
    await context.sequelize.query(`
      CREATE TABLE IF NOT EXISTS volunteer_stays (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        position VARCHAR(24) NOT NULL,
        monthly_targets JSONB NOT NULL,
        shift_type_ids JSONB NOT NULL,
        feedback JSONB,
        change_reason TEXT,
        revision INTEGER NOT NULL DEFAULT 1,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT volunteer_stays_date_range_ck CHECK (end_date > start_date),
        CONSTRAINT volunteer_stays_position_ck CHECK (position IN ('guide', 'social_media')),
        CONSTRAINT volunteer_stays_revision_ck CHECK (revision > 0),
        CONSTRAINT volunteer_stays_monthly_targets_ck CHECK (
          jsonb_typeof(monthly_targets) = 'object'
          AND monthly_targets ?& ARRAY['reviews','guidingShifts','promotionShifts','socialMediaShifts','cleaningTasks','attendancePercent']
          AND jsonb_typeof(monthly_targets->'reviews') = 'number'
          AND jsonb_typeof(monthly_targets->'guidingShifts') = 'number'
          AND jsonb_typeof(monthly_targets->'promotionShifts') = 'number'
          AND jsonb_typeof(monthly_targets->'socialMediaShifts') = 'number'
          AND jsonb_typeof(monthly_targets->'cleaningTasks') = 'number'
          AND jsonb_typeof(monthly_targets->'attendancePercent') = 'number'
          AND (monthly_targets->>'reviews')::numeric >= 0
          AND (monthly_targets->>'guidingShifts')::numeric >= 0
          AND (monthly_targets->>'promotionShifts')::numeric >= 0
          AND (monthly_targets->>'socialMediaShifts')::numeric >= 0
          AND (monthly_targets->>'cleaningTasks')::numeric >= 0
          AND (monthly_targets->>'attendancePercent')::numeric BETWEEN 0 AND 100
        ),
        CONSTRAINT volunteer_stays_shift_type_ids_ck CHECK (
          jsonb_typeof(shift_type_ids) = 'object'
          AND shift_type_ids ?& ARRAY['guiding','promotion','socialMedia']
          AND jsonb_typeof(shift_type_ids->'guiding') = 'array'
          AND jsonb_typeof(shift_type_ids->'promotion') = 'array'
          AND jsonb_typeof(shift_type_ids->'socialMedia') = 'array'
        ),
        CONSTRAINT volunteer_stays_feedback_ck CHECK (feedback IS NULL OR jsonb_typeof(feedback) = 'object')
      );
      CREATE INDEX IF NOT EXISTS volunteer_stays_user_dates_idx ON volunteer_stays (user_id, start_date, end_date);
      CREATE TABLE IF NOT EXISTS volunteer_stay_revisions (
        id SERIAL PRIMARY KEY,
        stay_id INTEGER NOT NULL REFERENCES volunteer_stays(id) ON DELETE RESTRICT,
        revision INTEGER NOT NULL CHECK (revision > 0),
        snapshot JSONB NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
        reason TEXT,
        actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT volunteer_stay_revisions_stay_revision_uq UNIQUE (stay_id, revision)
      );`, { transaction });

    await context.sequelize.query(`
      INSERT INTO "rolePagePermissions" ("userTypeId", "pageId", "canView", status, "createdAt", "updatedAt")
      SELECT ut.id, p.id, true, true, NOW(), NOW()
      FROM "userTypes" ut CROSS JOIN pages p
      WHERE ut.slug = 'social-media' AND p.slug = 'volunteer-progress'
      ON CONFLICT ("userTypeId", "pageId") DO UPDATE
        SET "canView" = true, status = true, "updatedAt" = NOW();
      INSERT INTO "roleModulePermissions" ("userTypeId", "moduleId", "actionId", allowed, status, "createdAt", "updatedAt")
      SELECT ut.id, m.id, a.id, true, true, NOW(), NOW()
      FROM "userTypes" ut CROSS JOIN modules m JOIN actions a ON a.key = 'view'
      WHERE ut.slug = 'social-media' AND m.slug = 'volunteer-progress'
      ON CONFLICT ("userTypeId", "moduleId", "actionId") DO UPDATE
        SET allowed = true, status = true, "updatedAt" = NOW();`, { transaction });
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export async function down({ context }: MigrationParams): Promise<void> {
  const transaction = await context.sequelize.transaction();
  try {
    // Never discard saved stay agreements or their audit trail during rollback.
    await context.sequelize.query(`
      LOCK TABLE volunteer_stays, volunteer_stay_revisions IN ACCESS EXCLUSIVE MODE;
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM volunteer_stays) OR EXISTS (SELECT 1 FROM volunteer_stay_revisions) THEN
          RAISE EXCEPTION 'Cannot roll back volunteer stays while saved agreements or revisions exist';
        END IF;
      END $$;
      DROP TABLE volunteer_stay_revisions;
      DROP TABLE volunteer_stays;`, { transaction });
    // View grants may have existed independently; do not revoke them on rollback.
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export async function verify({ context }: MigrationParams): Promise<{ ok: boolean; details: unknown }> {
  const [rows] = await context.sequelize.query(`
    SELECT to_regclass('public.volunteer_stays') IS NOT NULL AS stays_exist,
      to_regclass('public.volunteer_stay_revisions') IS NOT NULL AS revisions_exist,
      (SELECT COUNT(*) = 6 FROM pg_constraint
        WHERE conrelid = to_regclass('public.volunteer_stays')
        AND conname IN ('volunteer_stays_date_range_ck', 'volunteer_stays_position_ck',
          'volunteer_stays_revision_ck', 'volunteer_stays_monthly_targets_ck',
          'volunteer_stays_shift_type_ids_ck', 'volunteer_stays_feedback_ck')) AS checks_exist,
      EXISTS (SELECT 1 FROM pg_constraint
        WHERE conrelid = to_regclass('public.volunteer_stay_revisions')
          AND conname = 'volunteer_stay_revisions_stay_revision_uq') AS revision_unique;`);
  const details = (rows as Array<{ stays_exist: boolean; revisions_exist: boolean; checks_exist: boolean; revision_unique: boolean }>)[0];
  return { ok: Boolean(details?.stays_exist && details.revisions_exist && details.checks_exist && details.revision_unique), details };
}
