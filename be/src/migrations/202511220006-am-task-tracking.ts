import type { QueryInterface } from "sequelize";
import { DataTypes } from "sequelize";

type MigrationParams = { context: QueryInterface };

const TABLE_TASK_TEMPLATES = "am_task_templates";
const TABLE_TASK_ASSIGNMENTS = "am_task_assignments";
const TABLE_TASK_LOGS = "am_task_logs";
const TABLE_USERS = "users";
const TABLE_STAFF_PROFILES = "staff_profiles";

export async function up({ context }: MigrationParams): Promise<void> {
  const qi = context;

  await qi.createTable(TABLE_TASK_TEMPLATES, {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
      allowNull: false,
    },
    name: {
      type: DataTypes.STRING(160),
      allowNull: false,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    cadence: {
      type: DataTypes.ENUM("daily", "weekly", "biweekly", "every_two_weeks", "monthly"),
      allowNull: false,
      defaultValue: "daily",
    },
    schedule_config: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: {},
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
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

  await qi.createTable(TABLE_TASK_ASSIGNMENTS, {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
      allowNull: false,
    },
    template_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: TABLE_TASK_TEMPLATES, key: "id" },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },
    target_scope: {
      type: DataTypes.ENUM("staff_type", "user"),
      allowNull: false,
      defaultValue: "staff_type",
    },
    staff_type: {
      type: DataTypes.STRING(64),
      allowNull: true,
    },
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: TABLE_USERS, key: "id" },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    },
    effective_start: {
      type: DataTypes.DATEONLY,
      allowNull: true,
    },
    effective_end: {
      type: DataTypes.DATEONLY,
      allowNull: true,
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
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

  await qi.createTable(TABLE_TASK_LOGS, {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
      allowNull: false,
    },
    template_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: TABLE_TASK_TEMPLATES, key: "id" },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },
    assignment_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: TABLE_TASK_ASSIGNMENTS, key: "id" },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    },
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: TABLE_USERS, key: "id" },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },
    task_date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    status: {
      type: DataTypes.ENUM("pending", "completed", "missed", "waived"),
      allowNull: false,
      defaultValue: "pending",
    },
    completed_at: {
      type: DataTypes.DATE,
      allowNull: true,
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

  await qi.addIndex(TABLE_TASK_ASSIGNMENTS, ["template_id"], {
    name: "am_task_assignments_template_idx",
  });

  await qi.addIndex(TABLE_TASK_ASSIGNMENTS, ["target_scope"], {
    name: "am_task_assignments_scope_idx",
  });

  await qi.addIndex(TABLE_TASK_LOGS, ["template_id", "user_id", "task_date"], {
    unique: true,
    name: "am_task_logs_unique_per_user",
  });

  await qi.addIndex(TABLE_TASK_LOGS, ["status"], { name: "am_task_logs_status_idx" });
}

export async function down({ context }: MigrationParams): Promise<void> {
  const qi = context;
  await qi.dropTable(TABLE_TASK_LOGS);
  await qi.dropTable(TABLE_TASK_ASSIGNMENTS);
  await qi.dropTable(TABLE_TASK_TEMPLATES);
}
