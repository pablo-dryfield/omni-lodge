import type { QueryInterface } from "sequelize";
import { DataTypes } from "sequelize";

type MigrationParams = { context: QueryInterface };

const TABLE_COMPENSATION_COMPONENTS = "compensation_components";
const TABLE_COMPENSATION_ASSIGNMENTS = "compensation_component_assignments";
const TABLE_USERS = "users";
const TABLE_SHIFT_ROLES = "shift_roles";
const TABLE_USER_TYPES = "user_types";

export async function up({ context }: MigrationParams): Promise<void> {
  const qi = context;

  await qi.createTable(TABLE_COMPENSATION_COMPONENTS, {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
    },
    name: {
      type: DataTypes.STRING(150),
      allowNull: false,
    },
    slug: {
      type: DataTypes.STRING(180),
      allowNull: false,
      unique: true,
    },
    category: {
      type: DataTypes.ENUM("base", "commission", "incentive", "bonus", "review", "deduction", "adjustment"),
      allowNull: false,
      defaultValue: "base",
    },
    calculation_method: {
      type: DataTypes.ENUM("flat", "per_unit", "tiered", "percentage", "task_score", "hybrid"),
      allowNull: false,
      defaultValue: "flat",
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    config: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: {},
    },
    currency_code: {
      type: DataTypes.STRING(3),
      allowNull: false,
      defaultValue: "PLN",
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

  await qi.createTable(TABLE_COMPENSATION_ASSIGNMENTS, {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
    },
    component_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: TABLE_COMPENSATION_COMPONENTS, key: "id" },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },
    target_scope: {
      type: DataTypes.ENUM("global", "shift_role", "user", "user_type", "staff_type"),
      allowNull: false,
      defaultValue: "global",
    },
    shift_role_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: TABLE_SHIFT_ROLES, key: "id" },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    },
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: TABLE_USERS, key: "id" },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    },
    user_type_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: TABLE_USER_TYPES, key: "id" },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    },
    staff_type: {
      type: DataTypes.STRING(64),
      allowNull: true,
    },
    effective_start: {
      type: DataTypes.DATEONLY,
      allowNull: true,
    },
    effective_end: {
      type: DataTypes.DATEONLY,
      allowNull: true,
    },
    base_amount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0,
    },
    unit_amount: {
      type: DataTypes.DECIMAL(12, 4),
      allowNull: false,
      defaultValue: 0,
    },
    unit_label: {
      type: DataTypes.STRING(32),
      allowNull: true,
    },
    currency_code: {
      type: DataTypes.STRING(3),
      allowNull: false,
      defaultValue: "PLN",
    },
    task_list: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: [],
    },
    config: {
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

  await qi.addIndex(TABLE_COMPENSATION_COMPONENTS, ["slug"], {
    unique: true,
    name: "compensation_components_slug_idx",
  });

  await qi.addIndex(TABLE_COMPENSATION_ASSIGNMENTS, ["component_id"], {
    name: "compensation_assignments_component_idx",
  });

  await qi.addIndex(TABLE_COMPENSATION_ASSIGNMENTS, ["target_scope"], {
    name: "compensation_assignments_scope_idx",
  });
}

export async function down({ context }: MigrationParams): Promise<void> {
  const qi = context;
  await qi.dropTable(TABLE_COMPENSATION_ASSIGNMENTS);
  await qi.dropTable(TABLE_COMPENSATION_COMPONENTS);
}
