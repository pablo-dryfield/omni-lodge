import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const TABLE_PRODUCT_ALIASES = 'product_aliases';
const TABLE_PRODUCTS = 'products';
const TABLE_USERS = 'users';

const MATCH_TYPES = ['exact', 'contains', 'regex'] as const;

export async function up({ context }: MigrationParams): Promise<void> {
  const qi = context;

  await qi.createTable(TABLE_PRODUCT_ALIASES, {
    id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      autoIncrement: true,
      primaryKey: true,
    },
    product_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: TABLE_PRODUCTS, key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    },
    label: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    normalized_label: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    match_type: {
      type: DataTypes.ENUM(...MATCH_TYPES),
      allowNull: false,
      defaultValue: 'contains',
    },
    priority: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 100,
    },
    active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    hit_count: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    first_seen_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    last_seen_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    source: {
      type: DataTypes.STRING(64),
      allowNull: true,
    },
    created_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: TABLE_USERS, key: 'id' },
      onUpdate: 'SET NULL',
      onDelete: 'SET NULL',
    },
    updated_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: TABLE_USERS, key: 'id' },
      onUpdate: 'SET NULL',
      onDelete: 'SET NULL',
    },
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    updatedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  });

  await qi.addIndex(TABLE_PRODUCT_ALIASES, ['normalized_label'], {
    name: 'product_aliases_normalized_label_idx',
  });
  await qi.addIndex(TABLE_PRODUCT_ALIASES, ['product_id'], {
    name: 'product_aliases_product_id_idx',
  });
  await qi.addIndex(TABLE_PRODUCT_ALIASES, ['match_type', 'priority'], {
    name: 'product_aliases_match_priority_idx',
  });
}

export async function down({ context }: MigrationParams): Promise<void> {
  const qi = context;
  await qi.dropTable(TABLE_PRODUCT_ALIASES);
  await qi.sequelize.query('DROP TYPE IF EXISTS "enum_product_aliases_match_type";');
}
