import type { QueryInterface, Transaction } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const PAGE_SLUG = 'bookings';
const MODULE_SLUG = 'bank-transfer-booking-management';
const ROLE_SLUGS = ['admin', 'administrator', 'owner', 'manager'];
const ACTION_KEYS = ['view', 'create', 'update'];

async function upsertBankTransferBookingAccess(
  context: QueryInterface,
  transaction: Transaction,
): Promise<void> {
  await context.sequelize.query(
    `INSERT INTO modules ("pageId", slug, name, description, "componentRef", "sortOrder", status, "createdAt", "updatedAt")
     SELECT p.id, :moduleSlug, 'Bank Transfer Bookings',
            'Create bank-transfer reservations and reconcile received payments',
            'BankTransferBookingManagement', 2, true, NOW(), NOW()
       FROM pages p
      WHERE p.slug = :pageSlug
     ON CONFLICT (slug)
     DO UPDATE SET
       "pageId" = EXCLUDED."pageId",
       name = EXCLUDED.name,
       description = EXCLUDED.description,
       "componentRef" = EXCLUDED."componentRef",
       status = true,
       "updatedAt" = NOW();`,
    { transaction, replacements: { moduleSlug: MODULE_SLUG, pageSlug: PAGE_SLUG } },
  );

  await context.sequelize.query(
    `INSERT INTO "moduleActions" ("moduleId", "actionId", enabled, "createdAt", "updatedAt")
     SELECT m.id, a.id, true, NOW(), NOW()
       FROM modules m
       JOIN actions a ON a.key IN (:actionKeys)
      WHERE m.slug = :moduleSlug
     ON CONFLICT ("moduleId", "actionId")
     DO UPDATE SET enabled = true, "updatedAt" = NOW();`,
    { transaction, replacements: { moduleSlug: MODULE_SLUG, actionKeys: ACTION_KEYS } },
  );

  await context.sequelize.query(
    `INSERT INTO "roleModulePermissions" ("userTypeId", "moduleId", "actionId", allowed, status, "createdAt", "updatedAt")
     SELECT ut.id, m.id, a.id, true, true, NOW(), NOW()
       FROM "userTypes" ut
       CROSS JOIN modules m
       JOIN actions a ON a.key IN (:actionKeys)
      WHERE ut.slug IN (:roleSlugs)
        AND m.slug = :moduleSlug
     ON CONFLICT ("userTypeId", "moduleId", "actionId")
     DO UPDATE SET allowed = true, status = true, "updatedAt" = NOW();`,
    {
      transaction,
      replacements: {
        roleSlugs: ROLE_SLUGS,
        moduleSlug: MODULE_SLUG,
        actionKeys: ACTION_KEYS,
      },
    },
  );
}

export async function up({ context }: MigrationParams): Promise<void> {
  const transaction = await context.sequelize.transaction();
  try {
    await upsertBankTransferBookingAccess(context, transaction);
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
    await context.sequelize.query(
      'DELETE FROM modules WHERE slug = :moduleSlug;',
      { transaction, replacements: { moduleSlug: MODULE_SLUG } },
    );
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export async function verify({ context }: MigrationParams): Promise<{ ok: boolean; details: unknown }> {
  const [rows] = await context.sequelize.query(
    `SELECT
       EXISTS (
         SELECT 1
           FROM modules m
           JOIN pages p ON p.id = m."pageId"
          WHERE m.slug = :moduleSlug
            AND p.slug = :pageSlug
            AND m.status = true
            AND p.status = true
       ) AS module_exists,
       (SELECT COUNT(DISTINCT a.key)::integer
          FROM "moduleActions" ma
          JOIN modules m ON m.id = ma."moduleId"
          JOIN actions a ON a.id = ma."actionId"
         WHERE m.slug = :moduleSlug
           AND a.key IN (:actionKeys)
           AND ma.enabled = true) AS action_count,
       (SELECT COUNT(*)::integer
          FROM "userTypes" ut
         WHERE ut.slug IN (:roleSlugs)) AS default_role_count,
       NOT EXISTS (
         SELECT 1
           FROM "userTypes" ut
          WHERE ut.slug IN (:roleSlugs)
            AND (
              SELECT COUNT(DISTINCT a.key)
                FROM "roleModulePermissions" rmp
                JOIN modules m ON m.id = rmp."moduleId"
                JOIN actions a ON a.id = rmp."actionId"
               WHERE rmp."userTypeId" = ut.id
                 AND m.slug = :moduleSlug
                 AND a.key IN (:actionKeys)
                 AND rmp.allowed = true
                 AND rmp.status = true
            ) <> :actionCount
       ) AS default_roles_have_access;`,
    {
      replacements: {
        pageSlug: PAGE_SLUG,
        moduleSlug: MODULE_SLUG,
        roleSlugs: ROLE_SLUGS,
        actionKeys: ACTION_KEYS,
        actionCount: ACTION_KEYS.length,
      },
    },
  );
  const access = (rows as Array<{
    module_exists: boolean;
    action_count: number;
    default_role_count: number;
    default_roles_have_access: boolean;
  }>)[0];
  const ok = Boolean(
    access?.module_exists
    && Number(access.action_count) === ACTION_KEYS.length
    // Role rows are configuration data and production may not contain every
    // supported alias (notably the legacy `administrator` role). Verify the
    // grants for every matching role that actually exists without requiring
    // optional role records to be present.
    && Number(access.default_role_count) > 0
    && access.default_roles_have_access,
  );

  return { ok, details: { access } };
}
