import type { QueryInterface } from "sequelize";
import { DataTypes } from "sequelize";

type MigrationParams = { context: QueryInterface };

const TABLE_REVIEW_COUNTERS = "review_counters";
const TABLE_REVIEW_COUNTER_ENTRIES = "review_counter_entries";
const TABLE_USERS = "users";

export async function up({ context }: MigrationParams): Promise<void> {
  const qi = context;

  await qi.createTable(TABLE_REVIEW_COUNTERS, {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
      allowNull: false,
    },
    platform: {
      type: DataTypes.STRING(64),
      allowNull: false,
    },
    period_start: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    period_end: {
      type: DataTypes.DATEONLY,
      allowNull: true,
    },
    total_reviews: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    first_review_author: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    second_review_author: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    before_last_review_author: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    last_review_author: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    bad_review_count: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    no_name_review_count: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    meta: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: {},
    },
    created_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: TABLE_USERS, key: "id" },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    },
    updated_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: TABLE_USERS, key: "id" },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
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

  await qi.addIndex(TABLE_REVIEW_COUNTERS, ['platform', 'period_start'], {
    unique: true,
    name: 'review_counters_platform_period_idx',
  });

  await qi.createTable(TABLE_REVIEW_COUNTER_ENTRIES, {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
      allowNull: false,
    },
    counter_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: TABLE_REVIEW_COUNTERS, key: 'id' },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: TABLE_USERS, key: 'id' },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    },
    display_name: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    category: {
      type: DataTypes.STRING(32),
      allowNull: false,
      defaultValue: 'staff',
    },
    raw_count: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
    },
    rounded_count: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    meta: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: {},
    },
    created_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: TABLE_USERS, key: 'id' },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    },
    updated_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: TABLE_USERS, key: 'id' },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
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

  await qi.addIndex(TABLE_REVIEW_COUNTER_ENTRIES, ['counter_id'], {
    name: 'review_counter_entries_counter_idx',
  });

  await qi.addIndex(TABLE_REVIEW_COUNTER_ENTRIES, ['user_id'], {
    name: 'review_counter_entries_user_idx',
  });
}

export async function down({ context }: MigrationParams): Promise<void> {
  const qi = context;
  await qi.dropTable(TABLE_REVIEW_COUNTER_ENTRIES);
  await qi.dropTable(TABLE_REVIEW_COUNTERS);
}
