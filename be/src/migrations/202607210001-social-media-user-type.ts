import type { QueryInterface } from 'sequelize';

type MigrationParams = { context: QueryInterface };

export async function up({ context }: MigrationParams): Promise<void> {
  await context.sequelize.query(`
    INSERT INTO "userTypes" ("slug", "name", "description", "isDefault", "status", "createdAt", "updatedAt")
    VALUES ('social-media', 'Social Media', 'Social media staff access', false, true, NOW(), NOW())
    ON CONFLICT ("slug") DO UPDATE
    SET
      "name" = EXCLUDED."name",
      "description" = EXCLUDED."description",
      "status" = true,
      "updatedAt" = NOW();
  `);

  await context.sequelize.query(`
    INSERT INTO "rolePagePermissions" ("userTypeId", "pageId", "canView", "status", "createdAt", "updatedAt")
    SELECT social.id, guide_pages."pageId", guide_pages."canView", guide_pages."status", NOW(), NOW()
    FROM "userTypes" social
    JOIN "userTypes" guide ON guide.slug = 'guide'
    JOIN "rolePagePermissions" guide_pages ON guide_pages."userTypeId" = guide.id
    WHERE social.slug = 'social-media'
    ON CONFLICT ("userTypeId", "pageId") DO UPDATE
    SET
      "canView" = EXCLUDED."canView",
      "status" = EXCLUDED."status",
      "updatedAt" = NOW();
  `);

  await context.sequelize.query(`
    INSERT INTO "roleModulePermissions" ("userTypeId", "moduleId", "actionId", "allowed", "status", "createdAt", "updatedAt")
    SELECT social.id, guide_modules."moduleId", guide_modules."actionId", guide_modules."allowed", guide_modules."status", NOW(), NOW()
    FROM "userTypes" social
    JOIN "userTypes" guide ON guide.slug = 'guide'
    JOIN "roleModulePermissions" guide_modules ON guide_modules."userTypeId" = guide.id
    WHERE social.slug = 'social-media'
    ON CONFLICT ("userTypeId", "moduleId", "actionId") DO UPDATE
    SET
      "allowed" = EXCLUDED."allowed",
      "status" = EXCLUDED."status",
      "updatedAt" = NOW();
  `);
}

export async function down({ context }: MigrationParams): Promise<void> {
  await context.sequelize.query(`
    DELETE FROM "roleModulePermissions"
    WHERE "userTypeId" IN (SELECT id FROM "userTypes" WHERE slug = 'social-media');
  `);
  await context.sequelize.query(`
    DELETE FROM "rolePagePermissions"
    WHERE "userTypeId" IN (SELECT id FROM "userTypes" WHERE slug = 'social-media');
  `);
  await context.sequelize.query(`
    DELETE FROM "userTypes"
    WHERE slug = 'social-media';
  `);
}
