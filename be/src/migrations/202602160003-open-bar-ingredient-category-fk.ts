import type { QueryInterface, Transaction } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const TABLE_INGREDIENTS = 'open_bar_ingredients';
const TABLE_CATEGORIES = 'open_bar_ingredient_categories';
const FK_NAME = 'open_bar_ingredients_category_id_fkey';
const INDEX_NAME = 'open_bar_ingredients_category_id_idx';
const DEFAULT_CATEGORY_SLUG = 'other';

const ensureDefaultCategory = async (qi: QueryInterface, transaction: Transaction): Promise<number> => {
  await qi.sequelize.query(
    `
    INSERT INTO ${TABLE_CATEGORIES}
      (name, slug, sort_order, is_active, created_at, updated_at)
    VALUES
      ('Other', :slug, 90, true, NOW(), NOW())
    ON CONFLICT (slug) DO NOTHING;
    `,
    { transaction, replacements: { slug: DEFAULT_CATEGORY_SLUG } },
  );

  const [rows] = await qi.sequelize.query(
    `
    SELECT id
    FROM ${TABLE_CATEGORIES}
    WHERE slug = :slug
    ORDER BY id ASC
    LIMIT 1;
    `,
    { transaction, replacements: { slug: DEFAULT_CATEGORY_SLUG } },
  );

  const defaultCategory = Array.isArray(rows) ? (rows[0] as { id: number } | undefined) : undefined;
  if (!defaultCategory || !defaultCategory.id) {
    throw new Error('Failed to resolve default open bar ingredient category');
  }
  return Number(defaultCategory.id);
};

export async function up({ context }: MigrationParams): Promise<void> {
  const qi = context;
  const transaction = await qi.sequelize.transaction();
  try {
    const fallbackCategoryId = await ensureDefaultCategory(qi, transaction);

    await qi.sequelize.query(
      `
      ALTER TABLE ${TABLE_INGREDIENTS}
      ADD COLUMN IF NOT EXISTS category_id INTEGER;
      `,
      { transaction },
    );

    await qi.sequelize.query(
      `
      UPDATE ${TABLE_INGREDIENTS} AS ingredients
      SET category_id = categories.id
      FROM ${TABLE_CATEGORIES} AS categories
      WHERE ingredients.category_id IS NULL
        AND ingredients.category IS NOT NULL
        AND TRIM(ingredients.category) <> ''
        AND categories.slug = ingredients.category;
      `,
      { transaction },
    );

    await qi.sequelize.query(
      `
      UPDATE ${TABLE_INGREDIENTS}
      SET category_id = :fallbackCategoryId
      WHERE category_id IS NULL;
      `,
      { transaction, replacements: { fallbackCategoryId } },
    );

    await qi.sequelize.query(
      `
      ALTER TABLE ${TABLE_INGREDIENTS}
      ALTER COLUMN category_id SET NOT NULL;
      `,
      { transaction },
    );

    await qi.sequelize.query(
      `
      CREATE INDEX IF NOT EXISTS ${INDEX_NAME}
      ON ${TABLE_INGREDIENTS} (category_id);
      `,
      { transaction },
    );

    await qi.sequelize.query(
      `
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = '${FK_NAME}'
        ) THEN
          ALTER TABLE ${TABLE_INGREDIENTS}
          ADD CONSTRAINT ${FK_NAME}
          FOREIGN KEY (category_id)
          REFERENCES ${TABLE_CATEGORIES}(id)
          ON UPDATE CASCADE
          ON DELETE RESTRICT;
        END IF;
      END $$;
      `,
      { transaction },
    );

    await qi.sequelize.query(
      `
      ALTER TABLE ${TABLE_INGREDIENTS}
      DROP COLUMN IF EXISTS category;
      `,
      { transaction },
    );

    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export async function down({ context }: MigrationParams): Promise<void> {
  const qi = context;
  const transaction = await qi.sequelize.transaction();
  try {
    await qi.sequelize.query(
      `
      ALTER TABLE ${TABLE_INGREDIENTS}
      ADD COLUMN IF NOT EXISTS category VARCHAR(80);
      `,
      { transaction },
    );

    await qi.sequelize.query(
      `
      UPDATE ${TABLE_INGREDIENTS} AS ingredients
      SET category = categories.slug
      FROM ${TABLE_CATEGORIES} AS categories
      WHERE ingredients.category_id = categories.id;
      `,
      { transaction },
    );

    await qi.sequelize.query(
      `
      UPDATE ${TABLE_INGREDIENTS}
      SET category = :defaultCategory
      WHERE category IS NULL OR TRIM(category) = '';
      `,
      { transaction, replacements: { defaultCategory: DEFAULT_CATEGORY_SLUG } },
    );

    await qi.sequelize.query(
      `
      ALTER TABLE ${TABLE_INGREDIENTS}
      ALTER COLUMN category SET NOT NULL,
      ALTER COLUMN category SET DEFAULT :defaultCategory;
      `,
      { transaction, replacements: { defaultCategory: DEFAULT_CATEGORY_SLUG } },
    );

    await qi.sequelize.query(
      `
      ALTER TABLE ${TABLE_INGREDIENTS}
      DROP CONSTRAINT IF EXISTS ${FK_NAME};
      `,
      { transaction },
    );

    await qi.sequelize.query(
      `
      DROP INDEX IF EXISTS ${INDEX_NAME};
      `,
      { transaction },
    );

    await qi.sequelize.query(
      `
      ALTER TABLE ${TABLE_INGREDIENTS}
      DROP COLUMN IF EXISTS category_id;
      `,
      { transaction },
    );

    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}
