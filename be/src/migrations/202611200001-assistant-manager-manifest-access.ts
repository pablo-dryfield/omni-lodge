import type { QueryInterface } from 'sequelize';

type MigrationParams = { context: QueryInterface };
const MODULE_SLUG = 'bank-transfer-booking-management';
const ACTION_KEYS = ['view', 'update'];
const ROLE_KEYS = ['assistantmanager', 'assistmanager'];
const roleMatch = "lower(regexp_replace(ut.slug, '[[:space:]_-]+', '', 'g')) IN (:roleKeys)";

export async function up({ context }: MigrationParams): Promise<void> {
  await context.sequelize.transaction(async transaction => {
    // Existing bank-transfer validation remains permission-based. Grant the two
    // permissions needed to view and amend these bookings, without granting creation.
    await context.sequelize.query(
      `INSERT INTO "roleModulePermissions" ("userTypeId", "moduleId", "actionId", allowed, status, "createdAt", "updatedAt")
       SELECT ut.id, m.id, a.id, true, true, NOW(), NOW()
         FROM "userTypes" ut
         CROSS JOIN modules m
         JOIN actions a ON a.key IN (:actionKeys)
        WHERE ${roleMatch} AND m.slug = :moduleSlug
       ON CONFLICT ("userTypeId", "moduleId", "actionId")
       DO UPDATE SET allowed = true, status = true, "updatedAt" = NOW();`,
      { transaction, replacements: { moduleSlug: MODULE_SLUG, actionKeys: ACTION_KEYS, roleKeys: ROLE_KEYS } },
    );
  });
}

export async function down({ context }: MigrationParams): Promise<void> {
  // Permissions may predate this migration or have subsequently been edited by
  // an administrator. Never revoke those choices on application rollback.
  void context;
}

export async function verify({ context }: MigrationParams): Promise<{ ok: boolean; details: unknown }> {
  const [rows] = await context.sequelize.query(
    `SELECT
       (SELECT COUNT(*)::integer FROM modules WHERE slug = :moduleSlug) AS module_count,
       (SELECT COUNT(*)::integer FROM "userTypes" ut WHERE ${roleMatch}) AS role_count,
       NOT EXISTS (
         SELECT 1 FROM "userTypes" ut WHERE ${roleMatch}
           AND (SELECT COUNT(DISTINCT a.key) FROM "roleModulePermissions" rmp
             JOIN modules m ON m.id = rmp."moduleId"
             JOIN actions a ON a.id = rmp."actionId"
             WHERE rmp."userTypeId" = ut.id AND m.slug = :moduleSlug
               AND a.key IN (:actionKeys) AND rmp.allowed = true AND rmp.status = true) <> :actionCount
       ) AS roles_have_access;`,
    { replacements: { moduleSlug: MODULE_SLUG, actionKeys: ACTION_KEYS, roleKeys: ROLE_KEYS, actionCount: ACTION_KEYS.length } },
  );
  const access = (rows as Array<{ module_count: number; role_count: number; roles_have_access: boolean }>)[0];
  return {
    // Fresh installations create the optional role/module through the normal seed.
    ok: Number(access?.module_count) === 0 || Number(access?.role_count) === 0 || access?.roles_have_access === true,
    details: { access },
  };
}
