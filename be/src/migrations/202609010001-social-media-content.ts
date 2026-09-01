import { DataTypes, type QueryInterface, type Transaction } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const TABLE_NAME = 'social_media_contents';
const PAGE_SLUG = 'social-media';
const MODULE_SLUG = 'social-media-content';
const ROLE_SLUGS = ['admin', 'administrator', 'owner', 'manager', 'assistant-manager', 'social-media'];
const ACTION_KEYS = ['view', 'create', 'update', 'delete'];

async function upsertAccessControl(context: QueryInterface, transaction: Transaction): Promise<void> {
  await context.sequelize.query(
    `INSERT INTO pages (slug, name, description, "sortOrder", status, "createdAt", "updatedAt")
     VALUES (:slug, 'Social Media', 'Plan, produce, and publish short-form social content', 8, true, NOW(), NOW())
     ON CONFLICT (slug)
     DO UPDATE SET
       name = EXCLUDED.name,
       description = EXCLUDED.description,
       status = true,
       "updatedAt" = NOW();`,
    { transaction, replacements: { slug: PAGE_SLUG } },
  );

  await context.sequelize.query(
    `INSERT INTO modules ("pageId", slug, name, description, "componentRef", "sortOrder", status, "createdAt", "updatedAt")
     SELECT p.id, :moduleSlug, 'Social Media Content',
            'Plan and manage Reels, TikToks, and other short-form video content',
            'SocialMediaPage', 1, true, NOW(), NOW()
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
    `INSERT INTO "rolePagePermissions" ("userTypeId", "pageId", "canView", status, "createdAt", "updatedAt")
     SELECT ut.id, p.id, true, true, NOW(), NOW()
       FROM "userTypes" ut
       CROSS JOIN pages p
      WHERE ut.slug IN (:roleSlugs)
        AND p.slug = :pageSlug
     ON CONFLICT ("userTypeId", "pageId")
     DO UPDATE SET "canView" = true, status = true, "updatedAt" = NOW();`,
    { transaction, replacements: { roleSlugs: ROLE_SLUGS, pageSlug: PAGE_SLUG } },
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
      replacements: { roleSlugs: ROLE_SLUGS, moduleSlug: MODULE_SLUG, actionKeys: ACTION_KEYS },
    },
  );
}

export async function up({ context }: MigrationParams): Promise<void> {
  const transaction = await context.sequelize.transaction();
  try {
    await context.createTable(
      TABLE_NAME,
      {
        id: {
          type: DataTypes.INTEGER,
          allowNull: false,
          autoIncrement: true,
          primaryKey: true,
        },
        title: { type: DataTypes.STRING(180), allowNull: false },
        idea: { type: DataTypes.TEXT, allowNull: false },
        on_video_captions: { type: DataTypes.TEXT, allowNull: false, defaultValue: '' },
        platform_caption: { type: DataTypes.TEXT, allowNull: false, defaultValue: '' },
        hashtags: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
        target_platforms: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
        status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'idea' },
        scheduled_at: { type: DataTypes.DATE, allowNull: true },
        published_at: { type: DataTypes.DATE, allowNull: true },
        drive_project_url: { type: DataTypes.TEXT, allowNull: true },
        platform_links: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
        thumbnail_url: { type: DataTypes.TEXT, allowNull: true },
        thumbnail_drive_file_id: { type: DataTypes.STRING(255), allowNull: true },
        thumbnail_original_name: { type: DataTypes.STRING(255), allowNull: true },
        thumbnail_mime_type: { type: DataTypes.STRING(100), allowNull: true },
        archived_at: { type: DataTypes.DATE, allowNull: true },
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
      `ALTER TABLE ${TABLE_NAME}
         ADD CONSTRAINT social_media_contents_status_ck
         CHECK (status IN ('idea', 'planned', 'in_production', 'ready', 'published', 'archived')),
         ADD CONSTRAINT social_media_contents_title_ck
         CHECK (length(btrim(title)) > 0),
         ADD CONSTRAINT social_media_contents_idea_ck
         CHECK (length(btrim(idea)) > 0),
         ADD CONSTRAINT social_media_contents_hashtags_json_ck
         CHECK (jsonb_typeof(hashtags) = 'array'),
         ADD CONSTRAINT social_media_contents_platforms_json_ck
         CHECK (jsonb_typeof(target_platforms) = 'array'),
         ADD CONSTRAINT social_media_contents_platform_links_json_ck
         CHECK (jsonb_typeof(platform_links) = 'object');`,
      { transaction },
    );
    await context.addIndex(TABLE_NAME, ['status'], {
      name: 'social_media_contents_status_idx',
      transaction,
    });
    await context.addIndex(TABLE_NAME, ['scheduled_at'], {
      name: 'social_media_contents_scheduled_at_idx',
      transaction,
    });
    await context.addIndex(TABLE_NAME, ['target_platforms'], {
      name: 'social_media_contents_target_platforms_gin_idx',
      using: 'gin',
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
    await context.dropTable(TABLE_NAME, { transaction });
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export async function verify({ context }: MigrationParams): Promise<{ ok: boolean; details: unknown }> {
  const table = await context.describeTable(TABLE_NAME);
  const [accessRows] = await context.sequelize.query(
    `SELECT
       EXISTS (SELECT 1 FROM pages WHERE slug = :pageSlug) AS page_exists,
       EXISTS (SELECT 1 FROM modules WHERE slug = :moduleSlug) AS module_exists;`,
    { replacements: { pageSlug: PAGE_SLUG, moduleSlug: MODULE_SLUG } },
  );
  const access = (accessRows as Array<{ page_exists: boolean; module_exists: boolean }>)[0];
  const requiredColumns = [
    'title',
    'idea',
    'on_video_captions',
    'platform_caption',
    'hashtags',
    'target_platforms',
    'status',
    'drive_project_url',
    'platform_links',
  ];
  const missingColumns = requiredColumns.filter((column) => !table[column]);
  return {
    ok: missingColumns.length === 0 && Boolean(access?.page_exists) && Boolean(access?.module_exists),
    details: { missingColumns, access },
  };
}
