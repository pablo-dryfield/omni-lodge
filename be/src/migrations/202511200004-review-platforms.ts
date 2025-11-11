import type { QueryInterface } from "sequelize";
import { DataTypes } from "sequelize";

type MigrationParams = { context: QueryInterface };

const TABLE_REVIEW_PLATFORMS = "review_platforms";

export async function up({ context }: MigrationParams): Promise<void> {
  const qi = context;

  await qi.createTable(TABLE_REVIEW_PLATFORMS, {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
    },
    name: {
      type: DataTypes.STRING(120),
      allowNull: false,
    },
    slug: {
      type: DataTypes.STRING(160),
      allowNull: false,
      unique: true,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
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

  await qi.addIndex(TABLE_REVIEW_PLATFORMS, ["slug"], {
    unique: true,
    name: "review_platforms_slug_idx",
  });
}

export async function down({ context }: MigrationParams): Promise<void> {
  const qi = context;
  await qi.dropTable(TABLE_REVIEW_PLATFORMS);
}
