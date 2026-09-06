import { DataTypes, type QueryInterface, type Transaction } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const ATTENDANCE_TABLE = 'volunteer_shift_attendance';
const FEEDBACK_TABLE = 'volunteer_milestone_feedback';
const PAGE_SLUG = 'volunteer-progress';
const MODULE_SLUG = 'volunteer-progress';
const VIEW_ROLES = ['admin', 'administrator', 'owner', 'manager', 'assistant-manager', 'guide'];
const MANAGEMENT_ROLES = ['admin', 'administrator', 'owner', 'manager', 'assistant-manager'];

async function upsertAccessControl(context: QueryInterface, transaction: Transaction): Promise<void> {
  await context.sequelize.query(
    `INSERT INTO pages (slug, name, description, "sortOrder", status, "createdAt", "updatedAt")
     VALUES (:pageSlug, 'Volunteer Milestones',
             'Track transparent monthly volunteer star progress and management feedback',
             10, true, NOW(), NOW())
     ON CONFLICT (slug)
     DO UPDATE SET
       name = EXCLUDED.name,
       description = EXCLUDED.description,
       "sortOrder" = EXCLUDED."sortOrder",
       status = true,
       "updatedAt" = NOW();`,
    { transaction, replacements: { pageSlug: PAGE_SLUG } },
  );

  await context.sequelize.query(
    `INSERT INTO modules ("pageId", slug, name, description, "componentRef", "sortOrder", status, "createdAt", "updatedAt")
     SELECT p.id, :moduleSlug, 'Volunteer Milestones',
            'Review personal progress and manage volunteer attendance and feedback',
            'VolunteerProgress', 1, true, NOW(), NOW()
       FROM pages p
      WHERE p.slug = :pageSlug
     ON CONFLICT (slug)
     DO UPDATE SET
       "pageId" = EXCLUDED."pageId",
       name = EXCLUDED.name,
       description = EXCLUDED.description,
       "componentRef" = EXCLUDED."componentRef",
       "sortOrder" = EXCLUDED."sortOrder",
       status = true,
       "updatedAt" = NOW();`,
    { transaction, replacements: { pageSlug: PAGE_SLUG, moduleSlug: MODULE_SLUG } },
  );

  await context.sequelize.query(
    `INSERT INTO "moduleActions" ("moduleId", "actionId", enabled, "createdAt", "updatedAt")
     SELECT m.id, a.id, true, NOW(), NOW()
       FROM modules m
       JOIN actions a ON a.key IN ('view', 'update')
      WHERE m.slug = :moduleSlug
     ON CONFLICT ("moduleId", "actionId")
     DO UPDATE SET enabled = true, "updatedAt" = NOW();`,
    { transaction, replacements: { moduleSlug: MODULE_SLUG } },
  );

  await context.sequelize.query(
    `INSERT INTO "rolePagePermissions" ("userTypeId", "pageId", "canView", status, "createdAt", "updatedAt")
     SELECT ut.id, p.id, true, true, NOW(), NOW()
       FROM "userTypes" ut
       CROSS JOIN pages p
      WHERE ut.slug IN (:roleSlugs)
        AND p.slug = :pageSlug
     ON CONFLICT ("userTypeId", "pageId")
     DO UPDATE SET "canView" = true, status = true, "updatedAt" = NOW();`,
    { transaction, replacements: { pageSlug: PAGE_SLUG, roleSlugs: VIEW_ROLES } },
  );

  await context.sequelize.query(
    `INSERT INTO "roleModulePermissions" ("userTypeId", "moduleId", "actionId", allowed, status, "createdAt", "updatedAt")
     SELECT ut.id, m.id, a.id, true, true, NOW(), NOW()
       FROM "userTypes" ut
       CROSS JOIN modules m
       JOIN actions a ON a.key = 'view'
      WHERE ut.slug IN (:roleSlugs)
        AND m.slug = :moduleSlug
     ON CONFLICT ("userTypeId", "moduleId", "actionId")
     DO UPDATE SET allowed = true, status = true, "updatedAt" = NOW();`,
    { transaction, replacements: { moduleSlug: MODULE_SLUG, roleSlugs: VIEW_ROLES } },
  );

  await context.sequelize.query(
    `INSERT INTO "roleModulePermissions" ("userTypeId", "moduleId", "actionId", allowed, status, "createdAt", "updatedAt")
     SELECT ut.id, m.id, a.id, true, true, NOW(), NOW()
       FROM "userTypes" ut
       CROSS JOIN modules m
       JOIN actions a ON a.key = 'update'
      WHERE ut.slug IN (:roleSlugs)
        AND m.slug = :moduleSlug
     ON CONFLICT ("userTypeId", "moduleId", "actionId")
     DO UPDATE SET allowed = true, status = true, "updatedAt" = NOW();`,
    { transaction, replacements: { moduleSlug: MODULE_SLUG, roleSlugs: MANAGEMENT_ROLES } },
  );
}

