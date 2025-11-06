import type { QueryInterface } from "sequelize";
import { DataTypes } from "sequelize";

type MigrationParams = { context: QueryInterface };

const TABLE_REPORT_TEMPLATES = "report_templates";
const TABLE_REPORT_SCHEDULES = "report_schedules";
const TABLE_DERIVED_FIELDS = "derived_field_definitions";
const TABLE_QUERY_CACHE = "report_query_cache";
const TABLE_DASHBOARDS = "report_dashboards";
const TABLE_DASHBOARD_CARDS = "report_dashboard_cards";
const TABLE_ASYNC_JOBS = "report_async_jobs";

export async function up({ context }: MigrationParams): Promise<void> {
  const qi = context;

  await qi.addColumn(TABLE_REPORT_TEMPLATES, "query_config", {
    type: DataTypes.JSONB,
    allowNull: true,
    defaultValue: null,
  });

  await qi.addColumn(TABLE_REPORT_TEMPLATES, "derived_fields", {
    type: DataTypes.JSONB,
    allowNull: false,
    defaultValue: [],
  });

  await qi.addColumn(TABLE_REPORT_TEMPLATES, "metrics_spotlight", {
    type: DataTypes.JSONB,
    allowNull: false,
    defaultValue: [],
  });

  await qi.createTable(TABLE_REPORT_SCHEDULES, {
    id: {
      type: DataTypes.UUID,
      allowNull: false,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    template_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: TABLE_REPORT_TEMPLATES,
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },
    cadence: {
      type: DataTypes.STRING(120),
      allowNull: false,
    },
    timezone: {
      type: DataTypes.STRING(64),
      allowNull: false,
      defaultValue: "UTC",
    },
    delivery_targets: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: [],
    },
    last_run_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    next_run_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    status: {
      type: DataTypes.STRING(32),
      allowNull: false,
      defaultValue: "active",
    },
    meta: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: {},
    },
    created_at: {
      allowNull: false,
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
    updated_at: {
      allowNull: false,
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
  });

  await qi.createTable(TABLE_DERIVED_FIELDS, {
    id: {
      type: DataTypes.UUID,
      allowNull: false,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    scope: {
      type: DataTypes.STRING(32),
      allowNull: false,
      defaultValue: "workspace",
    },
    workspace_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    template_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: TABLE_REPORT_TEMPLATES,
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },
    name: {
      type: DataTypes.STRING(160),
      allowNull: false,
    },
    expression: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    kind: {
      type: DataTypes.STRING(32),
      allowNull: false,
      defaultValue: "row",
    },
    metadata: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: {},
    },
    created_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    created_at: {
      allowNull: false,
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
    updated_at: {
      allowNull: false,
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
  });

  await qi.createTable(TABLE_QUERY_CACHE, {
    hash: {
      type: DataTypes.STRING(128),
      allowNull: false,
      primaryKey: true,
    },
    template_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: TABLE_REPORT_TEMPLATES,
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    },
    result: {
      type: DataTypes.JSONB,
      allowNull: false,
    },
    meta: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: {},
    },
    created_at: {
      allowNull: false,
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
    expires_at: {
      allowNull: false,
      type: DataTypes.DATE,
    },
  });

  await qi.createTable(TABLE_DASHBOARDS, {
    id: {
      type: DataTypes.UUID,
      allowNull: false,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    owner_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: "users",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    },
    name: {
      type: DataTypes.STRING(160),
      allowNull: false,
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
    filters: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: {},
    },
    share_token: {
      type: DataTypes.STRING(64),
      allowNull: true,
      unique: true,
    },
    share_expires_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    created_at: {
      allowNull: false,
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
    updated_at: {
      allowNull: false,
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
  });

  await qi.createTable(TABLE_DASHBOARD_CARDS, {
    id: {
      type: DataTypes.UUID,
      allowNull: false,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    dashboard_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: TABLE_DASHBOARDS,
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },
    template_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: TABLE_REPORT_TEMPLATES,
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },
    title: {
      type: DataTypes.STRING(160),
      allowNull: false,
    },
    view_config: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: {},
    },
    layout: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: {},
    },
    created_at: {
      allowNull: false,
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
    updated_at: {
      allowNull: false,
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
  });

  await qi.createTable(TABLE_ASYNC_JOBS, {
    id: {
      type: DataTypes.UUID,
      allowNull: false,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    hash: {
      type: DataTypes.STRING(128),
      allowNull: true,
    },
    status: {
      type: DataTypes.STRING(32),
      allowNull: false,
      defaultValue: "queued",
    },
    payload: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: {},
    },
    result: {
      type: DataTypes.JSONB,
      allowNull: true,
    },
    error: {
      type: DataTypes.JSONB,
      allowNull: true,
    },
    created_at: {
      allowNull: false,
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
    updated_at: {
      allowNull: false,
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
    started_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    finished_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  });

  await qi.addIndex(TABLE_REPORT_SCHEDULES, ["template_id"], {
    name: "report_schedules_template_id_idx",
  });

  await qi.addIndex(TABLE_DERIVED_FIELDS, ["template_id"], {
    name: "derived_fields_template_id_idx",
  });

  await qi.addIndex(TABLE_DASHBOARD_CARDS, ["dashboard_id"], {
    name: "dashboard_cards_dashboard_id_idx",
  });

  await qi.addIndex(TABLE_QUERY_CACHE, ["expires_at"], {
    name: "report_query_cache_expires_at_idx",
  });
}

export async function down({ context }: MigrationParams): Promise<void> {
  const qi = context;

  await qi.removeColumn(TABLE_REPORT_TEMPLATES, "query_config");
  await qi.removeColumn(TABLE_REPORT_TEMPLATES, "derived_fields");
  await qi.removeColumn(TABLE_REPORT_TEMPLATES, "metrics_spotlight");

  await qi.dropTable(TABLE_ASYNC_JOBS);
  await qi.dropTable(TABLE_DASHBOARD_CARDS);
  await qi.dropTable(TABLE_DASHBOARDS);
  await qi.dropTable(TABLE_QUERY_CACHE);
  await qi.dropTable(TABLE_DERIVED_FIELDS);
  await qi.dropTable(TABLE_REPORT_SCHEDULES);
}
