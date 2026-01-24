import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const TABLE_CONFIG_KEYS = 'config_keys';
const TABLE_CONFIG_VALUES = 'config_values';
const TABLE_CONFIG_HISTORY = 'config_history';
const TABLE_USERS = 'users';

export async function up({ context }: MigrationParams): Promise<void> {
  const qi = context;

  await qi.createTable(TABLE_CONFIG_KEYS, {
    key: {
      type: DataTypes.STRING(128),
      allowNull: false,
      primaryKey: true,
    },
    label: {
      type: DataTypes.STRING(128),
      allowNull: false,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    category: {
      type: DataTypes.STRING(128),
      allowNull: false,
      defaultValue: 'General',
    },
    value_type: {
      type: DataTypes.STRING(32),
      allowNull: false,
      defaultValue: 'string',
    },
    default_value: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    validation_rules: {
      type: DataTypes.JSONB,
      allowNull: true,
    },
    is_secret: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    is_editable: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    impact: {
      type: DataTypes.STRING(16),
      allowNull: false,
      defaultValue: 'low',
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    updated_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  });

  await qi.createTable(TABLE_CONFIG_VALUES, {
    key: {
      type: DataTypes.STRING(128),
      allowNull: false,
      primaryKey: true,
      references: { model: TABLE_CONFIG_KEYS, key: 'key' },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
    value: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    encrypted_value: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    encryption_iv: {
      type: DataTypes.STRING(64),
      allowNull: true,
    },
    encryption_tag: {
      type: DataTypes.STRING(64),
      allowNull: true,
    },
    updated_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: TABLE_USERS, key: 'id' },
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
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  });

  await qi.createTable(TABLE_CONFIG_HISTORY, {
    id: {
      type: DataTypes.BIGINT,
      allowNull: false,
      autoIncrement: true,
      primaryKey: true,
    },
    key: {
      type: DataTypes.STRING(128),
      allowNull: false,
      references: { model: TABLE_CONFIG_KEYS, key: 'key' },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
    actor_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: TABLE_USERS, key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    },
    old_value: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    new_value: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    is_secret: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    reason: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  });

  await qi.addIndex(TABLE_CONFIG_KEYS, ['category'], { name: 'config_keys_category_idx' });
  await qi.addIndex(TABLE_CONFIG_VALUES, ['updated_by'], { name: 'config_values_updated_by_idx' });
  await qi.addIndex(TABLE_CONFIG_HISTORY, ['key'], { name: 'config_history_key_idx' });
}

export async function down({ context }: MigrationParams): Promise<void> {
  const qi = context;

  await qi.dropTable(TABLE_CONFIG_HISTORY);
  await qi.dropTable(TABLE_CONFIG_VALUES);
  await qi.dropTable(TABLE_CONFIG_KEYS);
}

export async function verify({ context }: MigrationParams): Promise<string[]> {
  const qi = context;
  const missing: string[] = [];
  const [rows] = await qi.sequelize.query(
    'SELECT to_regclass(:keys) AS keys, to_regclass(:values) AS values, to_regclass(:history) AS history',
    {
      replacements: {
        keys: `public.${TABLE_CONFIG_KEYS}`,
        values: `public.${TABLE_CONFIG_VALUES}`,
        history: `public.${TABLE_CONFIG_HISTORY}`,
      },
    },
  );
  const row = rows as Array<{ keys: string | null; values: string | null; history: string | null }>;
  if (!row[0]?.keys) {
    missing.push(TABLE_CONFIG_KEYS);
  }
  if (!row[0]?.values) {
    missing.push(TABLE_CONFIG_VALUES);
  }
  if (!row[0]?.history) {
    missing.push(TABLE_CONFIG_HISTORY);
  }
  return missing;
}
