import type { QueryInterface, Transaction } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const ROLE_SLUG = 'assistant-manager';
const MODULE_SLUG = 'review-counter-management';
const ACTION_KEYS = ['create', 'update'];

async function grantReviewManagementAccess(
  context: QueryInterface,
  transaction: Transaction,
): Promise<void> {
  await context.sequelize.query(
    `INSERT INTO "roleModulePermissions" ("userTypeId", "moduleId", "actionId", allowed, status, "createdAt", "updatedAt")
     SELECT ut.id, m.id, a.id, true, true, NOW(), NOW()
       FROM "userTypes" ut
       CROSS JOIN modules m
       JOIN actions a ON a.key IN (:actionKeys)
      WHERE ut.slug = :roleSlug
        AND m.slug = :moduleSlug
     ON CONFLICT ("userTypeId", "moduleId", "actionId")
     DO UPDATE SET allowed = true, status = true, "updatedAt" = NOW();`,
    {
      transaction,
      replacements: { actionKeys: ACTION_KEYS, moduleSlug: MODULE_SLUG, roleSlug: ROLE_SLUG },
    },
  );
}

export async function up({ context }: MigrationParams): Promise<void> {
  const transaction = await context.sequelize.transaction();
  try {
    await grantReviewManagementAccess(context, transaction);
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export async function down({ context }: MigrationParams): Promise<void> {
  // Access may have existed before this migration, so rollback must not revoke it.
  void context;
}

export async function verify({ context }: MigrationParams): Promise<{ ok: boolean; details: unknown }> {
  const [rows] = await context.sequelize.query(
    `SELECT NOT EXISTS (
       SELECT 1
         FROM unnest(ARRAY[:actionKeys]::text[]) required_action(key)
        WHERE NOT EXISTS (
          SELECT 1
            FROM "userTypes" ut
            JOIN "roleModulePermissions" rmp ON rmp."userTypeId" = ut.id
            JOIN modules m ON m.id = rmp."moduleId"
            JOIN actions a ON a.id = rmp."actionId"
           WHERE ut.slug = :roleSlug
             AND m.slug = :moduleSlug
             AND a.key = required_action.key
             AND rmp.allowed = true
             AND rmp.status = true
        )
     ) AS assistant_manager_has_review_management;`,
    {
      replacements: { actionKeys: ACTION_KEYS, moduleSlug: MODULE_SLUG, roleSlug: ROLE_SLUG },
    },
  );
  const access = (rows as Array<{ assistant_manager_has_review_management: boolean }>)[0];

  return {
    ok: Boolean(access?.assistant_manager_has_review_management),
    details: { access },
  };
}
