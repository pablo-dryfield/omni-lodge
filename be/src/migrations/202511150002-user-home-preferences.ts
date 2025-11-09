import type { QueryInterface } from "sequelize";
import { DataTypes } from "sequelize";

type MigrationParams = { context: QueryInterface };

const TABLE_USER_HOME_PREFERENCES = "user_home_preferences";
const TABLE_USERS = "users";

export async function up({ context }: MigrationParams): Promise<void> {
  const qi = context;

  await qi.createTable(TABLE_USER_HOME_PREFERENCES, {
    id: {
      type: DataTypes.UUID,
      allowNull: false,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: TABLE_USERS,
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
      unique: true,
    },
    view_mode: {
      type: DataTypes.STRING(32),
      allowNull: false,
      defaultValue: "navigation",
    },
    saved_dashboard_ids: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: [],
    },
    active_dashboard_id: {
      type: DataTypes.UUID,
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

  await qi.addIndex(TABLE_USER_HOME_PREFERENCES, ["user_id"], {
    name: "user_home_preferences_user_id_idx",
    unique: true,
  });
}

export async function down({ context }: MigrationParams): Promise<void> {
  const qi = context;
  await qi.dropTable(TABLE_USER_HOME_PREFERENCES);
}
