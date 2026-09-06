import type { QueryInterface, Transaction } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const PAGE_SLUG = 'volunteer-progress';
const MODULE_SLUG = 'volunteer-progress';
const LEGACY_VOLUNTEER_ROLE = 'pub-crawl-guide';

async function upsertVolunteerViewAccess(
  context: QueryInterface,
  transaction: Transaction,
): Promise<void> {
  await context.sequelize.query(
    `INSERT INTO "rolePagePermissions" ("userTypeId", "pageId", "canView", status, "createdAt", "updatedAt")
     SELECT ut.id, p.id, true, true, NOW(), NOW()
       FROM "userTypes" ut
       CROSS JOIN pages p
      WHERE ut.slug = :roleSlug
        AND p.slug = :pageSlug
     ON CONFLICT ("userTypeId", "pageId")
     DO UPDATE SET "canView" = true, status = true, "updatedAt" = NOW();`,
    {
      transaction,
      replacements: { pageSlug: PAGE_SLUG, roleSlug: LEGACY_VOLUNTEER_ROLE },
    },
  );

  await context.sequelize.query(
    `INSERT INTO "roleModulePermissions" ("userTypeId", "moduleId", "actionId", allowed, status, "createdAt", "updatedAt")
     SELECT ut.id, m.id, a.id, true, true, NOW(), NOW()
       FROM "userTypes" ut
       CROSS JOIN modules m
       JOIN actions a ON a.key = 'view'
      WHERE ut.slug = :roleSlug
        AND m.slug = :moduleSlug
     ON CONFLICT ("userTypeId", "moduleId", "actionId")
     DO UPDATE SET allowed = true, status = true, "updatedAt" = NOW();`,
    {
      transaction,
      replacements: { moduleSlug: MODULE_SLUG, roleSlug: LEGACY_VOLUNTEER_ROLE },
    },
  );
}

export async function up({ context }: MigrationParams): Promise<void> {
  const transaction = await context.sequelize.transaction();
  try {
    await upsertVolunteerViewAccess(context, transaction);
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export async function down({ context }: MigrationParams): Promise<void> {
  // This migration repairs access rows that may already have been created by
  // 202609060001. Removing them here could revoke valid access while that
  // migration remains applied, so rollback is intentionally a safe no-op.
  void context;
}

export async function verify({ context }: MigrationParams): Promise<{ ok: boolean; details: unknown }> {
  const [rows] = await context.sequelize.query(
    `SELECT
       (SELECT COUNT(*)::integer
          FROM "userTypes" ut
         WHERE ut.slug = :roleSlug) AS legacy_role_count,
       NOT EXISTS (
         SELECT 1
           FROM "userTypes" ut
          WHERE ut.slug = :roleSlug
            AND (
              NOT EXISTS (
                SELECT 1
                  FROM "rolePagePermissions" rpp
                  JOIN pages p ON p.id = rpp."pageId"
                 WHERE rpp."userTypeId" = ut.id
                   AND p.slug = :pageSlug
                   AND p.status = true
                   AND rpp."canView" = true
                   AND rpp.status = true
              )
              OR NOT EXISTS (
                SELECT 1
                  FROM "roleModulePermissions" rmp
                  JOIN modules m ON m.id = rmp."moduleId"
                  JOIN actions a ON a.id = rmp."actionId"
                 WHERE rmp."userTypeId" = ut.id
                   AND m.slug = :moduleSlug
                   AND m.status = true
                   AND a.key = 'view'
                   AND rmp.allowed = true
                   AND rmp.status = true
              )
            )
       ) AS legacy_role_has_view;`,
    {
      replacements: {
        pageSlug: PAGE_SLUG,
        moduleSlug: MODULE_SLUG,
        roleSlug: LEGACY_VOLUNTEER_ROLE,
      },
    },
  );
  const access = (rows as Array<{
    legacy_role_count: number;
    legacy_role_has_view: boolean;
  }>)[0];

  return {
    ok: Boolean(access?.legacy_role_has_view),
    details: { access },
  };
}