export async function up({ context }: MigrationParams): Promise<void> {
  const transaction = await context.sequelize.transaction();
  try {
    await context.createTable(
      ATTENDANCE_TABLE,
      {
        id: {
          type: DataTypes.INTEGER,
          allowNull: false,
          autoIncrement: true,
          primaryKey: true,
        },
        shift_assignment_id: {
          type: DataTypes.INTEGER,
          allowNull: false,
          references: { model: 'shift_assignments', key: 'id' },
          onDelete: 'CASCADE',
          onUpdate: 'CASCADE',
        },
        status: { type: DataTypes.STRING(16), allowNull: false },
        notes: { type: DataTypes.TEXT, allowNull: true },
        recorded_by: {
          type: DataTypes.INTEGER,
          allowNull: true,
          references: { model: 'users', key: 'id' },
          onDelete: 'SET NULL',
          onUpdate: 'CASCADE',
        },
        recorded_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
        created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
        updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      },
      { transaction },
    );

    await context.sequelize.query(
      `ALTER TABLE ${ATTENDANCE_TABLE}
         ADD CONSTRAINT volunteer_shift_attendance_status_ck
         CHECK (status IN ('attended', 'late', 'absent', 'excused')),
         ADD CONSTRAINT volunteer_shift_attendance_notes_ck
         CHECK (notes IS NULL OR length(notes) <= 2000);`,
      { transaction },
    );
    await context.addIndex(ATTENDANCE_TABLE, ['shift_assignment_id'], {
      name: 'volunteer_shift_attendance_assignment_uq',
      unique: true,
      transaction,
    });
    await context.addIndex(ATTENDANCE_TABLE, ['status'], {
      name: 'volunteer_shift_attendance_status_idx',
      transaction,
    });

    await context.createTable(
      FEEDBACK_TABLE,
      {
        id: {
          type: DataTypes.INTEGER,
          allowNull: false,
          autoIncrement: true,
          primaryKey: true,
        },
        volunteer_user_id: {
          type: DataTypes.INTEGER,
          allowNull: false,
          references: { model: 'users', key: 'id' },
          onDelete: 'CASCADE',
          onUpdate: 'CASCADE',
        },
        period_start: { type: DataTypes.DATEONLY, allowNull: false },
        feedback: { type: DataTypes.TEXT, allowNull: true },
        approved: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        approved_by: {
          type: DataTypes.INTEGER,
          allowNull: true,
          references: { model: 'users', key: 'id' },
          onDelete: 'SET NULL',
          onUpdate: 'CASCADE',
        },
        approved_at: { type: DataTypes.DATE, allowNull: true },
        created_by: {
          type: DataTypes.INTEGER,
          allowNull: true,
          references: { model: 'users', key: 'id' },
          onDelete: 'SET NULL',
          onUpdate: 'CASCADE',
        },
        updated_by: {
          type: DataTypes.INTEGER,
          allowNull: true,
          references: { model: 'users', key: 'id' },
          onDelete: 'SET NULL',
          onUpdate: 'CASCADE',
        },
        created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
        updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      },
      { transaction },
    );

    await context.sequelize.query(
      `ALTER TABLE ${FEEDBACK_TABLE}
         ADD CONSTRAINT volunteer_milestone_feedback_period_start_ck
         CHECK (EXTRACT(DAY FROM period_start) = 1),
         ADD CONSTRAINT volunteer_milestone_feedback_text_ck
         CHECK (feedback IS NULL OR length(feedback) <= 5000),
         ADD CONSTRAINT volunteer_milestone_feedback_approval_ck
         CHECK (
           (approved = false AND approved_by IS NULL AND approved_at IS NULL)
           OR
           (approved = true AND approved_at IS NOT NULL
            AND feedback IS NOT NULL AND length(btrim(feedback)) > 0)
         );`,
      { transaction },
    );
    await context.addIndex(FEEDBACK_TABLE, ['volunteer_user_id', 'period_start'], {
      name: 'volunteer_milestone_feedback_user_period_uq',
      unique: true,
      transaction,
    });
    await context.addIndex(FEEDBACK_TABLE, ['period_start'], {
      name: 'volunteer_milestone_feedback_period_idx',
      transaction,
    });

    await upsertAccessControl(context, transaction);
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export async function down({ context }: MigrationParams): Promise<void> {
  const transaction = await context.sequelize.transaction();
  try {
    await context.sequelize.query(
      `DELETE FROM "roleModulePermissions"
        WHERE "moduleId" IN (SELECT id FROM modules WHERE slug = :moduleSlug);`,
      { transaction, replacements: { moduleSlug: MODULE_SLUG } },
    );
    await context.sequelize.query(
      `DELETE FROM "moduleActions"
        WHERE "moduleId" IN (SELECT id FROM modules WHERE slug = :moduleSlug);`,
      { transaction, replacements: { moduleSlug: MODULE_SLUG } },
    );
    await context.sequelize.query('DELETE FROM modules WHERE slug = :moduleSlug;', {
      transaction,
      replacements: { moduleSlug: MODULE_SLUG },
    });
    await context.sequelize.query(
      `DELETE FROM "rolePagePermissions"
        WHERE "pageId" IN (SELECT id FROM pages WHERE slug = :pageSlug);`,
      { transaction, replacements: { pageSlug: PAGE_SLUG } },
    );
    await context.sequelize.query('DELETE FROM pages WHERE slug = :pageSlug;', {
      transaction,
      replacements: { pageSlug: PAGE_SLUG },
    });
    await context.dropTable(FEEDBACK_TABLE, { transaction });
    await context.dropTable(ATTENDANCE_TABLE, { transaction });
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export async function verify({ context }: MigrationParams): Promise<{ ok: boolean; details: unknown }> {
  const attendance = await context.describeTable(ATTENDANCE_TABLE);
  const feedback = await context.describeTable(FEEDBACK_TABLE);
  const [rows] = await context.sequelize.query(
    `SELECT
       EXISTS (SELECT 1 FROM pages WHERE slug = :pageSlug) AS page_exists,
       EXISTS (SELECT 1 FROM modules WHERE slug = :moduleSlug) AS module_exists,
       EXISTS (
         SELECT 1
           FROM "roleModulePermissions" rmp
           JOIN "userTypes" ut ON ut.id = rmp."userTypeId"
           JOIN modules m ON m.id = rmp."moduleId"
           JOIN actions a ON a.id = rmp."actionId"
          WHERE ut.slug = 'guide' AND m.slug = :moduleSlug AND a.key = 'view'
            AND rmp.allowed = true AND rmp.status = true
       ) AS guide_view_exists;`,
    { replacements: { pageSlug: PAGE_SLUG, moduleSlug: MODULE_SLUG } },
  );
  const access = (rows as Array<{
    page_exists: boolean;
    module_exists: boolean;
    guide_view_exists: boolean;
  }>)[0];
  const attendanceColumns = ['shift_assignment_id', 'status', 'recorded_by', 'recorded_at'];
  const feedbackColumns = ['volunteer_user_id', 'period_start', 'feedback', 'approved', 'approved_by', 'approved_at'];
  const missingAttendanceColumns = attendanceColumns.filter((column) => !attendance[column]);
  const missingFeedbackColumns = feedbackColumns.filter((column) => !feedback[column]);

  return {
    ok:
      missingAttendanceColumns.length === 0
      && missingFeedbackColumns.length === 0
      && Boolean(access?.page_exists)
      && Boolean(access?.module_exists)
      && Boolean(access?.guide_view_exists),
    details: { missingAttendanceColumns, missingFeedbackColumns, access },
  };
}
