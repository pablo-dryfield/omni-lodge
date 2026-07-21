import type { QueryInterface, Transaction } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const PAGE_SLUG = 'requests';
const MODULE_SLUG = 'requests-center';
const ROLE_SLUGS = ['admin', 'administrator', 'owner', 'manager', 'assistant-manager'];
const ACTION_KEYS = ['view', 'update'];

async function upsertRequestsAccess(qi: QueryInterface, transaction: Transaction): Promise<void> {
  await qi.sequelize.query(
    `INSERT INTO pages (slug, name, description, "sortOrder", status, "createdAt", "updatedAt")
     VALUES (:slug, :name, :description, :sortOrder, true, NOW(), NOW())
     ON CONFLICT (slug)
     DO UPDATE SET
       name = EXCLUDED.name,
       description = EXCLUDED.description,
       "sortOrder" = EXCLUDED."sortOrder",
       status = true,
       "updatedAt" = NOW();`,
    {
      transaction,
      replacements: {
        slug: PAGE_SLUG,
        name: 'Requests',
        description: 'Review operational requests and approvals',
        sortOrder: 9,
      },
    },
  );

  await qi.sequelize.query(
    `INSERT INTO modules ("pageId", slug, name, description, "componentRef", "sortOrder", status, "createdAt", "updatedAt")
     SELECT p.id, :moduleSlug, :name, :description, :componentRef, 1, true, NOW(), NOW()
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
    {
      transaction,
      replacements: {
        pageSlug: PAGE_SLUG,
        moduleSlug: MODULE_SLUG,
        name: 'Requests Center',
        description: 'Review pending signup, schedule, and finance requests',
        componentRef: 'RequestsPage',
      },
    },
  );

  await qi.sequelize.query(
    `INSERT INTO "moduleActions" ("moduleId", "actionId", enabled, "createdAt", "updatedAt")
     SELECT m.id, a.id, true, NOW(), NOW()
     FROM modules m
     JOIN actions a ON a.key IN (:actionKeys)
     WHERE m.slug = :moduleSlug
     ON CONFLICT ("moduleId", "actionId")
     DO UPDATE SET enabled = true, "updatedAt" = NOW();`,
    {
      transaction,
      replacements: {
        moduleSlug: MODULE_SLUG,
        actionKeys: ACTION_KEYS,
      },
    },
  );

  await qi.sequelize.query(
    `INSERT INTO "rolePagePermissions" ("userTypeId", "pageId", "canView", status, "createdAt", "updatedAt")
     SELECT ut.id, p.id, true, true, NOW(), NOW()
     FROM "userTypes" ut
     CROSS JOIN pages p
     WHERE ut.slug IN (:roleSlugs)
       AND p.slug = :pageSlug
     ON CONFLICT ("userTypeId", "pageId")
     DO UPDATE SET "canView" = true, status = true, "updatedAt" = NOW();`,
    {
      transaction,
      replacements: {
        roleSlugs: ROLE_SLUGS,
        pageSlug: PAGE_SLUG,
      },
    },
  );

  await qi.sequelize.query(
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
    await upsertRequestsAccess(context, transaction);
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
      `DELETE FROM modules WHERE slug = :moduleSlug;`,
      { transaction, replacements: { moduleSlug: MODULE_SLUG } },
    );
    await context.sequelize.query(
      `DELETE FROM "rolePagePermissions"
       WHERE "pageId" IN (SELECT id FROM pages WHERE slug = :pageSlug);`,
      { transaction, replacements: { pageSlug: PAGE_SLUG } },
    );
    await context.sequelize.query(
      `DELETE FROM pages WHERE slug = :pageSlug;`,
      { transaction, replacements: { pageSlug: PAGE_SLUG } },
    );
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}
