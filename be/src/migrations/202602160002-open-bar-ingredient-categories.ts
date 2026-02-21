import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const TABLE_CATEGORIES = 'open_bar_ingredient_categories';
const TABLE_INGREDIENTS = 'open_bar_ingredients';
const LEGACY_ENUM_NAME = 'enum_open_bar_ingredients_category';

const DEFAULT_CATEGORIES: Array<{ name: string; slug: string; sortOrder: number }> = [
  { name: 'Spirit', slug: 'spirit', sortOrder: 10 },
  { name: 'Mixer', slug: 'mixer', sortOrder: 20 },
  { name: 'Beer', slug: 'beer', sortOrder: 30 },
  { name: 'Soft Drink', slug: 'soft_drink', sortOrder: 40 },
  { name: 'Garnish', slug: 'garnish', sortOrder: 50 },
  { name: 'Other', slug: 'other', sortOrder: 90 },
];

const LEGACY_ALLOWED_VALUES = DEFAULT_CATEGORIES.map((entry) => entry.slug);

export async function up({ context }: MigrationParams): Promise<void> {
  const qi = context;
  const transaction = await qi.sequelize.transaction();
  try {
    await qi.createTable(
      TABLE_CATEGORIES,
      {
        id: {
          type: DataTypes.INTEGER,
          autoIncrement: true,
          primaryKey: true,
        },
        name: {
          type: DataTypes.STRING(120),
          allowNull: false,
          unique: true,
        },
        slug: {
          type: DataTypes.STRING(80),
          allowNull: false,
          unique: true,
        },
        sort_order: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 0,
        },
        is_active: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: true,
        },
        created_by: {
          type: DataTypes.INTEGER,
          allowNull: true,
          references: { model: 'users', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        updated_by: {
          type: DataTypes.INTEGER,
          allowNull: true,
          references: { model: 'users', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        created_at: {
          type: DataTypes.DATE,
          allowNull: false,
          defaultValue: DataTypes.NOW,
        },
        updated_at: {
          type: DataTypes.DATE,
          allowNull: true,
        },
      },
      { transaction },
    );

    await qi.addIndex(TABLE_CATEGORIES, ['is_active', 'sort_order'], {
      name: 'open_bar_ingredient_categories_active_sort_idx',
      transaction,
    });

    await qi.sequelize.query(
      `
      ALTER TABLE ${TABLE_INGREDIENTS}
      ALTER COLUMN category TYPE VARCHAR(80)
      USING category::text;
      `,
      { transaction },
    );
    await qi.sequelize.query(
      `
      ALTER TABLE ${TABLE_INGREDIENTS}
      ALTER COLUMN category SET DEFAULT 'other';
      `,
      { transaction },
    );
    await qi.sequelize.query(`DROP TYPE IF EXISTS "${LEGACY_ENUM_NAME}";`, { transaction });

    await qi.sequelize.query(
      `
      INSERT INTO ${TABLE_CATEGORIES}
        (name, slug, sort_order, is_active, created_at, updated_at)
      SELECT
        INITCAP(REPLACE(category, '_', ' ')) AS name,
        category AS slug,
        100,
        true,
        NOW(),
        NOW()
      FROM ${TABLE_INGREDIENTS}
      WHERE category IS NOT NULL
        AND TRIM(category) <> ''
      GROUP BY category
      ON CONFLICT (slug) DO NOTHING;
      `,
      { transaction },
    );

    for (const category of DEFAULT_CATEGORIES) {
      await qi.sequelize.query(
        `
        INSERT INTO ${TABLE_CATEGORIES}
          (name, slug, sort_order, is_active, created_at, updated_at)
        VALUES
          (:name, :slug, :sortOrder, true, NOW(), NOW())
        ON CONFLICT (slug)
        DO UPDATE SET
          name = EXCLUDED.name,
          sort_order = EXCLUDED.sort_order,
          is_active = true,
          updated_at = NOW();
        `,
        { transaction, replacements: category },
      );
    }

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
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = '${LEGACY_ENUM_NAME}') THEN
          CREATE TYPE "${LEGACY_ENUM_NAME}" AS ENUM ('spirit', 'mixer', 'beer', 'soft_drink', 'garnish', 'other');
        END IF;
      END $$;
      `,
      { transaction },
    );

    await qi.sequelize.query(
      `
      ALTER TABLE ${TABLE_INGREDIENTS}
      ALTER COLUMN category TYPE "${LEGACY_ENUM_NAME}"
      USING (
        CASE
          WHEN category IN (${LEGACY_ALLOWED_VALUES.map((value) => `'${value}'`).join(', ')}) THEN category
          ELSE 'other'
        END
      )::"${LEGACY_ENUM_NAME}";
      `,
      { transaction },
    );
    await qi.sequelize.query(
      `
      ALTER TABLE ${TABLE_INGREDIENTS}
      ALTER COLUMN category SET DEFAULT 'other';
      `,
      { transaction },
    );

    await qi.dropTable(TABLE_CATEGORIES, { transaction });
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

